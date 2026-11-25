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

// The hosting CSP allows only same-origin scripts (script-src 'self'): no inline scripts or event handlers.
const index = await readFile(join(browser, 'index.html'), 'utf8');
const inlineScripts = [...index.matchAll(/<script\b([^>]*)>/gi)].filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes));
assert.deepEqual(inlineScripts.map(([tag]) => tag), [], 'index.html must not contain inline scripts');
assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(index), 'index.html must not contain inline event handlers');
// The hosting caches scripts, styles and media as immutable: each one needs a content hash in its name.
// Entry files carry base32 hashes, while lazy chunks can carry base64url ones (for example chunk-Dk_SasX8.js).
const unhashed = files.map(file => file.split('\\').join('/'))
  .filter(file => /\.(js|css)$/.test(file) || file.startsWith('media/'))
  .filter(file => !/-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(file));
assert.deepEqual(unhashed, [], 'Scripts, styles and media must carry a content hash');
