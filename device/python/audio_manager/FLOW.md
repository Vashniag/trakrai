# Audio Service Flow

This document describes the complete request, execution, and delivery path for `trakrai-audio-manager`.

## End-To-End Flow

```mermaid
flowchart TD
    subgraph RequestSources["Request Sources"]
        UI["Edge UI / Cloud UI"]
        MQTT["MQTT Command"]
        WF["Workflow Engine"]
        SVC["Other Device Services"]
    end

    subgraph Routing["Routing Layer"]
        CC["cloud-comm"]
        IPC["Unix IPC Bus\n/tmp/trakrai-cloud-comm.sock"]
    end

    subgraph AudioManager["audio-manager"]
        IN["Notification Loop\n_handle_notifications"]
        CMD["Command Handler\nplay-audio / get-job / list-jobs / get-status"]
        PARSE["Request Parsing + Validation\nparse_audio_request"]
        DEDUPE["Recent Success Lookup\nSQLite dedupe window"]
        JOB["Create Job\nstate=queued"]
        Q["In-Memory Worker Queue"]
        WORK["Worker Loop\nmark_processing"]
        TTS["TTS Generator\ngTTS primary, espeak fallback\ncache in shared/audio/cache"]
        LOCAL["Local Playback Manager"]
        SPEAKER["Speaker Client"]
        STORE["SQLite Store\nstate + job history"]
        EVENT["Event Log\nshared/audio/audio-events.jsonl"]
        REPLY["Reply Publisher\njob / result / error / status"]
    end

    subgraph LocalPlayback["Local Playback Branch"]
        REALPLAY["Real Device Playback\nauto -> ffplay / mpg123 / aplay / paplay"]
        HOSTCMD["Local Dev Command Backend\ncurl generated audio to host relay"]
        HOSTRELAY["host-audio-player"]
        LAPTOP["Laptop Speakers\nafplay on macOS"]
    end

    subgraph NetworkSpeaker["Network Speaker Branch"]
        MAP["speaker-codes.csv\nmessageId -> short code"]
        SHORTPOST["HTTP POST\nm:<code>"]
        PA["IP Speaker / PA Endpoint"]
    end

    subgraph Artifacts["Persistent Artifacts"]
        DB["state/audio-manager.sqlite3"]
        CACHE["shared/audio/cache/*.(mp3|wav)"]
        LOG["shared/audio/audio-events.jsonl"]
    end

    UI -->|"WebSocket request via cloud-comm"| CC
    MQTT -->|"mqtt-message"| CC
    WF -->|"service-message: play-audio"| IPC
    SVC -->|"service-message: play-audio"| IPC
    CC -->|"service-message or mqtt-message"| IPC
    IPC --> IN
    IN --> CMD
    CMD -->|"play-audio"| PARSE
    CMD -->|"get-job / list-jobs / get-status"| REPLY
    PARSE --> DEDUPE
    DEDUPE -->|"recent match"| REPLY
    DEDUPE -->|"new request"| JOB
    JOB --> STORE
    JOB --> Q
    Q --> WORK
    WORK -->|"playLocal=true"| TTS
    TTS --> CACHE
    TTS --> LOCAL
    LOCAL -->|"real device"| REALPLAY
    LOCAL -->|"local dev"| HOSTCMD
    HOSTCMD --> HOSTRELAY
    HOSTRELAY --> LAPTOP
    WORK -->|"playSpeaker=true"| SPEAKER
    SPEAKER --> MAP
    MAP --> SHORTPOST
    SHORTPOST --> PA
    WORK --> STORE
    WORK --> EVENT
    WORK --> REPLY
    STORE --> DB
    EVENT --> LOG
```

## Response Semantics

- `play-audio` returns an immediate `audio-manager-job` response after queueing or deduping.
- Worker completion later emits `audio-manager-result`.
- Validation, queue overflow, or delivery failures emit `audio-manager-error`.
- `get-job`, `list-jobs`, and `get-status` are read-only IPC commands handled without going through the worker queue.

## Key Runtime Branches

- `playLocal=true`:
  - synthesize text into a cached audio file
  - run the configured playback backend
  - mark `localState`
- `playSpeaker=true`:
  - resolve `speakerCode` directly or through `speakerMessageId`
  - POST the short code or JSON payload to the configured speaker endpoint
  - mark `speakerState`
- both can run for the same job, and the final job state is persisted only after both branches finish

## Local Dev Specifics

- The device container still generates the audio file.
- The device container now tries `gTTS` first and falls back to `espeak`.
- The local dev config overrides playback to a `command` backend that sends the generated audio file to `host-audio-player`.
- `host-audio-player` plays the file on the host machine and records the last playback request under `.localdev/host-audio-player`.

## Files To Inspect

- Service loop: `device/python/audio_manager/src/service.py`
- TTS backend selection: `device/python/audio_manager/src/tts.py`
- Playback backend selection: `device/python/audio_manager/src/playback.py`
- Network speaker delivery: `device/python/audio_manager/src/speaker.py`
- Local host relay: `device/localdev/host-audio-player/server.py`
- Local verifier: `python3 -m device.devtool test run --test-name audio-service-local`
