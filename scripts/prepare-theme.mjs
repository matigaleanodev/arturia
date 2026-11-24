import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const path = 'dist/arturia/browser/index.html';
const index = await readFile(path, 'utf8');
const startup = /<script src="(theme-startup-[A-Z0-9]{8}\.js)" defer><\/script>/;
const entry = index.match(startup);
assert.ok(entry && index.includes('<head>'), 'Expected the hashed theme startup entry from Angular');

// A classic same-origin head script resolves the theme before CSS and before runtime config.
const prepared = index.replace(entry[0], '').replace(
  /<link rel="stylesheet"/,
  `<script src="${entry[1]}"></script><link rel="stylesheet"`,
);
assert.notEqual(prepared, index.replace(entry[0], ''), 'Expected the production stylesheet');
await writeFile(path, prepared);
