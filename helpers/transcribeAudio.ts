// // helpers/transcribe.ts
import { spawn } from 'child_process';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { speakText } from '../speakText';
import fs from 'fs/promises';
import path from 'path';

// // Use __dirname equivalent
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// Whisper relative path from current file
const whisperCppDir = path.resolve(__dirname, '../../../../whisper.cpp');

// export async function transcribeAudio(filePath: string): Promise<string> {
//   return new Promise((resolve, reject) => {
//     const binaryPath = path.join(whisperCppDir, 'build/bin/whisper-cli');
//     const modelPath = path.join(whisperCppDir, 'models/ggml-base.en.bin');

//     const process = spawn(binaryPath, ['-m', modelPath, '-f', filePath]);

//     let result = '';

//     process.stdout.on('data', (data) => {
//       result += data.toString();

//       speakText(data.toString());
//     //   TODO: Add websocket client support
//     //   webSocketClient.send(JSON.stringify({ type: 'tts_response', text }));
//     });

//     process.stderr.on('data', (err) => {
//       console.error('whisper error:', err.toString());
//     });

//     process.on('close', () => {
//       resolve(result.trim());
//     });

//     process.on('error', reject);
//   });
// }

export async function transcribeAudio(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const binaryPath = path.join(whisperCppDir, 'build/bin/whisper-cli');
    const modelPath = path.join(whisperCppDir, 'models/ggml-base.en.bin');

    const args = ['-m', modelPath, '-f', filePath, '--output-txt'];

    const process = spawn(binaryPath, args);

    process.stderr.on('data', (err) => {
      console.error('whisper error:', err.toString());
    });

    process.on('close', async () => {
      const txtPath = `${filePath}.txt`;
      try {
        const result = await fs.readFile(txtPath, 'utf-8');
        // await fs.unlink(txtPath);
        resolve(result.trim());
      } catch (e) {
        reject(e);
      }
    });

    process.on('error', reject);
  });
}
