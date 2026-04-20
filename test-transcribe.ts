import { transcribeAudio } from './helpers/transcribeAudio';

const test = async () => {
  try {
    const transcription = await transcribeAudio('./audio/test.wav');
    console.log('🎤 Transcription Result:', transcription);
  } catch (err) {
    console.error('❌ Transcription failed:', err);
  }
};

test();
