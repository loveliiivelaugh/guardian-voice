import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { spawn } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { saveAudioToTemp } from './helpers/saveAudioToTemp.ts';
import { transcribeAudio } from './helpers/transcribeAudio.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || process.env.APP_PORT || 5678);
const API_KEY = (process.env.TTS_API_KEY || process.env.API_KEY || '').trim();
const MAX_TEXT_CHARS = Number(process.env.TTS_MAX_TEXT_CHARS || 5000);
const TTS_BACKEND = (process.env.TTS_BACKEND || 'coqui').trim().toLowerCase();
const TTS_SERVICE_URL = (process.env.TTS_SERVICE_URL || 'http://127.0.0.1:5002').replace(/\/$/, '');
const VOICEBOX_BASE_URL = (process.env.VOICEBOX_BASE_URL || 'http://127.0.0.1:17493').replace(/\/$/, '');
const VOICEBOX_PROFILE_ID = (process.env.VOICEBOX_PROFILE_ID || '').trim();
const VOICEBOX_DEFAULT_VOICE = (process.env.VOICEBOX_DEFAULT_VOICE || 'default').trim();
const VOICEBOX_DEFAULT_MODEL = (process.env.VOICEBOX_DEFAULT_MODEL || 'voicebox').trim();
const VOICEBOX_LANGUAGE = (process.env.VOICEBOX_LANGUAGE || '').trim();
const VOICEBOX_VOICE_MAP = (process.env.VOICEBOX_VOICE_MAP || '').trim();
const STT_DEFAULT_MODEL = (process.env.STT_DEFAULT_MODEL || 'whisper-1').trim();
const STT_SUPPORTED_CONTENT_TYPES = (process.env.STT_SUPPORTED_CONTENT_TYPES || 'audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/webm,audio/mp4,audio/flac,audio/m4a,video/webm')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const app = new Hono();
let cachedVoiceMap: Record<string, string> | null = null;

type VoiceboxProfile = {
  id?: string;
  profile_id?: string;
  name?: string;
};

function jsonError(message: string, status = 400, type = 'invalid_request_error') {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function checkAuth(req: Request) {
  if (!API_KEY) return null;
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const alt = req.headers.get('x-api-key')?.trim() || '';
  const provided = bearer || alt;
  if (provided !== API_KEY) {
    return jsonError('Unauthorized', 401, 'auth_error');
  }
  return null;
}

function sanitizeText(text: string) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function loadVoiceMap() {
  if (cachedVoiceMap) return cachedVoiceMap;
  if (!VOICEBOX_VOICE_MAP) {
    cachedVoiceMap = {};
    return cachedVoiceMap;
  }
  try {
    cachedVoiceMap = JSON.parse(VOICEBOX_VOICE_MAP);
  } catch {
    cachedVoiceMap = {};
  }
  return cachedVoiceMap;
}

async function getVoiceboxProfiles() {
  try {
    const res = await fetch(`${VOICEBOX_BASE_URL}/profiles`);
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (const key of ['profiles', 'items', 'data']) {
        if (Array.isArray((data as any)[key])) return (data as any)[key];
      }
    }
    return [];
  } catch {
    return [];
  }
}

async function resolveVoiceboxProfile(voice?: string | null) {
  const requested = (voice || VOICEBOX_DEFAULT_VOICE || 'default').trim();
  if (VOICEBOX_PROFILE_ID) return VOICEBOX_PROFILE_ID;
  const map = loadVoiceMap();
  if (map && map[requested]) return map[requested];
  const profiles = await getVoiceboxProfiles();
  for (const profile of profiles) {
    const id = String(profile.id ?? profile.profile_id ?? '');
    const name = String(profile.name ?? '').trim().toLowerCase();
    if (requested.toLowerCase() === id.toLowerCase() || requested.toLowerCase() === name) {
      return id;
    }
  }
  const first = profiles[0];
  if (first) return String(first.id ?? first.profile_id ?? '');
  return null;
}

async function synthesizeViaCoqui(text: string) {
  const res = await fetch(`${TTS_SERVICE_URL}/v1/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
    body: JSON.stringify({ text, store: 'inline' }),
  });
  if (!res.ok) {
    throw new Error(`Coqui backend failed: ${await res.text()}`);
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'audio/wav',
  };
}

async function synthesizeViaVoicebox(text: string, voice?: string | null, model?: string | null) {
  const profileId = await resolveVoiceboxProfile(voice);
  if (!profileId) {
    throw new Error('VoiceBox profile resolution failed. Set VOICEBOX_PROFILE_ID or VOICEBOX_VOICE_MAP.');
  }
  const payload: Record<string, unknown> = {
    profile_id: profileId,
    text,
  };
  if (VOICEBOX_LANGUAGE) payload.language = VOICEBOX_LANGUAGE;
  if (model && !['tts-1', 'tts-1-hd', 'voicebox'].includes(model)) payload.model_size = model;

  const res = await fetch(`${VOICEBOX_BASE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`VoiceBox backend failed: ${await res.text()}`);
  }
  const contentType = res.headers.get('content-type') || 'audio/wav';
  if (contentType.includes('application/json')) {
    const data = (await res.json()) as Record<string, any>;
    const url = data.audio_url || data.url || data.file_url;
    if (!url) throw new Error(`Unexpected VoiceBox JSON response: ${JSON.stringify(data)}`);
    const audioRes = await fetch(url);
    if (!audioRes.ok) throw new Error(`VoiceBox audio fetch failed: ${await audioRes.text()}`);
    return {
      buffer: Buffer.from(await audioRes.arrayBuffer()),
      contentType: audioRes.headers.get('content-type') || 'audio/wav',
    };
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType,
  };
}

app.get('/health', (c) => c.json({ status: 'ok', tts_backend: TTS_BACKEND, stt_model: STT_DEFAULT_MODEL }));

app.get('/audio/models', async (c) => {
  const auth = checkAuth(c.req.raw);
  if (auth) return auth;
  return c.json({
    data: [
      { id: TTS_BACKEND === 'voicebox' ? VOICEBOX_DEFAULT_MODEL : 'tts-1', object: 'audio.model', owned_by: 'guardian-voice' },
      { id: 'tts-1-hd', object: 'audio.model', owned_by: 'guardian-voice' },
      { id: STT_DEFAULT_MODEL, object: 'audio.model', owned_by: 'guardian-voice' },
    ],
  });
});

app.get('/audio/voices', async (c) => {
  const auth = checkAuth(c.req.raw);
  if (auth) return auth;
  if (TTS_BACKEND !== 'voicebox') {
    return c.json({ data: [{ id: 'default', name: 'default' }] });
  }
  const profiles = (await getVoiceboxProfiles()) as VoiceboxProfile[];
  if (!profiles.length) {
    return c.json({ data: [{ id: VOICEBOX_DEFAULT_VOICE, name: VOICEBOX_DEFAULT_VOICE }] });
  }
  return c.json({
    data: profiles.map((profile: VoiceboxProfile) => ({
      id: String(profile.id ?? profile.profile_id ?? profile.name ?? 'unknown'),
      name: String(profile.name ?? profile.id ?? profile.profile_id ?? 'unknown'),
    })),
  });
});

app.post('/audio/speech', async (c) => {
  const auth = checkAuth(c.req.raw);
  if (auth) return auth;
  const body = await c.req.json().catch(() => ({} as any));
  const text = sanitizeText(String(body.input || ''));
  if (!text) return jsonError('Missing required field: input');
  if (text.length > MAX_TEXT_CHARS) return jsonError(`Input too long, max is ${MAX_TEXT_CHARS} chars`, 413);

  try {
    const result = TTS_BACKEND === 'voicebox'
      ? await synthesizeViaVoicebox(text, body.voice, body.model)
      : await synthesizeViaCoqui(text);

    return new Response(result.buffer, {
      status: 200,
      headers: { 'Content-Type': result.contentType },
    });
  } catch (error) {
    return jsonError(`TTS synthesis failed: ${(error as Error).message}`, 500, 'server_error');
  }
});

app.post('/audio/transcriptions', async (c) => {
  const auth = checkAuth(c.req.raw);
  if (auth) return auth;
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError('Missing file upload');
  if (file.type && STT_SUPPORTED_CONTENT_TYPES.length && !STT_SUPPORTED_CONTENT_TYPES.includes(file.type)) {
    return jsonError(`Unsupported content type: ${file.type}`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString('base64');

  try {
    const tmpFilePath = await saveAudioToTemp(base64);
    const text = await transcribeAudio(tmpFilePath);
    return c.json({
      text,
      model: String(form.get('model') || STT_DEFAULT_MODEL),
      ...(form.get('language') ? { language: String(form.get('language')) } : {}),
    });
  } catch (error) {
    return jsonError(`Transcription failed: ${(error as Error).message}`, 500, 'server_error');
  }
});

app.post('/transcribe', async (c) => {
  const body = await c.req.json();
  const audio = body.audio;
  if (!audio || typeof audio !== 'string') {
    return c.json({ error: 'Missing base64 audio payload' }, 400);
  }
  const tmpFilePath = await saveAudioToTemp(audio);
  const text = await transcribeAudio(tmpFilePath);
  return c.json({ transcription: text });
});

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`🧠 Guardian voice API listening on port ${PORT}`);
