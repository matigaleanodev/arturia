import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const stats = JSON.parse(await readFile('dist/arturia/browser-stats.json', 'utf8'));
const inputs = Object.keys(stats.inputs);
assert.ok(inputs.some(file => file.endsWith('src/main.ts')), 'Expected Angular production build inputs');
assert.deepEqual(inputs.filter(file => /src\/app\/(testing\/|core\/api\/contract\/fixtures\/)/.test(file)), [],
  'Synthetic sessions, chat fixtures and integrated providers must stay outside the production bundle');

// Environment values arrive through the /config.json published with each deployment, never through the build.
const browser = 'dist/arturia/browser';
const files = await readdir(browser, { recursive: true });
assert.ok(!files.some(file => file.endsWith('config.json')), 'The build must not ship a runtime configuration');
const frameworkHosts = new Set(['www.w3.org', 'angular.dev', 'fake']);
for (const file of files.filter(name => /\.(js|css|html)$/.test(name))) {
  const text = await readFile(join(browser, file), 'utf8');
  const hosts = [...text.matchAll(/https?:\/\/([\w.-]+)/g)].map(match => match[1]);
  assert.deepEqual(hosts.filter(host => !frameworkHosts.has(host)), [],
    `${file} embeds origins that belong in the runtime configuration`);
}
