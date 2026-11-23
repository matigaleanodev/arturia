import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConversationDetail, TurnAccepted, TurnSnapshot } from '../../src/app/core/api/contract/openapi.generated';

const api = process.env['ARTURIA_API_ORIGIN']!;
const control = process.env['ARTURIA_CONTROL_DIR']!;
const owner = { Authorization: 'Bearer integrated.a.local' };
const personal = 'fixture-personal';
const answer = 'Hola, este es un resultado sintético.';

test.beforeEach(async ({ context, baseURL }) => {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(api)) throw new Error('Expected a loopback API');
  await context.route('**/*', route =>
    [api, baseURL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
});

async function accept(page: Page) {
  await page.goto('/chat?scope=personal');
  await page.getByRole('button', { name: 'Nueva conversación' }).click();
  await page.getByRole('textbox', { name: 'Mensaje' }).fill('Consulta sintética integrada');
  const response = page.waitForResponse(r => r.url().startsWith(api + '/') &&
    r.url().endsWith('/turns') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Enviar' }).click();
  const accepted = await response;
  expect(accepted.status()).toBe(202);
  const { turnId, status } = await accepted.json() as TurnAccepted;
  expect(status).toBe('queued');
  expect(turnId).toMatch(/^[a-f0-9-]{36}$/);
  const conversationId = new URL(page.url()).searchParams.get('conversation');
  expect(conversationId).toBeTruthy();
  return { turnId, conversationId, url: page.url() };
}

async function release(turnId: string) {
  await writeFile(join(control, turnId + '.release'), '');
}

async function attempts(turnId: string) {
  return (await readFile(join(control, turnId + '.attempts'), 'utf8')).trim().split('\n');
}

async function snapshot(request: APIRequestContext, turnId: string) {
  const response = await request.get(api + '/v1/scopes/' + personal + '/turns/' + turnId, { headers: owner });
  expect(response.status()).toBe(200);
  return await response.json() as TurnSnapshot;
}

test('accepted_turn_finishes_after_tab_close', async ({ page, request }) => {
  const { turnId, conversationId } = await accept(page);
  await page.close();
  // The provider cannot return a chunk before the browser has disconnected.
  await release(turnId);
  await expect.poll(() => snapshot(request, turnId)).toMatchObject({
    turnId, conversationId, status: 'completed', result: { text: answer },
  });
  expect(await attempts(turnId)).toHaveLength(1);
});

test('restored_conversation_has_one_answer', async ({ page, context, request }) => {
  const { turnId, conversationId, url } = await accept(page);
  await page.close();
  const reopened = await context.newPage();
  const detail = reopened.waitForResponse(r => r.url() ===
    api + '/v1/scopes/' + personal + '/conversations/' + conversationId);
  await reopened.goto(url);
  const history = await (await detail).json() as ConversationDetail;
  expect(history.turns.map(t => t.snapshot.turnId)).toEqual([turnId]);
  expect(['queued', 'running']).toContain(history.turns[0]?.snapshot.status);
  await expect(reopened.getByRole('button', { name: 'Cancelar respuesta' })).toBeVisible();
  await release(turnId);
  await expect(reopened.getByText('Respuesta completa', { exact: true })).toBeVisible();
  await expect(reopened.getByRole('article')).toHaveCount(1);
  await expect(reopened.getByText(answer, { exact: true })).toHaveCount(1);
  expect((await snapshot(request, turnId)).status).toBe('completed');
  expect(await attempts(turnId)).toHaveLength(1);
});

test('foreign_scope_cannot_read_turn', async ({ page, request }) => {
  const { turnId } = await accept(page);
  await release(turnId);
  await expect.poll(async () => (await snapshot(request, turnId)).status).toBe('completed');
  const target = api + '/v1/scopes/' + personal + '/turns/' + turnId;
  const forbiddenOrigin = await request.get(target, { headers: { ...owner, Origin: 'https://foreign.invalid' } });
  expect(forbiddenOrigin.status()).toBe(403);
  expect(forbiddenOrigin.headers()['access-control-allow-origin']).toBeUndefined();
  const allowed = await request.fetch(target, { method: 'OPTIONS', headers: { Origin: new URL(page.url()).origin } });
  expect(allowed.status()).toBe(204);
  expect(allowed.headers()['access-control-allow-origin']).toBe(new URL(page.url()).origin);
  const other = { Authorization: 'Bearer integrated.b.local' };
  for (const [headers, scope, status] of [
    [owner, 'integrated-work', 404],
    [other, personal, 403],
    [other, 'fixture-work', 404],
  ] as const) {
    const response = await request.get(api + '/v1/scopes/' + scope + '/turns/' + turnId, { headers });
    expect(response.status()).toBe(status);
    expect(Object.keys(await response.json()).sort()).toEqual(['code', 'message', 'requestId']);
  }
});
