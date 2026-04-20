// scripts/encodeWavMock.ts
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const audioPath = path.join(__dirname, '../audio/guardian.wav');
const run = async () => {
  const buffer = await readFile(audioPath);
  const base64 = buffer.toString('base64');
  await writeFile(path.join(__dirname, '../audio/guardian.wav.base64.txt'), base64);
  console.log('✅ Exported base64 mock');
};

run();
