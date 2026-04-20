import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function saveAudioToTemp(base64: string): Promise<string> {
  const tempDir = '/tmp';
  const rawPath = path.join(tempDir, `audio-${uuidv4()}.wav`);
  const finalPath = rawPath.replace('.wav', '-converted.wav');

  const buffer = Buffer.from(base64, 'base64');
  await writeFile(rawPath, buffer);

  // Convert to mono, 16kHz, 16-bit PCM (required for whisper.cpp)
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y', // overwrite
      '-i', rawPath,
      '-ac', '1',            // mono
      '-ar', '16000',        // 16kHz
      '-sample_fmt', 's16',  // 16-bit PCM
      finalPath
    ]);

    ffmpeg.stderr.on('data', data => console.log("[ffmpeg]", data.toString()));
    ffmpeg.on('close', code => code === 0 ? resolve(true) : reject(new Error("ffmpeg conversion failed")));
  });

  return finalPath;
}
