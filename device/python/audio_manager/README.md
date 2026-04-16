# TrakrAI Audio Manager

`trakrai-audio-manager` is a wheel-installed device service that receives IPC audio requests, generates speech audio with `gTTS` as the primary engine and `espeak` as the fallback, performs local playback, and delivers short-code announcements to network speakers.

The service is designed to be managed by the shared `runtime-manager` flow and called by other device services such as `workflow-engine`.

For the full request / queue / playback / speaker-delivery flowchart, see [`FLOW.md`](/Users/hardikj/code/web-apps/trakrbi/trakrai/device/python/audio_manager/FLOW.md).
