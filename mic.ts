// mic.ts
import mic from 'mic';
import fs from 'fs';

export async function startMic(onAudio: (audio: Buffer) => Promise<void>) {
  const micInstance = mic({
    rate: '16000',
    channels: '1',
    debug: false,
    exitOnSilence: 6
  });

  const micInputStream = micInstance.getAudioStream();

  let audioChunks: Buffer[] = [];

  micInputStream.on('data', (data: Buffer) => {
    console.log(`🎙️ Mic data received: ${data.length} bytes`);
    audioChunks.push(data);
  });

  micInputStream.on('silence', async () => {
    const fullBuffer = Buffer.concat(audioChunks);
    audioChunks = [];
    await onAudio(fullBuffer);
  });

  micInputStream.on('error', (err: Error) => {
    console.error("Mic Error:", err);
  });

  micInstance.start();
}
