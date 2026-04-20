# Voice Service

A small voice microservice stack for Open WebUI / agent integrations.

## What is in this repo?

This repo currently contains three pieces:

1. **Transcription API** (`index.ts`)
   - Bun + Hono service
   - accepts base64 audio at `POST /transcribe`
   - normalizes audio with `ffmpeg`
   - transcribes with local `whisper.cpp`

2. **TTS API** (`tts_server/tts_server.v2.py`)
   - Flask service
   - generates speech with Coqui TTS
   - health endpoint: `GET /health`
   - synth endpoint: `POST /v1/tts`

3. **Voice analyzer** (`voice_analyzer/voice_analyzer.py`)
   - Flask service
   - analyzes emotion / speaker features from audio
   - endpoint: `POST /api/analyze`

## Current architecture

```text
client / Open WebUI
  -> transcription service :5678
  -> TTS service           :5002
  -> analyzer service      :5003
```

## Important notes

- The transcription service depends on a local checkout of `whisper.cpp` being available at:
  - `../../../../whisper.cpp` relative to `helpers/transcribeAudio.ts`
- `ffmpeg` must be installed for audio normalization.
- The TTS and analyzer services download / use ML models, so first startup can take a while.

## Quick start with Docker

### 1. Prepare env

```bash
cp tts_server/.env.example tts_server/.env
```

Edit `tts_server/.env` if you want to set a real API key or different model.

### 2. Build and start

```bash
docker compose up --build
```

### 3. Services

- Transcription API: `http://localhost:5678/transcribe`
- TTS health: `http://localhost:5002/health`
- TTS synth: `http://localhost:5002/v1/tts`
- Voice analyzer: `http://localhost:5003/api/analyze`

## Example requests

### TTS

```bash
curl -X POST http://localhost:5002/v1/tts   -H 'Content-Type: application/json'   -d '{"text":"Hello from the voice service","store":"inline"}'   --output sample.wav
```

### Transcription

Base64-encode a WAV file and send it to `/transcribe`.

## Open WebUI integration notes

For immediate use in Open WebUI, the fastest path is usually:

- use `:5002/v1/tts` as the TTS endpoint
- use `:5678/transcribe` as the speech-to-text endpoint if your integration accepts a custom transcription service

If needed, we can add a small OpenAI-compatible shim next so Open WebUI can plug into this with less custom wiring.

## Repo hygiene

This repo intentionally does **not** track:

- `.env` files
- generated audio
- model cache folders
- temp files
- local output folders

If those appear locally, they should stay untracked.
