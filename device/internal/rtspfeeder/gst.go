package rtspfeeder

/*
#cgo pkg-config: gstreamer-1.0 gstreamer-app-1.0
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
	GstElement *pipeline;
	GstElement *appsink;
} PipelineHandle;

static void gst_setup() {
	gst_init(NULL, NULL);
}

static PipelineHandle* pipeline_create(const char *desc, char **err_out) {
	GError *error = NULL;
	GstElement *pipeline = gst_parse_launch(desc, &error);
	if (error != NULL) {
		if (err_out) *err_out = g_strdup(error->message);
		g_error_free(error);
		if (pipeline) gst_object_unref(pipeline);
		return NULL;
	}
	GstElement *appsink = gst_bin_get_by_name(GST_BIN(pipeline), "sink");
	if (!appsink) {
		if (err_out) *err_out = g_strdup("appsink 'sink' not found");
		gst_object_unref(pipeline);
		return NULL;
	}
	PipelineHandle *h = (PipelineHandle*)malloc(sizeof(PipelineHandle));
	h->pipeline = pipeline;
	h->appsink  = appsink;
	return h;
}

static int pipeline_set_playing(PipelineHandle *h) {
	return gst_element_set_state(h->pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE ? -1 : 0;
}

static int pipeline_pull(PipelineHandle *h, guint64 timeout_ns, void **data, int *size) {
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

static int pipeline_is_eos(PipelineHandle *h) {
	return gst_app_sink_is_eos(GST_APP_SINK(h->appsink)) ? 1 : 0;
}

static char* pipeline_bus_error(PipelineHandle *h) {
	GstBus *bus = gst_element_get_bus(h->pipeline);
	GstMessage *msg = gst_bus_pop_filtered(bus, GST_MESSAGE_ERROR);
	gst_object_unref(bus);
	if (!msg) return NULL;
	GError *err = NULL;
	gst_message_parse_error(msg, &err, NULL);
	char *out = g_strdup(err->message);
	g_error_free(err);
	gst_message_unref(msg);
	return out;
}

static void pipeline_destroy(PipelineHandle *h) {
	if (!h) return;
	gst_element_set_state(h->pipeline, GST_STATE_NULL);
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

func GstInit() {
	C.gst_setup()
}

type Pipeline struct {
	h *C.PipelineHandle
}

func NewPipeline(desc string) (*Pipeline, error) {
	cd := C.CString(desc)
	defer C.free(unsafe.Pointer(cd))

	var cerr *C.char
	handle := C.pipeline_create(cd, &cerr)
	if handle == nil {
		msg := "unknown error"
		if cerr != nil {
			msg = C.GoString(cerr)
			C.free(unsafe.Pointer(cerr))
		}
		return nil, fmt.Errorf("pipeline: %s", msg)
	}
	return &Pipeline{h: handle}, nil
}

func (p *Pipeline) Start() error {
	if C.pipeline_set_playing(p.h) != 0 {
		return fmt.Errorf("failed to set PLAYING")
	}
	return nil
}

func (p *Pipeline) PullFrame(timeoutNs uint64) ([]byte, error) {
	var data unsafe.Pointer
	var size C.int

	if C.pipeline_pull(p.h, C.guint64(timeoutNs), &data, &size) != 0 {
		if C.pipeline_is_eos(p.h) != 0 {
			return nil, fmt.Errorf("eos")
		}
		cerr := C.pipeline_bus_error(p.h)
		if cerr != nil {
			msg := C.GoString(cerr)
			C.free(unsafe.Pointer(cerr))
			return nil, fmt.Errorf("gst: %s", msg)
		}
		return nil, fmt.Errorf("timeout")
	}
	defer C.free(data)
	return C.GoBytes(data, size), nil
}

func (p *Pipeline) Stop() {
	if p.h != nil {
		C.pipeline_destroy(p.h)
		p.h = nil
	}
}
