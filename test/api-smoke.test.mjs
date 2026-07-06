// Smoke test: every api module must parse and import cleanly.
// Serverless functions crash at import time if a top-level statement throws —
// this locks that behavior before any refactor.
import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

process.env.KV_REST_API_URL ||= 'https://example.upstash.io';
process.env.KV_REST_API_TOKEN ||= 'test-token';

const files = readdirSync('api').filter(f => f.endsWith('.js'));

for (const f of files) {
  test(`api/${f} parses (node --check)`, () => {
    execFileSync(process.execPath, ['--check', `api/${f}`]);
  });
  test(`api/${f} imports without throwing`, async () => {
    const mod = await import(`../api/${f}`);
    if (f !== '_telemetry.js') {
      assert.strictEqual(typeof mod.default, 'function', 'default export must be a handler function');
    }
  });
}

test('scan.js exports recomputeScore and scanGitHub', async () => {
  const scan = await import('../api/scan.js');
  assert.strictEqual(typeof scan.recomputeScore, 'function');
  assert.strictEqual(typeof scan.scanGitHub, 'function');
});
