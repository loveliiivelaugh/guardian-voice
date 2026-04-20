// helpers/wakeWord.ts
export function detectWakeWord(transcribedText: string): boolean {
    const lowered = transcribedText.toLowerCase();
    return lowered.includes('hey guardian') || lowered.includes('guardian');
}