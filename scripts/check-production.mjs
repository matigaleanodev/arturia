import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stats = JSON.parse(await readFile('dist/arturia/browser-stats.json', 'utf8'));
const inputs = Object.keys(stats.inputs);
assert.ok(inputs.some(file => file.endsWith('src/main.ts')), 'Expected Angular production build inputs');
assert.deepEqual(inputs.filter(file => /src\/app\/(testing\/|core\/api\/contract\/fixtures\/)/.test(file)), [],
  'Synthetic sessions, chat fixtures and integrated providers must stay outside the production bundle');
