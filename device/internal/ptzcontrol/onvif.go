package ptzcontrol

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/icholy/digest"
	onvifsdk "github.com/use-go/onvif"
	"github.com/use-go/onvif/media"
	"github.com/use-go/onvif/ptz"
	mediaapi "github.com/use-go/onvif/sdk/media"
	ptzapi "github.com/use-go/onvif/sdk/ptz"
	"github.com/use-go/onvif/xsd"
	onvifxsd "github.com/use-go/onvif/xsd/onvif"
)

type moveStatus struct {
	PanTilt string `json:"panTilt,omitempty"`
	Zoom    string `json:"zoom,omitempty"`
}

type positionSnapshot struct {
	CameraName string      `json:"cameraName"`
	MoveStatus *moveStatus `json:"moveStatus,omitempty"`
	Pan        float64     `json:"pan"`
	Tilt       float64     `json:"tilt"`
	UpdatedAt  string      `json:"updatedAt"`
	Zoom       float64     `json:"zoom"`
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
	profileToken onvifxsd.ReferenceToken
	spaces       ptzSpaces
	limits       ptzLimits
}

func newCameraController(cfg CameraConfig, defaults MoveDefaults) *cameraController {
	return &cameraController{
		cfg:      cfg,
		defaults: defaults,
		limits: ptzLimits{
			panMin:  -1,
			panMax:  1,
			tiltMin: -1,
			tiltMax: 1,
			zoomMin: 0,
			zoomMax: 1,
		},
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

func (c *cameraController) ContinuousMove(ctx context.Context, velocity velocityCommand) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.ensureConnectedLocked(ctx); err != nil {
		return err
	}

	_, err := ptzapi.Call_ContinuousMove(ctx, c.client, ptz.ContinuousMove{
		ProfileToken: c.profileToken,
		Velocity: onvifxsd.PTZSpeed{
			PanTilt: onvifxsd.Vector2D{
				X:     clamp(velocity.Pan, -1, 1),
				Y:     clamp(velocity.Tilt, -1, 1),
				Space: xsd.AnyURI(c.spaces.continuousPanTilt),
			},
			Zoom: onvifxsd.Vector1D{
				X:     clamp(velocity.Zoom, -1, 1),
				Space: xsd.AnyURI(c.spaces.continuousZoom),
			},
		},
	})
	if err != nil {
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
		PanTilt:      xsd.Boolean(true),
		Zoom:         xsd.Boolean(true),
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

	current, err := c.getStatusLocked(ctx)
	if err != nil {
		return nil, err
	}

	targetZoom := clamp(zoomLevel, c.limits.zoomMin, c.limits.zoomMax)
	_, err = ptzapi.Call_AbsoluteMove(ctx, c.client, ptz.AbsoluteMove{
		ProfileToken: c.profileToken,
		Position: onvifxsd.PTZVector{
			PanTilt: onvifxsd.Vector2D{
				X:     current.Position.PanTilt.X,
				Y:     current.Position.PanTilt.Y,
				Space: xsd.AnyURI(c.spaces.absolutePanTilt),
			},
			Zoom: onvifxsd.Vector1D{
				X:     targetZoom,
				Space: xsd.AnyURI(c.spaces.absoluteZoom),
			},
		},
		Speed: c.absoluteSpeed(),
	})
	if err != nil {
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
		_, err := ptzapi.Call_AbsoluteMove(ctx, c.client, ptz.AbsoluteMove{
			ProfileToken: c.profileToken,
			Position: onvifxsd.PTZVector{
				PanTilt: onvifxsd.Vector2D{
					X:     clamp(c.cfg.Home.Pan, c.limits.panMin, c.limits.panMax),
					Y:     clamp(c.cfg.Home.Tilt, c.limits.tiltMin, c.limits.tiltMax),
					Space: xsd.AnyURI(c.spaces.absolutePanTilt),
				},
				Zoom: onvifxsd.Vector1D{
					X:     clamp(c.cfg.Home.Zoom, c.limits.zoomMin, c.limits.zoomMax),
					Space: xsd.AnyURI(c.spaces.absoluteZoom),
				},
			},
			Speed: c.absoluteSpeed(),
		})
		if err != nil {
			return nil, fmt.Errorf("move to configured home: %w", err)
		}
	} else {
		_, err := ptzapi.Call_GotoHomePosition(ctx, c.client, ptz.GotoHomePosition{
			ProfileToken: c.profileToken,
			Speed:        c.absoluteSpeed(),
		})
		if err != nil {
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

	c.client = device
	c.profileToken = profile.Token
	c.spaces = ptzSpaces{
		absolutePanTilt:   strings.TrimSpace(string(profile.PTZConfiguration.DefaultAbsolutePantTiltPositionSpace)),
		absoluteZoom:      strings.TrimSpace(string(profile.PTZConfiguration.DefaultAbsoluteZoomPositionSpace)),
		continuousPanTilt: strings.TrimSpace(string(profile.PTZConfiguration.DefaultContinuousPanTiltVelocitySpace)),
		continuousZoom:    strings.TrimSpace(string(profile.PTZConfiguration.DefaultContinuousZoomVelocitySpace)),
	}
	c.limits = c.limitsFromProfile(profile)
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

func (c *cameraController) limitsFromProfile(profile onvifxsd.Profile) ptzLimits {
	limits := c.limits

	if profile.PTZConfiguration.PanTiltLimits.Range.XRange.Min != 0 || profile.PTZConfiguration.PanTiltLimits.Range.XRange.Max != 0 {
		limits.panMin = profile.PTZConfiguration.PanTiltLimits.Range.XRange.Min
		limits.panMax = profile.PTZConfiguration.PanTiltLimits.Range.XRange.Max
	}
	if profile.PTZConfiguration.PanTiltLimits.Range.YRange.Min != 0 || profile.PTZConfiguration.PanTiltLimits.Range.YRange.Max != 0 {
		limits.tiltMin = profile.PTZConfiguration.PanTiltLimits.Range.YRange.Min
		limits.tiltMax = profile.PTZConfiguration.PanTiltLimits.Range.YRange.Max
	}
	if profile.PTZConfiguration.ZoomLimits.Range.XRange.Min != 0 || profile.PTZConfiguration.ZoomLimits.Range.XRange.Max != 0 {
		limits.zoomMin = profile.PTZConfiguration.ZoomLimits.Range.XRange.Min
		limits.zoomMax = profile.PTZConfiguration.ZoomLimits.Range.XRange.Max
	}

	return limits
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
	time.Sleep(250 * time.Millisecond)

	status, err := c.getStatusLocked(ctx)
	if err != nil {
		return nil, err
	}

	return c.positionFromStatus(status), nil
}

func (c *cameraController) positionFromStatus(status onvifxsd.PTZStatus) *positionSnapshot {
	result := &positionSnapshot{
		CameraName: c.cfg.Name,
		Pan:        status.Position.PanTilt.X,
		Tilt:       status.Position.PanTilt.Y,
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		Zoom:       status.Position.Zoom.X,
	}

	if status.MoveStatus.PanTilt.Status != "" || status.MoveStatus.Zoom.Status != "" {
		result.MoveStatus = &moveStatus{
			PanTilt: status.MoveStatus.PanTilt.Status,
			Zoom:    status.MoveStatus.Zoom.Status,
		}
	}

	return result
}

func (c *cameraController) absoluteSpeed() onvifxsd.PTZSpeed {
	speed := clamp(c.defaults.AbsoluteSpeed, 0.05, 1)
	return onvifxsd.PTZSpeed{
		PanTilt: onvifxsd.Vector2D{
			X: speed,
			Y: speed,
		},
		Zoom: onvifxsd.Vector1D{
			X: speed,
		},
	}
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
