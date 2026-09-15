const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DATA_DIR = process.env.ELLA_BOB_DATA_DIR || path.join(os.homedir(), '.ella', 'bob');
const PORT = Number(process.env.ELLA_BOB_PORT || 3010);
const CDP_PORT = Number(process.env.ELLA_BOB_CDP_PORT || 9223);
const CONTROL_TOKEN = crypto.randomBytes(32).toString('hex');
const state = { process: null, status: 'STOPPED', error: null, currentTask: null };
function publicStatus() { return { ok: ['LIVE', 'CHAT_READY'].includes(state.status), name: 'Bob', status: state.status, currentTask: state.currentTask, error: state.error }; }
function headers() { return { Authorization: `Bearer ${CONTROL_TOKEN}`, 'Content-Type': 'application/json' }; }
async function bobFetch(endpoint, options = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}${endpoint}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Bob request failed (${response.status}).`);
  return body;
}
async function startBob() {
  if (state.status === 'LIVE') return publicStatus();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  state.status = 'STARTING'; state.error = null;
  const child = spawn(process.execPath, [path.join(__dirname, 'bob.js')], {
    cwd: __dirname, windowsHide: true, stdio: 'ignore',
    env: {
      SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, HOME: os.homedir(), USERPROFILE: os.homedir(),
      BOB_PORT: String(PORT), BOB_CDP_PORT: String(CDP_PORT), BOB_DATA_DIR: DATA_DIR,
      BOB_CONTROL_TOKEN: CONTROL_TOKEN, BOB_PERSONALITY: process.env.BOB_PERSONALITY || undefined,
      BOB_MODEL: process.env.BOB_MODEL || 'gemma3:4b',
      OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
    }
  });
  state.process = child;
  child.once('exit', () => { if (state.process === child) { state.process = null; state.status = 'STOPPED'; state.currentTask = null; } });
  try {
    const started = Date.now();
    let childStatus;
    while (Date.now() - started < 10000) {
      try { childStatus = await bobFetch('/api/status'); break; } catch (_error) { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!childStatus) throw new Error('Bob process did not start.');
    state.status = 'LIVE';
    state.error = childStatus.error || null;
    return publicStatus();
  }
  catch (error) { state.status = 'ERROR'; state.error = 'Bob failed to start.'; child.kill(); throw error; }
}
async function stopBob() { if (state.process) state.process.kill(); state.process = null; state.status = 'STOPPED'; state.currentTask = null; return publicStatus(); }
async function restartBob() { await stopBob(); return startBob(); }
async function bobStatus() { try { const result = await bobFetch('/api/status'); state.status = ['LIVE', 'CHAT_READY'].includes(result.status) ? 'LIVE' : result.status; state.currentTask = result.currentTask; return publicStatus(); } catch (_error) { return publicStatus(); } }
async function submitTask(instruction) {
  await startBob();
  const result = await bobFetch('/api/tasks', { method: 'POST', body: JSON.stringify({ instruction }) });
  state.currentTask = null; return result;
}
async function chat(message, conversationId) {
  await startBob();
  return bobFetch('/api/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) });
}
async function cancelTask() { await bobFetch('/api/tasks/cancel', { method: 'POST', body: '{}' }); state.currentTask = null; }
function localJson(file) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []; } catch (_error) { return []; } }
async function activity() { fs.mkdirSync(DATA_DIR, { recursive: true }); return { ok: true, items: localJson(path.join(DATA_DIR, 'activity.json')).slice(-100).reverse() }; }
async function history() { fs.mkdirSync(DATA_DIR, { recursive: true }); return { ok: true, items: localJson(path.join(DATA_DIR, 'conversation.json')).slice(-100) }; }
async function screenshot() {
  await startBob();
  const response = await fetch(`http://127.0.0.1:${PORT}/api/screenshot`, { headers: { Authorization: `Bearer ${CONTROL_TOKEN}` } });
  if (!response.ok) throw new Error('Bob browser screen is unavailable.');
  return response;
}
module.exports = { DATA_DIR, PORT, publicStatus, startBob, stopBob, restartBob, bobStatus, submitTask, chat, cancelTask, activity, history, screenshot };
