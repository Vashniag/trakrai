package livefeed

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	imagedraw "image/draw"
	"image/jpeg"
	"log/slog"
	"math"
	"strings"
	"sync"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

const (
	compositeLabelHeight = 20
	compositeLabelInset  = 6
)

var (
	compositeBackgroundColor = color.RGBA{R: 10, G: 12, B: 16, A: 255}
	tileBackgroundColor      = color.RGBA{R: 18, G: 21, B: 28, A: 255}
	primaryTileBorderColor   = color.RGBA{R: 16, G: 185, B: 129, A: 255}
	tileBorderColor          = color.RGBA{R: 71, G: 85, B: 105, A: 255}
	labelBackgroundColor     = color.RGBA{R: 15, G: 23, B: 42, A: 216}
	placeholderColor         = color.RGBA{R: 30, G: 41, B: 59, A: 255}
	labelTextColor           = color.RGBA{R: 255, G: 255, B: 255, A: 255}
)

type compositeRegion struct {
	Bounds     image.Rectangle
	CameraName string
	Primary    bool
}

type cachedDecodedFrame struct {
	image image.Image
	imgID string
}

type MosaicComposer struct {
	cfg      CompositeConfig
	frameSrc *FrameSource
	log      *slog.Logger

	mu    sync.Mutex
	cache map[string]cachedDecodedFrame
}

func NewMosaicComposer(cfg CompositeConfig, frameSrc *FrameSource) *MosaicComposer {
	return &MosaicComposer{
		cfg:      cfg,
		frameSrc: frameSrc,
		log:      slog.With("component", "mosaic-composer"),
		cache:    make(map[string]cachedDecodedFrame),
	}
}

func (mc *MosaicComposer) ComposeRGBAFrame(ctx context.Context, plan LiveLayoutPlan) ([]byte, error) {
	regions := compositeRegions(mc.cfg.Width, mc.cfg.Height, mc.cfg.TilePadding, plan)
	if len(regions) == 0 {
		return nil, fmt.Errorf("no composite regions generated")
	}

	canvas := image.NewRGBA(image.Rect(0, 0, mc.cfg.Width, mc.cfg.Height))
	fillRect(canvas, canvas.Bounds(), compositeBackgroundColor)

	for _, region := range regions {
		mc.drawRegion(ctx, canvas, region)
	}

	return bytes.Clone(canvas.Pix), nil
}

func (mc *MosaicComposer) drawRegion(ctx context.Context, canvas *image.RGBA, region compositeRegion) {
	fillRect(canvas, region.Bounds, tileBackgroundColor)
	strokeRect(canvas, region.Bounds, tileBorderColor)
	if region.Primary {
		strokeRectInset(canvas, region.Bounds, primaryTileBorderColor, 1)
	}

	frame, err := mc.readDecodedFrame(ctx, region.CameraName)
	if err != nil {
		mc.log.Debug("composite frame unavailable", "camera", region.CameraName, "error", err)
		fillRect(canvas, insetRect(region.Bounds, 2), placeholderColor)
		drawCameraLabel(canvas, region.Bounds, region.CameraName)
		return
	}

	targetRect := fitRect(frame.Bounds().Dx(), frame.Bounds().Dy(), insetRect(region.Bounds, 2))
	fillRect(canvas, targetRect, color.Black)
	draw.CatmullRom.Scale(canvas, targetRect, frame, frame.Bounds(), imagedraw.Over, nil)
	drawCameraLabel(canvas, region.Bounds, region.CameraName)
}

func (mc *MosaicComposer) readDecodedFrame(ctx context.Context, cameraName string) (image.Image, error) {
	frameData, imgID, err := mc.frameSrc.ReadFrame(ctx, cameraName)
	if err != nil {
		mc.mu.Lock()
		cached, ok := mc.cache[cameraName]
		mc.mu.Unlock()
		if ok {
			return cached.image, nil
		}

		return nil, err
	}

	mc.mu.Lock()
	cached, ok := mc.cache[cameraName]
	mc.mu.Unlock()
	if ok && cached.imgID == imgID {
		return cached.image, nil
	}

	decodedImage, err := jpeg.Decode(bytes.NewReader(frameData))
	if err != nil {
		return nil, fmt.Errorf("jpeg decode: %w", err)
	}

	mc.mu.Lock()
	mc.cache[cameraName] = cachedDecodedFrame{
		image: decodedImage,
		imgID: imgID,
	}
	mc.mu.Unlock()

	return decodedImage, nil
}

func compositeRegions(width int, height int, padding int, plan LiveLayoutPlan) []compositeRegion {
	switch plan.Mode {
	case LiveLayoutGrid4:
		return gridRegions(width, height, padding, 2, 2, plan.CameraNames)
	case LiveLayoutGrid9:
		return gridRegions(width, height, padding, 3, 3, plan.CameraNames)
	case LiveLayoutGrid16:
		return gridRegions(width, height, padding, 4, 4, plan.CameraNames)
	case LiveLayoutFocus8:
		return focusRegions(width, height, padding, plan.CameraNames)
	case LiveLayoutSingle:
		fallthrough
	default:
		return singleRegion(width, height, padding, plan.CameraNames)
	}
}

func singleRegion(width int, height int, padding int, cameraNames []string) []compositeRegion {
	if len(cameraNames) == 0 {
		return nil
	}

	return []compositeRegion{{
		Bounds:     image.Rect(padding, padding, width-padding, height-padding),
		CameraName: cameraNames[0],
		Primary:    true,
	}}
}

func gridRegions(
	width int,
	height int,
	padding int,
	cols int,
	rows int,
	cameraNames []string,
) []compositeRegion {
	if cols <= 0 || rows <= 0 || len(cameraNames) == 0 {
		return nil
	}

	contentWidth := maxInt(1, width-(padding*(cols+1)))
	contentHeight := maxInt(1, height-(padding*(rows+1)))
	cellWidth := contentWidth / cols
	cellHeight := contentHeight / rows

	regions := make([]compositeRegion, 0, minInt(len(cameraNames), cols*rows))
	for index, cameraName := range cameraNames {
		if index >= cols*rows {
			break
		}

		row := index / cols
		col := index % cols
		left := padding + (col * (cellWidth + padding))
		top := padding + (row * (cellHeight + padding))
		right := left + cellWidth
		bottom := top + cellHeight
		if col == cols-1 {
			right = width - padding
		}
		if row == rows-1 {
			bottom = height - padding
		}

		regions = append(regions, compositeRegion{
			Bounds:     image.Rect(left, top, right, bottom),
			CameraName: cameraName,
			Primary:    index == 0,
		})
	}

	return regions
}

func focusRegions(width int, height int, padding int, cameraNames []string) []compositeRegion {
	if len(cameraNames) == 0 {
		return nil
	}
	if len(cameraNames) == 1 {
		return singleRegion(width, height, padding, cameraNames)
	}

	rightRailWidth := maxInt(160, (width-(padding*3))/3)
	mainWidth := maxInt(1, width-(padding*3)-rightRailWidth)
	mainBounds := image.Rect(
		padding,
		padding,
		padding+mainWidth,
		height-padding,
	)

	regions := []compositeRegion{{
		Bounds:     mainBounds,
		CameraName: cameraNames[0],
		Primary:    true,
	}}

	thumbLeft := mainBounds.Max.X + padding
	thumbWidth := maxInt(1, width-thumbLeft-padding)
	thumbRows := 4
	thumbCols := 2
	thumbContentHeight := maxInt(1, height-(padding*(thumbRows+1)))
	thumbHeight := thumbContentHeight / thumbRows
	thumbContentWidth := maxInt(1, thumbWidth-padding)
	thumbCellWidth := thumbContentWidth / thumbCols

	for index, cameraName := range cameraNames[1:] {
		if index >= 7 {
			break
		}

		row := index / thumbCols
		col := index % thumbCols
		left := thumbLeft + (col * (thumbCellWidth + padding))
		top := padding + (row * (thumbHeight + padding))
		right := left + thumbCellWidth
		bottom := top + thumbHeight
		if col == thumbCols-1 {
			right = width - padding
		}
		if row == thumbRows-1 {
			bottom = height - padding
		}

		regions = append(regions, compositeRegion{
			Bounds:     image.Rect(left, top, right, bottom),
			CameraName: cameraName,
			Primary:    false,
		})
	}

	return regions
}

func fitRect(srcWidth int, srcHeight int, bounds image.Rectangle) image.Rectangle {
	if srcWidth <= 0 || srcHeight <= 0 || bounds.Empty() {
		return bounds
	}

	destWidth := bounds.Dx()
	destHeight := bounds.Dy()
	if destWidth <= 0 || destHeight <= 0 {
		return bounds
	}

	scale := math.Min(float64(destWidth)/float64(srcWidth), float64(destHeight)/float64(srcHeight))
	if scale <= 0 {
		return bounds
	}

	scaledWidth := maxInt(1, int(math.Round(float64(srcWidth)*scale)))
	scaledHeight := maxInt(1, int(math.Round(float64(srcHeight)*scale)))
	offsetX := bounds.Min.X + ((destWidth - scaledWidth) / 2)
	offsetY := bounds.Min.Y + ((destHeight - scaledHeight) / 2)

	return image.Rect(offsetX, offsetY, offsetX+scaledWidth, offsetY+scaledHeight)
}

func drawCameraLabel(canvas *image.RGBA, bounds image.Rectangle, cameraName string) {
	cameraName = strings.TrimSpace(cameraName)
	if cameraName == "" {
		return
	}

	labelBounds := image.Rect(
		bounds.Min.X+2,
		bounds.Min.Y+2,
		bounds.Max.X-2,
		minInt(bounds.Max.Y, bounds.Min.Y+compositeLabelHeight),
	)
	fillRect(canvas, labelBounds, labelBackgroundColor)

	d := &font.Drawer{
		Dst:  canvas,
		Src:  image.NewUniform(labelTextColor),
		Face: basicfont.Face7x13,
		Dot: fixed.Point26_6{
			X: fixed.I(labelBounds.Min.X + compositeLabelInset),
			Y: fixed.I(labelBounds.Min.Y + 14),
		},
	}
	d.DrawString(cameraName)
}

func insetRect(bounds image.Rectangle, inset int) image.Rectangle {
	return image.Rect(
		bounds.Min.X+inset,
		bounds.Min.Y+inset,
		bounds.Max.X-inset,
		bounds.Max.Y-inset,
	)
}

func fillRect(dst imagedraw.Image, rect image.Rectangle, fill color.Color) {
	if rect.Empty() {
		return
	}

	imagedraw.Draw(dst, rect, image.NewUniform(fill), image.Point{}, imagedraw.Src)
}

func strokeRect(dst *image.RGBA, rect image.Rectangle, stroke color.Color) {
	if rect.Empty() {
		return
	}

	fillRect(dst, image.Rect(rect.Min.X, rect.Min.Y, rect.Max.X, rect.Min.Y+1), stroke)
	fillRect(dst, image.Rect(rect.Min.X, rect.Max.Y-1, rect.Max.X, rect.Max.Y), stroke)
	fillRect(dst, image.Rect(rect.Min.X, rect.Min.Y, rect.Min.X+1, rect.Max.Y), stroke)
	fillRect(dst, image.Rect(rect.Max.X-1, rect.Min.Y, rect.Max.X, rect.Max.Y), stroke)
}

func strokeRectInset(dst *image.RGBA, rect image.Rectangle, stroke color.Color, inset int) {
	strokeRect(dst, insetRect(rect, inset), stroke)
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}

	return right
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}

	return right
}
