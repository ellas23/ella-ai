const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ELLA_WATCH_TOKEN = 'temporary-watch-test-token';
process.env.ELLA_ADMIN_PASSWORD = 'temporary-admin-test-password';
process.env.ELLA_WATCH_DRY_RUN = '1';
process.env.ELLA_WATCH_COMMANDS_FILE = require('path').join(require('os').tmpdir(), `ella-watch-test-${process.pid}.json`);

const { server, WATCH_COMMANDS, WATCH_OS_ACTIONS } = require('../server.js');

let baseUrl;
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  delete process.env.ELLA_WATCH_TOKEN;
  delete process.env.ELLA_ADMIN_PASSWORD;
  delete process.env.ELLA_WATCH_DRY_RUN;
  delete process.env.ELLA_WATCH_COMMANDS_FILE;
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() };
}
function command(commandName, requestId = `watch-test-${commandName}-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  const payload = { command: commandName, source: 'iphone_shortcut' };
  if (requestId !== null) payload.requestId = requestId;
  return request('/api/watch/command', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ELLA_WATCH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

test('reports non-secret configuration and the complete allowlist', async () => {
  const { response, body } = await request('/api/watch/status');
  assert.equal(response.status, 200);
  assert.equal(body.data.authentication, 'CONFIGURED');
  assert.deepEqual(body.data.supportedCommands, WATCH_COMMANDS);
  assert.doesNotMatch(JSON.stringify(body), /temporary-watch-test-token/);
});

test('Watch endpoints stay separate from Ella admin-session authentication', async () => {
  const status = await request('/api/watch/status');
  assert.equal(status.response.status, 200);
  const missingWatchToken = await request('/api/watch/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'get_ella_status', source: 'iphone_shortcut' })
  });
  assert.equal(missingWatchToken.response.status, 401);
  const adminPasswordAsWatchToken = await request('/api/watch/command', {
    method: 'POST',
    headers: { Authorization: 'Bearer temporary-admin-test-password', 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'get_ella_status', source: 'iphone_shortcut' })
  });
  assert.equal(adminPasswordAsWatchToken.response.status, 401);
});

test('rejects missing and invalid authentication without leaking the token', async () => {
  const missing = await request('/api/watch/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'get_pc_status', requestId: 'missing-auth', source: 'iphone_shortcut' }) });
  assert.equal(missing.response.status, 401);
  const invalid = await request('/api/watch/command', { method: 'POST', headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'get_pc_status', requestId: 'invalid-auth', source: 'iphone_shortcut' }) });
  assert.equal(invalid.response.status, 401);
  assert.doesNotMatch(JSON.stringify({ missing, invalid }), /temporary-watch-test-token/);
});

test('accepts a supplied request ID and generates one when omitted', async () => {
  const supplied = await command('get_pc_status', 'watch-supplied-id');
  assert.equal(supplied.response.status, 200);
  assert.equal(supplied.body.requestId, 'watch-supplied-id');
  const generated = await command('get_pc_status', null);
  assert.equal(generated.response.status, 200);
  assert.match(generated.body.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(generated.body.status, 'SUCCESS');
});

test('accepts iphone_shortcut without requestId and returns a generated ID', async () => {
  const result = await command('get_ella_status', null);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'SUCCESS');
  assert.equal(result.body.command, 'get_ella_status');
  assert.match(result.body.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('accepts the Shortcut trailing-space source-key compatibility case', async () => {
  const response = await request('/api/watch/command', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ELLA_WATCH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'get_ella_status', 'source ': 'iphone_shortcut' })
  });
  assert.equal(response.response.status, 200);
  assert.equal(response.body.status, 'SUCCESS');
  assert.equal(response.body.command, 'get_ella_status');
  assert.match(response.body.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('rejects unknown commands and malformed JSON', async () => {
  const unknown = await command('not_supported');
  assert.equal(unknown.response.status, 400);
  const malformed = await fetch(`${baseUrl}/api/watch/command`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.ELLA_WATCH_TOKEN}`, 'Content-Type': 'application/json' }, body: '{"command":' });
  assert.ok([400, 500].includes(malformed.status));
  assert.doesNotMatch(await malformed.text(), /temporary-watch-test-token/);
});

test('executes every allowlisted command through safe routing in dry-run mode', async () => {
  for (const supported of WATCH_COMMANDS) {
    const result = await command(supported);
    assert.ok([200, 502].includes(result.response.status), `${supported}: ${result.response.status}`);
    if (WATCH_OS_ACTIONS[supported] || ['start_ella', 'stop_ella', 'restart_ella', 'get_pc_status', 'get_ella_status', 'get_research_status', 'cancel_research'].includes(supported)) {
      assert.equal(result.body.command, supported);
      assert.equal(result.body.requestId.length > 0, true);
    }
  }
  for (const action of Object.values(WATCH_OS_ACTIONS)) assert.ok(action.executable && Array.isArray(action.args));
});

test('does not execute a duplicate supplied request ID twice', async () => {
  const requestId = 'watch-replay-test';
  const first = await command('get_pc_status', requestId);
  const second = await command('get_pc_status', requestId);
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.replayed, true);
});

test('does not write the token to Watch logs', async () => {
  const logs = await request('/api/admin/logs?limit=100');
  assert.doesNotMatch(JSON.stringify(logs.body), /temporary-watch-test-token/);
});
