// transcribe.ts
export async function transcribeAudio(audioBuffer: Buffer) {
    const response = await fetch("http://localhost:11434/api/whisper", {
      method: "POST",
      body: audioBuffer,
      headers: {
        "Content-Type": "audio/wav"
      }
    });
  
    const result = await response.json();
    return result.text;
  }
  