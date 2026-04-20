import os
import re
import io
import json
import time
import hashlib
from datetime import datetime, timezone

from flask import Flask, request, jsonify, send_file, abort
from werkzeug.middleware.proxy_fix import ProxyFix

from TTS.api import TTS

# Optional dependency for in-memory WAV encoding
# pip install soundfile
import soundfile as sf

from dotenv import load_dotenv
load_dotenv()  # loads .env from current working dir

# Optional Supabase upload:
# pip install supabase
try:
    from supabase import create_client
except Exception:
    create_client = None


APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "5002"))

# Security (optional)
API_KEY = os.getenv("TTS_API_KEY", "").strip()  # if set, require header X-API-Key

# Storage config
STORAGE_MODE = os.getenv("TTS_STORAGE_MODE", "local").lower()  # local | supabase
OUTPUT_DIR = os.getenv("TTS_OUTPUT_DIR", "out")

# Supabase config (optional)
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "")
SUPABASE_PREFIX = os.getenv("SUPABASE_PREFIX", "tts-assets").strip("/")

# TTS model config
TTS_MODEL_NAME = os.getenv("TTS_MODEL_NAME", "tts_models/en/jenny/jenny")
TTS_GPU = os.getenv("TTS_GPU", "false").lower() in ("1", "true", "yes")

# Input limits
MAX_TEXT_CHARS = int(os.getenv("TTS_MAX_TEXT_CHARS", "5000"))

# If you're behind a proxy (nginx, etc.), this helps Flask get correct client IPs/headers.
USE_PROXY_FIX = os.getenv("USE_PROXY_FIX", "false").lower() in ("1", "true", "yes")

app = Flask(__name__)
if USE_PROXY_FIX:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)


def _require_api_key():
    if not API_KEY:
        return
    provided = request.headers.get("X-API-Key", "").strip()
    if provided != API_KEY:
        abort(401)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _sanitize_text(text: str) -> str:
    text = (text or "").strip()
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)
    return text


def _hash_request(payload: dict) -> str:
    # Stable hash used for idempotency/cache
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:24]


def _ensure_out_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def _local_asset_paths(asset_id: str, fmt: str):
    _ensure_out_dir()
    fname = f"{asset_id}.{fmt}"
    audio_path = os.path.join(OUTPUT_DIR, fname)
    meta_path = os.path.join(OUTPUT_DIR, f"{asset_id}.json")
    return audio_path, meta_path


def _write_metadata(meta_path: str, meta: dict):
    tmp = meta_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    os.replace(tmp, meta_path)


def _read_metadata(meta_path: str):
    if not os.path.exists(meta_path):
        return None
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _encode_wav_bytes(wav, sample_rate: int = 22050) -> bytes:
    """
    Coqui TTS returns a waveform array. We'll encode WAV in-memory.
    """
    buf = io.BytesIO()
    sf.write(buf, wav, samplerate=sample_rate, format="WAV")
    return buf.getvalue()


def _maybe_init_supabase():
    if STORAGE_MODE != "supabase":
        return None
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and SUPABASE_BUCKET):
        raise RuntimeError("Supabase mode enabled but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_BUCKET not set.")
    if create_client is None:
        raise RuntimeError("Supabase client not installed. pip install supabase")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _supabase_upload(sb, asset_id: str, fmt: str, audio_bytes: bytes, content_type: str):
    """
    Upload to Supabase Storage and return a path + a public URL (if bucket is public),
    otherwise return signed URL (requires additional call if you want it).
    """
    object_path = f"{SUPABASE_PREFIX}/{asset_id}.{fmt}"

    # upload expects bytes-like; supabase-py accepts file-like too
    file_options = {"content-type": content_type, "upsert": True}
    sb.storage.from_(SUPABASE_BUCKET).upload(object_path, audio_bytes, file_options=file_options)

    # Public URL works if bucket is public. If private, consider generate_signed_url.
    public_url = sb.storage.from_(SUPABASE_BUCKET).get_public_url(object_path)
    return object_path, public_url


# ---- Initialize TTS once (important for perf) ----
print(f"🔊 Loading Coqui TTS model: {TTS_MODEL_NAME} (gpu={TTS_GPU})")
tts = TTS(model_name=TTS_MODEL_NAME, progress_bar=False, gpu=TTS_GPU)
print("✅ Model loaded")


@app.get("/health")
def health():
    return jsonify({"status": "ok", "time": _now_iso(), "model": TTS_MODEL_NAME}), 200


@app.post("/v1/tts")
def synthesize():
    _require_api_key()

    started = time.time()
    data = request.get_json(silent=True) or {}

    text = _sanitize_text(data.get("text", ""))
    if not text or len(text) < 2:
        return jsonify({"error": "Skipped non-speakable input."}), 200
    if len(text) > MAX_TEXT_CHARS:
        return jsonify({"error": f"Text too long ({len(text)} chars). Max is {MAX_TEXT_CHARS}."}), 413

    # You can extend these later (speaker, language, speed, etc.)
    fmt = (data.get("format") or "wav").lower()
    if fmt not in ("wav",):
        return jsonify({"error": "Only 'wav' is supported in this service build."}), 400

    store = (data.get("store") or STORAGE_MODE).lower()  # local | supabase | inline
    # inline = return audio bytes directly without saving/uploading

    # idempotency/caching key
    req_fingerprint = {
        "text": text,
        "model": TTS_MODEL_NAME,
        "format": fmt,
        "gpu": TTS_GPU,
    }
    asset_id = data.get("asset_id") or _hash_request(req_fingerprint)

    # Local cache check
    audio_path, meta_path = _local_asset_paths(asset_id, fmt)
    if store in ("local", "inline") and os.path.exists(audio_path) and os.path.exists(meta_path):
        meta = _read_metadata(meta_path) or {}
        meta["cache_hit"] = True
        meta["served_at"] = _now_iso()

        # If inline request, return the bytes
        if store == "inline":
            return send_file(audio_path, mimetype="audio/wav", as_attachment=False, download_name=f"{asset_id}.wav")

        # JSON response
        meta["audio_url"] = f"/v1/assets/{asset_id}/audio"
        return jsonify(meta), 200

    try:
        print(f"🗣️ [{asset_id}] Generating TTS ({len(text)} chars)")
        # Generate waveform array
        wav = tts.tts(text=text)

        # Encode WAV to bytes
        audio_bytes = _encode_wav_bytes(wav, sample_rate=tts.synthesizer.output_sample_rate)
        duration_ms = int((len(wav) / float(tts.synthesizer.output_sample_rate)) * 1000)

        meta = {
            "asset_id": asset_id,
            "model": TTS_MODEL_NAME,
            "format": "wav",
            "duration_ms": duration_ms,
            "text_chars": len(text),
            "created_at": _now_iso(),
            "cache_hit": False,
        }

        # inline: return audio bytes directly (no file write)
        if store == "inline":
            elapsed_ms = int((time.time() - started) * 1000)
            meta["generation_ms"] = elapsed_ms
            # You can also return metadata headers if you want
            return send_file(
                io.BytesIO(audio_bytes),
                mimetype="audio/wav",
                as_attachment=False,
                download_name=f"{asset_id}.wav",
            )

        # local: write file + metadata, and serve via /v1/assets
        if store == "local":
            _ensure_out_dir()
            with open(audio_path, "wb") as f:
                f.write(audio_bytes)

            meta["storage"] = {"mode": "local", "path": audio_path}
            _write_metadata(meta_path, meta)

            elapsed_ms = int((time.time() - started) * 1000)
            meta["generation_ms"] = elapsed_ms
            meta["audio_url"] = f"/v1/assets/{asset_id}/audio"
            meta["meta_url"] = f"/v1/assets/{asset_id}"
            return jsonify(meta), 200

        # supabase: upload bytes and also store metadata locally (handy for debugging/cache)
        if store == "supabase":
            sb = _maybe_init_supabase()
            object_path, public_url = _supabase_upload(sb, asset_id, "wav", audio_bytes, "audio/wav")

            _ensure_out_dir()
            meta["storage"] = {
                "mode": "supabase",
                "bucket": SUPABASE_BUCKET,
                "object_path": object_path,
                "public_url": public_url,
            }
            _write_metadata(meta_path, meta)

            elapsed_ms = int((time.time() - started) * 1000)
            meta["generation_ms"] = elapsed_ms
            return jsonify(meta), 200

        return jsonify({"error": f"Unknown store mode: {store}"}), 400

    except Exception as e:
        print("❌ TTS Error:", str(e))
        return jsonify({"error": str(e)}), 500


@app.get("/v1/assets/<asset_id>")
def asset_meta(asset_id: str):
    _require_api_key()
    _, meta_path = _local_asset_paths(asset_id, "wav")  # meta doesn't depend on fmt here
    meta = _read_metadata(meta_path)
    if not meta:
        return jsonify({"error": "Not found"}), 404
    # Helpful local audio URL if available
    meta.setdefault("audio_url", f"/v1/assets/{asset_id}/audio")
    return jsonify(meta), 200


@app.get("/v1/assets/<asset_id>/audio")
def asset_audio(asset_id: str):
    _require_api_key()
    audio_path, meta_path = _local_asset_paths(asset_id, "wav")
    meta = _read_metadata(meta_path)

    # If supabase mode and we have a public URL, redirecting is an option.
    # But simplest: if local file exists, serve it. Otherwise return metadata.
    if os.path.exists(audio_path):
        return send_file(audio_path, mimetype="audio/wav", as_attachment=False, download_name=f"{asset_id}.wav")

    if meta and meta.get("storage", {}).get("mode") == "supabase":
        # If you want: return the public URL so the caller fetches it
        return jsonify({"error": "Audio stored in Supabase; fetch via URL", "public_url": meta["storage"].get("public_url")}), 409

    return jsonify({"error": "Not found"}), 404


if __name__ == "__main__":
    app.run(host=APP_HOST, port=APP_PORT)