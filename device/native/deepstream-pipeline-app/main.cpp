#include <arpa/inet.h>
#include <gst/gst.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "gstnvdsmeta.h"

#if __has_include(<filesystem>)
#include <filesystem>
namespace fs = std::filesystem;
#elif __has_include(<experimental/filesystem>)
#include <experimental/filesystem>
namespace fs = std::experimental::filesystem;
#else
#error "filesystem support is required"
#endif

namespace {

struct SourceConfig {
    int id = 0;
    std::string name;
    std::string uri;
    int rawPort = 0;
    int processedPort = 0;
    int latencyMs = 200;
    int rtpProtocol = 4;
    bool rotate180 = false;
};

struct AppConfig {
    std::vector<SourceConfig> sources;
    std::string inferConfigPath;
    std::string redisHost = "127.0.0.1";
    int redisPort = 6379;
    std::string redisPassword;
    std::string redisPrefix = "camera";
    std::string spoolDir;
    std::string udpHost = "127.0.0.1";
    int rawGridPort = 0;
    int processedGridPort = 0;
    int muxWidth = 640;
    int muxHeight = 640;
    int tileWidth = 960;
    int tileHeight = 540;
    int sampleFPS = 1;
    int sampleJPEGQuality = 80;
};

struct AppContext {
    AppConfig config;
    std::unordered_map<guint, SourceConfig> sourcesByStream;
};

struct RedisClient {
    std::string host;
    int port = 6379;
    std::string password;
    int sock = -1;
    bool authed = false;

    ~RedisClient() { closeSocket(); }

    void closeSocket() {
        if (sock >= 0) {
            close(sock);
            sock = -1;
        }
        authed = false;
    }

    bool ensureConnected() {
        if (sock >= 0) {
            return true;
        }

        sock = socket(AF_INET, SOCK_STREAM, 0);
        if (sock < 0) {
            perror("socket");
            return false;
        }

        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_port = htons(static_cast<uint16_t>(port));
        if (inet_pton(AF_INET, host.c_str(), &address.sin_addr) != 1) {
            std::cerr << "redis connect: invalid host " << host << std::endl;
            closeSocket();
            return false;
        }
        if (connect(sock, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
            perror("connect");
            closeSocket();
            return false;
        }

        if (!password.empty()) {
            if (!sendCommand({"AUTH", password})) {
                closeSocket();
                return false;
            }
            authed = true;
        }
        return true;
    }

    bool sendCommand(const std::vector<std::string>& args) {
        if (!ensureConnected()) {
            return false;
        }

        std::ostringstream buffer;
        buffer << "*" << args.size() << "\r\n";
        for (const auto& arg : args) {
            buffer << "$" << arg.size() << "\r\n" << arg << "\r\n";
        }
        const std::string payload = buffer.str();

        std::size_t written = 0;
        while (written < payload.size()) {
            const ssize_t sent = send(sock, payload.data() + written, payload.size() - written, 0);
            if (sent <= 0) {
                closeSocket();
                return false;
            }
            written += static_cast<std::size_t>(sent);
        }

        std::string reply;
        char ch = '\0';
        while (recv(sock, &ch, 1, 0) == 1) {
            reply.push_back(ch);
            if (reply.size() >= 2 && reply[reply.size() - 2] == '\r' && reply[reply.size() - 1] == '\n') {
                break;
            }
        }
        if (reply.empty() || (reply[0] != '+' && reply[0] != '$' && reply[0] != ':')) {
            closeSocket();
            return false;
        }
        return true;
    }

    bool set(const std::string& key, const std::string& value) {
        return sendCommand({"SET", key, value});
    }
};

std::string trim(const std::string& value) {
    const auto start = value.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) {
        return "";
    }
    const auto end = value.find_last_not_of(" \t\r\n");
    return value.substr(start, end - start + 1);
}

std::vector<std::string> split(const std::string& value, char delimiter) {
    std::vector<std::string> parts;
    std::stringstream stream(value);
    std::string item;
    while (std::getline(stream, item, delimiter)) {
        parts.push_back(item);
    }
    return parts;
}

std::string jsonEscape(const std::string& value) {
    std::ostringstream out;
    for (const char ch : value) {
        switch (ch) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20) {
                    out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(ch);
                } else {
                    out << ch;
                }
                break;
        }
    }
    return out.str();
}

std::string nowImageID() {
    using clock = std::chrono::system_clock;
    const auto now = clock::now();
    const auto epochMicros = std::chrono::duration_cast<std::chrono::microseconds>(now.time_since_epoch()).count();
    const auto seconds = epochMicros / 1000000;
    const auto micros = epochMicros % 1000000;
    std::time_t timeValue = static_cast<std::time_t>(seconds);
    std::tm tmValue{};
    gmtime_r(&timeValue, &tmValue);
    char buffer[64];
    std::snprintf(
        buffer,
        sizeof(buffer),
        "%04d-%02d-%02dT%02d:%02d:%02d.%06lld",
        tmValue.tm_year + 1900,
        tmValue.tm_mon + 1,
        tmValue.tm_mday,
        tmValue.tm_hour,
        tmValue.tm_min,
        tmValue.tm_sec,
        static_cast<long long>(micros)
    );
    return buffer;
}

std::string sanitizePath(const std::string& value) {
    std::string result;
    result.reserve(value.size());
    for (const char ch : value) {
        switch (ch) {
            case '/':
            case '\\':
            case ':':
            case ' ':
            case '\t':
                result.push_back('-');
                break;
            default:
                result.push_back(ch);
                break;
        }
    }
    return trim(result);
}

std::string gstEscape(const std::string& value) {
    std::string result;
    result.reserve(value.size() + 4);
    for (const char ch : value) {
        if (ch == '"' || ch == '\\') {
            result.push_back('\\');
        }
        result.push_back(ch);
    }
    return result;
}

int gridRows(int count) {
    if (count <= 1) {
        return 1;
    }
    if (count <= 4) {
        return 2;
    }
    if (count <= 9) {
        return 3;
    }
    return 4;
}

int gridColumns(int count) {
    const int rows = gridRows(count);
    return std::max(1, static_cast<int>(std::ceil(static_cast<double>(count) / static_cast<double>(rows))));
}

void ensureSpoolDirs(const AppConfig& config) {
    if (config.spoolDir.empty() || config.sampleFPS <= 0) {
        return;
    }

    for (const auto& source : config.sources) {
        for (const auto* kind : {"raw", "processed"}) {
            const fs::path dir = fs::path(config.spoolDir) / kind / sanitizePath(source.name);
            fs::create_directories(dir);
            for (const auto& entry : fs::directory_iterator(dir)) {
                if (fs::is_regular_file(entry.path())) {
                    fs::remove(entry.path());
                }
            }
        }
    }
}

std::string sampleBranch(
    const std::string& prefix,
    int index,
    const AppConfig& config,
    const SourceConfig& source,
    const std::string& kind
) {
    if (config.spoolDir.empty() || config.sampleFPS <= 0) {
        return "";
    }

    const auto baseDir = (fs::path(config.spoolDir) / kind / sanitizePath(source.name)).string();
    std::ostringstream out;
    out
        << prefix << ". ! queue leaky=downstream max-size-buffers=1 "
        << "! nvvideoconvert ! video/x-raw,format=I420 "
        << "! videorate ! video/x-raw,framerate=" << config.sampleFPS << "/1 "
        << "! jpegenc quality=" << config.sampleJPEGQuality << " "
        << "! multifilesink location=\"" << gstEscape(baseDir) << "/frame-%08d.jpg\" "
        << "post-messages=false async=false";
    return out.str();
}

std::string h264RtpSinkBranch(const std::string& prefix, const std::string& host, int port) {
    if (port <= 0) {
        return "";
    }

    std::ostringstream out;
    out
        << prefix << ". ! queue leaky=downstream max-size-buffers=2 "
        << "! nvvideoconvert ! video/x-raw(memory:NVMM),format=NV12 "
        << "! nvv4l2h264enc maxperf-enable=true insert-sps-pps=true iframeinterval=15 idrinterval=15 bitrate=2000000 "
        << "! h264parse config-interval=1 "
        << "! rtph264pay pt=96 config-interval=1 "
        << "! udpsink host=\"" << gstEscape(host) << "\" port=" << port << " sync=false async=false qos=false";
    return out.str();
}

std::string buildPipeline(const AppConfig& config) {
    const int sourceCount = static_cast<int>(config.sources.size());
    const int rows = gridRows(sourceCount);
    const int columns = gridColumns(sourceCount);

    std::vector<std::string> parts;
    parts.push_back(
        "nvstreammux name=mux live-source=1 batch-size=" + std::to_string(sourceCount) +
        " width=" + std::to_string(config.muxWidth) +
        " height=" + std::to_string(config.muxHeight) +
        " batched-push-timeout=40000"
    );
    parts.push_back("tee name=rawtee");
    parts.push_back("rawtee. ! queue ! nvinfer name=pgie config-file-path=\"" + gstEscape(config.inferConfigPath) + "\" ! tee name=proctee");

    if (config.rawGridPort > 0) {
        parts.push_back(
            "rawtee. ! queue ! nvmultistreamtiler rows=" + std::to_string(rows) +
            " columns=" + std::to_string(columns) +
            " width=" + std::to_string(config.tileWidth) +
            " height=" + std::to_string(config.tileHeight) +
            " ! tee name=rawgridtee"
        );
        parts.push_back(h264RtpSinkBranch("rawgridtee", config.udpHost, config.rawGridPort));
    }

    if (config.processedGridPort > 0) {
        parts.push_back(
            "proctee. ! queue ! nvmultistreamtiler rows=" + std::to_string(rows) +
            " columns=" + std::to_string(columns) +
            " width=" + std::to_string(config.tileWidth) +
            " height=" + std::to_string(config.tileHeight) +
            " ! nvdsosd process-mode=0 display-text=1 ! tee name=procgridtee"
        );
        parts.push_back(h264RtpSinkBranch("procgridtee", config.udpHost, config.processedGridPort));
    }

    parts.push_back("rawtee. ! queue ! nvstreamdemux name=rawdemux");
    parts.push_back("proctee. ! queue ! nvstreamdemux name=procdemux");

    for (std::size_t index = 0; index < config.sources.size(); ++index) {
        const auto& source = config.sources[index];

        std::ostringstream sourceDesc;
        sourceDesc
            << "nvurisrcbin uri=\"" << gstEscape(source.uri) << "\" type=2 "
            << "latency=" << source.latencyMs << " "
            << "select-rtp-protocol=" << source.rtpProtocol << " "
            << "rtsp-reconnect-interval=10 "
            << "! queue ";
        if (source.rotate180) {
            sourceDesc << "! nvvideoconvert flip-method=2 ";
        }
        sourceDesc << "! mux.sink_" << index;
        parts.push_back(sourceDesc.str());

        parts.push_back("rawdemux.src_" + std::to_string(index) + " ! queue ! tee name=rawsplit" + std::to_string(index));
        if (source.rawPort > 0) {
            parts.push_back(h264RtpSinkBranch("rawsplit" + std::to_string(index), config.udpHost, source.rawPort));
        }
        const auto rawSample = sampleBranch("rawsplit" + std::to_string(index), static_cast<int>(index), config, source, "raw");
        if (!rawSample.empty()) {
            parts.push_back(rawSample);
        }

        parts.push_back(
            "procdemux.src_" + std::to_string(index) +
            " ! queue ! nvdsosd process-mode=0 display-text=1 ! tee name=procsplit" + std::to_string(index)
        );
        if (source.processedPort > 0) {
            parts.push_back(h264RtpSinkBranch("procsplit" + std::to_string(index), config.udpHost, source.processedPort));
        }
        const auto processedSample = sampleBranch("procsplit" + std::to_string(index), static_cast<int>(index), config, source, "processed");
        if (!processedSample.empty()) {
            parts.push_back(processedSample);
        }
    }

    std::ostringstream pipeline;
    for (std::size_t index = 0; index < parts.size(); ++index) {
        if (parts[index].empty()) {
            continue;
        }
        if (pipeline.tellp() > 0) {
            pipeline << " ";
        }
        pipeline << parts[index];
    }
    return pipeline.str();
}

SourceConfig parseSource(const std::string& spec) {
    const auto parts = split(spec, '|');
    if (parts.size() < 7) {
        throw std::runtime_error("source spec must be id|name|uri|rawPort|processedPort|latencyMs|rotate180");
    }

    SourceConfig source;
    source.id = std::stoi(parts[0]);
    source.name = parts[1];
    source.uri = parts[2];
    source.rawPort = std::stoi(parts[3]);
    source.processedPort = std::stoi(parts[4]);
    source.latencyMs = std::stoi(parts[5]);
    source.rotate180 = parts[6] == "1" || parts[6] == "true";
    if (parts.size() >= 8 && !parts[7].empty()) {
        source.rtpProtocol = std::stoi(parts[7]);
    }
    return source;
}

AppConfig parseArgs(int argc, char** argv) {
    AppConfig config;

    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        auto requireValue = [&](const char* name) -> std::string {
            if (index + 1 >= argc) {
                throw std::runtime_error(std::string("missing value for ") + name);
            }
            ++index;
            return argv[index];
        };

        if (arg == "--source") {
            config.sources.push_back(parseSource(requireValue("--source")));
        } else if (arg == "--infer-config") {
            config.inferConfigPath = requireValue("--infer-config");
        } else if (arg == "--redis-host") {
            config.redisHost = requireValue("--redis-host");
        } else if (arg == "--redis-port") {
            config.redisPort = std::stoi(requireValue("--redis-port"));
        } else if (arg == "--redis-password") {
            config.redisPassword = requireValue("--redis-password");
        } else if (arg == "--redis-prefix") {
            config.redisPrefix = requireValue("--redis-prefix");
        } else if (arg == "--spool-dir") {
            config.spoolDir = requireValue("--spool-dir");
        } else if (arg == "--udp-host") {
            config.udpHost = requireValue("--udp-host");
        } else if (arg == "--raw-grid-port") {
            config.rawGridPort = std::stoi(requireValue("--raw-grid-port"));
        } else if (arg == "--processed-grid-port") {
            config.processedGridPort = std::stoi(requireValue("--processed-grid-port"));
        } else if (arg == "--mux-width") {
            config.muxWidth = std::stoi(requireValue("--mux-width"));
        } else if (arg == "--mux-height") {
            config.muxHeight = std::stoi(requireValue("--mux-height"));
        } else if (arg == "--tile-width") {
            config.tileWidth = std::stoi(requireValue("--tile-width"));
        } else if (arg == "--tile-height") {
            config.tileHeight = std::stoi(requireValue("--tile-height"));
        } else if (arg == "--sample-fps") {
            config.sampleFPS = std::stoi(requireValue("--sample-fps"));
        } else if (arg == "--sample-jpeg-quality") {
            config.sampleJPEGQuality = std::stoi(requireValue("--sample-jpeg-quality"));
        } else if (arg == "--version") {
            std::cout << "trakrai-deepstream-app 0.1.0" << std::endl;
            std::exit(0);
        } else {
            throw std::runtime_error("unknown argument: " + arg);
        }
    }

    if (config.sources.empty()) {
        throw std::runtime_error("at least one --source is required");
    }
    if (config.inferConfigPath.empty()) {
        throw std::runtime_error("--infer-config is required");
    }
    return config;
}

gboolean busCallback(GstBus* bus, GstMessage* message, gpointer userData) {
    auto* loop = static_cast<GMainLoop*>(userData);
    switch (GST_MESSAGE_TYPE(message)) {
        case GST_MESSAGE_EOS:
            g_main_loop_quit(loop);
            break;
        case GST_MESSAGE_ERROR: {
            GError* error = nullptr;
            gchar* debug = nullptr;
            gst_message_parse_error(message, &error, &debug);
            std::cerr << "deepstream pipeline error from " << GST_OBJECT_NAME(message->src) << ": "
                      << (error ? error->message : "unknown") << std::endl;
            if (debug) {
                std::cerr << debug << std::endl;
            }
            if (error) {
                g_error_free(error);
            }
            if (debug) {
                g_free(debug);
            }
            g_main_loop_quit(loop);
            break;
        }
        default:
            break;
    }
    return TRUE;
}

GstPadProbeReturn metadataProbe(GstPad*, GstPadProbeInfo* info, gpointer userData) {
    auto* context = static_cast<AppContext*>(userData);
    if (info == nullptr || info->data == nullptr || context == nullptr) {
        return GST_PAD_PROBE_OK;
    }

    GstBuffer* buffer = static_cast<GstBuffer*>(info->data);
    NvDsBatchMeta* batchMeta = gst_buffer_get_nvds_batch_meta(buffer);
    if (batchMeta == nullptr) {
        return GST_PAD_PROBE_OK;
    }

    static RedisClient redis;
    redis.host = context->config.redisHost;
    redis.port = context->config.redisPort;
    redis.password = context->config.redisPassword;

    for (NvDsMetaList* frameNode = batchMeta->frame_meta_list; frameNode != nullptr; frameNode = frameNode->next) {
        auto* frameMeta = static_cast<NvDsFrameMeta*>(frameNode->data);
        if (frameMeta == nullptr) {
            continue;
        }

        const auto streamIt = context->sourcesByStream.find(frameMeta->source_id);
        if (streamIt == context->sourcesByStream.end()) {
            continue;
        }
        const auto& source = streamIt->second;

        std::map<std::string, int> counts;
        std::ostringstream bboxJson;
        bboxJson << "[";
        bool firstBox = true;
        int totalDetections = 0;

        for (NvDsMetaList* objNode = frameMeta->obj_meta_list; objNode != nullptr; objNode = objNode->next) {
            auto* objectMeta = static_cast<NvDsObjectMeta*>(objNode->data);
            if (objectMeta == nullptr) {
                continue;
            }
            const std::string label = trim(objectMeta->obj_label ? objectMeta->obj_label : "object");
            counts[label.empty() ? "object" : label] += 1;
            if (!firstBox) {
                bboxJson << ",";
            }
            firstBox = false;
            bboxJson
                << "{"
                << "\"label\":\"" << jsonEscape(label.empty() ? "object" : label) << "\","
                << "\"conf\":" << std::fixed << std::setprecision(4) << objectMeta->confidence << ","
                << "\"raw_bboxes\":["
                << objectMeta->rect_params.left << ","
                << objectMeta->rect_params.top << ","
                << (objectMeta->rect_params.left + objectMeta->rect_params.width) << ","
                << (objectMeta->rect_params.top + objectMeta->rect_params.height)
                << "]"
                << "}";
            totalDetections += 1;
        }
        bboxJson << "]";

        std::ostringstream countsJson;
        countsJson << "{";
        bool firstCount = true;
        for (const auto& entry : counts) {
            if (!firstCount) {
                countsJson << ",";
            }
            firstCount = false;
            countsJson << "\"" << jsonEscape(entry.first) << "\":" << entry.second;
        }
        countsJson << "}";

        const auto imageId = nowImageID();
        const auto nowSeconds = std::chrono::duration_cast<std::chrono::milliseconds>(
                                    std::chrono::system_clock::now().time_since_epoch())
                                    .count() /
                                1000.0;

        std::ostringstream payload;
        payload
            << "{"
            << "\"cam_id\":\"" << source.id << "\","
            << "\"cam_name\":\"" << jsonEscape(source.name) << "\","
            << "\"frame_id\":\"" << jsonEscape(imageId) << "\","
            << "\"imgID\":\"" << jsonEscape(imageId) << "\","
            << "\"system_detection_time\":" << std::fixed << std::setprecision(3) << nowSeconds << ","
            << "\"totalDetection\":" << totalDetections << ","
            << "\"DetectionPerClass\":" << countsJson.str() << ","
            << "\"bbox\":" << bboxJson.str()
            << "}";

        const std::string detectionsKey = context->config.redisPrefix + ":" + source.name + ":detections";
        const std::string timeKey = context->config.redisPrefix + ":" + source.name + ":detections_time";
        redis.set(detectionsKey, payload.str());
        redis.set(timeKey, imageId);
    }

    return GST_PAD_PROBE_OK;
}

}  // namespace

int main(int argc, char** argv) {
    gst_init(&argc, &argv);

    try {
        AppContext context;
        context.config = parseArgs(argc, argv);
        ensureSpoolDirs(context.config);
        for (std::size_t index = 0; index < context.config.sources.size(); ++index) {
            context.sourcesByStream.emplace(static_cast<guint>(index), context.config.sources[index]);
        }

        const std::string pipelineDesc = buildPipeline(context.config);
        std::cout << "DeepStream pipeline: " << pipelineDesc << std::endl;

        GError* error = nullptr;
        GstElement* pipeline = gst_parse_launch(pipelineDesc.c_str(), &error);
        if (error != nullptr) {
            std::cerr << "gst_parse_launch failed: " << error->message << std::endl;
            g_error_free(error);
            return 1;
        }
        if (pipeline == nullptr) {
            std::cerr << "pipeline creation returned null" << std::endl;
            return 1;
        }

        GstElement* pgie = gst_bin_get_by_name(GST_BIN(pipeline), "pgie");
        if (pgie == nullptr) {
            std::cerr << "pgie element not found" << std::endl;
            gst_object_unref(pipeline);
            return 1;
        }
        g_object_set(G_OBJECT(pgie), "batch-size", static_cast<guint>(context.config.sources.size()), nullptr);

        GstPad* pgieSrcPad = gst_element_get_static_pad(pgie, "src");
        gst_pad_add_probe(pgieSrcPad, GST_PAD_PROBE_TYPE_BUFFER, metadataProbe, &context, nullptr);
        gst_object_unref(pgieSrcPad);
        gst_object_unref(pgie);

        GMainLoop* loop = g_main_loop_new(nullptr, FALSE);
        GstBus* bus = gst_element_get_bus(pipeline);
        gst_bus_add_watch(bus, busCallback, loop);
        gst_object_unref(bus);

        if (gst_element_set_state(pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
            std::cerr << "failed to start pipeline" << std::endl;
            gst_object_unref(pipeline);
            g_main_loop_unref(loop);
            return 1;
        }

        g_main_loop_run(loop);

        gst_element_set_state(pipeline, GST_STATE_NULL);
        gst_object_unref(pipeline);
        g_main_loop_unref(loop);
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << ex.what() << std::endl;
        return 1;
    }
}
