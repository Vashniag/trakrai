//go:build cgo

package livefeed

/*
#cgo pkg-config: gstreamer-1.0 gstreamer-app-1.0
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <stdio.h>
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

typedef struct {
	GstElement *pipeline;
	GstElement *appsink;
} ReaderHandle;

typedef struct {
	GstElement *pipeline;
	GstElement *appsrc;
	GstBus *bus;
} WriterHandle;

typedef struct {
	GstElement *pipeline;
	GstElement *appsink;
	GstElement *appsrcs[16];
	int appsrc_count;
} MultiSourceHandle;

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

static ReaderHandle* reader_create(const char *desc, char **err_out) {
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

	ReaderHandle *h = (ReaderHandle*)malloc(sizeof(ReaderHandle));
	h->pipeline = pipeline;
	h->appsink  = appsink;
	return h;
}

static int reader_set_playing(ReaderHandle *h) {
	return gst_element_set_state(h->pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE ? -1 : 0;
}

static int reader_pull(ReaderHandle *h, guint64 timeout_ns, void **data, int *size) {
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

static int reader_is_eos(ReaderHandle *h) {
	return gst_app_sink_is_eos(GST_APP_SINK(h->appsink)) ? 1 : 0;
}

static char* reader_bus_error(ReaderHandle *h) {
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

static void reader_destroy(ReaderHandle *h) {
	if (!h) return;
	gst_element_set_state(h->pipeline, GST_STATE_NULL);
	gst_object_unref(h->appsink);
	gst_object_unref(h->pipeline);
	free(h);
}

static WriterHandle* writer_create(const char *desc, char **err_out) {
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

	GstBus *bus = gst_element_get_bus(pipeline);
	if (!bus) {
		if (err_out) *err_out = g_strdup("gst bus not available");
		gst_object_unref(appsrc);
		gst_object_unref(pipeline);
		return NULL;
	}

	WriterHandle *h = (WriterHandle*)malloc(sizeof(WriterHandle));
	h->pipeline = pipeline;
	h->appsrc   = appsrc;
	h->bus      = bus;
	return h;
}

static int writer_set_playing(WriterHandle *h) {
	return gst_element_set_state(h->pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE ? -1 : 0;
}

static int writer_push(WriterHandle *h, const void *data, int size, guint64 pts, guint64 duration) {
	GstBuffer *buf = gst_buffer_new_allocate(NULL, size, NULL);
	GstMapInfo map;
	gst_buffer_map(buf, &map, GST_MAP_WRITE);
	memcpy(map.data, data, size);
	gst_buffer_unmap(buf, &map);

	GST_BUFFER_PTS(buf) = pts;
	GST_BUFFER_DTS(buf) = pts;
	GST_BUFFER_DURATION(buf) = duration;

	GstFlowReturn ret = gst_app_src_push_buffer(GST_APP_SRC(h->appsrc), buf);
	return (ret == GST_FLOW_OK) ? 0 : -1;
}

static int writer_finalize(WriterHandle *h, guint64 timeout_ns, char **err_out) {
	if (gst_app_src_end_of_stream(GST_APP_SRC(h->appsrc)) != GST_FLOW_OK) {
		if (err_out) *err_out = g_strdup("failed to send EOS to appsrc");
		return -1;
	}

	GstMessage *message = gst_bus_timed_pop_filtered(
		h->bus,
		timeout_ns,
		(GstMessageType)(GST_MESSAGE_ERROR | GST_MESSAGE_EOS)
	);
	if (!message) {
		if (err_out) *err_out = g_strdup("timed out waiting for EOS");
		return -1;
	}

	if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
		GError *error = NULL;
		gchar *debug = NULL;
		gst_message_parse_error(message, &error, &debug);
		if (err_out) {
			if (error != NULL && error->message != NULL) {
				*err_out = g_strdup(error->message);
			} else {
				*err_out = g_strdup("gstreamer writer error");
			}
		}
		if (error) g_error_free(error);
		if (debug) g_free(debug);
		gst_message_unref(message);
		return -1;
	}

	gst_message_unref(message);
	return 0;
}

static void writer_destroy(WriterHandle *h) {
	if (!h) return;
	gst_element_set_state(h->pipeline, GST_STATE_NULL);
	gst_object_unref(h->bus);
	gst_object_unref(h->appsrc);
	gst_object_unref(h->pipeline);
	free(h);
}

static MultiSourceHandle* multisource_create(const char *desc, int appsrc_count, char **err_out) {
	GError *error = NULL;
	GstElement *pipeline = gst_parse_launch(desc, &error);
	if (error != NULL) {
		if (err_out) *err_out = g_strdup(error->message);
		g_error_free(error);
		if (pipeline) gst_object_unref(pipeline);
		return NULL;
	}

	if (appsrc_count <= 0 || appsrc_count > 16) {
		if (err_out) *err_out = g_strdup("appsrc_count must be between 1 and 16");
		gst_object_unref(pipeline);
		return NULL;
	}

	GstElement *appsink = gst_bin_get_by_name(GST_BIN(pipeline), "sink");
	if (!appsink) {
		if (err_out) *err_out = g_strdup("appsink 'sink' not found");
		gst_object_unref(pipeline);
		return NULL;
	}

	MultiSourceHandle *h = (MultiSourceHandle*)malloc(sizeof(MultiSourceHandle));
	memset(h, 0, sizeof(MultiSourceHandle));
	h->pipeline = pipeline;
	h->appsink = appsink;
	h->appsrc_count = appsrc_count;

	for (int i = 0; i < appsrc_count; i++) {
		char name[16];
		snprintf(name, sizeof(name), "src%d", i);
		GstElement *appsrc = gst_bin_get_by_name(GST_BIN(pipeline), name);
		if (!appsrc) {
			if (err_out) *err_out = g_strdup_printf("appsrc '%s' not found", name);
			for (int j = 0; j < i; j++) {
				gst_object_unref(h->appsrcs[j]);
			}
			gst_object_unref(appsink);
			gst_object_unref(pipeline);
			free(h);
			return NULL;
		}
		h->appsrcs[i] = appsrc;
	}

	return h;
}

static int multisource_set_playing(MultiSourceHandle *h) {
	return gst_element_set_state(h->pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE ? -1 : 0;
}

static int multisource_push(MultiSourceHandle *h, int index, const void *data, int size, guint64 pts) {
	if (!h || index < 0 || index >= h->appsrc_count || size <= 0) return -1;

	GstBuffer *buf = gst_buffer_new_allocate(NULL, size, NULL);
	GstMapInfo map;
	gst_buffer_map(buf, &map, GST_MAP_WRITE);
	memcpy(map.data, data, size);
	gst_buffer_unmap(buf, &map);

	GST_BUFFER_PTS(buf) = pts;
	GST_BUFFER_DTS(buf) = pts;

	GstFlowReturn ret = gst_app_src_push_buffer(GST_APP_SRC(h->appsrcs[index]), buf);
	return (ret == GST_FLOW_OK) ? 0 : -1;
}

static int multisource_pull(MultiSourceHandle *h, guint64 timeout_ns, void **data, int *size) {
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

static void multisource_destroy(MultiSourceHandle *h) {
	if (!h) return;
	for (int i = 0; i < h->appsrc_count; i++) {
		if (h->appsrcs[i]) {
			gst_app_src_end_of_stream(GST_APP_SRC(h->appsrcs[i]));
		}
	}
	gst_element_set_state(h->pipeline, GST_STATE_NULL);
	for (int i = 0; i < h->appsrc_count; i++) {
		if (h->appsrcs[i]) {
			gst_object_unref(h->appsrcs[i]);
		}
	}
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

type Encoder struct {
	h *C.EncoderHandle
}

type PacketReader struct {
	h *C.ReaderHandle
}

type PipelineWriter struct {
	h *C.WriterHandle
}

type MultiSourceEncoder struct {
	h           *C.MultiSourceHandle
	sourceCount int
}

func NewEncoder(desc string) (*Encoder, error) {
	cd := C.CString(desc)
	defer C.free(unsafe.Pointer(cd))

	var cerr *C.char
	handle := C.encoder_create(cd, &cerr)
	if handle == nil {
		msg := "unknown error"
		if cerr != nil {
			msg = C.GoString(cerr)
			C.free(unsafe.Pointer(cerr))
		}
		return nil, fmt.Errorf("encoder: %s", msg)
	}
	return &Encoder{h: handle}, nil
}

func (e *Encoder) Start() error {
	if C.encoder_set_playing(e.h) != 0 {
		return fmt.Errorf("failed to set PLAYING")
	}
	return nil
}

func (e *Encoder) PushFrame(jpeg []byte, ptsNs uint64) error {
	if C.encoder_push(e.h, unsafe.Pointer(&jpeg[0]), C.int(len(jpeg)), C.guint64(ptsNs)) != 0 {
		return fmt.Errorf("push failed")
	}
	return nil
}

func (e *Encoder) PullPacket(timeoutNs uint64) ([]byte, error) {
	var data unsafe.Pointer
	var size C.int

	if C.encoder_pull(e.h, C.guint64(timeoutNs), &data, &size) != 0 {
		return nil, fmt.Errorf("pull timeout")
	}
	defer C.free(data)
	return C.GoBytes(data, size), nil
}

func (e *Encoder) Stop() {
	if e.h != nil {
		C.encoder_destroy(e.h)
		e.h = nil
	}
}

func NewPacketReader(desc string) (*PacketReader, error) {
	cd := C.CString(desc)
	defer C.free(unsafe.Pointer(cd))

	var cerr *C.char
	handle := C.reader_create(cd, &cerr)
	if handle == nil {
		msg := "unknown error"
		if cerr != nil {
			msg = C.GoString(cerr)
			C.free(unsafe.Pointer(cerr))
		}
		return nil, fmt.Errorf("packet reader: %s", msg)
	}
	return &PacketReader{h: handle}, nil
}

func (r *PacketReader) Start() error {
	if C.reader_set_playing(r.h) != 0 {
		return fmt.Errorf("failed to set PLAYING")
	}
	return nil
}

func (r *PacketReader) PullPacket(timeoutNs uint64) ([]byte, error) {
	var data unsafe.Pointer
	var size C.int

	if C.reader_pull(r.h, C.guint64(timeoutNs), &data, &size) != 0 {
		if C.reader_is_eos(r.h) != 0 {
			return nil, fmt.Errorf("eos")
		}
		cerr := C.reader_bus_error(r.h)
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

func (r *PacketReader) Stop() {
	if r.h != nil {
		C.reader_destroy(r.h)
		r.h = nil
	}
}

func NewPipelineWriter(desc string) (*PipelineWriter, error) {
	cd := C.CString(desc)
	defer C.free(unsafe.Pointer(cd))

	var cerr *C.char
	handle := C.writer_create(cd, &cerr)
	if handle == nil {
		msg := "unknown error"
		if cerr != nil {
			msg = C.GoString(cerr)
			C.free(unsafe.Pointer(cerr))
		}
		return nil, fmt.Errorf("pipeline writer: %s", msg)
	}

	return &PipelineWriter{h: handle}, nil
}

func (w *PipelineWriter) Start() error {
	if C.writer_set_playing(w.h) != 0 {
		return fmt.Errorf("failed to set PLAYING")
	}
	return nil
}

func (w *PipelineWriter) PushFrame(frame []byte, ptsNs uint64, durationNs uint64) error {
	if len(frame) == 0 {
		return fmt.Errorf("frame is empty")
	}
	if C.writer_push(
		w.h,
		unsafe.Pointer(&frame[0]),
		C.int(len(frame)),
		C.guint64(ptsNs),
		C.guint64(durationNs),
	) != 0 {
		return fmt.Errorf("push failed")
	}
	return nil
}

func (w *PipelineWriter) Finalize(timeoutNs uint64) error {
	var cerr *C.char
	if C.writer_finalize(w.h, C.guint64(timeoutNs), &cerr) != 0 {
		msg := "failed to finalize writer"
		if cerr != nil {
			msg = C.GoString(cerr)
			C.free(unsafe.Pointer(cerr))
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}

func (w *PipelineWriter) Stop() {
	if w.h != nil {
		C.writer_destroy(w.h)
		w.h = nil
	}
}

func NewMultiSourceEncoder(desc string, sourceCount int) (*MultiSourceEncoder, error) {
	cd := C.CString(desc)
	defer C.free(unsafe.Pointer(cd))

	var cerr *C.char
	handle := C.multisource_create(cd, C.int(sourceCount), &cerr)
	if handle == nil {
		msg := "unknown error"
		if cerr != nil {
			msg = C.GoString(cerr)
			C.free(unsafe.Pointer(cerr))
		}
		return nil, fmt.Errorf("multisource encoder: %s", msg)
	}

	return &MultiSourceEncoder{
		h:           handle,
		sourceCount: sourceCount,
	}, nil
}

func (e *MultiSourceEncoder) Start() error {
	if C.multisource_set_playing(e.h) != 0 {
		return fmt.Errorf("failed to set PLAYING")
	}
	return nil
}

func (e *MultiSourceEncoder) PushFrame(index int, frame []byte, ptsNs uint64) error {
	if index < 0 || index >= e.sourceCount {
		return fmt.Errorf("source index %d out of range", index)
	}
	if len(frame) == 0 {
		return fmt.Errorf("frame is empty")
	}
	if C.multisource_push(e.h, C.int(index), unsafe.Pointer(&frame[0]), C.int(len(frame)), C.guint64(ptsNs)) != 0 {
		return fmt.Errorf("push failed")
	}
	return nil
}

func (e *MultiSourceEncoder) PullPacket(timeoutNs uint64) ([]byte, error) {
	var data unsafe.Pointer
	var size C.int

	if C.multisource_pull(e.h, C.guint64(timeoutNs), &data, &size) != 0 {
		return nil, fmt.Errorf("pull timeout")
	}
	defer C.free(data)
	return C.GoBytes(data, size), nil
}

func (e *MultiSourceEncoder) Stop() {
	if e.h != nil {
		C.multisource_destroy(e.h)
		e.h = nil
	}
}
