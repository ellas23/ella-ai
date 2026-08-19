import { execFile as _execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const execFile = promisify(_execFile);

const VOSK_SCRIPT = 'scripts\\vosk_recognizer.py';
const DEFAULT_VOSK_MODEL = 'models\\vosk-model-small-en-us-0.15';
const SAPI_VOICE = process.env.SAPI_VOICE || 'Microsoft Zira Desktop';
const ONE_HOUR_MS = 60 * 60 * 1000;
const TTS_RATE = -2;

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

// Global TTS controller to avoid overlapping speech and allow interruption
let currentTtsChild = null;
// Suppress STT while TTS is playing to avoid Ella hearing herself
let sttSuppressed = false;
let _sttSuppressTimeout = null;

const INACTIVITY_SLEEP_MS = 5 * 60 * 1000;
let lastUserActivity = Date.now();
let isAsleep = false;

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
    // safety timeout: clear suppression after 10s if child doesn't exit
    if (_sttSuppressTimeout) clearTimeout(_sttSuppressTimeout);
    _sttSuppressTimeout = setTimeout(() => { sttSuppressed = false; _sttSuppressTimeout = null; }, 10000);

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
      // leave a short cooldown to avoid immediate re-trigger by residual audio
      if (_sttSuppressTimeout) { clearTimeout(_sttSuppressTimeout); _sttSuppressTimeout = null; }
      sttSuppressed = true;
      _sttSuppressTimeout = setTimeout(() => { sttSuppressed = false; _sttSuppressTimeout = null; }, 400);
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
  try {
    // ensure any previous TTS is stopped before starting
    cancelTts();
    await spawnChild('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath]);
  } finally {
    await import('node:fs/promises').then(({unlink}) => unlink(scriptPath).catch(()=>{}));
  }
}

async function runOllama(prompt, model='llama2:13b', cli='ollama', profile = null) {
  return new Promise((resolve, reject) => {
    const voiceMemoryInstruction = buildVoiceMemoryInstruction(profile || loadProfile());
    const baseInstruction = `System: You are Ella. Speak in a calm, measured, and professional tone. DO NOT correct the user's grammar or rephrase their words. Answer the user's intent directly and preserve their original wording when repeating. Provide full, informative answers — do not artificially limit length. Do not start responses with offers like "How can I help?" or "What can I do?" Do not ask clarifying questions unless the user's intent is ambiguous; when needed, ask at most one precise clarifying question. Avoid exclamations, slang, interjections, or overly casual phrasing. Never add smiley faces, emojis, giggling, happy-face text, or filler words like "like", "um", "uh", "you know". Use plain, direct language.`;
    const instruction = voiceMemoryInstruction ? `${baseInstruction}\n\n${voiceMemoryInstruction}` : baseInstruction;
    const combined = instruction + '\n\n' + prompt;
    const args = ['run', model, combined, '--hidethinking', '--nowordwrap'];
    const child = spawn(cli, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data',(c)=> out += String(c));
    child.stderr.setEncoding('utf8'); child.stderr.on('data',(c)=> err += String(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Ollama exited ${code}: ${err}`));
      resolve(sanitizeVoiceReply(cleanLine(out)));
    });
  });
}

async function startVosk(modelPath) {
  const model = modelPath || DEFAULT_VOSK_MODEL;
  if (!existsSync(model)) return null;
  // Prefer a configured Python (VOSK_PYTHON) or the project's venv if present
  const venvPy = 'venv_coqui\\Scripts\\python.exe';
  const pyCmd = process.env.VOSK_PYTHON || (existsSync(venvPy) ? venvPy : 'python');
  console.log('Starting Vosk with python:', pyCmd);
  const child = spawn(pyCmd, ['-u', VOSK_SCRIPT, model], { stdio: ['ignore','pipe','pipe'] });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  return child;
}

async function main() {
  console.log('Ella (female voice) starting.');
  const args = process.argv.slice(2);
  const useVosk = args.includes('--vosk') || process.env.STT === 'vosk';
  const modelArg = args.find(a=>a.startsWith('--vosk-model='));
  const modelPath = modelArg ? modelArg.split('=')[1] : null;
  const llmCli = process.env.LLM_CLI_PATH || 'ollama';
  const llmModel = process.env.LLM_MODEL || 'llama2:13b';

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

  if (useVosk) {
    const rec = await startVosk(modelPath);
    if (rec) {
      console.log('Vosk ready. Say the wake word or speak.');
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
          if (heard === 'VOSK_READY') { console.log('Vosk ready'); continue; }

          if (isAsleep) {
            if (isWakePhrase(heard)) {
              isAsleep = false;
              resetUserActivity();
              profile = touchProfileActivity(profile);
              saveProfile(profile);
              const wakeText = stripWakePhrase(heard);
              console.log('Ella awake.');
              if (wakeText) {
                const followUp = wakeText;
                const reply = await runOllama(followUp, llmModel, llmCli, profile);
                console.log('Reply:', reply);
                await speakSapi(reply, profile);
              } else {
                await speakSapi('Yes?', profile);
              }
              continue;
            }
            console.log('Ignored while asleep:', heard);
            continue;
          }

          resetUserActivity();
          profile = touchProfileActivity(profile);
          saveProfile(profile);

          // If we're currently speaking (TTS), ignore STT to avoid feedback loops
          if (sttSuppressed) { console.log('Ignored (speaking):', heard); continue; }
          // interrupt any current TTS when new user speech is detected
          cancelTts();
          console.log('Heard:', heard);

          const switchMatch = heard.match(/\b(?:switch|change|use)\s+(?:to\s+)?([A-Za-z][A-Za-z0-9_-]{0,29})\s+voice\b/i);
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

          const m = heard.match(/\b(?:my name is|i am|i'm|call me)\s+([A-Za-z][A-Za-z0-9_-]{1,29})/i);
          if (m && m[1]) {
            const name = m[1].trim();
            profile = rememberSpeakerVoice(profile, heard, name);
            profile = setActiveVoice(profile, name);
            saveProfile(profile);
            const ack = `Thanks. I'll remember that your name is ${name}. I am copying your style and learning it over time.`;
            console.log(ack);
            await speakSapi(ack, profile);
            continue;
          }

          profile = rememberSpeakerVoice(profile, heard);
          saveProfile(profile);

          // before calling the LLM, ensure no TTS is running (we already canceled on hear)
          const reply = await runOllama(heard, llmModel, llmCli, profile);
          console.log('Reply:', reply);
          await speakSapi(reply, profile);
        }
      });
      rec.stderr.on('data', d=> console.error('[VOSK]', String(d).trim()));
      rec.on('exit', (c)=> console.log('Vosk exit', c));
      return;
    }
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
        profile = rememberSpeakerVoice(profile, `My name is ${name}`, name);
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
        // detect name in single-shot listen
        const switchMatch = heard.match(/\b(?:switch|change|use)\s+(?:to\s+)?([A-Za-z][A-Za-z0-9_-]{0,29})\s+voice\b/i);
        if (switchMatch && switchMatch[1]) {
          const target = switchMatch[1].trim();
          profile = ensureVoiceProfile(profile, target);
          profile = setActiveVoice(profile, target);
          saveProfile(profile);
          const ack = `Switching to ${target} voice.`;
          console.log(ack); await speakSapi(ack, profile); continue;
        }
        const m = heard.match(/\b(?:my name is|i am|i'm|call me)\s+([A-Za-z][A-Za-z0-9_-]{1,29})/i);
        if (m && m[1]) {
          const name = m[1].trim();
          profile = rememberSpeakerVoice(profile, heard, name);
          profile = setActiveVoice(profile, name);
          saveProfile(profile);
          const ack = `Thanks. I'll remember that your name is ${profile.name}. I am copying your style and learning it over time.`;
          console.log(ack); await speakSapi(ack, profile); continue;
        }
        profile = rememberSpeakerVoice(profile, heard);
        saveProfile(profile);
        const reply = await runOllama(heard, llmModel, llmCli, profile); console.log('Reply:', reply); await speakSapi(reply, profile);
      } finally { await import('node:fs/promises').then(({unlink})=> unlink(scriptPath).catch(()=>{})); }
      continue;
    }
    profile = rememberSpeakerVoice(profile, t);
    saveProfile(profile);
    const reply = await runOllama(t, llmModel, llmCli, profile);
    console.log('Reply:', reply);
    await speakSapi(reply, profile);
  }
  rl.close();
}

main().catch(e=>{ console.error('Fatal', e); process.exit(1); });
