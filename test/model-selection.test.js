const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server.js');

test.before(async () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)));
test.after(() => server.close());

test('Ollama model selector uses exact installed model identifiers', async () => {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/ollama/models`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.models.includes('qwen2.5:14b'));
  assert.ok(body.models.includes('llama3:8b'));
});

test('switching to an installed model does not require an Ella restart', async () => {
  const port = server.address().port;
  const models = await (await fetch(`http://127.0.0.1:${port}/api/ollama/models`)).json();
  const selected = models.models[0];
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/model`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selected }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.model, selected);
  assert.equal(body.restartRequired, undefined);
});

test('uninstalled model is rejected without changing the active model', async () => {
  const port = server.address().port;
  const overviewBefore = await (await fetch(`http://127.0.0.1:${port}/api/admin/overview`)).json();
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/model`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'not-installed-model:latest' }) });
  assert.equal(response.status, 400);
  const overviewAfter = await (await fetch(`http://127.0.0.1:${port}/api/admin/overview`)).json();
  assert.equal(overviewAfter.data.ollama.activeModel, overviewBefore.data.ollama.activeModel);
});
