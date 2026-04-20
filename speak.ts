// speak.ts
import { exec } from 'child_process';

export async function speakText(text: string) {
  console.log("🗣️ Speaking:", text);
  exec(`say "${text.replace(/"/g, '\\"')}"`);
}
