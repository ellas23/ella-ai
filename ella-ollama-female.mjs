import { execFile as _execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
const execFile = promisify(_execFile);

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const WHISPER_SCRIPT = join(PROJECT_ROOT, 'scripts', 'faster_whisper_recognizer.py');
const DEFAULT_WHISPER_MODEL = 'medium.en';
const SAPI_VOICE = process.env.SAPI_VOICE || 'Microsoft Zira Desktop';
const ONE_HOUR_MS = 60 * 60 * 1000;
const TTS_RATE = -2;
const RUNTIME_CONFIG_FILE = join(PROJECT_ROOT, 'data', 'runtime_config.json');
const TTS_STATUS_FILE = join(PROJECT_ROOT, 'data', 'tts_status.json');
let serviceSocket = null;
function writeTtsStatus(patch) {
  let current = {};
  try { current = existsSync(TTS_STATUS_FILE) ? JSON.parse(readFileSync(TTS_STATUS_FILE, 'utf8')) : {}; } catch (_) {}
  const next = { TTS_STATUS: 'IDLE', TTS_ENGINE: 'Windows System.Speech SAPI', TTS_PROCESS: null, TTS_AUDIO_GENERATED: false, TTS_OUTPUT_DEVICE: 'Windows default audio output device', TTS_LAST_ERROR: null, TTS_LAST_SPOKEN_TIME: null, ...current, ...patch, updatedAt: new Date().toISOString() };
  try { writeFileSync(TTS_STATUS_FILE, JSON.stringify(next, null, 2), 'utf8'); } catch (error) { console.error('TTS diagnostics write failed:', error.message); }
  return next;
}
function sendVoiceEvent(type, data) {
  try { if (serviceSocket && serviceSocket.readyState === WebSocket.OPEN) serviceSocket.send(JSON.stringify({ type, data })); } catch (error) { console.error('Voice event send failed:', error.message); }
}
function sendPipeline(stage, data = {}) {
  sendVoiceEvent('VOICE_PIPELINE', { stage, ...data });
}

function loadRuntimeConfig() {
  try { return existsSync(RUNTIME_CONFIG_FILE) ? JSON.parse(readFileSync(RUNTIME_CONFIG_FILE, 'utf8')) : {}; }
  catch (error) { console.error('Runtime config load failed:', error.message); return {}; }
}

function cleanLine(s) { return String(s || '').trim(); }

function sanitizeVoiceReply(text) {
  let s = String(text || '').trim();
  s = s.replace(/\b(?:smiley\s+face|smiling\s+face|happy\s+face|smile\s+face|giggle|giggles|giggling|laugh|laughing|emoji|emoticon|blush(?:ing)?|bats\s+eyelashes|wink(?:ing)?|hearts?)\b/gi, '');
  s = s.replace(/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/gu, '');
  // remove common filler/interjections and hedging
  s = s.replace(/\b(?:like|um|uh|you know|i mean|sort of|kind of|right|so|well|actually|basically|literally)\b/gi, '');
  // remove repeated consecutive words (e.g., "like like like")
  s = s.replace(/\b(\w+)(?:\s+\1){1,}\b/gi, '$1');
  // strip leading short greetings that offer help (e.g., "Hi there. How can I help you?")
  s = s.replace(/^\s*(?:hi\b|hello\b|hey\b|hi there\b|hello there\b|greetings\b)[\s,!\.-]*/i, '');
  // strip trailing offer phrases like "How can I help you today?", "What can I do for you?"
  s = s.replace(/(?:\s*[-—–:,]?\s*)?(?:how can i (?:help|assist)(?: you)?(?: today)?\??|what can i (?:help you with|do for you)(?: today)?\??|i'?m here to help(?: you)?(?: with anything)?\.?\s*)$/i, '');
  // remove excessive punctuation and whitespace
  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/^[\s\-:\;,\.\?]+|[\s\-:\;,\.\?]+$/g, '');
  // Do NOT artificially truncate responses — return the cleaned full text
  return s.trim();
}

function profilePath() { return 'ella_profile.json'; }
function defaultProfile() {
  return {
    name: null,
    voiceSample: null,
    activeVoice: null,
    voiceProfiles: {},
    speaker: {
      id: 'default_user',
      samples: [],
      style: { tone: 'neutral', directness: 'balanced', pace: 'medium', warmth: 'warm' },
      confidence: 0,
      lastSeen: null
    },
    learning: { enabled: true, improvedAt: null },
    lastUsedAt: null
  };
}
function loadProfile() {
  try {
    const p = profilePath();
    if (!existsSync(p)) return defaultProfile();
    const loaded = JSON.parse(readFileSync(p, 'utf8'));
    return { ...defaultProfile(), ...loaded, speaker: { ...defaultProfile().speaker, ...(loaded.speaker || {}) } };
  } catch (e) { return defaultProfile(); }
}
function saveProfile(profile) {
  try { writeFileSync(profilePath(), JSON.stringify(profile, null, 2), 'utf8'); return true; } catch (e) { return false; }
}

function touchProfileActivity(profile) {
  if (!profile) return profile;
  profile.lastUsedAt = new Date().toISOString();
  return profile;
}

function shouldWelcomeBack(profile) {
  if (!profile || !profile.lastUsedAt) return false;
  const lastUsed = new Date(profile.lastUsedAt).getTime();
  if (Number.isNaN(lastUsed)) return false;
  return Date.now() - lastUsed >= ONE_HOUR_MS;
}

function inferStyleFromText(text) {
  const t = String(text || '').toLowerCase();
  const style = { tone: 'neutral', directness: 'balanced', pace: 'medium', warmth: 'warm' };

  if (/\b(hey|hi|hello|yo|sup)\b/.test(t)) style.tone = 'friendly';
  if (/\b(please|can you|could you|would you|thanks|thank you)\b/.test(t)) style.tone = 'polite';
  if (/\b(quick|fast|now|right now|urgent|asap|hurry)\b/.test(t)) style.pace = 'fast';
  if (/\b(why|how|what|when|where|who)\b/.test(t)) style.directness = 'curious';
  if (/\b(seriously|honestly|just|frankly)\b/.test(t)) style.directness = 'direct';
  if (/\b(great|love|amazing|awesome|nice|perfect)\b/.test(t)) style.warmth = 'enthusiastic';
  if (/\b(please|kindly|could you)\b/.test(t)) style.warmth = 'respectful';
  return style;
}

function mergeStyles(existing = {}, incoming = {}) {
  const next = { ...defaultProfile().speaker.style, ...existing };
  Object.keys(incoming).forEach((k) => {
    if (incoming[k]) next[k] = incoming[k];
  });
  return next;
}

function rememberSpeakerVoice(profile, heard, nameOverride = null) {
  const normalized = String(heard || '').trim();
  if (!normalized) return profile;

  if (nameOverride) {
    const candidate = String(nameOverride).trim();
    if (candidate && candidate.length > 1 && candidate.toLowerCase() !== 'i') {
      profile.name = candidate;
    }
  }

  profile = ensureVoiceProfile(profile, profile.name || 'default_user');
  const speaker = profile.speaker || { id: 'default_user', samples: [], style: defaultProfile().speaker.style, confidence: 0, lastSeen: null };
  const sample = {
    text: normalized,
    style: inferStyleFromText(normalized),
    timestamp: new Date().toISOString(),
    length: normalized.length
  };

  speaker.samples.push(sample);
  // Increase short-term voice sample memory to capture more context (keep last 200)
  if (speaker.samples.length > 200) speaker.samples = speaker.samples.slice(-200);

  const styles = speaker.samples.map((s) => s.style);
  const merged = { tone: 'neutral', directness: 'balanced', pace: 'medium', warmth: 'warm' };
  const counts = {
    tone: {}, directness: {}, pace: {}, warmth: {}
  };

  styles.forEach((style) => {
    Object.keys(style).forEach((key) => {
      counts[key][style[key]] = (counts[key][style[key]] || 0) + 1;
    });
  });

  Object.keys(merged).forEach((key) => {
    const bucket = counts[key];
    if (bucket && Object.keys(bucket).length) {
      merged[key] = Object.entries(bucket).sort((a, b) => b[1] - a[1])[0][0];
    }
  });

  speaker.style = mergeStyles(speaker.style, merged);
  speaker.lastSeen = sample.timestamp;
  speaker.confidence = Math.min(1, Math.max(speaker.confidence, speaker.samples.length / 12));
  profile.speaker = speaker;
  profile.learning = { enabled: true, improvedAt: new Date().toISOString() };

  if (profile.name) {
    speaker.id = profile.name.toLowerCase();
    const voiceKey = profile.name;
    profile.voiceProfiles = profile.voiceProfiles || {};
    profile.voiceProfiles[voiceKey] = {
      ...(profile.voiceProfiles[voiceKey] || {}),
      style: speaker.style,
      // Keep a larger history per voice profile to improve long-term personalization
      samples: speaker.samples.slice(-100),
      confidence: speaker.confidence,
      updatedAt: new Date().toISOString(),
      voiceName: profile.voiceProfiles[voiceKey]?.voiceName || resolveActiveVoiceName(profile)
    };
    if (!profile.activeVoice) profile.activeVoice = voiceKey;
  }

  return profile;
}

function buildVoiceMemoryInstruction(profile) {
  const speaker = profile && profile.speaker ? profile.speaker : null;
  if (!speaker || !speaker.confidence || speaker.confidence < 0.25) return '';
  const style = speaker.style || { tone: 'neutral', directness: 'balanced', pace: 'medium', warmth: 'warm' };
  const confidencePct = Math.round((speaker.confidence || 0) * 100);
  return `Voice memory: this speaker prefers a ${style.tone} tone, ${style.directness} directness, ${style.pace} pace, and ${style.warmth} warmth. Match their cadence and energy as closely as possible while staying clear and natural. Learning confidence: ${confidencePct}%. Keep improving the match over time by refining to this personality.`;
}

function levenshteinDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }
  return rows[a.length][b.length];
}

function normalizeSpeechText(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSpeechVocabulary(profile) {
  const vocab = new Set();
  const samples = Array.isArray(profile?.speaker?.samples) ? profile.speaker.samples : [];
  samples.forEach((sample) => {
    const text = normalizeSpeechText(sample?.text || '');
    text.split(' ').forEach((token) => {
      const clean = token.replace(/'/g, '').trim();
      if (clean.length > 2) vocab.add(clean);
    });
  });
  return vocab;
}

function repairSpeechText(heard, profile) {
  const raw = String(heard || '').trim();
  if (!raw) return raw;

  const replacements = {
    " u ": ' you ', " ur ": ' your ', " r ": ' are ', " im ": ' i am ', " ive ": ' i have ', " dont ": ' do not ', " cant ": ' can not ', " wont ": ' will not ',
    " wanna ": ' want to ', " gonna ": ' going to ', " gotta ": ' got to ', " kinda ": ' kind of ', " sorta ": ' sort of ', " pls ": ' please ', " plz ": ' please ',
    " thx ": ' thanks ', " ty ": ' thank you ', " cuz ": ' because ', " b4 ": ' before ', " w/ ": ' with ', " n ": ' and ', " ya ": ' yes ', " yep ": ' yes ',
  };

  let fixed = normalizeSpeechText(raw);
  Object.entries(replacements).forEach(([wrong, right]) => {
    fixed = fixed.replace(new RegExp(`\\b${wrong.trim()}\\b`, 'gi'), right.trim());
  });
  fixed = fixed.replace(/(.)\1{2,}/g, '$1$1');

  const tokens = fixed.split(' ').filter(Boolean);
  const vocab = buildSpeechVocabulary(profile);

  const corrected = tokens.map((token) => {
    const compact = token.replace(/'/g, '');
    if (!compact || compact.length <= 2 || vocab.has(compact)) return token;

    let nearest = token;
    let bestDistance = Number.POSITIVE_INFINITY;
    const allowedDistance = compact.length <= 5 ? 1 : 2;

    for (const known of vocab) {
      const distance = levenshteinDistance(compact, known);
      if (distance <= allowedDistance && distance < bestDistance) {
        bestDistance = distance;
        nearest = known;
      }
    }

    return nearest;
  });

  const direct = corrected.join(' ');
  return direct.replace(/\s+/g, ' ').trim();
}

// Global TTS controller to avoid overlapping speech and allow interruption
let currentTtsChild = null;
// Suppress STT while TTS is playing to avoid Ella hearing herself
let sttSuppressed = false;
let _sttSuppressTimeout = null;
let lastTtsText = '';
let lastTtsEndedAt = 0;

const INACTIVITY_SLEEP_MS = 5 * 60 * 1000;
let lastUserActivity = Date.now();
let isAsleep = false;

function normalizeEchoText(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelySelfEcho(heard, spokenText = '') {
  const heardText = normalizeEchoText(heard);
  const spoken = normalizeEchoText(spokenText);
  if (!heardText || !spoken) return false;

  const ageMs = Date.now() - lastTtsEndedAt;
  if (ageMs > 6000) return false;

  if (heardText === spoken) return true;

  const heardPrefix = heardText.slice(0, Math.min(heardText.length, 32));
  const spokenPrefix = spoken.slice(0, Math.min(spoken.length, 32));
  if (heardText.includes(spokenPrefix) || spoken.includes(heardPrefix)) return true;

  const heardWords = heardText.split(' ');
  const spokenWords = spoken.split(' ');
  const overlap = heardWords.filter((word) => spokenWords.includes(word)).length;
  return heardWords.length > 3 && spokenWords.length > 3 && overlap >= Math.max(4, Math.min(heardWords.length, spokenWords.length) * 0.6);
}

function resetUserActivity() {
  lastUserActivity = Date.now();
}

function isWakePhrase(text) {
  const t = String(text || '').trim();
  return /^(?:hey\s+)?ella\b/i.test(t) || /^(?:hey\s+)?ella\s+.*$/i.test(t);
}

function stripWakePhrase(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(?:hey\s+)?ella\s*(.*)$/i);
  return m ? m[1].trim() : t;
}

function maybeSleepElla() {
  if (isAsleep) return;
  if (Date.now() - lastUserActivity >= INACTIVITY_SLEEP_MS) {
    isAsleep = true;
    cancelTts();
    console.log('Ella is asleep. Say "Ella" to wake me up.');
  }
}

function cancelTts() {
  try {
    if (currentTtsChild && !currentTtsChild.killed) {
      // attempt to gracefully kill
      currentTtsChild.kill();
    }
  } catch (e) { /* ignore */ }
  currentTtsChild = null;
  // Clear suppression when TTS canceled
  sttSuppressed = false;
  if (_sttSuppressTimeout) { clearTimeout(_sttSuppressTimeout); _sttSuppressTimeout = null; }
}

function spawnChild(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', ...opts });
    // mark TTS as active and suppress STT
    sttSuppressed = true;
    // keep a longer mute window after TTS finishes to absorb echo from the same mic/speaker setup
    if (_sttSuppressTimeout) clearTimeout(_sttSuppressTimeout);
    _sttSuppressTimeout = setTimeout(() => { sttSuppressed = false; _sttSuppressTimeout = null; }, 6000);

    currentTtsChild = child;
    child.on('error', (err) => {
      if (currentTtsChild === child) currentTtsChild = null;
      // clear suppression on error
      sttSuppressed = false;
      if (_sttSuppressTimeout) { clearTimeout(_sttSuppressTimeout); _sttSuppressTimeout = null; }
      reject(err);
    });
    child.on('exit', (code, sig) => {
      if (currentTtsChild === child) currentTtsChild = null;
      const now = Date.now();
      lastTtsEndedAt = now;
      if (_sttSuppressTimeout) { clearTimeout(_sttSuppressTimeout); _sttSuppressTimeout = null; }
      sttSuppressed = true;
      _sttSuppressTimeout = setTimeout(() => { sttSuppressed = false; _sttSuppressTimeout = null; }, 5000);
      resolve({ code, sig });
    });
  });
}

function resolveActiveVoiceName(profile) {
  // Allow an env override to force a SAPI voice (useful if system picks the wrong default)
  if (process.env.FORCE_SAPI_VOICE) return process.env.FORCE_SAPI_VOICE;
  if (!profile) return SAPI_VOICE;
  const name = profile.activeVoice;
  const voiceProfiles = profile.voiceProfiles || {};
  if (name && voiceProfiles[name] && voiceProfiles[name].voiceName) return voiceProfiles[name].voiceName;
  if (profile.name && voiceProfiles[profile.name]) return voiceProfiles[profile.name].voiceName || SAPI_VOICE;
  return SAPI_VOICE;
}

function ensureVoiceProfile(profile, name) {
  const key = String(name || '').trim();
  if (!key) return profile;
  const voiceProfiles = profile.voiceProfiles || {};
  if (!voiceProfiles[key]) {
    voiceProfiles[key] = {
      voiceName: resolveActiveVoiceName(profile),
      style: { tone: 'neutral', directness: 'balanced', pace: 'medium', warmth: 'warm' },
      samples: [],
      confidence: 0,
      updatedAt: new Date().toISOString()
    };
  }
  profile.voiceProfiles = voiceProfiles;
  return profile;
}

function setActiveVoice(profile, name) {
  const key = String(name || '').trim();
  if (!key) return profile;
  profile = ensureVoiceProfile(profile, key);
  profile.activeVoice = key;
  return profile;
}

async function speakCoqui(text, profile = null) {
  try {
    // ensure any existing TTS is stopped before starting Coqui
    cancelTts();
    lastTtsText = sanitizeVoiceReply(text);
    const fs = await import('node:fs/promises');
    const outDir = 'coqui_out';
    await fs.mkdir(outDir, { recursive: true });
    const filename = `ella_coqui_${Date.now()}.wav`;
    const hostPath = `${outDir}\\${filename}`;
    const containerPath = `/out/${filename}`;
    const model = process.env.COQUI_MODEL || 'tts_models/en/vctk/vits';
    console.log('Coqui synth: writing to', hostPath);
    // Run a docker container to synthesize the WAV into the host-mounted folder
    await execFile('docker', ['run', '--rm', '-v', `${process.cwd()}\\${outDir}:/out`, 'ghcr.io/coqui-ai/tts-cpu', 'tts', '--text', text, '--model_name', model, '--out_path', containerPath], { maxBuffer: 200 * 1024 * 1024 });
    // Play the resulting WAV using PowerShell SoundPlayer (spawned so we can cancel)
    await spawnChild('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object System.Media.SoundPlayer '${hostPath}').PlaySync()`]);
  } catch (e) {
    console.error('Coqui synth failed', e);
    // fallback to SAPI if available
    const selectedVoice = resolveActiveVoiceName(profile || { activeVoice: null, voiceProfiles: {} });
    if (process.platform !== 'win32') { console.log('TTS fallback:', text); return; }
    const b64 = Buffer.from(String(text || ''), 'utf8').toString('base64');
    const ps = [
      'Add-Type -AssemblyName System.Speech',
      `$bytes = [System.Convert]::FromBase64String('${b64}')`,
      "$text = [System.Text.Encoding]::UTF8.GetString($bytes)",
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$synth.SelectVoice(${JSON.stringify(selectedVoice)})`,
      '// Slightly slower, smoother rate for a calm and natural delivery.',
      `$synth.Rate = ${TTS_RATE}`,
      '$synth.Volume = 95',
      '$synth.Speak($text)',
      '$synth.Dispose()'
    ].join('\r\n');
    const scriptPath = `ella-female-speak-fallback-${Date.now()}.ps1`;
    await import('node:fs/promises').then(({writeFile, unlink}) => writeFile(scriptPath, ps, 'utf8').then(()=>{}).catch(()=>{}));
    try {
      // ensure previous TTS canceled before fallback
      cancelTts();
      await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath], { maxBuffer: 50 * 1024 * 1024 });
    } finally {
      await import('node:fs/promises').then(({unlink}) => unlink(scriptPath).catch(()=>{}));
    }
  }
}

async function speakSapi(text, profile = null) {
  // If configured to use Coqui, delegate
  if (process.env.TTS_BACKEND === 'coqui') {
    return speakCoqui(text, profile);
  }

  const selectedVoice = resolveActiveVoiceName(profile || { activeVoice: null, voiceProfiles: {} });
  const safeText = sanitizeVoiceReply(text);
  lastTtsText = safeText;
  if (process.platform !== 'win32') { console.log('TTS:', safeText); return; }
  const b64 = Buffer.from(String(safeText || ''), 'utf8').toString('base64');
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    `$bytes = [System.Convert]::FromBase64String('${b64}')`,
    "$text = [System.Text.Encoding]::UTF8.GetString($bytes)",
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$synth.SelectVoice(${JSON.stringify(selectedVoice)})`,
    '// Slightly slower, smoother rate for a calm and natural delivery.',
    `$synth.Rate = ${TTS_RATE}`,
    '$synth.Volume = 95',
    '$synth.Speak($text)',
    '$synth.Dispose()'
  ].join('\r\n');

  const scriptPath = `ella-female-speak-${Date.now()}.ps1`;
  await import('node:fs/promises').then(({writeFile, unlink}) => writeFile(scriptPath, ps, 'utf8').then(()=>{}).catch(()=>{}));
  writeTtsStatus({ TTS_STATUS: 'SPEAKING', TTS_PROCESS: 'powershell.exe', TTS_AUDIO_GENERATED: false, TTS_LAST_ERROR: null });
  sendVoiceEvent('VOICE_STATE', { state: 'SPEAKING', source: 'Windows System.Speech SAPI', tts: true });
  try {
    cancelTts();
    await spawnChild('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath]);
    writeTtsStatus({ TTS_STATUS: 'IDLE', TTS_PROCESS: null, TTS_AUDIO_GENERATED: true, TTS_LAST_SPOKEN_TIME: new Date().toISOString(), TTS_LAST_ERROR: null });
    sendVoiceEvent('VOICE_STATE', { state: 'IDLE', source: 'Windows System.Speech SAPI', tts: true });
  } catch (error) {
    writeTtsStatus({ TTS_STATUS: 'ERROR', TTS_PROCESS: null, TTS_AUDIO_GENERATED: false, TTS_LAST_ERROR: error.message });
    sendVoiceEvent('VOICE_STATE', { state: 'ERROR', source: 'Windows System.Speech SAPI', tts: true, error: error.message });
    throw error;
  } finally {
    await import('node:fs/promises').then(({unlink}) => unlink(scriptPath).catch(()=>{}));
  }
}

function resolveOllamaModel(requestedModel = null) {
  const preferred = requestedModel || process.env.LLM_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:14b';
  const fallbackOrder = [preferred, 'qwen2.5:14b', 'llama3:8b', 'llama2:13b'];
  return [...new Set(fallbackOrder.filter(Boolean))];
}

async function runOllama(prompt, model='qwen2.5:14b', cli='ollama', profile = null) {
  const runtime = loadRuntimeConfig();
  const brain = runtime.brain || {};
  const personality = runtime.personality || {};
  model = brain.model || model;
  const modelOrder = resolveOllamaModel(model);

  const attemptModel = (index) => new Promise((resolve, reject) => {
    const voiceMemoryInstruction = buildVoiceMemoryInstruction(profile || loadProfile());
    const custom = [personality.personality, personality.tone && `Tone: ${personality.tone}`, personality.speakingStyle && `Speaking style: ${personality.speakingStyle}`, personality.systemInstructions, personality.rules, personality.customBehavior].filter(Boolean).join('\n');
    const baseInstruction = `System: You are ${personality.name || 'Ella'}, a friendly execution-focused assistant. Understand the user's intent first, then act when the request is sufficiently specified. The coordinator performs real actions before this response is generated; never claim an action happened unless the coordinator result says it succeeded. If a required parameter is genuinely missing, ask exactly one concise question. Do not ask for information the user already provided, and do not restart the conversation after they answer. For information requests, answer directly. Speak in a calm, measured, and professional tone. DO NOT correct the user's grammar or rephrase their words. Provide full, informative answers — do not artificially limit length. Do not start responses with offers like "How can I help?" or "What can I do?" Avoid exclamations, slang, interjections, or overly casual phrasing. Never add smiley faces, emojis, giggling, or filler words. Use plain, direct language.${custom ? `\n\n${custom}` : ''}`;
    const instruction = voiceMemoryInstruction ? `${baseInstruction}\n\n${voiceMemoryInstruction}` : baseInstruction;
    const combined = instruction + '\n\n' + prompt;
    const targetModel = modelOrder[index];
    const args = ['run', targetModel, combined, '--hidethinking', '--nowordwrap'];
    const child = spawn(cli, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data',(c)=> out += String(c));
    child.stderr.setEncoding('utf8'); child.stderr.on('data',(c)=> err += String(c));
    child.on('error', (e) => {
      if (index < modelOrder.length - 1) return attemptModel(index + 1).then(resolve).catch(reject);
      reject(e);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(sanitizeVoiceReply(cleanLine(out)));
        return;
      }
      const msg = String(err || '').toLowerCase();
      const isMissingModel = /not found|model.*not found|no model/i.test(msg) || /not found|model.*not found|no model/i.test(String(out || '').toLowerCase());
      if (isMissingModel && index < modelOrder.length - 1) {
        return attemptModel(index + 1).then(resolve).catch(reject);
      }
      reject(new Error(`Ollama exited ${code}: ${err || out || 'unknown error'}`));
    });
  });

  let lastError = null;
  for (let i = 0; i < modelOrder.length; i++) {
    try {
      return await attemptModel(i);
    } catch (error) {
      lastError = error;
      if (i === modelOrder.length - 1) throw error;
    }
  }
  throw lastError || new Error('Ollama request failed');
}

let requestSequence = 0;
let requestQueue = Promise.resolve();
let pendingConfirmation = null;
let pendingClarification = null;
async function requestAction(text, confirm = false, clarification = null, requestId = null) {
  const correlationId = requestId || `voice-${Date.now()}-${++requestSequence}`;
  sendPipeline('COORDINATOR_REQUESTED', { requestId: correlationId, text });
  const response = await fetch(`http://127.0.0.1:${process.env.ELLA_PORT || 3001}/api/assistant/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: correlationId, text, confirm, ...(clarification || {}) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !payload.data) throw new Error(payload.error || `Action coordinator returned ${response.status}`);
  return payload.data || payload;
}
function actionResponseText(action) {
  if (action.status === 'WAITING_FOR_INPUT') return action.action === 'SEND_EMAIL' ? 'Which recipient should I use for that email?' : `What is the ${action.missing.join(' and ')}?`;
  if (action.status === 'WAITING_FOR_CONFIRMATION') return `I have the message ready for ${action.result.recipient}. Should I send it?`;
  if (action.status === 'CODING_TASK_COMPLETION_UNAVAILABLE') return `The coding Agent launched, but I could not independently verify completion.`;
  if (action.status === 'FAILED') return `I could not complete that action: ${action.result?.error || 'the coordinator reported a failure'}.`;
  const result = action.result || {};
  if (action.action === 'RESEARCH') return `Research completed. ${String(result.summary || '').slice(0, 1200)}`;
  if (action.action === 'CREATE_FILE') return `Created and verified ${result.path}.`;
  if (action.action === 'CREATE_CODING_TASK') return `Coding task ${result.taskId || 'created'} finished with status ${action.status}.`;
  if (action.action === 'SEND_EMAIL') return `The email was sent to ${result.recipient}.`;
  if (action.action === 'CREATE_AUTOMATION') return `The reminder was persisted as ${result.rule?.id || 'a new automation rule'}.`;
  if (action.action === 'OPEN_ITEM') return `Opened ${result.path || 'the requested item'}.`;
  return 'The requested action completed.';
}
async function handleUserRequest(text, profile, model, cli, requestIdOverride = null) {
  const requestText = String(text || '').trim();
  if (!requestText) return;
  const requestId = requestIdOverride || `voice-${Date.now()}-${++requestSequence}`;
  sendPipeline('TRANSCRIPT_RECEIVED_BY_ASSISTANT', { requestId, text: requestText });
  requestQueue = requestQueue.then(async () => {
    const isConfirmation = Boolean(pendingConfirmation && /^(yes|yeah|yep|send it|do it|confirm|okay|ok)$/i.test(requestText));
    const clarification = pendingClarification && !isConfirmation ? { resumeRequestId: pendingClarification.requestId, clarificationAnswer: requestText } : null;
    const action = await requestAction(isConfirmation ? pendingConfirmation.text : requestText, isConfirmation, clarification, requestId);
    if (action.status === 'WAITING_FOR_CONFIRMATION') pendingConfirmation = { text: isConfirmation ? pendingConfirmation.text : requestText };
    else if (isConfirmation || action.status === 'SUCCESS' || action.status === 'FAILED') pendingConfirmation = null;
    if (action.status === 'WAITING_FOR_INPUT' && action.result?.resumeRequestId) pendingClarification = { requestId: action.result.resumeRequestId };
    else if (clarification || action.status === 'SUCCESS' || action.status === 'FAILED') pendingClarification = null;
    if (action.status !== 'NOT_HANDLED') {
      const reply = actionResponseText(action);
      console.log(`Action ${action.requestId} ${action.status}:`, reply);
      sendPipeline('RESPONSE_READY', { requestId, response: reply, source: 'ACTION' });
      sendVoiceEvent('VOICE_TRANSCRIPT', { from: 'ella', text: reply, requestId });
      sendPipeline('TTS_REQUESTED', { requestId, response: reply });
      await speakSapi(reply, profile);
      return;
    }
    sendPipeline('OLLAMA_REQUESTED', { requestId, prompt: requestText });
    const reply = await runOllama(`[REQUEST_ID=${requestId}] ${requestText}`, model, cli, profile);
    if (!reply) throw new Error('Ollama returned an empty response.');
    console.log(`Reply [${action.requestId}]:`, reply);
    sendPipeline('OLLAMA_RESPONSE_RECEIVED', { requestId, response: reply });
    sendVoiceEvent('VOICE_TRANSCRIPT', { from: 'ella', text: reply, requestId });
    sendPipeline('TTS_REQUESTED', { requestId, response: reply });
    await speakSapi(reply, profile);
  }).catch(async error => {
    console.error('Request execution failed:', error.message);
    sendPipeline('REQUEST_FAILED', { requestId, error: error.message });
    await speakSapi(`I could not complete that request: ${error.message}`, profile);
  });
  await requestQueue;
}

async function startWhisper(modelName) {
  const venvPy = join(PROJECT_ROOT, 'venv_coqui', 'Scripts', 'python.exe');
  const pyCmd = process.env.WHISPER_PYTHON || (existsSync(venvPy) ? venvPy : 'python');
  if (!existsSync(WHISPER_SCRIPT)) {
    console.error('faster-whisper recognizer not found:', WHISPER_SCRIPT);
    return null;
  }
  console.log('Starting faster-whisper with python:', pyCmd, 'model:', modelName || DEFAULT_WHISPER_MODEL);
  const child = spawn(pyCmd, ['-u', WHISPER_SCRIPT], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore','pipe','pipe'],
    env: {
      ...process.env,
      FASTER_WHISPER_MODEL: modelName || process.env.FASTER_WHISPER_MODEL || DEFAULT_WHISPER_MODEL,
      FASTER_WHISPER_MODEL_DIR: process.env.FASTER_WHISPER_MODEL_DIR || join(PROJECT_ROOT, 'models', `faster-whisper-${modelName || DEFAULT_WHISPER_MODEL}`),
      ELLA_START_THRESHOLD: process.env.ELLA_START_THRESHOLD || '120',
      ELLA_DOUBLE_CLAP_ENABLED: String(loadRuntimeConfig().voice?.doubleClap?.enabled === true),
      ELLA_DOUBLE_CLAP_SPIKE_RATIO: String(loadRuntimeConfig().voice?.doubleClap?.spikeRatio || 7),
      ELLA_DOUBLE_CLAP_MIN_LEVEL: String(loadRuntimeConfig().voice?.doubleClap?.minLevel || 400),
      ELLA_DOUBLE_CLAP_COOLDOWN: String(loadRuntimeConfig().voice?.doubleClap?.cooldownSeconds || 0.8),
      ELLA_DOUBLE_CLAP_MIN_GAP: String(loadRuntimeConfig().voice?.doubleClap?.minGapSeconds || 0.05),
      ELLA_DOUBLE_CLAP_MAX_GAP: String(loadRuntimeConfig().voice?.doubleClap?.maxGapSeconds || 0.35),
      ELLA_MICROPHONE_DEVICE: String(loadRuntimeConfig().voice?.microphone?.device ?? '')
    }
  });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  return child;
}

async function main() {
  console.log('Ella (female voice) starting.');
  const args = process.argv.slice(2);
  const serviceMode = args.includes('--service');
  const useWhisper = args.includes('--whisper') || (!serviceMode && !args.includes('--vosk') && process.env.STT !== 'vosk');
  const modelArg = args.find(a=>a.startsWith('--whisper-model='));
  const modelName = modelArg ? modelArg.split('=')[1] : null;
  const llmCli = process.env.LLM_CLI_PATH || 'ollama';
  const llmModel = process.env.LLM_MODEL || process.env.OLLAMA_MODEL || loadRuntimeConfig().brain?.model || 'qwen2.5:14b';

  // Load profile and greet if it has been more than an hour since last use
  let profile = loadProfile();
  const shouldGreet = Boolean(profile && profile.name && shouldWelcomeBack(profile));
  if (shouldGreet) {
    const greet = `Welcome back, ${profile.name}. I am learning your voice and style.`;
    console.log(greet);
    await speakSapi(greet, profile);
  }
  profile = touchProfileActivity(profile);
  saveProfile(profile);

  if (useWhisper) {
    const rec = await startWhisper(modelName);
    if (rec) {
      console.log('faster-whisper recognizer starting. Waiting for microphone audio.');
      const sleepCheck = setInterval(() => {
        if (!isAsleep && Date.now() - lastUserActivity >= INACTIVITY_SLEEP_MS) {
          maybeSleepElla();
        }
      }, 15000);
      rec.on('exit', () => clearInterval(sleepCheck));
      let buf='';
      rec.stdout.on('data', async (chunk)=>{
        buf += String(chunk);
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) {
          const heard = cleanLine(line);
          if (!heard) continue;
          if (heard === 'FASTER_WHISPER_READY') { console.log('faster-whisper ready. Say the wake word or speak.'); continue; }
          if (heard === 'DOUBLE_CLAP') {
            resetUserActivity();
            sendVoiceEvent('DOUBLE_CLAP', { source: 'Ella microphone recognizer', timestamp: new Date().toISOString() });
            if (isAsleep) {
              isAsleep = false;
              console.log('Ella activated by double clap.');
              await speakSapi('Yes?', profile);
            } else if (!sttSuppressed) {
              console.log('Double clap activation acknowledged.');
              await speakSapi('Yes?', profile);
            }
            continue;
          }

          const repairedHeard = repairSpeechText(heard, profile);
          if (repairedHeard && repairedHeard !== heard) {
            console.log('Heard repaired:', heard, '=>', repairedHeard);
          }

          if (isAsleep) {
            if (isWakePhrase(repairedHeard)) {
              isAsleep = false;
              resetUserActivity();
              profile = touchProfileActivity(profile);
              saveProfile(profile);
              const wakeText = stripWakePhrase(repairedHeard);
              console.log('Ella awake.');
              if (wakeText) {
                const followUp = wakeText;
                await handleUserRequest(followUp, profile, llmModel, llmCli);
              } else {
                await speakSapi('Yes?', profile);
              }
              continue;
            }
            console.log('Ignored while asleep:', repairedHeard);
            continue;
          }

          resetUserActivity();
          profile = touchProfileActivity(profile);
          saveProfile(profile);

          // If we're currently speaking (TTS), ignore STT to avoid feedback loops
          if (sttSuppressed) { console.log('Ignored (speaking):', repairedHeard); continue; }
          // Ignore self-echo immediately after TTS playback; many Windows setups re-capture the assistant audio through the mic.
          if (isLikelySelfEcho(repairedHeard, lastTtsText)) { console.log('Ignored (self echo):', repairedHeard); continue; }
          // interrupt any current TTS when new user speech is detected
          cancelTts();
          console.log('Heard:', repairedHeard);

          const switchMatch = repairedHeard.match(/\b(?:switch|change|use)\s+(?:to\s+)?([A-Za-z][A-Za-z0-9_-]{0,29})\s+voice\b/i);
          if (switchMatch && switchMatch[1]) {
            const target = switchMatch[1].trim();
            profile = ensureVoiceProfile(profile, target);
            profile = setActiveVoice(profile, target);
            saveProfile(profile);
            const ack = `Switching to ${target} voice.`;
            console.log(ack);
            await speakSapi(ack, profile);
            continue;
          }

          const m = repairedHeard.match(/\b(?:my name is|i am|i'm|call me)\s+([A-Za-z][A-Za-z0-9_-]{1,29})/i);
          if (m && m[1]) {
            const name = m[1].trim();
            profile = rememberSpeakerVoice(profile, repairedHeard, name);
            profile = setActiveVoice(profile, name);
            saveProfile(profile);
            const ack = `Thanks. I'll remember that your name is ${name}. I am copying your style and learning it over time.`;
            console.log(ack);
            await speakSapi(ack, profile);
            continue;
          }

          profile = rememberSpeakerVoice(profile, repairedHeard);
          saveProfile(profile);

          // before calling the LLM, ensure no TTS is running (we already canceled on hear)
          await handleUserRequest(repairedHeard, profile, llmModel, llmCli);
        }
      });
      rec.stderr.on('data', d=> console.error('[FASTER_WHISPER]', String(d).trim()));
      rec.on('exit', (c)=> console.log('faster-whisper exit', c));
      return;
    }
  }

  // The dashboard starts Ella without an interactive terminal. Keep a dedicated
  // service process alive so lifecycle controls can verify the real AI owner.
  // Voice input remains owned by the desktop orb/faster-whisper process.
  if (serviceMode) {
    console.log(`ELLA_SERVICE_READY model=${llmModel}`);
    writeTtsStatus({ TTS_STATUS: 'IDLE', TTS_ENGINE: 'Windows System.Speech SAPI', TTS_PROCESS: null, TTS_OUTPUT_DEVICE: 'Windows default audio output device' });
    await new Promise((resolve) => {
      const connect = () => {
        serviceSocket = new WebSocket(`ws://127.0.0.1:${process.env.ELLA_PORT || 3001}`);
        serviceSocket.on('open', () => serviceSocket.send(JSON.stringify({ type: 'CLIENT_HELLO', data: { clientType: 'ella-assistant-service' } })));
        serviceSocket.on('message', async raw => { try { const msg = JSON.parse(String(raw)); if (msg.type === 'VOICE_TRANSCRIPT' && msg.data?.from === 'user' && msg.data?.text) await handleUserRequest(String(msg.data.text), profile, llmModel, llmCli, msg.data.requestId); } catch (error) { console.error('Service transcript handling failed:', error.message); writeTtsStatus({ TTS_STATUS: 'ERROR', TTS_LAST_ERROR: error.message }); } });
        serviceSocket.on('close', () => setTimeout(connect, 1000));
        serviceSocket.on('error', error => console.error('Assistant service WebSocket error:', error.message));
      };
      connect();
      const shutdown = () => { try { serviceSocket?.close(); } catch (_) {} resolve(); };
      process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    });
    return;
  }

  // Fallback interactive loop
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const line = await new Promise((res)=> rl.question('Say something or type /exit: ', res));
    const t = String(line||'').trim();
    if (!t) continue;
    profile = touchProfileActivity(profile);
    saveProfile(profile);
    // interrupt any speaking when user types a command or message
    cancelTts();
    if (t.toLowerCase()==='/exit') break;
    // interactive name commands
    if (t.toLowerCase().startsWith('/setname ')) {
      const name = t.slice(9).trim();
      if (name) {
        const repaired = repairSpeechText(`My name is ${name}`, profile);
        profile = rememberSpeakerVoice(profile, repaired, name);
        profile = setActiveVoice(profile, name);
        saveProfile(profile);
        const ack = `Okay, I'll remember your name is ${name}. I am copying your style and learning it over time.`;
        console.log(ack);
        await speakSapi(ack, profile);
      } else {
        console.log('Usage: /setname YourName');
      }
      continue;
    }
    if (t.toLowerCase().startsWith('/voice ')) {
      const target = t.slice(6).trim();
      if (target) {
        profile = ensureVoiceProfile(profile, target);
        profile = setActiveVoice(profile, target);
        saveProfile(profile);
        console.log(`Voice switched to ${target}.`);
        await speakSapi(`Switching to ${target} voice.`, profile);
      }
      continue;
    }
    if (t.toLowerCase()==='/getname') { console.log(`Name: ${profile.name||'(not set)'}`); continue; }
    if (t.toLowerCase()==='/listen') {
      // interrupt any speaking
      cancelTts();
      // single-shot listen via PowerShell
      const scriptPath = `ella-listen-${Date.now()}.ps1`;
      const ps = [
        'Add-Type -AssemblyName System.Speech',
        '$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine',
        '$rec.SetInputToDefaultAudioDevice()',
        '$rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
        '$r = $rec.Recognize()',
        'if ($r) { Write-Output $r.Text }'
      ].join('\r\n');
      await import('node:fs/promises').then(({writeFile,unlink})=> writeFile(scriptPath, ps, 'utf8').then(()=>{}));
      try { const { stdout } = await execFile('powershell.exe',['-NoProfile','-NonInteractive','-File',scriptPath],{maxBuffer:50*1024*1024}); const heard = String(stdout||'').trim(); if (!heard) { console.log('No speech'); continue;} console.log('Heard:', heard);
        const repairedHeard = repairSpeechText(heard, profile);
        if (repairedHeard && repairedHeard !== heard) console.log('Heard repaired:', heard, '=>', repairedHeard);
        // detect name in single-shot listen
        const switchMatch = repairedHeard.match(/\b(?:switch|change|use)\s+(?:to\s+)?([A-Za-z][A-Za-z0-9_-]{0,29})\s+voice\b/i);
        if (switchMatch && switchMatch[1]) {
          const target = switchMatch[1].trim();
          profile = ensureVoiceProfile(profile, target);
          profile = setActiveVoice(profile, target);
          saveProfile(profile);
          const ack = `Switching to ${target} voice.`;
          console.log(ack); await speakSapi(ack, profile); continue;
        }
        const m = repairedHeard.match(/\b(?:my name is|i am|i'm|call me)\s+([A-Za-z][A-Za-z0-9_-]{1,29})/i);
        if (m && m[1]) {
          const name = m[1].trim();
          profile = rememberSpeakerVoice(profile, repairedHeard, name);
          profile = setActiveVoice(profile, name);
          saveProfile(profile);
          const ack = `Thanks. I'll remember that your name is ${profile.name}. I am copying your style and learning it over time.`;
          console.log(ack); await speakSapi(ack, profile); continue;
        }
        profile = rememberSpeakerVoice(profile, repairedHeard);
        saveProfile(profile);
        await handleUserRequest(repairedHeard, profile, llmModel, llmCli);
      } finally { await import('node:fs/promises').then(({unlink})=> unlink(scriptPath).catch(()=>{})); }
      continue;
    }
    const repairedTyping = repairSpeechText(t, profile);
    if (repairedTyping && repairedTyping !== t) console.log('Typed input repaired:', t, '=>', repairedTyping);
    profile = rememberSpeakerVoice(profile, repairedTyping);
    saveProfile(profile);
    await handleUserRequest(repairedTyping, profile, llmModel, llmCli);
  }
  rl.close();
}

main().catch(e=>{ console.error('Fatal', e); process.exit(1); });
