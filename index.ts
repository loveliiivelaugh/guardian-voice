// import { startMic } from './mic.ts';
// import { transcribeAudio } from './transcribe.ts';
// import { speakText } from './speak.ts';
// index.ts
import { Hono } from 'hono';
import { transcribeAudio } from './helpers/transcribeAudio.ts';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, readFile } from 'fs/promises';
import path from 'path';
// import { serve } from '@hono/node-server';
import { existsSync } from 'fs';
import { saveAudioToTemp } from './helpers/saveAudioToTemp.ts';

// *| Guardian just sends audio to the Whisper service. 
// *| It shouldn't be responsible for preparing the format. 
// *| -- Whisper should be resilient and expect anything from the client.

// export async function saveAudioToTemp(base64: string): Promise<string> {
//     const tempDir = '/tmp';
//     const filePath = path.join(tempDir, `audio-${uuidv4()}.wav`);
//     const buffer = Buffer.from(base64, 'base64');
  
//     console.log(`[🧠] Writing file to: ${filePath}`);
//     console.log(`[📦] Buffer size: ${buffer.length}`);
    
//     await writeFile(filePath, buffer);
//     console.log(`[✅] File written successfully`);

//     return filePath;
// }

const port = 5678;
const app = new Hono();

app.post('/transcribe', async (c) => {
  const { audio } = await c.req.json();
  console.log("Received audio: ", typeof audio);
//   const id = uuidv4();
//   const tmpFilePath = `/tmp/audio-${id}.wav`;
//   const buffer = Buffer.from(audio, 'base64');

//   await fs.writeFile(tmpFilePath, buffer);
// 1. Save to file & convert to whisper-compatible wav
  const tmpFilePath = await saveAudioToTemp(audio);

  if (!existsSync(tmpFilePath)) {
    throw new Error("File does not exist after writing.");
  }
  // 2. Transcribe with whisper.cpp
  const text = await transcribeAudio(tmpFilePath);
//   await fs.unlink(tmpFilePath);
  return c.json({ transcription: text });
});


// Start server
export default {
    port,
    fetch: app.fetch
};

console.log('🧠 Whisper API listening on port 5678');

// // 🔁 Optional wake word loop
// import('./startVoiceLoop.ts').then(({ startVoiceLoop }) => startVoiceLoop());


// console.log("🎙️ Voice Agent is now listening...");
// startVoiceLoop();
// await startMic(async (audioBuffer: Buffer) => {
//   const text = await transcribeAudio(audioBuffer);
//   if (text) {
//     console.log("🧠 Transcribed:", text);
//     // Store to memory or run a plan
//     const response = await fetch('http://localhost:8787/api/v1/voice/ingest', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ text })
//     });
//     const result = await response.json();
//     if (result.reply) {
//       await speakText(result.reply);
//     }
//   }
// });
