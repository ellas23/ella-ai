const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.BOB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ella-bob-memory-test-'));
const { app, server, status, chat, MEMORY_FILE, saveMemory, memoryItems, clearMemories, relevantMemories } = require('../bob.js');

let webCookie = '';
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  webCookie = response.headers.get('set-cookie').split(';')[0];
});
test.after(() => server.close());

test('Bob status is independent and does not expose credentials', async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/status`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.name, 'Bob');
  assert.equal(JSON.stringify(body).includes('token'), false);
  assert.match(body.personality, /gay|queer/i);
  assert.equal(status().name, 'Bob');
});

test('Bob exposes separate voice configuration without Ella voice data', async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public/config`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.tts.enabled, true);
  assert.equal(JSON.stringify(body).includes('Ella'), false);
});

test('Bob rejects unsafe navigation schemes', async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/navigate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'file:///secret' })
  });

  assert.equal(response.status, 400);
});

test('Bob exposes a normal conversational chat contract', async () => {
  await assert.rejects(() => chat('', 'default'), /chat message/i);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: webCookie }, body: JSON.stringify({ message: '' })
  });

  test('Bob memory is persistent, relevant, and isolated', async () => {
    clearMemories();
    const saved = saveMemory('My favorite game is Minecraft.', 'explicit');
    assert.ok(saved?.id);
    assert.match(MEMORY_FILE, /bob-memory\.json$/);
    assert.equal(memoryItems().length, 1);
    assert.equal(relevantMemories('What is my favorite game?')[0].id, saved.id);
    assert.equal(JSON.stringify(memoryItems()).includes('conversations.json'), false);
    clearMemories();
    assert.deepEqual(memoryItems(), []);
  });

  test('Bob memory rejects secrets and supports deletion through protected storage', async () => {
    clearMemories();
    assert.equal(saveMemory('My API key is secret-value'), null);
    const saved = saveMemory('I like blue.');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/memories/${saved.id}`, { method: 'DELETE', headers: { Cookie: webCookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(memoryItems(), []);
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.ok, false);
});
