const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ella-devices-'));
process.env.ELLA_WATCH_TOKEN = 'device-test-token';
process.env.ELLA_DEVICES_FILE = path.join(root, 'devices.json');
process.env.ELLA_REMOTE_AUDIT_FILE = path.join(root, 'remote-audit.json');
process.env.ELLA_SSH_CREDENTIALS_FILE = path.join(root, 'ssh-credentials.dpapi.json');
process.env.ELLA_WEBCODEPHONE_TOKEN_FILE = path.join(root, 'webcodephone-token');
fs.writeFileSync(process.env.ELLA_WEBCODEPHONE_TOKEN_FILE, 'webcodephone-test-token');
const { server, normalizeDevice, executeDeviceAction, inferDeviceAction, setSshRunnerForTests, setSshPasswordRunnerForTests, validateDeviceAction, saveSshPassword, hasSshPassword, removeSshPassword } = require('../server.js');

test.before(async () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)));
test.after(() => server.close());

test('device registration validates metadata and rejects injection', { concurrency: false }, () => {
  const device = normalizeDevice({ id: 'raspberry-pi', name: 'Raspberry Pi', host: '192.168.1.147', username: 'ben', platform: 'linux', capabilities: ['system_status', 'disk_status'] });
  assert.equal(device.id, 'raspberry-pi');
  assert.throws(() => normalizeDevice({ id: 'bad', name: 'Bad', host: '192.168.1.1;whoami', username: 'ben', capabilities: [] }), /invalid registered host/);
  assert.throws(() => validateDeviceAction('restart_service', { service: 'ella-worker; rm -rf /' }), /invalid service name/);
});

test('mocked SSH executes only enabled capabilities and records structured results', { concurrency: false }, async () => {
  fs.writeFileSync(process.env.ELLA_DEVICES_FILE, JSON.stringify([normalizeDevice({ id: 'raspberry-pi', name: 'Raspberry Pi', host: '192.168.1.147', username: 'ben', capabilities: ['system_status', 'disk_status'] })]));
  setSshRunnerForTests(async (_device, args, command) => ({ stdout: `mocked:${command}`, stderr: '', args }));
  const result = await executeDeviceAction({ requestId: 'test-request', deviceId: 'raspberry-pi', action: 'disk_status' });
  assert.equal(result.status, 'SUCCESS');
  assert.match(result.result.stdout, /df -P/);
  await assert.rejects(() => executeDeviceAction({ requestId: 'test-request-2', deviceId: 'raspberry-pi', action: 'process_list' }), /capability is not enabled/);
  assert.deepEqual(inferDeviceAction("How much storage does the Pi have?"), { deviceId: 'raspberry-pi', action: 'disk_status' });
});

test('device API requires authentication and exposes no credentials', { concurrency: false }, async () => {
  const port = server.address().port;
  const denied = await fetch(`http://127.0.0.1:${port}/api/devices/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: JSON.stringify({ deviceId: 'raspberry-pi', action: 'status' }) });
  assert.equal(denied.status, 401);
  const response = await fetch(`http://127.0.0.1:${port}/api/devices`, { headers: { Authorization: 'Bearer device-test-token' } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(body).includes('private'), false);
  assert.equal(JSON.stringify(body).includes('"password":'), false);
});

test('Mac screen viewer requires registration and capability, without exposing credentials', { concurrency: false }, async () => {
  const viewer = http.createServer((req, res) => {
    if (req.url === '/api/screenshot') {
      assert.equal(req.headers['x-access-token'], 'webcodephone-test-token');
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from('png-test'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('webcodephone');
  });
  await new Promise(resolve => viewer.listen(0, '127.0.0.1', resolve));
  const viewerPort = viewer.address().port;
  const mac = normalizeDevice({
    id: 'my-mac', name: 'My Mac', host: '127.0.0.1', username: 'ben', platform: 'macos',
    capabilities: ['mac_screen_view'], screenViewerUrl: `http://127.0.0.1:${viewerPort}`
  });

  fs.writeFileSync(process.env.ELLA_DEVICES_FILE, JSON.stringify([mac]));
  assert.deepEqual(inferDeviceAction('show me my Mac'), { deviceId: 'my-mac', action: 'mac_screen_view' });
  const result = await executeDeviceAction({ deviceId: 'my-mac', action: 'mac_screen_view', requestId: 'screen-test' });
  assert.equal(result.status, 'ONLINE');
  assert.equal(result.embedded, false);
  assert.equal(result.authRequired, true);
  assert.equal(result.viewerUrl.includes('/mac-screen-viewer.html?'), true);
  assert.equal(result.phoneViewerUrl, `http://127.0.0.1:${viewerPort}`);
  assert.equal(JSON.stringify(result).includes('webcodephone-test-token'), false);
  const port = server.address().port;
  const denied = await fetch(`http://127.0.0.1:${port}/api/devices/my-mac/screen`);
  assert.equal(denied.status, 200);
  const response = await fetch(`http://127.0.0.1:${port}/api/devices/my-mac/screen`, { headers: { Authorization: 'Bearer device-test-token' } });
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes('password'), false);
  await new Promise(resolve => viewer.close(resolve));
});

test('Mac screen proxy serves authenticated upstream frames without Watch authentication', { concurrency: false }, async () => {
  const viewer = http.createServer((req, res) => {
    assert.equal(req.headers['x-access-token'], 'webcodephone-test-token');
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from('png-test'));
  });
  await new Promise(resolve => viewer.listen(0, '127.0.0.1', resolve));
  const viewerPort = viewer.address().port;
  const mac = normalizeDevice({ id: 'proxy-mac', name: 'Proxy Mac', host: '127.0.0.1', username: 'ben', platform: 'macos', capabilities: ['mac_screen_view'], screenViewerUrl: `http://127.0.0.1:${viewerPort}` });
  fs.writeFileSync(process.env.ELLA_DEVICES_FILE, JSON.stringify([mac]));
  const port = server.address().port;
  const previousWatchToken = process.env.ELLA_WATCH_TOKEN;
  delete process.env.ELLA_WATCH_TOKEN;
  const response = await fetch(`http://127.0.0.1:${port}/api/devices/proxy-mac/screen/proxy/screenshot`);
  process.env.ELLA_WATCH_TOKEN = previousWatchToken;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal((await response.text()).includes('webcodephone-test-token'), false);
  await new Promise(resolve => viewer.close(resolve));
});

test('Mac screen reports an unavailable protected service without leaking auth details', { concurrency: false }, async () => {
  const mac = normalizeDevice({ id: 'offline-mac', name: 'Offline Mac', host: '127.0.0.1', username: 'ben', platform: 'macos', capabilities: ['mac_screen_view'], screenViewerUrl: 'http://127.0.0.1:9' });
  fs.writeFileSync(process.env.ELLA_DEVICES_FILE, JSON.stringify([mac]));
  const result = await executeDeviceAction({ deviceId: mac.id, action: 'mac_screen_view', requestId: 'offline-screen-test' });
  assert.equal(result.status, 'OFFLINE');
  assert.match(result.message, /unavailable/i);
  assert.equal(JSON.stringify(result).includes('webcodephone-test-token'), false);
});

test('SSH password uses protected storage and never appears in device or audit data', { concurrency: false }, async () => {
  const secret = 'test-only-password-that-must-not-leak';
  const device = normalizeDevice({ id: 'password-device', name: 'Password Device', host: '192.0.2.10', username: 'tester', capabilities: ['system_status'] });
  fs.writeFileSync(process.env.ELLA_DEVICES_FILE, JSON.stringify([device]));
  await saveSshPassword(device.id, secret);
  assert.equal(hasSshPassword(device.id), true);
  assert.equal(fs.readFileSync(process.env.ELLA_SSH_CREDENTIALS_FILE, 'utf8').includes(secret), false);
  setSshRunnerForTests(async () => { throw new Error('key unavailable'); });
  setSshPasswordRunnerForTests(async (_device, _command, password) => {
    assert.equal(password, secret);
    return { stdout: 'password-auth-ok', stderr: '' };
  });
  const result = await executeDeviceAction({ deviceId: device.id, action: 'status', requestId: 'password-test' });
  assert.equal(result.status, 'SUCCESS');
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/devices`);
  const body = await response.text();
  assert.equal(body.includes(secret), false);
  assert.equal(body.includes('"passwordConfigured":true'), true);
  const audit = fs.readFileSync(process.env.ELLA_REMOTE_AUDIT_FILE, 'utf8');
  assert.equal(audit.includes(secret), false);
  removeSshPassword(device.id);
  assert.equal(hasSshPassword(device.id), false);
  setSshPasswordRunnerForTests(null);
});
