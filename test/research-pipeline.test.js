const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractResearchHtmlText,
  researchDeterministicClaims,
  researchValidateClaims,
  parseResearchJson,
  mergeResearchClaim,
  researchRecoveryRoutes,
  researchCandidateUrl,
  researchRouteUrls,
  classifyResearchFailure,
  researchRetryableFailure,
  researchBackoffMs,
  normalizeResearchProfile,
  researchSourceAdapter,
  researchSuccessRate
  ,searchResearchKnowledge, knowledgeAnswer, researchKnowledgeFreshness, normalizeResearchKnowledgeItem
} = require('../server.js');

test('extracts readable text from normal HTML and removes non-content elements', () => {
  const text = extractResearchHtmlText('<html><head><title>Example</title><script>alert(1)</script></head><body><h1>Facts</h1><p>The documented system stores records in a local database.</p><nav>Menu</nav></body></html>');
  assert.match(text, /Facts/);
  assert.match(text, /stores records in a local database/);
  assert.doesNotMatch(text, /alert|Menu/);
});

test('extracts grounded claims from GitHub and documentation HTML', () => {
  const html = '<article><h1>Repository guide</h1><p>The client retries failed requests with exponential backoff.</p><p>The API accepts JSON payloads over HTTPS.</p></article>';
  const claims = researchDeterministicClaims(html);
  assert.equal(claims.length, 2);
  assert.match(claims[0], /retries failed requests/);
});

test('rejects malformed optional LLM JSON without affecting deterministic fallback', () => {
  assert.equal(parseResearchJson('not json at all'), null);
  assert.deepEqual(parseResearchJson('```json\n{"summary":"ok",}\n```'), { summary: 'ok' });
  assert.equal(researchDeterministicClaims('<p>The source says the service is available on Windows systems.</p>').length, 1);
});

test('validates and deduplicates claims', () => {
  const source = 'The service is available on Windows systems and uses a local worker.';
  const claims = researchValidateClaims([
    'The service is available on Windows systems.',
    'The service is available on Windows systems.',
    'This unrelated claim is not grounded in the source.'
  ], source);
  assert.equal(claims.length, 1);
});

test('handles unsupported sources, zero-claim recovery, and genuinely empty failure', () => {
  assert.equal(researchCandidateUrl('file:///secret.txt'), false);
  assert.equal(researchCandidateUrl('javascript:alert(1)'), false);
  assert.ok(researchRecoveryRoutes('research reliable APIs', 1).length > 0);
  assert.deepEqual(researchDeterministicClaims(''), []);
  assert.deepEqual(researchDeterministicClaims('<html><body><script>no readable text</script></body></html>'), []);
});

test('centrally merges the same grounded claim from multiple workers', () => {
  const knowledge = [];
  const graph = [];
  const task = { taskId: 'task-test', query: 'service availability' };
  const first = { sourceId: 'src-a', content: 'The service is available on Windows systems and uses a local worker.' };
  const second = { sourceId: 'src-b', content: 'The service is available on Windows systems and uses a local worker.' };
  const confidence = { label: 'MEDIUM', score: 0.6 };
  const a = mergeResearchClaim(knowledge, graph, task, first, 'The service is available on Windows systems and uses a local worker.', confidence);
  const b = mergeResearchClaim(knowledge, graph, task, second, 'The service is available on Windows systems and uses a local worker.', confidence);
  assert.equal(a.merged, false);
  assert.equal(b.merged, true);
  assert.equal(knowledge.length, 1);
  assert.deepEqual(knowledge[0].sourceIds.sort(), ['src-a', 'src-b']);
  assert.equal(knowledge[0].supportCount, 2);
});

test('routes technical questions to relevant categories without forcing all categories', () => {
  const routes = researchRouteUrls('research Python API documentation and GitHub examples');
  const categories = new Set(routes.map(([, category]) => category));
  assert.ok(categories.has('GITHUB'));
  assert.ok(categories.has('OFFICIAL_DOCUMENTATION'));
  assert.ok(categories.has('CODING_SITES'));
  assert.ok(categories.has('YOUTUBE'));
  assert.ok(!categories.has('NEWS'));
});

test('classifies transient and permanent source failures for bounded retries', () => {
  assert.equal(classifyResearchFailure(new Error('request timeout')), 'TIMEOUT');
  assert.equal(classifyResearchFailure(new Error('captcha challenge')), 'CAPTCHA');
  assert.equal(classifyResearchFailure(new Error('HTTP Error 403: Forbidden')), 'HTTP_ERROR');
  assert.equal(researchRetryableFailure('TIMEOUT'), true);
  assert.equal(researchRetryableFailure('CAPTCHA'), false);
  assert.ok(researchBackoffMs(2) > researchBackoffMs(1));
});

test('resource profiles remain bounded and normalized', () => {
  assert.equal(normalizeResearchProfile('MAX_SAFE'), 'MAX_SAFE');
  assert.equal(normalizeResearchProfile('untrusted'), 'BALANCED');
});

test('adapts public GitHub, Wikipedia, and Stack Exchange responses into evidence text', () => {
  const github = researchSourceAdapter('https://api.github.com/search/repositories', JSON.stringify({ items: [{ full_name: 'python/cpython', description: 'The Python language repository.', html_url: 'https://github.com/python/cpython' }] }), 'GITHUB');
  assert.match(github.text, /python\/cpython/);
  assert.equal(github.links[0], 'https://github.com/python/cpython');
  const wikipedia = researchSourceAdapter('https://en.wikipedia.org/api/rest_v1/page/summary/Python', JSON.stringify({ title: 'Python', extract: 'Python is a programming language.' }), 'WIKIPEDIA');
  assert.match(wikipedia.text, /programming language/);
  const coding = researchSourceAdapter('https://api.stackexchange.com/2.3/search/advanced', JSON.stringify({ items: [{ title: 'How to use Python', excerpt: 'Python can be used for scripting.', link: 'https://stackoverflow.com/q/1' }] }), 'CODING_SITES');
  assert.match(coding.text, /How to use Python/);
});

test('tracks successful source rate without treating failed attempts as evidence', () => {
  const metrics = researchSuccessRate([
    { status: 'CLAIMS_EXTRACTED' },
    { status: 'EXTRACTED' },
    { status: 'FAILED', failureReason: 'HTTP_ERROR' },
    { status: 'ACCESS_FAILED', failureReason: 'BLOCKED' }
  ]);
  assert.deepEqual(metrics, { attempted: 4, successful: 2, failed: 2, rate: 0.5 });
});

test('normalizes research knowledge with provenance and freshness', () => {
  const item = normalizeResearchKnowledgeItem({ knowledgeId: 'k1', claim: 'The API is stable.', sourceIds: ['s1'], createdAt: new Date().toISOString(), confidenceScore: 0.8 }, [{ sourceId: 's1', url: 'https://docs.example.test/api' }]);
  assert.equal(item.normalizedClaim, 'The API is stable.');
  assert.deepEqual(item.sourceUrls, ['https://docs.example.test/api']);
  assert.equal(item.freshness, 'CURRENT');
});

test('knowledge answer structure distinguishes stored evidence from research need', () => {
  const result = knowledgeAnswer('question with no matching stored fact');
  assert.equal(result.structure, 'KNOWLEDGE_FOUND');
  assert.equal(typeof result.needsResearch, 'boolean');
  assert.ok(Array.isArray(result.sources));
  assert.ok(Array.isArray(result.conflicts));
});
