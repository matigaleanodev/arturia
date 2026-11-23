import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const snapshot = 'src/app/core/api/contract';

for (const file of ['openapi.json', 'sse.schema.json', 'fixtures/chat.json']) {
  test(`contract_digest_detects_drift: ${file}`, (context) => {
    const checkout = mkdtempSync(join(tmpdir(), 'arturia-contract-'));
    context.after(() => rmSync(checkout, { recursive: true, force: true }));
    const scripts = join(checkout, 'scripts');
    const contract = join(checkout, snapshot);
    mkdirSync(scripts);
    copyFileSync(join(project, 'scripts/check-contract.mjs'), join(scripts, 'check-contract.mjs'));
    cpSync(join(project, snapshot), contract, { recursive: true });

    const check = () =>
      spawnSync(process.execPath, ['scripts/check-contract.mjs'], { cwd: checkout, encoding: 'utf8' });

    const original = check();
    assert.equal(original.status, 0, original.stderr);

    appendFileSync(join(contract, file), '\n');
    const changed = check();
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Contract digest mismatch/);
  });
}
