# tts_server.py
from flask import Flask, request, jsonify
from TTS.api import TTS
import os
import uuid
import base64


app = Flask(__name__)
# tts = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC", progress_bar=False, gpu=False)
# tts = TTS(model_name="tts_models/en/vctk/vits", progress_bar=False, gpu=False)
# tts = TTS(model_name="tts_models/en/blizzard2013/capacitron-t2-c50", progress_bar=False, gpu=False)
tts = TTS(model_name="tts_models/en/jenny/jenny", progress_bar=False, gpu=False)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200

@app.route("/api/tts", methods=["POST"])
def synthesize():
    data = request.json or {}
    text = data.get("text", "").strip()

    # 🛡️ Sanitize bad or empty input ## too strict
    # if not text or any(token in text for token in ["*", "(", ")", "[", "]"]):
    if not text or len(text.strip()) < 2:
        return jsonify({"error": "Skipped non-speakable input."}), 200

    try:
        output_path = os.path.join("out", f"{uuid.uuid4()}.wav")
        os.makedirs("out", exist_ok=True)

        print(f"🗣️ Generating TTS for: {text}")
        tts.tts_to_file(text=text, file_path=output_path)

        with open(output_path, "rb") as f:
            audio_bytes = f.read()

        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

        os.remove(output_path)  # after base64 encoding

        print(f"✅ TTS response sent, size: {len(audio_base64)} chars")

        return jsonify({"message": "TTS complete", "file": audio_base64, "format": "wav"}), 200
    except Exception as e:
        print("❌ TTS Error:", str(e))
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(port=5002)
