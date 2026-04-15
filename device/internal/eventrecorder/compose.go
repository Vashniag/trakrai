package eventrecorder

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	stdDraw "image/draw"
	"image/jpeg"
	"os"

	"github.com/trakrai/device-services/internal/livefeed"
	xdraw "golang.org/x/image/draw"
)

type clipRegion struct {
	Bounds     image.Rectangle
	CameraName string
}

var (
	clipBackground = color.RGBA{R: 10, G: 12, B: 16, A: 255}
	tileBackground = color.RGBA{R: 18, G: 21, B: 28, A: 255}
)

func buildClipFrames(cfg *Config, request captureRequest, framesByCamera map[string][]sampledFrameRef) ([][]byte, error) {
	if request.Plan.Mode == livefeed.LiveLayoutSingle && len(request.Plan.CameraNames) == 1 {
		frames := framesByCamera[request.Plan.PrimaryCamera()]
		jpegFrames := make([][]byte, 0, len(frames))
		for _, frame := range frames {
			jpegBytes, err := os.ReadFile(frame.Path)
			if err != nil {
				return nil, fmt.Errorf("read frame %s: %w", frame.Path, err)
			}
			jpegFrames = append(jpegFrames, jpegBytes)
		}
		return jpegFrames, nil
	}

	timeline := alignFramesByTimeline(framesByCamera)
	if len(timeline) == 0 {
		return nil, fmt.Errorf("no aligned timeline available")
	}

	regions := clipRegions(cfg.Composite.Width, cfg.Composite.Height, cfg.Composite.TilePadding, request.Plan)
	if len(regions) == 0 {
		return nil, fmt.Errorf("no clip regions generated")
	}

	encodedFrames := make([][]byte, 0, len(timeline))
	for _, slot := range timeline {
		canvas := image.NewRGBA(image.Rect(0, 0, cfg.Composite.Width, cfg.Composite.Height))
		fillRect(canvas, canvas.Bounds(), clipBackground)
		for _, region := range regions {
			fillRect(canvas, region.Bounds, tileBackground)
			frameRef, ok := pickNearestFrame(framesByCamera[region.CameraName], slot)
			if !ok {
				continue
			}
			decoded, err := decodeJPEGPath(frameRef.Path)
			if err != nil {
				return nil, err
			}
			target := fitRect(decoded.Bounds().Dx(), decoded.Bounds().Dy(), insetRect(region.Bounds, 2))
			if decoded.Bounds().Dx() == target.Dx() && decoded.Bounds().Dy() == target.Dy() {
				stdDraw.Draw(canvas, target, decoded, decoded.Bounds().Min, stdDraw.Over)
			} else {
				xdraw.ApproxBiLinear.Scale(canvas, target, decoded, decoded.Bounds(), stdDraw.Over, nil)
			}
		}
		var buffer bytes.Buffer
		if err := jpeg.Encode(&buffer, canvas, &jpeg.Options{Quality: cfg.Output.JPEGQuality}); err != nil {
			return nil, fmt.Errorf("encode composite frame: %w", err)
		}
		encodedFrames = append(encodedFrames, buffer.Bytes())
	}

	return encodedFrames, nil
}

func decodeJPEGPath(path string) (image.Image, error) {
	handle, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open frame %s: %w", path, err)
	}
	defer handle.Close()

	decoded, err := jpeg.Decode(handle)
	if err != nil {
		return nil, fmt.Errorf("decode jpeg %s: %w", path, err)
	}
	return decoded, nil
}

func clipRegions(width int, height int, padding int, plan livefeed.LiveLayoutPlan) []clipRegion {
	switch plan.Mode {
	case livefeed.LiveLayoutGrid4:
		return gridClipRegions(width, height, padding, 2, 2, plan.CameraNames)
	case livefeed.LiveLayoutGrid9:
		return gridClipRegions(width, height, padding, 3, 3, plan.CameraNames)
	case livefeed.LiveLayoutGrid16:
		return gridClipRegions(width, height, padding, 4, 4, plan.CameraNames)
	case livefeed.LiveLayoutFocus8:
		return focusClipRegions(width, height, padding, plan.CameraNames)
	case livefeed.LiveLayoutSingle:
		fallthrough
	default:
		return singleClipRegion(width, height, padding, plan.CameraNames)
	}
}

func singleClipRegion(width int, height int, padding int, cameraNames []string) []clipRegion {
	if len(cameraNames) == 0 {
		return nil
	}
	return []clipRegion{{
		Bounds:     image.Rect(padding, padding, width-padding, height-padding),
		CameraName: cameraNames[0],
	}}
}

func gridClipRegions(width int, height int, padding int, cols int, rows int, cameraNames []string) []clipRegion {
	if cols <= 0 || rows <= 0 || len(cameraNames) == 0 {
		return nil
	}
	contentWidth := maxInt(1, width-(padding*(cols+1)))
	contentHeight := maxInt(1, height-(padding*(rows+1)))
	cellWidth := contentWidth / cols
	cellHeight := contentHeight / rows

	regions := make([]clipRegion, 0, minInt(len(cameraNames), cols*rows))
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
		regions = append(regions, clipRegion{
			Bounds:     image.Rect(left, top, right, bottom),
			CameraName: cameraName,
		})
	}
	return regions
}

func focusClipRegions(width int, height int, padding int, cameraNames []string) []clipRegion {
	if len(cameraNames) == 0 {
		return nil
	}
	if len(cameraNames) == 1 {
		return singleClipRegion(width, height, padding, cameraNames)
	}

	rightRailWidth := maxInt(160, (width-(padding*3))/3)
	mainWidth := maxInt(1, width-(padding*3)-rightRailWidth)
	mainBounds := image.Rect(padding, padding, padding+mainWidth, height-padding)

	regions := []clipRegion{{
		Bounds:     mainBounds,
		CameraName: cameraNames[0],
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
		regions = append(regions, clipRegion{
			Bounds:     image.Rect(left, top, right, bottom),
			CameraName: cameraName,
		})
	}

	return regions
}

func fillRect(dst stdDraw.Image, rect image.Rectangle, fill color.Color) {
	if rect.Empty() {
		return
	}
	stdDraw.Draw(dst, rect, image.NewUniform(fill), image.Point{}, stdDraw.Src)
}

func insetRect(bounds image.Rectangle, inset int) image.Rectangle {
	return image.Rect(bounds.Min.X+inset, bounds.Min.Y+inset, bounds.Max.X-inset, bounds.Max.Y-inset)
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

	widthRatio := float64(destWidth) / float64(srcWidth)
	heightRatio := float64(destHeight) / float64(srcHeight)
	scale := widthRatio
	if heightRatio < scale {
		scale = heightRatio
	}
	scaledWidth := maxInt(1, int(float64(srcWidth)*scale))
	scaledHeight := maxInt(1, int(float64(srcHeight)*scale))
	offsetX := bounds.Min.X + ((destWidth - scaledWidth) / 2)
	offsetY := bounds.Min.Y + ((destHeight - scaledHeight) / 2)
	return image.Rect(offsetX, offsetY, offsetX+scaledWidth, offsetY+scaledHeight)
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
