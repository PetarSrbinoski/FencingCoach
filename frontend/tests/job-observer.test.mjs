import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Compile the actual module without adding a browser test dependency.
const source = await readFile(new URL('../src/lib/job-observer.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const { createJobObserver } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

for (const outcome of ['resolve', 'reject']) {
  test(`late ${outcome} from an old conversation cannot affect the new observation`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const observer = createJobObserver(10);
    const old = deferred();
    const current = deferred();
    const results = [];
    observer.begin().poll(() => old.promise, () => assert.fail('stale result'), () => assert.fail('stale error'));
    t.mock.timers.tick(10);
    observer.begin().poll(() => current.promise, (value) => results.push(value), assert.fail);
    t.mock.timers.tick(10);
    old[outcome](outcome === 'resolve' ? { status: 'done', id: 1 } : new Error('old error'));
    await flush();
    assert.deepEqual(results, []);
    current.resolve({ status: 'done', id: 2 });
    await flush();
    assert.deepEqual(results, [{ status: 'done', id: 2 }]);
  });
}

test('slow pending requests never overlap, and terminal results stop polling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const observer = createJobObserver(10);
  const first = deferred();
  let calls = 0;
  let result;
  observer.begin().poll(() => {
    calls++;
    return calls === 1 ? first.promise : Promise.resolve({ status: 'done' });
  }, (value) => { result = value; }, assert.fail);
  t.mock.timers.tick(10);
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);
  first.resolve({ status: 'pending' });
  await flush();
  t.mock.timers.tick(10);
  await flush();
  t.mock.timers.tick(1000);
  assert.equal(calls, 2);
  assert.deepEqual(result, { status: 'done' });
});

test('stopping while a request is in flight suppresses completion; resuming works', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const observer = createJobObserver(10);
  const request = deferred();
  observer.begin().poll(() => request.promise, assert.fail, assert.fail);
  t.mock.timers.tick(10);
  observer.stop();
  request.resolve({ status: 'done' });
  await flush();
  let result;
  observer.begin().poll(async () => ({ status: 'error' }), (value) => { result = value; }, assert.fail);
  t.mock.timers.tick(10);
  await flush();
  assert.deepEqual(result, { status: 'error' });
});

test('stopping during submission prevents the old acceptance from starting polling', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const observer = createJobObserver(10);
  const submission = observer.begin();
  observer.stop();
  assert.equal(submission.isCurrent(), false);
  submission.poll(assert.fail, assert.fail, assert.fail);
  t.mock.timers.tick(1000);
});
