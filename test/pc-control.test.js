const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ella-pc-control-'));
process.env.ELLA_WATCH_TOKEN = 'test-token';
const { app, server, validatePcAction, inferPcAction, redactPc, executePcAction, prepareForFortnite, setGamingPrepRunners } = require('../server.js');

test.before(async () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)));
test.after(() => server.close());

test('PC API requires authentication for actions and reports real status to local dashboard reads', async () => {
  const port = server.address().port;
  const denied = await fetch(`http://127.0.0.1:${port}/api/pc/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_status' }) });
  assert.equal(denied.status, 401);
  const status = await fetch(`http://127.0.0.1:${port}/api/pc/status`);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).ok, true);
});

test('PC action registry validates approved targets and blocks arbitrary commands', () => {
  assert.deepEqual(validatePcAction({ action: 'launch_application', target: 'Discord' }).action, 'launch_application');
  assert.throws(() => validatePcAction({ action: 'shell', target: 'whoami' }), /unsupported PC action/);
  assert.throws(() => validatePcAction({ action: 'launch_application', target: 'PowerShell' }), /application is not approved/);
  assert.throws(() => validatePcAction({ action: 'restart_service', target: 'UnknownService' }), /service is not approved/);
});

test('natural language maps only to structured PC actions', () => {
  assert.deepEqual(inferPcAction('Open Discord.'), { action: 'launch_application', target: 'discord' });
  assert.deepEqual(inferPcAction('How much RAM am I using?'), { action: 'get_status' });
  assert.deepEqual(inferPcAction('Restart the Windows Update service.'), { action: 'restart_service', target: 'wuauserv' });
  assert.deepEqual(inferPcAction('Hey Ella, prepare for Fortnite.'), { action: 'prepare_for_fortnite' });
  assert.deepEqual(inferPcAction('get ready for fortnite'), { action: 'prepare_for_fortnite' });
  assert.equal(inferPcAction('run arbitrary shell command'), null);
});

test('Fortnite preparation is safe, reports unavailable probes, and never launches browser or Discord', async () => {
  const launched = [];
  setGamingPrepRunners(async () => ({
    processes: [],
    audio: [],
    adapters: [],
    temperature: null,
    cpuPercent: 12,
    status: { memory: { usedPercent: 35 } }
  }), executable => launched.push(executable));
  const result = await prepareForFortnite();
  setGamingPrepRunners(null, null);
  assert.equal(result.state, 'DEGRADED');
  assert.equal(launched.length, 0);
  assert.ok(result.steps.some(step => step.name === 'temperature' && step.state === 'UNAVAILABLE'));
  assert.ok(result.steps.some(step => step.name === 'audio_microphone' && step.state === 'UNAVAILABLE'));
});

test('Fortnite preparation does not relaunch an existing Fortnite process', async () => {
  const launched = [];
  setGamingPrepRunners(async () => ({
    processes: [{ Name: 'FortniteClient-Win64-Shipping.exe', ProcessId: 1234 }],
    audio: [{ Name: 'Speakers' }],
    adapters: [{ Name: 'Ethernet' }],
    temperature: [{ CurrentTemperature: 3000 }],
    cpuPercent: 20,
    status: { memory: { usedPercent: 40 } }
  }), executable => launched.push(executable));
  const result = await prepareForFortnite();
  setGamingPrepRunners(null, null);
  assert.equal(result.state, 'READY');
  assert.equal(launched.length, 0);
  assert.match(result.steps.find(step => step.name === 'fortnite').message, /already running/);
});

test('destructive operations require confirmation and audit data is redacted', async () => {
  const pending = await executePcAction({ action: 'restart_windows' });
  assert.equal(pending.status, 'PENDING_CONFIRMATION');
  const safe = redactPc({ token: 'secret', nested: { password: 'hidden' }, message: 'normal' });
  assert.deepEqual(safe, { token: '[REDACTED]', nested: { password: '[REDACTED]' }, message: 'normal' });
});

test('filesystem safety rejects traversal and critical Windows paths', () => {
  assert.throws(() => validatePcAction({ action: 'delete_file', target: path.join(os.homedir(), 'Documents', '..', 'Windows') }), /outside approved|protected/);
  assert.throws(() => validatePcAction({ action: 'copy_file', source: 'C:\\Windows\\win.ini', destination: path.join(os.homedir(), 'Desktop', 'copy.ini') }), /outside approved|protected/);
});
