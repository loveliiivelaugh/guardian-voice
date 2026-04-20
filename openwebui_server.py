import io
import os
import re
import json
import uuid
import time
import tempfile
import hashlib
import subprocess
from typing import Optional

import requests
from flask import Flask, request, jsonify, send_file, Response
from werkzeug.utils import secure_filename

from TTS.api import TTS
import soundfile as sf

APP_HOST = os.getenv('APP_HOST', '0.0.0.0')
APP_PORT = int(os.getenv('APP_PORT', '5002'))

API_KEY = os.getenv('TTS_API_KEY', '').strip()
MAX_TEXT_CHARS = int(os.getenv('TTS_MAX_TEXT_CHARS', '5000'))
TTS_MODEL_NAME = os.getenv('TTS_MODEL_NAME', 'tts_models/en/jenny/jenny')
TTS_GPU = os.getenv('TTS_GPU', 'false').lower() in ('1', 'true', 'yes')

TTS_BACKEND = os.getenv('TTS_BACKEND', 'coqui').strip().lower()
VOICEBOX_BASE_URL = os.getenv('VOICEBOX_BASE_URL', 'http://127.0.0.1:17493').rstrip('/')
VOICEBOX_TIMEOUT_SECONDS = int(os.getenv('VOICEBOX_TIMEOUT_SECONDS', '180'))
VOICEBOX_PROFILE_ID = os.getenv('VOICEBOX_PROFILE_ID', '').strip()
VOICEBOX_LANGUAGE = os.getenv('VOICEBOX_LANGUAGE', '').strip() or None
VOICEBOX_DEFAULT_MODEL = os.getenv('VOICEBOX_DEFAULT_MODEL', 'voicebox')
VOICEBOX_DEFAULT_VOICE = os.getenv('VOICEBOX_DEFAULT_VOICE', 'default')
VOICEBOX_VOICE_MAP = os.getenv('VOICEBOX_VOICE_MAP', '').strip()

WHISPER_CPP_DIR = os.getenv('WHISPER_CPP_DIR', os.path.expanduser('~/Projects/whisper.cpp'))
WHISPER_CLI_PATH = os.getenv('WHISPER_CLI_PATH', os.path.join(WHISPER_CPP_DIR, 'build/bin/whisper-cli'))
WHISPER_MODEL_PATH = os.getenv('WHISPER_MODEL_PATH', os.path.join(WHISPER_CPP_DIR, 'models/ggml-base.en.bin'))
FFMPEG_BIN = os.getenv('FFMPEG_BIN', 'ffmpeg')
STT_BACKEND = os.getenv('STT_BACKEND', 'whispercpp').strip().lower()
STT_DEFAULT_MODEL = os.getenv('STT_DEFAULT_MODEL', 'whisper-1')
STT_SUPPORTED_CONTENT_TYPES = [
    x.strip() for x in os.getenv('STT_SUPPORTED_CONTENT_TYPES', 'audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/webm,audio/mp4,audio/flac,audio/m4a,video/webm').split(',') if x.strip()
]

app = Flask(__name__)

_voice_map_cache = None
_tts_instance = None


def require_api_key():
    if not API_KEY:
        return None
    provided = request.headers.get('Authorization', '').replace('Bearer ', '').strip() or request.headers.get('X-API-Key', '').strip()
    if provided != API_KEY:
        return jsonify({'error': {'message': 'Unauthorized', 'type': 'auth_error'}}), 401
    return None


def sanitize_text(text: str) -> str:
    text = (text or '').strip()
    text = re.sub(r'\s+', ' ', text)
    return text


def load_voice_map():
    global _voice_map_cache
    if _voice_map_cache is not None:
        return _voice_map_cache
    if not VOICEBOX_VOICE_MAP:
        _voice_map_cache = {}
        return _voice_map_cache
    try:
        _voice_map_cache = json.loads(VOICEBOX_VOICE_MAP)
    except Exception:
        _voice_map_cache = {}
    return _voice_map_cache


def get_tts():
    global _tts_instance
    if _tts_instance is None:
        print(f'🔊 Loading Coqui TTS model: {TTS_MODEL_NAME} (gpu={TTS_GPU})')
        _tts_instance = TTS(model_name=TTS_MODEL_NAME, progress_bar=False, gpu=TTS_GPU)
        print('✅ Coqui model loaded')
    return _tts_instance


def encode_wav_bytes(wav, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, wav, samplerate=sample_rate, format='WAV')
    return buf.getvalue()


def openai_error(message: str, code: int = 400, err_type: str = 'invalid_request_error'):
    return jsonify({'error': {'message': message, 'type': err_type}}), code


def list_voicebox_profiles():
    try:
        res = requests.get(f'{VOICEBOX_BASE_URL}/profiles', timeout=10)
        res.raise_for_status()
        data = res.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ('profiles', 'items', 'data'):
                if isinstance(data.get(key), list):
                    return data[key]
        return []
    except Exception:
        return []


def resolve_voicebox_profile(voice: Optional[str]):
    voice = (voice or VOICEBOX_DEFAULT_VOICE or 'default').strip()
    if VOICEBOX_PROFILE_ID:
        return VOICEBOX_PROFILE_ID
    voice_map = load_voice_map()
    if voice in voice_map:
        return voice_map[voice]
    profiles = list_voicebox_profiles()
    for profile in profiles:
        pid = profile.get('id') or profile.get('profile_id')
        name = (profile.get('name') or '').strip().lower()
        if voice.lower() in {name, str(pid).lower()}:
            return pid
    if profiles:
        return profiles[0].get('id') or profiles[0].get('profile_id')
    return None


def synthesize_with_voicebox(text: str, voice: Optional[str], model: Optional[str]):
    profile_id = resolve_voicebox_profile(voice)
    if not profile_id:
        raise RuntimeError('VoiceBox profile resolution failed. Set VOICEBOX_PROFILE_ID or VOICEBOX_VOICE_MAP.')
    payload = {
        'profile_id': profile_id,
        'text': text,
    }
    if VOICEBOX_LANGUAGE:
        payload['language'] = VOICEBOX_LANGUAGE
    if model and model not in ('tts-1', 'tts-1-hd', 'voicebox'):
        payload['model_size'] = model
    res = requests.post(
        f'{VOICEBOX_BASE_URL}/generate',
        json=payload,
        timeout=VOICEBOX_TIMEOUT_SECONDS,
    )
    res.raise_for_status()
    content_type = res.headers.get('content-type', '')
    if 'application/json' in content_type:
        data = res.json()
        for key in ('audio_url', 'url', 'file_url'):
            if data.get(key):
                audio_res = requests.get(data[key], timeout=VOICEBOX_TIMEOUT_SECONDS)
                audio_res.raise_for_status()
                return audio_res.content, audio_res.headers.get('content-type', 'audio/wav')
        raise RuntimeError(f'Unexpected VoiceBox JSON response: {data}')
    return res.content, content_type or 'audio/wav'


def synthesize_with_coqui(text: str):
    tts = get_tts()
    wav = tts.tts(text=text)
    sample_rate = getattr(tts.synthesizer, 'output_sample_rate', 22050)
    audio_bytes = encode_wav_bytes(wav, sample_rate)
    return audio_bytes, 'audio/wav'


def convert_audio_to_wav(input_path: str):
    output_path = f'{input_path}-converted.wav'
    cmd = [
        FFMPEG_BIN,
        '-y',
        '-i',
        input_path,
        '-ac', '1',
        '-ar', '16000',
        '-sample_fmt', 's16',
        output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return output_path


def transcribe_with_whispercpp(input_path: str):
    output_base = input_path
    cmd = [
        WHISPER_CLI_PATH,
        '-m', WHISPER_MODEL_PATH,
        '-f', input_path,
        '--output-txt',
        '--output-file', output_base,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    txt_path = f'{output_base}.txt'
    with open(txt_path, 'r', encoding='utf-8') as f:
        return f.read().strip()


@app.get('/health')
def health():
    return jsonify({
        'status': 'ok',
        'tts_backend': TTS_BACKEND,
        'stt_backend': STT_BACKEND,
        'tts_model': TTS_MODEL_NAME if TTS_BACKEND == 'coqui' else VOICEBOX_DEFAULT_MODEL,
    }), 200


@app.get('/audio/models')
def audio_models():
    auth = require_api_key()
    if auth:
        return auth
    models = []
    if TTS_BACKEND == 'voicebox':
        models.append({'id': VOICEBOX_DEFAULT_MODEL, 'object': 'audio.model', 'owned_by': 'guardian-voice'})
    else:
        models.append({'id': 'tts-1', 'object': 'audio.model', 'owned_by': 'guardian-voice'})
    models.append({'id': 'tts-1-hd', 'object': 'audio.model', 'owned_by': 'guardian-voice'})
    models.append({'id': STT_DEFAULT_MODEL, 'object': 'audio.model', 'owned_by': 'guardian-voice'})
    return jsonify({'data': models})


@app.get('/audio/voices')
def audio_voices():
    auth = require_api_key()
    if auth:
        return auth
    voices = []
    if TTS_BACKEND == 'voicebox':
        profiles = list_voicebox_profiles()
        if profiles:
            for profile in profiles:
                pid = profile.get('id') or profile.get('profile_id')
                name = profile.get('name') or str(pid)
                voices.append({'id': str(pid), 'name': name})
        else:
            voices.append({'id': VOICEBOX_DEFAULT_VOICE, 'name': VOICEBOX_DEFAULT_VOICE})
    else:
        voices.append({'id': 'default', 'name': 'default'})
    return jsonify({'data': voices})


@app.post('/audio/speech')
def openai_speech():
    auth = require_api_key()
    if auth:
        return auth
    data = request.get_json(silent=True) or {}
    text = sanitize_text(data.get('input', ''))
    if not text or len(text) < 1:
        return openai_error('Missing required field: input')
    if len(text) > MAX_TEXT_CHARS:
        return openai_error(f'Input too long, max is {MAX_TEXT_CHARS} chars', 413)
    model = (data.get('model') or 'tts-1').strip()
    voice = (data.get('voice') or '').strip() or None
    response_format = (data.get('response_format') or 'wav').strip().lower()
    if response_format not in ('wav', 'mp3', 'flac', 'opus', 'aac', 'pcm'):
        response_format = 'wav'
    try:
        if TTS_BACKEND == 'voicebox':
            audio_bytes, content_type = synthesize_with_voicebox(text, voice=voice, model=model)
        else:
            audio_bytes, content_type = synthesize_with_coqui(text)
        return Response(audio_bytes, mimetype=content_type)
    except requests.HTTPError as e:
        detail = e.response.text if e.response is not None else str(e)
        return openai_error(f'TTS backend request failed: {detail}', 502, 'api_error')
    except Exception as e:
        return openai_error(f'TTS synthesis failed: {str(e)}', 500, 'server_error')


@app.post('/audio/transcriptions')
def openai_transcriptions():
    auth = require_api_key()
    if auth:
        return auth
    upload = request.files.get('file')
    if upload is None:
        return openai_error('Missing file upload')
    if upload.mimetype and STT_SUPPORTED_CONTENT_TYPES and upload.mimetype not in STT_SUPPORTED_CONTENT_TYPES:
        return openai_error(f'Unsupported content type: {upload.mimetype}')
    model = (request.form.get('model') or STT_DEFAULT_MODEL).strip()
    language = (request.form.get('language') or '').strip()
    temp_input = None
    converted = None
    try:
        suffix = os.path.splitext(secure_filename(upload.filename or 'audio.wav'))[1] or '.wav'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_input = tmp.name
            upload.save(tmp)
        converted = convert_audio_to_wav(temp_input)
        text = transcribe_with_whispercpp(converted)
        payload = {'text': text}
        if model:
            payload['model'] = model
        if language:
            payload['language'] = language
        return jsonify(payload)
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or b'').decode('utf-8', errors='ignore') or str(e)
        return openai_error(f'STT backend failed: {detail}', 500, 'server_error')
    except Exception as e:
        return openai_error(f'Transcription failed: {str(e)}', 500, 'server_error')
    finally:
        for path in (temp_input, converted):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass


@app.post('/v1/tts')
def guardian_tts_v1():
    auth = require_api_key()
    if auth:
        return auth
    data = request.get_json(silent=True) or {}
    text = sanitize_text(data.get('text', ''))
    if not text or len(text) < 2:
        return jsonify({'error': 'Skipped non-speakable input.'}), 200
    try:
        if TTS_BACKEND == 'voicebox':
            audio_bytes, _ = synthesize_with_voicebox(text, voice=data.get('voice'), model=data.get('model'))
        else:
            audio_bytes, _ = synthesize_with_coqui(text)
        if (data.get('store') or 'inline').lower() == 'inline':
            return send_file(io.BytesIO(audio_bytes), mimetype='audio/wav', as_attachment=False, download_name=f"{uuid.uuid4()}.wav")
        return jsonify({'error': 'Only inline mode is supported in openwebui_server.py'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host=APP_HOST, port=APP_PORT)
