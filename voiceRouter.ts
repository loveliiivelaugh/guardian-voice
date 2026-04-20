import { transcribeAudio } from './helpers/transcribeAudio';
// import { runLLM } from '@/helpers/runLLM';
// import { runPlan } from '@/orchestrator/engine';
// import { getAgentFlowByName } from '@/db/flows';

export async function handleVoiceCommand(audioFilePath: string) {
  console.log('🎤 Transcribing...');
  const transcript = await transcribeAudio(audioFilePath);
  console.log('📄 Transcript:', transcript);

  console.log('🤖 Classifying intent...');
//   TODO: Call Guardian API
//   TODO: This is cool and all but it needs to get moved to the Guardian server and be accessed via API
//   const { output: intent } = await runLLM({
//     model: 'ollama',
//     prompt: `You are an intent classifier. Given the user's voice input, return one of the following commands as JSON:
// - "run_email_flow"
// - "create_new_flow"
// - "summarize_context"
// - "noop"

// User said: "${transcript}"

// Respond as JSON:
// { "intent": "run_email_flow", "reason": "..." }`,
//     options: {
//       json: {
//         type: "object",
//         properties: {
//           intent: { type: "string" },
//           reason: { type: "string" }
//         },
//         required: ["intent"]
//       }
//     },
//     retries: 0
//   });

//   console.log('🔎 Intent classified:', intent);

//   switch (intent.intent) {
//     case 'run_email_flow': {
//       const flow = await getAgentFlowByName('gmail-intake-flow');
//       if (!flow) throw new Error('💥 Email flow not found');
//       console.log('🚀 Running Gmail Flow...');
//       await runPlan(flow, {}); // Optional context if needed
//       break;
//     }

//     case 'create_new_flow': {
//       console.log('🎨 Creating a new agent flow (stubbed)...');
//       // Maybe start a prompt for LLM to design a flow
//       break;
//     }

//     case 'summarize_context': {
//       console.log('📚 Summarizing memory/context...');
//       // Trigger summarization task
//       break;
//     }

//     case 'noop':
//     default:
//       console.log('🛑 No valid action determined.');
//       break;
//   }
}
