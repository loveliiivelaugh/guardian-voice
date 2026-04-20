# Voice Agent Setup and Debug Guide

This README documents the current implementation and debugging steps for the Voice Agent Service.

## Open WebUI compatibility

This repo now includes both a Python service, `openwebui_server.py`, and the main Bun + Hono service in `index.ts`, each exposing OpenAI-compatible audio endpoints for Open WebUI:

- `POST /audio/transcriptions` for STT
- `POST /audio/speech` for TTS
- `GET /audio/models`
- `GET /audio/voices`
- `GET /health`

They support:

- `STT_BACKEND=whispercpp` using local `whisper.cpp`
- `TTS_BACKEND=coqui` using local Coqui TTS
- `TTS_BACKEND=voicebox` using a running VoiceBox service, for example `VOICEBOX_BASE_URL=http://127.0.0.1:17493`

For the Bun + Hono service, `/audio/transcriptions` and `/audio/speech` now live beside the legacy `/transcribe` route so existing microservice patterns still work.

### Suggested Open WebUI environment variables

```yaml
environment:
  - AUDIO_STT_ENGINE=openai
  - AUDIO_STT_OPENAI_API_BASE_URL=http://host.docker.internal:5002
  - AUDIO_STT_OPENAI_API_KEY=replace-with-your-api-key
  - AUDIO_STT_MODEL=whisper-1
  - AUDIO_TTS_ENGINE=openai
  - AUDIO_TTS_OPENAI_API_BASE_URL=http://host.docker.internal:5002
  - AUDIO_TTS_OPENAI_API_KEY=replace-with-your-api-key
  - AUDIO_TTS_MODEL=tts-1
  - AUDIO_TTS_VOICE=default
```

### Open WebUI server env vars

```bash
APP_HOST=0.0.0.0
APP_PORT=5002
TTS_API_KEY=replace-with-your-api-key

# TTS backend selection
TTS_BACKEND=coqui
# or
TTS_BACKEND=voicebox
VOICEBOX_BASE_URL=http://127.0.0.1:17493
VOICEBOX_PROFILE_ID=
VOICEBOX_VOICE_MAP={}
VOICEBOX_DEFAULT_VOICE=default
VOICEBOX_DEFAULT_MODEL=voicebox

# STT backend selection
STT_BACKEND=whispercpp
WHISPER_CPP_DIR=~/Projects/whisper.cpp
WHISPER_CLI_PATH=~/Projects/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=~/Projects/whisper.cpp/models/ggml-base.en.bin
FFMPEG_BIN=ffmpeg
```

### Bun + Hono service notes

The Bun service in `index.ts` now supports:

- `POST /transcribe` (legacy JSON base64 STT route)
- `POST /audio/transcriptions` (OpenAI-compatible multipart STT route)
- `POST /audio/speech` (OpenAI-compatible TTS route)
- `GET /audio/models`
- `GET /audio/voices`
- `GET /health`

Useful env vars for the Bun service:

```bash
PORT=5678
TTS_API_KEY=replace-with-your-api-key
TTS_BACKEND=coqui
TTS_SERVICE_URL=http://127.0.0.1:5002
# or
TTS_BACKEND=voicebox
VOICEBOX_BASE_URL=http://127.0.0.1:17493
VOICEBOX_PROFILE_ID=
VOICEBOX_VOICE_MAP={}
STT_DEFAULT_MODEL=whisper-1
```

---

## !! IMPORTANT !!

BOTH THE WHISPER VOICE SERVER AND THE COQUI TTS SERVER MUST BE RUNNING FOR THIS TO WORK.
BOTH SERVICES ARE IN THIS REPO.


## ✅ Voice Agent Overview

* Passive listener for wake word (e.g., "Hey Assistant")
* Records 5-second command after detection
* Transcribes using `whisper.cpp`
* Sends transcript to upstream voice API
* Receives TTS reply from local Coqui server
* Plays spoken response aloud

---

## 📦 Dependencies

* `node-record-lpcm16`
* `whisper.cpp` (compiled locally)
* `axios`
* Python TTS server (Coqui via `TTS`) running at `http://localhost:5002`

---

## 🔁 Voice Loop Process

1. Microphone streams incoming audio
2. `temp.wav` buffer saved (used for detecting wake word)
3. If `detectWakeWord()` matches, begin listening
4. Record 5-second clip into `/recordings/*.wav`
5. Transcribe using `transcribeAudio()` (calls `whisper-cli`)
6. Send to upstream voice API: `POST /api/v1/voice/ingest`
7. Use `speakText()` → `POST /api/tts`
8. Play the audio output

---

## 🐛 Troubleshooting

### Wake Word Not Triggering

* Log transcript before detection:

  ```ts
  console.log('Transcript:', transcript);
  ```
* Check `temp.wav` plays with `afplay ./tmp/temp.wav`
* Adjust buffer size or add `setTimeout` before transcription

### Whisper Errors

* Confirm model path:

  ```
  whisper.cpp/models/ggml-base.en.bin
  ```
* Ensure audio file is valid WAV (check sample rate = 16000)
* Ignore Metal backend warnings unless fatal

### TTS Not Playing

* Log response from `speakText()`
* Test TTS manually:

  ```bash
  curl -X POST http://localhost:5002/api/tts \
       -H "Content-Type: application/json" \
       -d '{"text": "Voice service is online"}'
  ```
* Ensure response file is played with `afplay` or `playAudioFile()`

### Python TTS Errors

* Fix `NameError: 'jsonify' is not defined` by adding:

  ```python
  from flask import jsonify
  ```
* Handle ZeroDivisionError in Coqui with:

  ```python
  audio_time = max(len(wav) / self.output_sample_rate, 0.1)
  ```

---

## 📂 File Structure

```
voice/
├── index.ts                  # Main entry for voice agent
├── tmp/temp.wav             # Short buffer for wake detection
├── recordings/              # Full command recordings
├── helpers/
│   ├── transcribeAudio.ts   # Whisper CLI call
│   ├── wakeWord.ts          # Wake word detection logic
│   ├── tts.ts               # speakText via Coqui
│   └── audioPlayer.ts       # Play audio file
```

---

## 📌 Next Steps

* Improve wake word sensitivity & duration handling
* Add fallback logging for no transcript
* Store audio + transcript for review/debug
* Make wake detection async-compatible
* Add real-time VAD if needed

---

When returning, start with:

```bash
cd voice
bun run index.ts
```

Then test:

* Say "Hey Assistant"
* Wait for recording
* Ensure TTS response plays
