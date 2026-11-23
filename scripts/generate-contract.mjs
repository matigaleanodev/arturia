import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@hey-api/openapi-ts';
import { compile } from 'json-schema-to-typescript';

const snapshot = new URL('../src/app/core/api/contract/', import.meta.url);
const check = process.argv.includes('--check');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'arturia-types-'));

try {
  await createClient({
    input: fileURLToPath(new URL('openapi.json', snapshot)),
    output: { path: temporaryDirectory, indexFile: false },
    plugins: ['@hey-api/typescript'],
  });
  const openapiTypes = await readFile(join(temporaryDirectory, 'types.gen.ts'), 'utf8');
  const sseSchema = JSON.parse(await readFile(new URL('sse.schema.json', snapshot), 'utf8'));
  const sseTypes = await compile(sseSchema, 'SseEvent', {
    bannerComment: '// Generated from sse.schema.json. Run npm run contract:generate.',
    style: { singleQuote: true },
    ignoreMinAndMaxItems: true,
    enableConstEnums: false,
  });

  for (const [name, content] of [
    ['openapi.generated.ts', openapiTypes],
    ['sse.generated.ts', sseTypes],
  ]) {
    const target = new URL(name, snapshot);
    const normalized = content.replaceAll('\r\n', '\n');

    if (check) {
      const current = await readFile(target, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      if (current !== normalized) {
        console.error(`${name} is stale. Run npm run contract:generate.`);
        process.exitCode = 1;
      }
    } else {
      await writeFile(target, normalized);
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
