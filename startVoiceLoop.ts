// import record from 'node-record-lpcm16';
// import fs from 'fs';
// import path from 'path';
// import { transcribeAudio } from './helpers/transcribeAudio';
// import { detectWakeWord } from './helpers/wakeWord'; // custom or simple phrase match
// import axios from 'axios';

// export async function postToGuardian(text: string) {
//   try {
//     const result = await axios.post('http://localhost:8787/api/voice', {
//       text,
//       timestamp: new Date().toISOString(),
//       source: 'voice-agent'
//     });
//     console.log('📡 Sent to Guardian:', result.data);
//   } catch (e: any) {
//     console.error('❌ Failed to send to Guardian:', e.message);
//   }
// }

// let isListening = false;

// export function startVoiceLoop() {
//   console.log('🎙️ Voice Agent is live. Waiting for wake word...');

//   const filePath = path.join(__dirname, '../temp.wav');
//   const writeStream = fs.createWriteStream(filePath);

//   const micInstance = record
//     .record({ threshold: 0, verbose: false })
//     .stream()
//     .on('data', async (data: Buffer) => {
//       console.log('🎤 Captured audio...', data.toString());
//       if (isListening) return;

//       const detected = detectWakeWord(data.toString()); // Match buffer or decode and check for "Hey Guardian"
//       if (detected) {
//         console.log('👂 Wake word detected...');
//         isListening = true;

//         const outputFile = `./recordings/${Date.now()}.wav`;
//         const mic = record.record({ sampleRate: 16000 });
//         const out = fs.createWriteStream(outputFile);

//         console.log('🎤 Listening for command...');
//         mic.stream().pipe(out);

//         setTimeout(async () => {
//           mic.stop();
//           console.log('📤 Processing command...');
//           const transcript = await transcribeAudio(outputFile);
//           await postToGuardian(transcript);
//           isListening = false;
//         }, 5000); // listen 5s after wake word
//       }
//     });
// }

import record from 'node-record-lpcm16';
import path from 'path';
import wav from 'wav';
import fs from 'fs';
import { transcribeAudio } from './helpers/transcribeAudio';
import { detectWakeWord } from './helpers/wakeWord';

export function recordToWavFile(outputPath: string): Promise<void> {
    return new Promise((resolve) => {
        const fileWriter = new wav.FileWriter(outputPath, {
            sampleRate: 16000,
            channels: 1,
        });

        const mic = record.record({ 
            sampleRate: 16000, 
            channels: 1,
            audioType: 'wav',
            threshold: 0,
            verbose: true,
            recorder: 'sox',
        });
        mic.stream().pipe(fileWriter);

        setTimeout(() => {
            mic.stop();
            fileWriter.end(); // ensure WAV header is flushed
            resolve();
        }, 2000);
    });
}

let isListening = false;

export function startVoiceLoop() {
    console.log('🎙️ Voice Agent is live. Waiting for wake word...');

    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    setInterval(async () => {
        if (isListening) return;

        const filePath = path.join(tmpDir, `wake-${Date.now()}.wav`);
        await recordToWavFile(filePath);
        // const mic = record.record({ sampleRate: 16000 });
        // const out = fs.createWriteStream(filePath);
        // mic.stream().pipe(out);

        console.log('🎤 Recording snippet...');
        setTimeout(async () => {
            //   mic.stop();
            console.log('📤 Transcribing snippet...');

            try {
                const transcript = await transcribeAudio(filePath);
                console.log('📄 Transcript:', transcript);

                if (
                    !transcript ||
                    transcript.includes('(') ||
                    transcript.includes('*') ||
                    transcript.includes('[00:')
                ) {
                    console.log('🛑 Skipping non-verbal transcript:', transcript);
                    return;
                }

                if (detectWakeWord(transcript)) {
                    console.log('👂 Wake word detected!');
                    isListening = true;

                    // Now continue to full command capture logic
                    // ...
                }
            } catch (err: any) {
                console.error('⚠️ Transcription error:', err.message);
            }
        }, 2000);
    }, 4000); // Try every 3s
}
