import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const ts = require('typescript');
const source = await readFile(new URL('../../frontend/src/lib/uuid.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function load(crypto) {
  const context = { crypto, exports: {} };
  vm.runInNewContext(outputText, context);
  return context.exports.randomUUID;
}

test('generates distinct v4 request IDs on HTTP where randomUUID is unavailable', () => {
  const randomUUID = load({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const ids = Array.from({ length: 100 }, () => randomUUID());
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
});

test('uses the native UUID implementation when available', () => {
  assert.equal(load({ randomUUID: () => 'native-id' })(), 'native-id');
});
