package ptzcontrol

import (
	"context"
	"encoding/xml"
	"fmt"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/icholy/digest"
	"github.com/juju/errors"
	onvifsdk "github.com/use-go/onvif"
	"github.com/use-go/onvif/gosoap"
	"github.com/use-go/onvif/media"
	"github.com/use-go/onvif/networking"
	"github.com/use-go/onvif/ptz"
	"github.com/use-go/onvif/sdk"
	mediaapi "github.com/use-go/onvif/sdk/media"
	ptzapi "github.com/use-go/onvif/sdk/ptz"
	"github.com/use-go/onvif/xsd"
	onvifxsd "github.com/use-go/onvif/xsd/onvif"
)

type moveStatus struct {
	PanTilt string `json:"panTilt,omitempty"`
	Zoom    string `json:"zoom,omitempty"`
}

type ptzRange struct {
	Max float64 `json:"max"`
	Min float64 `json:"min"`
}

type ptzCapabilities struct {
	CanAbsolutePanTilt   bool      `json:"canAbsolutePanTilt"`
	CanAbsoluteZoom      bool      `json:"canAbsoluteZoom"`
	CanContinuousPanTilt bool      `json:"canContinuousPanTilt"`
	CanContinuousZoom    bool      `json:"canContinuousZoom"`
	CanGoHome            bool      `json:"canGoHome"`
	PanRange             *ptzRange `json:"panRange,omitempty"`
	TiltRange            *ptzRange `json:"tiltRange,omitempty"`
	ZoomRange            *ptzRange `json:"zoomRange,omitempty"`
}

type positionSnapshot struct {
	Capabilities *ptzCapabilities `json:"capabilities,omitempty"`
	CameraName   string           `json:"cameraName"`
	MoveStatus   *moveStatus      `json:"moveStatus,omitempty"`
	Pan          float64          `json:"pan"`
	Tilt         float64          `json:"tilt"`
	UpdatedAt    string           `json:"updatedAt"`
	Zoom         float64          `json:"zoom"`
}

type velocityCommand struct {
	Pan  float64 `json:"pan"`
	Tilt float64 `json:"tilt"`
	Zoom float64 `json:"zoom"`
}

type ptzSpaces struct {
	absolutePanTilt   string
	absoluteZoom      string
	continuousPanTilt string
	continuousZoom    string
}

type ptzLimits struct {
	panMin  float64
	panMax  float64
	tiltMin float64
	tiltMax float64
	zoomMin float64
	zoomMax float64
}

type cameraController struct {
	cfg      CameraConfig
	defaults MoveDefaults

	mu           sync.Mutex
	client       *onvifsdk.Device
	httpClient   *http.Client
	ptzEndpoint  string
	profileToken onvifxsd.ReferenceToken
	capabilities ptzCapabilities
	spaces       ptzSpaces
	limits       ptzLimits
	velocity     ptzLimits
}

func newCameraController(cfg CameraConfig, defaults MoveDefaults) *cameraController {
	return &cameraController{
		cfg:      cfg,
		defaults: defaults,
		limits:   defaultPositionLimits(),
		velocity: defaultVelocityLimits(),
	}
}

func (c *cameraController) GetPosition(ctx context.Context) (*positionSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.ensureConnectedLocked(ctx); err != nil {
		return nil, err
	}

	resp, err := ptzapi.Call_GetStatus(ctx, c.client, ptz.GetStatus{
		ProfileToken: c.profileToken,
	})
	if err != nil {
		return nil, fmt.Errorf("get PTZ status: %w", err)
	}

	return c.positionFromStatus(resp.PTZStatus), nil
}

func (c *cameraController) Capabilities(ctx context.Context) (*ptzCapabilities, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.ensureConnectedLocked(ctx); err != nil {
		return nil, err
	}

	return c.capabilitiesSnapshot(), nil
}

func (c *cameraController) ContinuousMove(ctx context.Context, velocity velocityCommand) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.ensureConnectedLocked(ctx); err != nil {
		return err
	}

	request := continuousMoveRequest{
		ProfileToken: c.profileToken,
		Timeout:      xsd.Duration("PT0.7S"),
	}

	if c.capabilities.CanContinuousPanTilt && (velocity.Pan != 0 || velocity.Tilt != 0) {
		request.Velocity.PanTilt = &onvifxsd.Vector2D{
			X:     scaleVelocityComponent(velocity.Pan, c.velocity.panMin, c.velocity.panMax),
			Y:     scaleVelocityComponent(velocity.Tilt, c.velocity.tiltMin, c.velocity.tiltMax),
			Space: xsd.AnyURI(c.spaces.continuousPanTilt),
		}
	}

	if c.capabilities.CanContinuousZoom && velocity.Zoom != 0 {
		request.Velocity.Zoom = &onvifxsd.Vector1D{
			X:     scaleVelocityComponent(velocity.Zoom, c.velocity.zoomMin, c.velocity.zoomMax),
			Space: xsd.AnyURI(c.spaces.continuousZoom),
		}
	}

	if request.Velocity.PanTilt == nil && request.Velocity.Zoom == nil {
		return fmt.Errorf("camera %s does not support the requested PTZ motion", c.cfg.Name)
	}

	if err := callContinuousMove(ctx, c.ptzEndpoint, c.httpClient, c.cfg.Username, c.cfg.Password, request); err != nil {
		return fmt.Errorf("continuous move: %w", err)
	}

	return nil
}

func (c *cameraController) Stop(ctx context.Context) (*positionSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.ensureConnectedLocked(ctx); err != nil {
		return nil, err
	}

	_, err := ptzapi.Call_Stop(ctx, c.client, ptz.Stop{
		ProfileToken: c.profileToken,
		PanTilt:      xsd.Boolean(c.capabilities.CanContinuousPanTilt),
		Zoom:         xsd.Boolean(c.capabilities.CanContinuousZoom),
	})
	if err != nil {
		return nil, fmt.Errorf("stop PTZ motion: %w", err)
	}

	return c.positionAfterActionLocked(ctx)
}

func (c *cameraController) SetZoom(ctx context.Context, zoomLevel float64) (*positionSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.ensureConnectedLocked(ctx); err != nil {
		return nil, err
	}

	if !c.capabilities.CanAbsoluteZoom {
		return nil, fmt.Errorf("camera %s does not support absolute zoom on this ONVIF profile", c.cfg.Name)
	}

	request := absoluteMoveRequest{
		ProfileToken: c.profileToken,
		Position: optionalPTZVector{
			Zoom: &onvifxsd.Vector1D{
				X:     normalizedToRange(zoomLevel, c.limits.zoomMin, c.limits.zoomMax),
				Space: xsd.AnyURI(c.spaces.absoluteZoom),
			},
		},
		Speed: zoomOnlyMoveSpeed(c.defaults.AbsoluteSpeed, c.capabilities),
	}

	if c.capabilities.CanAbsolutePanTilt {
		current, err := c.getStatusLocked(ctx)
		if err != nil {
			return nil, err
		}

		request.Position.PanTilt = &onvifxsd.Vector2D{
			X:     current.Position.PanTilt.X,
			Y:     current.Position.PanTilt.Y,
			Space: xsd.AnyURI(c.spaces.absolutePanTilt),
		}
		request.Speed = absoluteMoveSpeed(c.defaults.AbsoluteSpeed, c.capabilities)
	}

	if err := callAbsoluteMove(ctx, c.ptzEndpoint, c.httpClient, c.cfg.Username, c.cfg.Password, request); err != nil {
		return nil, fmt.Errorf("absolute zoom move: %w", err)
	}

	return c.positionAfterActionLocked(ctx)
}

func (c *cameraController) GoHome(ctx context.Context) (*positionSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.ensureConnectedLocked(ctx); err != nil {
		return nil, err
	}

	if c.cfg.Home != nil {
		if !c.capabilities.CanAbsolutePanTilt {
			return nil, fmt.Errorf("camera %s does not support absolute pan/tilt moves for the configured home position", c.cfg.Name)
		}

		request := absoluteMoveRequest{
			ProfileToken: c.profileToken,
			Position: optionalPTZVector{
				PanTilt: &onvifxsd.Vector2D{
					X:     clamp(c.cfg.Home.Pan, c.limits.panMin, c.limits.panMax),
					Y:     clamp(c.cfg.Home.Tilt, c.limits.tiltMin, c.limits.tiltMax),
					Space: xsd.AnyURI(c.spaces.absolutePanTilt),
				},
			},
			Speed: absoluteMoveSpeed(c.defaults.AbsoluteSpeed, c.capabilities),
		}

		if c.capabilities.CanAbsoluteZoom {
			request.Position.Zoom = &onvifxsd.Vector1D{
				X:     clamp(c.cfg.Home.Zoom, c.limits.zoomMin, c.limits.zoomMax),
				Space: xsd.AnyURI(c.spaces.absoluteZoom),
			}
		}

		if err := callAbsoluteMove(ctx, c.ptzEndpoint, c.httpClient, c.cfg.Username, c.cfg.Password, request); err != nil {
			return nil, fmt.Errorf("move to configured home: %w", err)
		}
	} else {
		if !c.capabilities.CanGoHome {
			return nil, fmt.Errorf("camera %s does not advertise ONVIF home support on this profile", c.cfg.Name)
		}

		if err := callGotoHomePosition(ctx, c.ptzEndpoint, c.httpClient, c.cfg.Username, c.cfg.Password, gotoHomePositionRequest{
			ProfileToken: c.profileToken,
		}); err != nil {
			return nil, fmt.Errorf("go home: %w", err)
		}
	}

	return c.positionAfterActionLocked(ctx)
}

func (c *cameraController) ensureConnectedLocked(ctx context.Context) error {
	if c.client != nil && c.profileToken != "" {
		return nil
	}

	httpClient := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &digest.Transport{
			Username: c.cfg.Username,
			Password: c.cfg.Password,
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				ResponseHeaderTimeout: 10 * time.Second,
			},
		},
	}

	device, err := onvifsdk.NewDevice(onvifsdk.DeviceParams{
		Xaddr:      fmt.Sprintf("%s:%d", c.cfg.Address, c.cfg.OnvifPort),
		Username:   c.cfg.Username,
		Password:   c.cfg.Password,
		HttpClient: httpClient,
	})
	if err != nil {
		return fmt.Errorf("connect ONVIF device %s: %w", c.cfg.Name, err)
	}

	profileResp, err := mediaapi.Call_GetProfiles(ctx, device, media.GetProfiles{})
	if err != nil {
		return fmt.Errorf("load media profiles for %s: %w", c.cfg.Name, err)
	}
	if len(profileResp.Profiles) == 0 {
		return fmt.Errorf("camera %s returned no media profiles", c.cfg.Name)
	}

	profile, err := c.selectProfile(profileResp.Profiles)
	if err != nil {
		return err
	}

	node, err := c.loadNodeLocked(ctx, device, profile)
	if err != nil {
		return err
	}

	c.client = device
	c.httpClient = httpClient
	c.ptzEndpoint = resolvePTZEndpoint(device)
	c.profileToken = profile.Token
	c.spaces = spacesFromProfileAndNode(profile.PTZConfiguration, node)
	c.limits = positionLimitsFromProfileAndNode(profile.PTZConfiguration, node)
	c.velocity = velocityLimitsFromNode(node)
	c.capabilities = buildCapabilities(c.cfg.Home != nil, c.spaces, c.limits, c.velocity, bool(node.HomeSupported))

	if strings.TrimSpace(c.ptzEndpoint) == "" {
		return fmt.Errorf("camera %s returned no PTZ service endpoint", c.cfg.Name)
	}

	return nil
}

func (c *cameraController) selectProfile(profiles []onvifxsd.Profile) (onvifxsd.Profile, error) {
	if c.cfg.ProfileToken != "" {
		for _, profile := range profiles {
			if string(profile.Token) == c.cfg.ProfileToken {
				return profile, nil
			}
		}
		return onvifxsd.Profile{}, fmt.Errorf("camera %s profile %q not found", c.cfg.Name, c.cfg.ProfileToken)
	}

	for _, profile := range profiles {
		if profile.PTZConfiguration.Token != "" {
			return profile, nil
		}
	}

	return profiles[0], nil
}

func (c *cameraController) loadNodeLocked(
	ctx context.Context,
	device *onvifsdk.Device,
	profile onvifxsd.Profile,
) (onvifxsd.PTZNode, error) {
	nodeToken := profile.PTZConfiguration.NodeToken
	if nodeToken == "" {
		return onvifxsd.PTZNode{}, nil
	}

	nodeResp, err := ptzapi.Call_GetNode(ctx, device, ptz.GetNode{NodeToken: nodeToken})
	if err != nil {
		return onvifxsd.PTZNode{}, fmt.Errorf("load PTZ node for %s: %w", c.cfg.Name, err)
	}

	return nodeResp.PTZNode, nil
}

func (c *cameraController) getStatusLocked(ctx context.Context) (onvifxsd.PTZStatus, error) {
	resp, err := ptzapi.Call_GetStatus(ctx, c.client, ptz.GetStatus{
		ProfileToken: c.profileToken,
	})
	if err != nil {
		return onvifxsd.PTZStatus{}, fmt.Errorf("get PTZ status: %w", err)
	}

	return resp.PTZStatus, nil
}

func (c *cameraController) positionAfterActionLocked(ctx context.Context) (*positionSnapshot, error) {
	var (
		lastStatus onvifxsd.PTZStatus
		lastErr    error
	)

	for attempt := 0; attempt < 4; attempt++ {
		if attempt > 0 {
			time.Sleep(200 * time.Millisecond)
		}

		lastStatus, lastErr = c.getStatusLocked(ctx)
		if lastErr != nil {
			continue
		}

		if statusSettled(lastStatus) || attempt == 3 {
			return c.positionFromStatus(lastStatus), nil
		}
	}

	return nil, lastErr
}

func (c *cameraController) positionFromStatus(status onvifxsd.PTZStatus) *positionSnapshot {
	result := &positionSnapshot{
		Capabilities: c.capabilitiesSnapshot(),
		CameraName:   c.cfg.Name,
		Pan:          status.Position.PanTilt.X,
		Tilt:         status.Position.PanTilt.Y,
		UpdatedAt:    time.Now().UTC().Format(time.RFC3339),
		Zoom:         status.Position.Zoom.X,
	}

	if status.MoveStatus.PanTilt.Status != "" || status.MoveStatus.Zoom.Status != "" {
		result.MoveStatus = &moveStatus{
			PanTilt: status.MoveStatus.PanTilt.Status,
			Zoom:    status.MoveStatus.Zoom.Status,
		}
	}

	return result
}

func (c *cameraController) capabilitiesSnapshot() *ptzCapabilities {
	snapshot := c.capabilities
	return &snapshot
}

func clamp(value float64, min float64, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func defaultPositionLimits() ptzLimits {
	return ptzLimits{
		panMin:  -1,
		panMax:  1,
		tiltMin: -1,
		tiltMax: 1,
		zoomMin: 0,
		zoomMax: 1,
	}
}

func defaultVelocityLimits() ptzLimits {
	return ptzLimits{
		panMin:  -1,
		panMax:  1,
		tiltMin: -1,
		tiltMax: 1,
		zoomMin: -1,
		zoomMax: 1,
	}
}

func spacesFromProfileAndNode(config onvifxsd.PTZConfiguration, node onvifxsd.PTZNode) ptzSpaces {
	return ptzSpaces{
		absolutePanTilt: chooseSpaceURI(
			node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.URI,
			config.DefaultAbsolutePantTiltPositionSpace,
		),
		absoluteZoom: chooseSpaceURI(
			node.SupportedPTZSpaces.AbsoluteZoomPositionSpace.URI,
			config.DefaultAbsoluteZoomPositionSpace,
		),
		continuousPanTilt: chooseSpaceURI(
			node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.URI,
			config.DefaultContinuousPanTiltVelocitySpace,
		),
		continuousZoom: chooseSpaceURI(
			node.SupportedPTZSpaces.ContinuousZoomVelocitySpace.URI,
			config.DefaultContinuousZoomVelocitySpace,
		),
	}
}

func positionLimitsFromProfileAndNode(
	config onvifxsd.PTZConfiguration,
	node onvifxsd.PTZNode,
) ptzLimits {
	limits := defaultPositionLimits()

	if hasFiniteRange(config.PanTiltLimits.Range.XRange.Min, config.PanTiltLimits.Range.XRange.Max) {
		limits.panMin = config.PanTiltLimits.Range.XRange.Min
		limits.panMax = config.PanTiltLimits.Range.XRange.Max
	} else if hasFiniteRange(
		node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.XRange.Min,
		node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.XRange.Max,
	) {
		limits.panMin = node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.XRange.Min
		limits.panMax = node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.XRange.Max
	}

	if hasFiniteRange(config.PanTiltLimits.Range.YRange.Min, config.PanTiltLimits.Range.YRange.Max) {
		limits.tiltMin = config.PanTiltLimits.Range.YRange.Min
		limits.tiltMax = config.PanTiltLimits.Range.YRange.Max
	} else if hasFiniteRange(
		node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.YRange.Min,
		node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.YRange.Max,
	) {
		limits.tiltMin = node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.YRange.Min
		limits.tiltMax = node.SupportedPTZSpaces.AbsolutePanTiltPositionSpace.YRange.Max
	}

	if hasFiniteRange(config.ZoomLimits.Range.XRange.Min, config.ZoomLimits.Range.XRange.Max) {
		limits.zoomMin = config.ZoomLimits.Range.XRange.Min
		limits.zoomMax = config.ZoomLimits.Range.XRange.Max
	} else if hasFiniteRange(
		node.SupportedPTZSpaces.AbsoluteZoomPositionSpace.XRange.Min,
		node.SupportedPTZSpaces.AbsoluteZoomPositionSpace.XRange.Max,
	) {
		limits.zoomMin = node.SupportedPTZSpaces.AbsoluteZoomPositionSpace.XRange.Min
		limits.zoomMax = node.SupportedPTZSpaces.AbsoluteZoomPositionSpace.XRange.Max
	}

	return limits
}

func velocityLimitsFromNode(node onvifxsd.PTZNode) ptzLimits {
	limits := defaultVelocityLimits()

	if hasFiniteRange(
		node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.XRange.Min,
		node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.XRange.Max,
	) {
		limits.panMin = node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.XRange.Min
		limits.panMax = node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.XRange.Max
	}

	if hasFiniteRange(
		node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.YRange.Min,
		node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.YRange.Max,
	) {
		limits.tiltMin = node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.YRange.Min
		limits.tiltMax = node.SupportedPTZSpaces.ContinuousPanTiltVelocitySpace.YRange.Max
	}

	if hasFiniteRange(
		node.SupportedPTZSpaces.ContinuousZoomVelocitySpace.XRange.Min,
		node.SupportedPTZSpaces.ContinuousZoomVelocitySpace.XRange.Max,
	) {
		limits.zoomMin = node.SupportedPTZSpaces.ContinuousZoomVelocitySpace.XRange.Min
		limits.zoomMax = node.SupportedPTZSpaces.ContinuousZoomVelocitySpace.XRange.Max
	}

	return limits
}

func buildCapabilities(
	hasConfiguredHome bool,
	spaces ptzSpaces,
	positionLimits ptzLimits,
	velocityLimits ptzLimits,
	homeSupported bool,
) ptzCapabilities {
	capabilities := ptzCapabilities{
		CanAbsolutePanTilt:   spaces.absolutePanTilt != "",
		CanAbsoluteZoom:      spaces.absoluteZoom != "",
		CanContinuousPanTilt: spaces.continuousPanTilt != "",
		CanContinuousZoom:    spaces.continuousZoom != "",
		CanGoHome:            homeSupported || (hasConfiguredHome && spaces.absolutePanTilt != ""),
	}

	if capabilities.CanAbsolutePanTilt || capabilities.CanContinuousPanTilt {
		capabilities.PanRange = &ptzRange{Min: positionLimits.panMin, Max: positionLimits.panMax}
		capabilities.TiltRange = &ptzRange{Min: positionLimits.tiltMin, Max: positionLimits.tiltMax}
	}

	if capabilities.CanAbsoluteZoom {
		capabilities.ZoomRange = &ptzRange{Min: positionLimits.zoomMin, Max: positionLimits.zoomMax}
	} else if capabilities.CanContinuousZoom {
		capabilities.ZoomRange = &ptzRange{Min: velocityLimits.zoomMin, Max: velocityLimits.zoomMax}
	}

	return capabilities
}

func chooseSpaceURI(primary xsd.AnyURI, fallback xsd.AnyURI) string {
	primaryValue := strings.TrimSpace(string(primary))
	if primaryValue != "" {
		return primaryValue
	}

	return strings.TrimSpace(string(fallback))
}

func resolvePTZEndpoint(device *onvifsdk.Device) string {
	if device == nil {
		return ""
	}

	if endpoint := strings.TrimSpace(device.GetEndpoint("PTZ")); endpoint != "" {
		return endpoint
	}

	for serviceName, endpoint := range device.GetServices() {
		if strings.Contains(strings.ToLower(strings.TrimSpace(serviceName)), "ptz") {
			if normalizedEndpoint := strings.TrimSpace(endpoint); normalizedEndpoint != "" {
				return normalizedEndpoint
			}
		}
	}

	return ""
}

func hasFiniteRange(min float64, max float64) bool {
	return !math.IsNaN(min) && !math.IsNaN(max) && (min != 0 || max != 0)
}

func scaleVelocityComponent(value float64, min float64, max float64) float64 {
	if value == 0 {
		return 0
	}

	if value > 0 {
		return clamp(math.Abs(value), 0, 1) * positiveRangeMax(max)
	}

	return -clamp(math.Abs(value), 0, 1) * positiveRangeMax(math.Abs(min))
}

func positiveRangeMax(value float64) float64 {
	if value <= 0 {
		return 1
	}

	return value
}

func normalizedToRange(value float64, min float64, max float64) float64 {
	if max <= min {
		return min
	}

	normalized := clamp(value, 0, 1)
	return min + ((max - min) * normalized)
}

func statusSettled(status onvifxsd.PTZStatus) bool {
	panTiltStatus := strings.TrimSpace(status.MoveStatus.PanTilt.Status)
	zoomStatus := strings.TrimSpace(status.MoveStatus.Zoom.Status)
	panTiltSettled := panTiltStatus == "" || strings.EqualFold(panTiltStatus, "IDLE")
	zoomSettled := zoomStatus == "" || strings.EqualFold(zoomStatus, "IDLE")

	return panTiltSettled && zoomSettled
}

type optionalPTZSpeed struct {
	PanTilt *onvifxsd.Vector2D `xml:"onvif:PanTilt,omitempty"`
	Zoom    *onvifxsd.Vector1D `xml:"onvif:Zoom,omitempty"`
}

type optionalPTZVector struct {
	PanTilt *onvifxsd.Vector2D `xml:"onvif:PanTilt,omitempty"`
	Zoom    *onvifxsd.Vector1D `xml:"onvif:Zoom,omitempty"`
}

type continuousMoveRequest struct {
	XMLName      string                  `xml:"tptz:ContinuousMove"`
	ProfileToken onvifxsd.ReferenceToken `xml:"tptz:ProfileToken"`
	Velocity     optionalPTZSpeed        `xml:"tptz:Velocity"`
	Timeout      xsd.Duration            `xml:"tptz:Timeout,omitempty"`
}

type absoluteMoveRequest struct {
	XMLName      string                  `xml:"tptz:AbsoluteMove"`
	ProfileToken onvifxsd.ReferenceToken `xml:"tptz:ProfileToken"`
	Position     optionalPTZVector       `xml:"tptz:Position"`
	Speed        *optionalPTZSpeed       `xml:"tptz:Speed,omitempty"`
}

type gotoHomePositionRequest struct {
	XMLName      string                  `xml:"tptz:GotoHomePosition"`
	ProfileToken onvifxsd.ReferenceToken `xml:"tptz:ProfileToken"`
}

func absoluteMoveSpeed(speedValue float64, capabilities ptzCapabilities) *optionalPTZSpeed {
	speed := clamp(speedValue, 0.05, 1)
	result := &optionalPTZSpeed{}

	if capabilities.CanAbsolutePanTilt {
		result.PanTilt = &onvifxsd.Vector2D{X: speed, Y: speed}
	}
	if capabilities.CanAbsoluteZoom {
		result.Zoom = &onvifxsd.Vector1D{X: speed}
	}

	if result.PanTilt == nil && result.Zoom == nil {
		return nil
	}

	return result
}

func zoomOnlyMoveSpeed(speedValue float64, capabilities ptzCapabilities) *optionalPTZSpeed {
	if !capabilities.CanAbsoluteZoom {
		return nil
	}

	speed := clamp(speedValue, 0.05, 1)
	return &optionalPTZSpeed{
		Zoom: &onvifxsd.Vector1D{X: speed},
	}
}

func callContinuousMove(
	ctx context.Context,
	endpoint string,
	httpClient *http.Client,
	username string,
	password string,
	request continuousMoveRequest,
) error {
	type envelope struct {
		Header struct{}
		Body   struct {
			ContinuousMoveResponse ptz.ContinuousMoveResponse
		}
	}

	return callAndParse(ctx, endpoint, httpClient, username, password, request, &envelope{}, "ContinuousMove")
}

func callAbsoluteMove(
	ctx context.Context,
	endpoint string,
	httpClient *http.Client,
	username string,
	password string,
	request absoluteMoveRequest,
) error {
	type envelope struct {
		Header struct{}
		Body   struct {
			AbsoluteMoveResponse ptz.AbsoluteMoveResponse
		}
	}

	return callAndParse(ctx, endpoint, httpClient, username, password, request, &envelope{}, "AbsoluteMove")
}

func callGotoHomePosition(
	ctx context.Context,
	endpoint string,
	httpClient *http.Client,
	username string,
	password string,
	request gotoHomePositionRequest,
) error {
	type envelope struct {
		Header struct{}
		Body   struct {
			GotoHomePositionResponse ptz.GotoHomePositionResponse
		}
	}

	return callAndParse(ctx, endpoint, httpClient, username, password, request, &envelope{}, "GotoHomePosition")
}

func callAndParse(
	ctx context.Context,
	endpoint string,
	httpClient *http.Client,
	username string,
	password string,
	request interface{},
	reply interface{},
	operation string,
) error {
	output, err := xml.MarshalIndent(request, "  ", "    ")
	if err != nil {
		return errors.Annotate(err, "marshal")
	}

	soap := gosoap.NewEmptySOAP()
	soap.AddStringBodyContent(string(output))
	soap.AddRootNamespaces(onvifsdk.Xlmns)
	soap.AddAction()

	if username != "" && password != "" {
		soap.AddWSSecurity(username, password)
	}

	httpReply, err := networking.SendSoap(httpClient, endpoint, soap.String())
	if err != nil {
		return errors.Annotate(err, "call")
	}

	return errors.Annotate(sdk.ReadAndParse(ctx, httpReply, reply, operation), "reply")
}
