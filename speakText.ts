// helpers/speak.ts
import { writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
// helpers/speakText.ts
import axios from 'axios';
import fs from 'fs';
import player from 'play-sound';

const audio = player({}); // default system player

const TTS_API_URL = 'http://127.0.0.1:5002/api/tts';

export async function speakText2(text: string, voice = 'default') {
  const tempFile = path.join(__dirname, `../tts/voice-${Date.now()}.wav`);

  try {
    const res = await axios.post(
      TTS_API_URL,
      { text, voice },
      { responseType: 'arraybuffer' }
    );

    fs.writeFileSync(tempFile, res.data);

    audio.play(tempFile, (err) => {
      if (err) console.error('🔇 Error playing audio:', err);
      fs.unlink(tempFile, () => {}); // clean up
    });
  } catch (e: any) {
    console.error('🛑 Failed to synthesize speech:', e.message);
  }
}

// export async function synthesizeWithCoqui(text: string, outputPath = './tts_output.wav') {
//     try {
//         const res = await axios.post(
//             'http://127.0.0.1:5002/api/tts',
//             { text },
//             { responseType: 'arraybuffer' }
//         );
//         fs.writeFileSync(outputPath, res.data);
//         return outputPath;
//     } catch (err: any) {
//         console.error('🛑 TTS synthesis failed:', err.message);
//         throw err;
//     }
// }

export async function speakText(text: string) {
    const res = await fetch('http://127.0.0.1:5002/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    });

    const buffer = Buffer.from(await res.arrayBuffer());
    const filePath = path.join('/tmp', `tts_output_${Date.now()}.wav`);
    await writeFile(filePath, buffer);

    spawn('afplay', [filePath]); // macOS audio player (use `play` or `mpg123` on Linux)
}
