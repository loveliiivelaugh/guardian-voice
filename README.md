# guardian-voice

A voice microservice stack for Guardian and Open WebUI.

This repo exists because there are really two slightly different integration problems to solve:

1. *Guardian-native voice microservices* for your existing Bun + Hono and docker-compose architecture
2. *Open WebUI-compatible audio APIs* that look like OpenAI-style STT/TTS endpoints

Instead of forcing one system to pretend to be the other everywhere, this repo now supports both cleanly.

## Why these microservices exist

### 1. Bun + Hono service

The Bun service is the *canonical app-facing API edge*.

Why it exists:
- it matches your normal microservice architecture
- it is lightweight and easy to compose into the rest of Guardian
- it preserves legacy routes like `/transcribe`
- it now also exposes Open WebUI-compatible routes so you do not need a completely separate adapter repo

Use it when:
- Guardian or other internal services need a voice API
- you want one stable API edge in docker-compose
- you want to proxy to Coqui or VoiceBox without changing callers

### 2. Python Open WebUI-compatible service

The Python service exists because the Coqui TTS implementation already lives naturally in Python, and Open WebUI wants a very specific HTTP contract.

Why it exists:
- Coqui TTS is easiest to host and control in Python
- Open WebUI expects OpenAI-style `/audio/speech` and `/audio/transcriptions`
- it gives you a direct compatibility surface for Open WebUI without forcing Bun to own every inference detail
- it can act as a backend helper behind the Bun service

Use it when:
- you want a direct Open WebUI-compatible backend
- you want Coqui hosted close to the TTS inference layer
- you want Bun to proxy to a simpler Python speech service

## Current architecture

### Services in this repo

#### Bun + Hono API (`index.ts`)

Routes:
- `GET /health`
- `GET /audio/models`
- `GET /audio/voices`
- `POST /audio/speech`
- `POST /audio/transcriptions`
- `POST /transcribe` (legacy)

Capabilities:
- STT via local `whisper.cpp`
- TTS via Coqui backend
- TTS via VoiceBox backend
- Open WebUI-compatible request/response shapes
- backward compatibility with the earlier JSON base64 transcription route

#### Python Open WebUI service (`openwebui_server.py`)

Routes:
- `GET /health`
- `GET /audio/models`
- `GET /audio/voices`
- `POST /audio/speech`
- `POST /audio/transcriptions`
- `POST /v1/tts`

Capabilities:
- Open WebUI-compatible STT/TTS endpoints
- direct Coqui inference
- VoiceBox passthrough mode
- local `whisper.cpp` transcription

#### Coqui TTS server (`tts_server/`)

This is the local TTS service layer and remains useful as a backend building block.

#### Voice analyzer (`voice_analyzer/`)

This is separate from the Open WebUI integration path. It provides speaker and emotion analysis for future voice-aware agent experiences.

## Backend support

### Speech-to-text

Current STT backend:
- `whisper.cpp`

How it works:
- incoming audio is normalized through `ffmpeg`
- audio is converted to mono, 16kHz, 16-bit PCM
- `whisper-cli` runs locally against your configured model

### Text-to-speech

Current TTS backends:
- `coqui`
- `voicebox`

#### Coqui

Use Coqui when:
- you want local, direct TTS inference
- you already have your existing Coqui stack working
- you want a simple default path

#### VoiceBox

Use VoiceBox when:
- you want higher-quality and more flexible voice generation
- you want profile-based voice selection
- you want to grow into richer voice UX

VoiceBox integration supports:
- `VOICEBOX_PROFILE_ID`
- `VOICEBOX_VOICE_MAP`
- fallback to the first profile returned from `/profiles`

## Why Open WebUI compatibility matters

Open WebUI does not talk to arbitrary custom speech APIs directly. In its OpenAI audio mode it expects endpoints shaped like:

- `POST /audio/transcriptions`
- `POST /audio/speech`
- optionally `GET /audio/models`
- optionally `GET /audio/voices`

This repo now exposes those routes so your self-hosted voice stack can plug into Open WebUI without needing cloud audio services.

That gives you:
- self-hosted STT
- self-hosted TTS
- Docker-friendly deployment
- the ability to switch TTS engines without changing Open WebUI itself

## Environment variables

### Shared / common

```bash
TTS_API_KEY=replace-with-your-api-key
TTS_MAX_TEXT_CHARS=5000
TTS_BACKEND=coqui

# STT
STT_DEFAULT_MODEL=whisper-1
STT_SUPPORTED_CONTENT_TYPES=audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/webm,audio/mp4,audio/flac,audio/m4a,video/webm
WHISPER_CPP_HOST_PATH=/absolute/path/to/whisper.cpp
WHISPER_CPP_DIR=/opt/whisper.cpp
WHISPER_CLI_PATH=/opt/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=/opt/whisper.cpp/models/ggml-base.en.bin
FFMPEG_BIN=ffmpeg
```

### Bun + Hono service

```bash
PORT=5678
TTS_SERVICE_URL=http://guardian-voice-openwebui:5002
```

### Python Open WebUI service

```bash
APP_HOST=0.0.0.0
APP_PORT=5002
TTS_MODEL_NAME=tts_models/en/jenny/jenny
TTS_GPU=false
```

### VoiceBox

```bash
TTS_BACKEND=voicebox
VOICEBOX_BASE_URL=http://host.docker.internal:17493
VOICEBOX_TIMEOUT_SECONDS=180
VOICEBOX_PROFILE_ID=
VOICEBOX_LANGUAGE=
VOICEBOX_DEFAULT_MODEL=voicebox
VOICEBOX_DEFAULT_VOICE=default
VOICEBOX_VOICE_MAP={}
```

## Local development

### Bun service

```bash
bun install
bun run index.ts
```

### Python Open WebUI service

```bash
pip install -r requirements-openwebui.txt
cp .env.openwebui.example .env.openwebui
python3 openwebui_server.py
```

## Docker deployment

This repo includes:
- `Dockerfile.bun`
- `Dockerfile.openwebui`
- `docker-compose.yml`
- `docker-compose.openwebui.yml`

### Main stack

```bash
cp .env.openwebui.example .env.openwebui
# edit .env.openwebui and set WHISPER_CPP_HOST_PATH to an absolute local path

docker compose up --build
```

This starts:
- `guardian-voice-bun` on port `5678`
- `guardian-voice-openwebui` on port `5002`

### Open WebUI stack overlay

```bash
docker compose -f docker-compose.yml -f docker-compose.openwebui.yml up --build
```

This additionally starts:
- `open-webui` on port `3000`

## Recommended deployment pattern

My recommendation is:

- treat `guardian-voice-bun` as the stable API edge
- keep `guardian-voice-openwebui` as the speech compatibility backend
- point Open WebUI at the Bun service unless you have a reason to use the Python service directly
- use VoiceBox for premium TTS when available
- keep Coqui as fallback/default local TTS

That gives you a clean split:
- *Bun owns app/API orchestration*
- *Python owns speech inference ergonomics where useful*
- *Open WebUI gets a stable compatible contract*

## Open WebUI configuration

Set these in the Open WebUI container:

```bash
AUDIO_STT_ENGINE=openai
AUDIO_STT_OPENAI_API_BASE_URL=http://host.docker.internal:5678
AUDIO_STT_OPENAI_API_KEY=replace-with-your-api-key
AUDIO_STT_MODEL=whisper-1

AUDIO_TTS_ENGINE=openai
AUDIO_TTS_OPENAI_API_BASE_URL=http://host.docker.internal:5678
AUDIO_TTS_OPENAI_API_KEY=replace-with-your-api-key
AUDIO_TTS_MODEL=tts-1
AUDIO_TTS_VOICE=default
AUDIO_TTS_SPLIT_ON=punctuation
```

If Open WebUI is on the same compose network and you prefer internal addressing, use the service DNS name instead of `host.docker.internal`.

## Healthchecks and startup notes

The compose files include healthchecks so dependent services do not start blind.

Important notes:
- `WHISPER_CPP_HOST_PATH` is required in `.env.openwebui` and must be an *absolute* host path
- ensure the mounted `whisper.cpp` build already contains `build/bin/whisper-cli`
- ensure the model file exists at the configured path
- if VoiceBox runs on the host, `host.docker.internal` must resolve from Docker on your machine
- the compose stack is intentionally strict here so it fails early instead of silently booting without Whisper

## Route summary

### Bun service

#### `POST /audio/transcriptions`
OpenAI-compatible multipart STT endpoint.

Input:
- multipart form field: `file`
- optional form fields: `model`, `language`

Output:
```json
{ "text": "hello world" }
```

#### `POST /audio/speech`
OpenAI-compatible TTS endpoint.

Input:
```json
{
  "model": "tts-1",
  "voice": "default",
  "input": "Hello world"
}
```

Output:
- raw audio bytes

#### `POST /transcribe`
Legacy route.

Input:
```json
{ "audio": "<base64>" }
```

Output:
```json
{ "transcription": "hello world" }
```

## Commits added during this integration

- `9c78723` Add Open WebUI-compatible audio endpoints
- `4cbf5c5` Add Open WebUI routes to Bun voice service
- `96419ee` Add container packaging for voice microservices

## Next recommended follow-ups

- runtime-test VoiceBox once the service is reachable
- add profile/voice naming conventions for your preferred personas
- add response format transcoding if you want mp3/opus output instead of wav-only defaults
- optionally add a reverse proxy or gateway ingress in front of the stack

This repo is now set up to act as both:
- a Guardian-native voice microservice layer
- an Open WebUI-compatible self-hosted voice backend
