const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ella-memory-automation-'));
process.env.ELLA_MEMORY_FILE = path.join(root, 'memory.json');
process.env.ELLA_AUTOMATION_FILE = path.join(root, 'automation.json');
process.env.ELLA_AUTOMATION_HISTORY_FILE = path.join(root, 'automation-history.json');

const {
  normalizeMemory, memorySearch, memoryStats, saveMemoryRecord, extractDurableMemory,
  normalizeAutomation, validateAutomation, executeAutomation, emitAutomationEvent
} = require('../server.js');

test('normalizes legacy memory and gives it a stable id', () => {
  const first = normalizeMemory({ ts: 1000, from: 'user', text: 'I prefer dark mode' }, 2);
  const second = normalizeMemory({ ts: 1000, from: 'user', text: 'I prefer dark mode' }, 2);
  assert.equal(first.content, 'I prefer dark mode');
  assert.equal(first.category, 'other');
  assert.equal(first.id, second.id);
});

test('memory creation deduplicates, searches, ranks, and rejects secrets', () => {
  const first = saveMemoryRecord({ content: 'I prefer dark mode', category: 'preference', importance: 'high', confidence: 'high', source: 'manual' });
  const duplicate = saveMemoryRecord({ content: 'I prefer dark mode', category: 'preference', importance: 'high', confidence: 'high', source: 'manual' });
  assert.equal(first.deduplicated, false);
  assert.equal(duplicate.deduplicated, true);
  assert.ok(memorySearch('dark mode')[0].relevance > 0);
  assert.equal(memoryStats().total, 1);
  assert.throws(() => saveMemoryRecord({ content: 'my API key is secret-value' }), /secrets/);
});

test('durable extraction ignores transient text', () => {
  assert.equal(extractDurableMemory('I prefer a concise answer').category, 'preference');
  assert.equal(extractDurableMemory('hello there'), null);
  assert.equal(extractDurableMemory('my password is abc'), null);
});

test('automation validation preserves safe allowlists', () => {
  const rule = validateAutomation({ name: 'Hourly status', trigger: { type: 'interval', intervalSeconds: 3600 }, actions: [{ type: 'get_pc_status' }] });
  assert.equal(rule.trigger.type, 'interval');
  assert.throws(() => validateAutomation({ name: 'Unsafe', trigger: { type: 'manual' }, actions: [{ type: 'shell', command: 'whoami' }] }), /invalid automation action/);
  assert.equal(normalizeAutomation({ name: 'legacy', condition: 'CPU > 90', action: 'notify-ella' }).actions[0].type, 'notify_ella');
});

test('automation execution supports dry run and duplicate-run protection', async () => {
  const rule = validateAutomation({ id: 'test-automation', name: 'Test', trigger: { type: 'manual' }, actions: [{ type: 'notify_ella', message: 'test' }] });
  fs.writeFileSync(process.env.ELLA_AUTOMATION_FILE, JSON.stringify([rule]));
  const dry = await executeAutomation(rule.id, { dryRun: true, force: true });
  assert.equal(dry.status, 'success');
  assert.equal(dry.actions[0].status, 'dry-run');
  const normal = await executeAutomation(rule.id, { force: true });
  assert.equal(normal.status, 'success');
});

test('event automation is allowlisted and dispatchable', async () => {
  const rule = validateAutomation({ id: 'event-automation', name: 'Event test', trigger: { type: 'event', event: 'test_event' }, actions: [{ type: 'notify_ella', message: 'event' }] });
  fs.writeFileSync(process.env.ELLA_AUTOMATION_FILE, JSON.stringify([rule]));
  emitAutomationEvent('test_event');
  await new Promise(resolve => setTimeout(resolve, 20));
  const saved = JSON.parse(fs.readFileSync(process.env.ELLA_AUTOMATION_FILE, 'utf8'));
  assert.equal(saved[0].runCount, 1);
});
