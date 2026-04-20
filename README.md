# Voice Agent Setup and Debug Guide

This README documents the current implementation and debugging steps for the Voice Agent Service.

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
