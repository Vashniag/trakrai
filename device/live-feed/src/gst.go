package main

/*
#cgo pkg-config: gstreamer-1.0 gstreamer-app-1.0
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <stdlib.h>
#include <string.h>

static void gst_setup() {
	gst_init(NULL, NULL);
}

typedef struct {
	GstElement *pipeline;
	GstElement *appsrc;
	GstElement *appsink;
} EncoderHandle;

// Create an encoder pipeline with both appsrc and appsink.
static EncoderHandle* encoder_create(const char *desc, char **err_out) {
	GError *error = NULL;
	GstElement *pipeline = gst_parse_launch(desc, &error);
	if (error != NULL) {
		if (err_out) *err_out = g_strdup(error->message);
		g_error_free(error);
		if (pipeline) gst_object_unref(pipeline);
		return NULL;
	}

	GstElement *appsrc = gst_bin_get_by_name(GST_BIN(pipeline), "src");
	if (!appsrc) {
		if (err_out) *err_out = g_strdup("appsrc 'src' not found");
		gst_object_unref(pipeline);
		return NULL;
	}

	GstElement *appsink = gst_bin_get_by_name(GST_BIN(pipeline), "sink");
	if (!appsink) {
		if (err_out) *err_out = g_strdup("appsink 'sink' not found");
		gst_object_unref(appsrc);
		gst_object_unref(pipeline);
		return NULL;
	}

	EncoderHandle *h = (EncoderHandle*)malloc(sizeof(EncoderHandle));
	h->pipeline = pipeline;
	h->appsrc   = appsrc;
	h->appsink  = appsink;
	return h;
}

static int encoder_set_playing(EncoderHandle *h) {
	return gst_element_set_state(h->pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE ? -1 : 0;
}

// Push a JPEG buffer into appsrc.
static int encoder_push(EncoderHandle *h, const void *data, int size, guint64 pts) {
	GstBuffer *buf = gst_buffer_new_allocate(NULL, size, NULL);
	GstMapInfo map;
	gst_buffer_map(buf, &map, GST_MAP_WRITE);
	memcpy(map.data, data, size);
	gst_buffer_unmap(buf, &map);

	GST_BUFFER_PTS(buf) = pts;
	GST_BUFFER_DTS(buf) = pts;

	GstFlowReturn ret = gst_app_src_push_buffer(GST_APP_SRC(h->appsrc), buf);
	return (ret == GST_FLOW_OK) ? 0 : -1;
}

// Pull an encoded RTP packet from appsink.
static int encoder_pull(EncoderHandle *h, guint64 timeout_ns, void **data, int *size) {
	GstSample *sample = gst_app_sink_try_pull_sample(GST_APP_SINK(h->appsink), timeout_ns);
	if (!sample) { *data = NULL; *size = 0; return -1; }

	GstBuffer *buf = gst_sample_get_buffer(sample);
	if (!buf) { gst_sample_unref(sample); *data = NULL; *size = 0; return -1; }

	GstMapInfo map;
	if (!gst_buffer_map(buf, &map, GST_MAP_READ)) {
		gst_sample_unref(sample);
		*data = NULL; *size = 0; return -1;
	}
	*size = (int)map.size;
	*data = malloc(map.size);
	memcpy(*data, map.data, map.size);
	gst_buffer_unmap(buf, &map);
	gst_sample_unref(sample);
	return 0;
}

static void encoder_destroy(EncoderHandle *h) {
	if (!h) return;
	gst_app_src_end_of_stream(GST_APP_SRC(h->appsrc));
	gst_element_set_state(h->pipeline, GST_STATE_NULL);
	gst_object_unref(h->appsrc);
	gst_object_unref(h->appsink);
	gst_object_unref(h->pipeline);
	free(h);
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// GstInit initialises GStreamer. Call once at process start.
func GstInit() {
	C.gst_setup()
}

// Encoder wraps a GStreamer encoding pipeline with appsrc input and appsink output.
type Encoder struct {
	h *C.EncoderHandle
}

// NewEncoder creates an encoder pipeline from a gst_parse_launch description.
// The description must contain elements named "src" (appsrc) and "sink" (appsink).
func NewEncoder(desc string) (*Encoder, error) {
	cd := C.CString(desc)
	defer C.free(unsafe.Pointer(cd))

	var cerr *C.char
	h := C.encoder_create(cd, &cerr)
	if h == nil {
		msg := "unknown error"
		if cerr != nil {
			msg = C.GoString(cerr)
			C.free(unsafe.Pointer(cerr))
		}
		return nil, fmt.Errorf("encoder: %s", msg)
	}
	return &Encoder{h: h}, nil
}

// Start sets the encoder pipeline to PLAYING.
func (e *Encoder) Start() error {
	if C.encoder_set_playing(e.h) != 0 {
		return fmt.Errorf("failed to set PLAYING")
	}
	return nil
}

// PushFrame pushes a JPEG frame into the encoder.
func (e *Encoder) PushFrame(jpeg []byte, ptsNs uint64) error {
	if C.encoder_push(e.h, unsafe.Pointer(&jpeg[0]), C.int(len(jpeg)), C.guint64(ptsNs)) != 0 {
		return fmt.Errorf("push failed")
	}
	return nil
}

// PullPacket pulls an encoded packet (H.264 RTP or raw NAL) from the encoder.
func (e *Encoder) PullPacket(timeoutNs uint64) ([]byte, error) {
	var data unsafe.Pointer
	var size C.int

	if C.encoder_pull(e.h, C.guint64(timeoutNs), &data, &size) != 0 {
		return nil, fmt.Errorf("pull timeout")
	}
	defer C.free(data)
	return C.GoBytes(data, size), nil
}

// Stop tears down the encoder pipeline.
func (e *Encoder) Stop() {
	if e.h != nil {
		C.encoder_destroy(e.h)
		e.h = nil
	}
}
