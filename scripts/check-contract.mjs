import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const snapshot = new URL('../src/app/core/api/contract/', import.meta.url);
const expected = readFileSync(new URL('sha256.txt', snapshot), 'utf8').trim();
const files = ['openapi.json', 'sse.schema.json', 'fixtures/chat.json'];
const digest = (value) => createHash('sha256').update(value).digest('hex');

// Match sha256sum in the API checkout, regardless of the checkout path or host OS.
const manifest = files
  .map((file) => `${digest(readFileSync(new URL(file, snapshot)))}  contracts/${file}\n`)
  .join('');
const actual = digest(manifest);

if (actual !== expected) {
  console.error(`Contract digest mismatch: expected ${expected}, got ${actual}.`);
  process.exitCode = 1;
} else {
  console.log(`Contract digest: ${actual}`);
}
