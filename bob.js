// Bob is an isolated browser-only desktop session. It deliberately does not
// reuse Ella's desktop capture, browser profile, ports, or process lifecycle.
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { WebSocket } = require('ws');

const PORT = Number(process.env.BOB_PORT || 3010);
const HOST = process.env.BOB_HOST || '127.0.0.1';
const CDP_PORT = Number(process.env.BOB_CDP_PORT || 9223);
const START_URL = process.env.BOB_START_URL || 'about:blank';
const DATA_DIR = process.env.BOB_DATA_DIR || path.join(os.homedir(), '.ella', 'bob');
const PROFILE_DIR = process.env.BOB_PROFILE_DIR || path.join(DATA_DIR, 'browser');
const HISTORY_FILE = path.join(DATA_DIR, 'conversation.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const MEMORY_FILE = path.join(DATA_DIR, 'bob-memory.json');
const CONTROL_TOKEN = String(process.env.BOB_CONTROL_TOKEN || (require.main === module ? require('crypto').randomBytes(32).toString('hex') : ''));
const WEB_SESSION = crypto.randomBytes(32).toString('hex');
const BOB_PERSONALITY = String(process.env.BOB_PERSONALITY || 'Bob is an openly gay man and proudly queer best friend. He is warm, expressive, playful, witty, stylish, a little sassy, and comfortable using occasional LGBTQ+ slang and references to queer culture when they fit naturally. He can enthusiastically mention being gay, celebrate queer joy, and offer supportive LGBTQ+ perspectives, but he should remain authentic rather than turning every reply into a stereotype or making assumptions about another person identity. He is confident, kind, helpful, respectful, and never sexualizes or harasses anyone. Never access private files, credentials, or Ella tools.');
const BOB_MODEL = String(process.env.BOB_MODEL || 'gemma3:4b');
const OLLAMA_HOST = String(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const BOB_TTS_VOICE = String(process.env.BOB_TTS_VOICE || '');
const BOB_TTS_RATE = Number(process.env.BOB_TTS_RATE || 1);

const app = express();
app.use(express.json({ limit: '32kb' }));
function authorized(req) {
  if (!CONTROL_TOKEN) return true;
  return req.get('Authorization') === `Bearer ${CONTROL_TOKEN}`;
}
function webSessionAuthorized(req) { return String(req.headers.cookie || '').split(';').some(item => item.trim() === `bob_session=${WEB_SESSION}`); }
app.use('/api', (req, res, next) => req.path === '/public/status' || (['/chat', '/chat/history', '/memories'].includes(req.path) || req.path.startsWith('/memories/')) && webSessionAuthorized(req) || authorized(req) ? next() : res.status(401).json({ ok: false, error: 'Bob authentication failed.' }));
app.get('/', (_req, res) => { res.setHeader('Set-Cookie', `bob_session=${WEB_SESSION}; HttpOnly; SameSite=Lax; Path=/`); res.sendFile(path.join(__dirname, 'bob-chat.html')); });
app.get('/bob-viewer.html', (_req, res) => res.sendFile(path.join(__dirname, 'bob-viewer.html')));
app.get('/api/status', (_req, res) => res.json(status()));
app.get('/api/public/status', (_req, res) => res.json({ ok: true, name: 'Bob', status: state.status, model: BOB_MODEL }));
app.get('/api/public/config', (_req, res) => res.json({ ok: true, tts: { enabled: true, voice: BOB_TTS_VOICE, rate: Number.isFinite(BOB_TTS_RATE) ? BOB_TTS_RATE : 1 } }));

const state = {
  process: null,
  socket: null,
  sessionId: null,
  targetId: null,
  nextId: 1,
  pending: new Map(),
  status: 'STOPPED',
  error: null,
  startedAt: null
};
let currentTask = null;
const SECRET_PATTERN = /\b(password|passcode|api[\s_-]?key|access[\s_-]?token|auth(?:entication)?[\s_-]?token|private[\s_-]?key|credit\s*card|ssn|social security)\b/i;
function memoryItems() { return loadJson(MEMORY_FILE, []).filter(item => item && item.id && item.text); }
function saveMemory(text, kind = 'conversation') {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value || value.length > 500 || SECRET_PATTERN.test(value)) return null;
  const existing = memoryItems().find(item => item.text.toLowerCase() === value.toLowerCase());
  if (existing) return existing;
  const now = new Date().toISOString();
  const item = { id: crypto.randomUUID(), text: value, kind, createdAt: now, updatedAt: now };
  saveJson(MEMORY_FILE, [...memoryItems(), item].slice(-500));
  return item;
}
function forgetMemory(id) {
  const before = memoryItems();
  const after = before.filter(item => item.id !== id);
  saveJson(MEMORY_FILE, after);
  return before.length !== after.length;
}
function clearMemories() { saveJson(MEMORY_FILE, []); }
function relevantMemories(message) {
  const terms = String(message || '').toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 2);
  return memoryItems().filter(item => terms.some(term => item.text.toLowerCase().includes(term))).slice(-20);
}
function explicitMemoryAction(content) {
  const remember = content.match(/^remember(?: that)?\s+(.+)$/i);
  if (remember) return { type: 'remember', text: remember[1].trim() };
  if (/^what do you remember about me\??$/i.test(content)) return { type: 'list' };
  if (/^forget everything you remember about me\.?$/i.test(content)) return { type: 'clear' };
  const forget = content.match(/^forget(?: that)?\s+(.+)$/i);
  if (forget) return { type: 'forget', text: forget[1].trim() };
  return null;
}
function automaticMemory(content) {
  if (SECRET_PATTERN.test(content) || /\b(don't|do not)\s+(remember|save|store)\b/i.test(content)) return null;
  const match = content.match(/^(?:my name is|call me|my favorite (?:game|movie|show|food|music|book) is|i (?:like|love|enjoy)|i am working on|i'm working on)\s+(.+)$/i);
  return match ? { proposed: content, requiresConfirmation: true } : null;
}
function conversationHistory(conversationId) {
  return loadJson(HISTORY_FILE, []).filter(item => item.conversationId === conversationId).slice(-20);
}
async function chat(message, conversationId = 'default') {
  const content = String(message || '').trim();
  const id = String(conversationId || 'default').trim().slice(0, 120) || 'default';
  if (!content || content.length > 8000) throw new Error('A chat message between 1 and 8000 characters is required.');
  const action = explicitMemoryAction(content);
  if (action?.type === 'remember') {
    const item = saveMemory(action.text, 'explicit');
    return { reply: item ? `I'll remember that: ${item.text}` : 'I cannot save that because it looks sensitive or invalid.', conversationId: id, model: BOB_MODEL };
  }
  if (action?.type === 'list') {
    const items = memoryItems();
    return { reply: items.length ? `I remember:\n${items.map(item => `- ${item.text}`).join('\n')}` : 'I do not have any saved memories about you yet.', conversationId: id, model: BOB_MODEL };
  }
  if (action?.type === 'clear') {
    clearMemories();
    return { reply: 'I forgot everything saved in Bob memory.', conversationId: id, model: BOB_MODEL };
  }
  if (action?.type === 'forget') {
    const target = action.text.toLowerCase();
    const matches = memoryItems().filter(item => item.text.toLowerCase().includes(target) || target.includes(item.text.toLowerCase()));
    matches.forEach(item => forgetMemory(item.id));
    return { reply: matches.length ? `I forgot ${matches.map(item => item.text).join('; ')}.` : 'I could not find that saved memory.', conversationId: id, model: BOB_MODEL };
  }
  const memories = relevantMemories(content);
  const memoryContext = memories.length ? `\nRelevant Bob memories (use only when helpful):\n${memories.map(item => `- ${item.text}`).join('\n')}` : '';
  const messages = [{ role: 'system', content: BOB_PERSONALITY + memoryContext }, ...conversationHistory(id).map(item => ({ role: item.role === 'bob' ? 'assistant' : item.role, content: item.content })), { role: 'user', content }];
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: BOB_MODEL, messages, stream: false }), signal: AbortSignal.timeout(120000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Bob chat model is unavailable.');
  const reply = String(body.message?.content || '').trim();
  if (!reply) throw new Error('Bob returned an empty response.');
  const now = new Date().toISOString();
  const all = loadJson(HISTORY_FILE, []);
  all.push({ role: 'user', content, conversationId: id, timestamp: now });
  all.push({ role: 'bob', content: reply, conversationId: id, timestamp: new Date().toISOString() });
  saveJson(HISTORY_FILE, all.slice(-400));
  automaticMemory(content);
  recordActivity('chat', 'Conversation message completed.', { conversationId: id });
  return { reply, conversationId: id, model: BOB_MODEL };
}
function loadJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch (_error) { return fallback; } }
function saveJson(file, value) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function recordActivity(kind, message, extra = {}) {
  const items = loadJson(ACTIVITY_FILE, []);
  items.push({ timestamp: new Date().toISOString(), kind, message, ...extra });
  saveJson(ACTIVITY_FILE, items.slice(-200));
}

function status() {
  return {
    ok: state.status === 'LIVE',
    name: 'Bob',
    status: state.status,
    startedAt: state.startedAt,
    error: state.error,
    personality: BOB_PERSONALITY,
    model: BOB_MODEL,
    currentTask: currentTask ? { id: currentTask.id, type: currentTask.type, status: currentTask.status, startedAt: currentTask.startedAt } : null
  };
}

function chromePath() {
  const candidates = [
    process.env.BOB_CHROME_PATH,
    path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'chrome.exe'
  ].filter(Boolean);
  const installed = candidates.find(candidate => fs.existsSync(candidate));
  if (installed) return installed;
  try { return execFileSync('where.exe', ['chrome.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0] || null; }
  catch (_error) { return null; }
}

function waitForPort(port, timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error('Bob browser did not start.'));
        else setTimeout(probe, 100);
      });
    };
    probe();
  });
}

function ensurePortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`Bob CDP port ${port} is already in use.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function cdpJson(endpoint) {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}${endpoint}`);
  if (!response.ok) throw new Error(`Bob browser endpoint returned HTTP ${response.status}.`);
  return response.json();
}

function cdpCall(method, params = {}, sessionId = state.sessionId) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Bob browser is not connected.'));
  const id = state.nextId++;
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject });
    state.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

function closeSocket() {
  for (const pending of state.pending.values()) pending.reject(new Error('Bob browser stopped.'));
  state.pending.clear();
  if (state.socket) state.socket.close();
  state.socket = null;
  state.sessionId = null;
  state.targetId = null;
}

async function startBob() {
  if (state.status === 'LIVE' || state.status === 'STARTING') return status();
  const executable = chromePath();
  if (!executable) throw new Error('Chrome was not found. Set BOB_CHROME_PATH to a Chromium executable.');
  await ensurePortFree(CDP_PORT);
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  state.status = 'STARTING';
  state.error = null;
  const child = spawn(executable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-allow-origins=*',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE_DIR}`,
    '--window-size=1280,800', START_URL
  ], { windowsHide: true, stdio: 'ignore' });
  state.process = child;
  child.once('error', error => {
    if (state.process === child) state.error = error.code === 'ENOENT' ? 'Bob browser executable could not be started.' : error.message;
  });
  child.once('exit', () => {
    if (state.process === child) {
      closeSocket();
      state.process = null;
      state.status = 'STOPPED';
      state.startedAt = null;
    }
  });
  try {
    await waitForPort(CDP_PORT);
    const version = await cdpJson('/json/version');
    state.socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      state.socket.once('open', resolve);
      state.socket.once('error', reject);
      state.socket.on('message', data => {
        const message = JSON.parse(String(data));
        if (message.id && state.pending.has(message.id)) {
          const pending = state.pending.get(message.id);
          state.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }
      });
    });
    const target = await cdpCall('Target.createTarget', { url: START_URL }, null);
    state.targetId = target.targetId;
    const attached = await cdpCall('Target.attachToTarget', { targetId: state.targetId, flatten: true }, null);
    state.sessionId = attached.sessionId;
    await cdpCall('Page.enable');
    await cdpCall('Runtime.enable');
    state.status = 'LIVE';
    state.startedAt = new Date().toISOString();
    return status();
  } catch (error) {
    await stopBob();
    state.error = error.message;
    state.status = 'ERROR';
    throw error;
  }
}

async function stopBob() {
  closeSocket();
  if (state.process && state.process.pid) {
    state.process.kill();
    state.process = null;
  }
  state.status = 'STOPPED';
  state.startedAt = null;
  return status();
}

async function ensureBob() {
  if (state.status !== 'LIVE') await startBob();
}

app.post('/api/start', async (_req, res) => {
  try { res.json(await startBob()); } catch (error) { res.status(503).json({ ok: false, error: error.message }); }
});
app.post('/api/stop', async (_req, res) => res.json(await stopBob()));
app.post('/api/reconnect', async (_req, res) => {
  try { await stopBob(); res.json(await startBob()); } catch (error) { res.status(503).json({ ok: false, error: error.message }); }
});
app.get('/api/screenshot', async (_req, res) => {
  try {
    await ensureBob();
    const result = await cdpCall('Page.captureScreenshot', { format: 'png' });
    res.type('png').send(Buffer.from(result.data, 'base64'));
  } catch (error) { res.status(503).json({ ok: false, error: error.message }); }
});
app.post('/api/navigate', async (req, res) => {
  try {
    const url = String(req.body && req.body.url || '');
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Only http(s) navigation is allowed.' });
    await ensureBob();
    await cdpCall('Page.navigate', { url });
    res.json({ ok: true });
  } catch (error) { res.status(503).json({ ok: false, error: error.message }); }
});
app.post('/api/input', async (req, res) => {
  try {
    await ensureBob();
    const body = req.body || {};
    if (body.type === 'text') await cdpCall('Input.insertText', { text: String(body.text || '') });
    else if (body.type === 'key') await cdpCall('Input.dispatchKeyEvent', { type: body.eventType || 'keyDown', key: String(body.key || ''), code: String(body.code || ''), text: body.text ? String(body.text) : undefined });
    else if (body.type === 'mouse') await cdpCall('Input.dispatchMouseEvent', { type: body.eventType || 'mousePressed', x: Number(body.x), y: Number(body.y), button: body.button || 'left', clickCount: Number(body.clickCount || 1), deltaX: Number(body.deltaX || 0), deltaY: Number(body.deltaY || 0) });
    else return res.status(400).json({ ok: false, error: 'Unsupported Bob input.' });
    res.json({ ok: true });
  } catch (error) { res.status(503).json({ ok: false, error: error.message }); }
});
app.get('/api/activity', (_req, res) => res.json({ ok: true, items: loadJson(ACTIVITY_FILE, []).slice(-100).reverse() }));
app.get('/api/history', (_req, res) => res.json({ ok: true, items: loadJson(HISTORY_FILE, []).slice(-100) }));
app.post('/api/chat', async (req, res) => {
  try { res.json({ ok: true, ...(await chat(req.body?.message, req.body?.conversationId)) }); }
  catch (error) { res.status(502).json({ ok: false, error: error.message }); }
});
app.get('/api/chat/history', (req, res) => {
  const conversationId = String(req.query.conversationId || '').trim().slice(0, 120);
  if (!conversationId) return res.status(400).json({ ok: false, error: 'conversationId is required.' });
  res.json({ ok: true, items: conversationHistory(conversationId) });
});
app.get('/api/memories', (_req, res) => res.json({ ok: true, memories: memoryItems().map(item => ({ ...item })) }));
app.delete('/api/memories/:id', (req, res) => res.json({ ok: true, deleted: forgetMemory(String(req.params.id || '')) }));
app.delete('/api/memories', (_req, res) => { clearMemories(); res.json({ ok: true }); });
app.post('/api/tasks', async (req, res) => {
  if (currentTask && ['QUEUED', 'RUNNING'].includes(currentTask.status)) return res.status(409).json({ ok: false, error: 'Bob is already busy.' });
  const instruction = String(req.body?.instruction || '').trim();
  if (!instruction || instruction.length > 4000) return res.status(400).json({ ok: false, error: 'A web task instruction is required.' });
  const task = { id: String(req.body?.taskId || `bob-${Date.now()}`), type: 'web_research', instruction, status: 'RUNNING', startedAt: new Date().toISOString() };
  currentTask = task;
  const history = loadJson(HISTORY_FILE, []);
  history.push({ role: 'user', content: instruction, timestamp: task.startedAt });
  saveJson(HISTORY_FILE, history.slice(-200));
  recordActivity('task', 'Web research started.', { taskId: task.id });
  try {
    await ensureBob();
    const response = await fetch(instruction.match(/^https?:\/\//i) ? instruction : `https://www.google.com/search?q=${encodeURIComponent(instruction)}`, { signal: AbortSignal.timeout(15000) });
    const html = await response.text();
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
    task.status = response.ok ? 'COMPLETED' : 'FAILED';
    task.result = { url: response.url, status: response.status, text };
    history.push({ role: 'bob', content: text.slice(0, 4000), timestamp: new Date().toISOString() });
    saveJson(HISTORY_FILE, history.slice(-200));
    recordActivity('task', response.ok ? 'Web research completed.' : 'Web research returned an error.', { taskId: task.id, status: task.status });
    res.status(response.ok ? 200 : 502).json({ ok: response.ok, task });
  } catch (error) {
    task.status = 'FAILED'; task.error = 'Web research failed.';
    recordActivity('task', 'Web research failed.', { taskId: task.id });
    res.status(502).json({ ok: false, task });
  } finally { currentTask = null; }
});
app.post('/api/tasks/cancel', (_req, res) => {
  if (!currentTask) return res.json({ ok: true, cancelled: false });
  currentTask.status = 'CANCELLED'; recordActivity('task', 'Web research cancelled.', { taskId: currentTask.id }); currentTask = null;
  res.json({ ok: true, cancelled: true });
});

const server = http.createServer(app);
if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    state.status = 'CHAT_READY';
    console.log(`Bob listening on http://${HOST}:${PORT}`);
  });
}

module.exports = { app, server, startBob, stopBob, status, chat, chromePath, PROFILE_DIR, MEMORY_FILE, memoryItems, saveMemory, forgetMemory, clearMemories, relevantMemories };
