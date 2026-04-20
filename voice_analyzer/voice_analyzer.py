from flask import Flask, request, jsonify
from speechbrain.inference import SpeakerRecognition
from speechbrain.inference.classifiers import EncoderClassifier
import base64
import tempfile
import torchaudio
import librosa

app = Flask(__name__)

# Load models (v1.0 compatible)
emotion_model = EncoderClassifier.from_hparams(
    source="speechbrain/emotion-recognition-wav2vec2-IEMOCAP",
    savedir="pretrained_models/emotion-recognition"
)
speaker_model = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="pretrained_models/spkrec-ecapa-voxceleb"
)

@app.route("/api/analyze", methods=["POST"])
def analyze():
    try:
        data = request.get_json()
        base64_audio = data.get("audio")
        if not base64_audio:
            return jsonify({ "error": "No audio data provided." }), 400

        # Decode to temp .wav file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(base64.b64decode(base64_audio))
            f.flush()
            path = f.name

        # 🧠 Emotion Prediction
        out_prob, score, index, text_lab = emotion_model.classify_file(path)

        # 🧬 Speaker Embedding
        embedding = speaker_model.encode_file(path).squeeze().tolist()

        # 🎵 Audio features via librosa
        y, sr = librosa.load(path)
        pitches, _ = librosa.piptrack(y=y, sr=sr)
        pitch = pitches[pitches > 0].mean().item() if pitches[pitches > 0].size > 0 else 0.0
        duration = librosa.get_duration(y=y, sr=sr)
        rate = len(librosa.effects.split(y)) / duration if duration > 0 else 0.0
        volume = librosa.feature.rms(y=y).mean().item()

        return jsonify({
            "emotion": text_lab,
            "confidence": round(float(score), 4),
            "embedding": embedding,
            "pitch": round(pitch, 2),
            "rate": round(rate, 2),
            "volume": round(volume, 4)
        })

    except Exception as e:
        return jsonify({ "error": str(e) }), 500

if __name__ == "__main__":
    app.run(port=5003)
