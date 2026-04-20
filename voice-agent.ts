// voice-agent.ts
import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { transcribeAudio } from './helpers/transcribeAudio';
// import { runPlan } from './guardianClient'; // your existing Guardian runPlan call
import path from 'path';

const MODEL_PATH = path.resolve('models/ggml-base.en.bin');
const AUDIO_PATH = path.resolve('audio.wav');
const LISTEN_DURATION_MS = 5000; // 5 seconds

async function recordAudio(duration = LISTEN_DURATION_MS): Promise<void> {
  return new Promise((resolve) => {
    console.log('🎙️ Listening...');
    const rec = spawn('rec', [AUDIO_PATH]);

    setTimeout(() => {
      rec.kill();
    }, duration);

    rec.on('close', () => {
      console.log('🔊 Audio captured.');
      resolve();
    });
  });
}

async function handleVoiceInput() {
  await recordAudio();

  const transcript = await transcribeAudio(AUDIO_PATH);
  console.log('📝 Transcribed:', transcript);

  if (!transcript.toLowerCase().startsWith('hey assistant')) {
    console.log('🛑 Wake word not detected. Ignoring.');
    return;
  }

  const input = transcript.replace(/^hey assistant[,\s]*/i, '').trim();
  console.log('🤖 Sending to Guardian:', input);

//   TODO: Call upstream voice API
//   // Send to Guardian
//   await runPlan({
//     flow_id: 'voice-agent-flow',
//     context: { voice_input: input },
//   });
}

// Loop every 10s or on-demand
(async () => {
  while (true) {
    await handleVoiceInput();
    await new Promise((r) => setTimeout(r, 2000));
  }
})();
