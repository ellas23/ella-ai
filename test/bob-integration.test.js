const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ella-bob-integration-'));
process.env.ELLA_WATCH_TOKEN = 'bob-integration-token';
process.env.ELLA_BOB_DATA_DIR = path.join(root, 'bob-data');
process.env.ELLA_VAULT_FILE = path.join(root, 'vault.dpapi.json');
const { server } = require('../server.js');

test.before(async () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)));
test.after(() => server.close());

test('Bob status is authenticated and exposes only limited metadata', async () => {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/bob/status`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.name, 'Bob');
  assert.deepEqual(Object.keys(body.data.permissions).sort(), ['browser_control', 'web_navigate', 'web_read', 'web_search']);
  assert.equal(JSON.stringify(body).includes('ELLA_WATCH_TOKEN'), false);
  assert.equal(JSON.stringify(body).includes('bob-integration-token'), false);
});

test('Bob activity/history are separate from Ella memory paths', async () => {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/bob/history`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.items, []);
  assert.equal(JSON.stringify(body).includes('conversations.json'), false);
});

test('vault metadata never returns protected credential values', async () => {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/vault`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.credentials, []);
  assert.equal(JSON.stringify(body).includes('protectedValue'), false);
});
