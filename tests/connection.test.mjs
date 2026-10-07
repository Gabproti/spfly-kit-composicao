import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/connection.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { withTimeout, boundedFetch, connectionMessage } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('unreachable server releases the waiting UI with a connection message', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), { message: connectionMessage });
});
test('successful and failed operations retain their result', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 100), 'ok');
  const failure = new Error('original');
  await assert.rejects(withTimeout(Promise.reject(failure), 100), failure);
});
test('request cancellation reaches the underlying fetch and preserves options', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_input, init) => {
    assert.equal(init.headers.apikey, 'public-test-key');
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  };
  const controller = new AbortController();
  const pending = boundedFetch('https://example.invalid', { headers: { apikey: 'public-test-key' }, signal: controller.signal });
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
});
