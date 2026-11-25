import { expect, type Page } from '@playwright/test';

/** Widths of the T9 matrix: the narrowest supported phone up to a wide desktop. */
export const viewports = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

export const themes = ['light', 'dark'] as const;
export type ThemeName = (typeof themes)[number];

const drawerBreakpoint = 768;

export async function useTheme(page: Page, theme: ThemeName, sidebar?: 'collapsed' | 'expanded') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript(([name, preference]) => {
    localStorage.setItem('arturia.theme', name);
    if (preference) localStorage.setItem('arturia.sidebar', preference);
  }, [theme, sidebar] as const);
}

export async function setScenario(page: Page, scenario: string) {
  await page.evaluate((value) => sessionStorage.setItem('arturia.fixture.scenario', value), scenario);
}

export async function send(page: Page, text: string, scenario?: string) {
  if (scenario) await setScenario(page, scenario);
  await page.getByRole('textbox', { name: 'Mensaje' }).fill(text);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page).toHaveURL(/[?&]conversation=/);
}

export async function emptyChat(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '¿En qué te ayudo?' })).toBeVisible();
}

export async function markdownConversation(page: Page) {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00Z') });
  await emptyChat(page);
  await send(page, '¿Cómo organizo la mudanza en tres semanas?', 'markdown');
  await page.clock.fastForward(5_000);
  await expect(page.getByRole('button', { name: 'Copiar respuesta' })).toBeVisible();
}

/** Every interface state worth auditing: complete, incomplete, failed, cancelled and an unacknowledged send. */
export async function allStates(page: Page) {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00Z') });
  await emptyChat(page);
  await send(page, 'Resumí el informe trimestral', 'incomplete');
  await page.clock.fastForward(5_000);
  await send(page, 'Probá otra vez', 'failed');
  await page.clock.fastForward(5_000);
  await send(page, 'Mejor dejalo');
  await page.getByRole('button', { name: 'Detener respuesta' }).click();
  await expect(page.getByText('Respuesta cancelada')).toBeVisible();
  await setScenario(page, 'lost-response');
  await page.getByRole('textbox', { name: 'Mensaje' }).fill('Este mensaje no tuvo acuse');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reintentar envío' })).toBeVisible();
}

export async function generating(page: Page) {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00Z') });
  await emptyChat(page);
  await send(page, '¿Cómo organizo la mudanza?', 'markdown');
  await page.clock.runFor(1_200);
  await expect(page.getByText('Generando respuesta…')).toBeVisible();
}

export async function openScopeMenu(page: Page, width: number) {
  if (width < drawerBreakpoint) await page.getByRole('button', { name: 'Abrir menú' }).click();
  await page.getByRole('button', { name: /Ámbito/ }).click();
  await expect(page.getByRole('button', { name: /Ámbito/ })).toHaveAttribute('aria-expanded', 'true');
}

export interface View {
  readonly name: string;
  /** The sidebar preference the view needs on widths that show a sidebar. */
  readonly sidebar?: 'collapsed' | 'expanded';
  readonly applies?: (width: number) => boolean;
  readonly run: (page: Page, width: number) => Promise<void>;
}

export const views: readonly View[] = [
  {
    name: 'acceso',
    run: async (page) => {
      await page.goto('/settings?scope=personal');
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(page.getByRole('heading', { name: 'Arturia' })).toBeVisible();
    },
  },
  { name: 'conversación vacía', run: emptyChat },
  { name: 'conversación con Markdown', run: markdownConversation },
  { name: 'estados de respuesta', run: allStates },
  { name: 'generación en curso', run: generating },
  {
    name: 'sidebar expandido con selector de ámbito',
    sidebar: 'expanded',
    run: async (page, width) => {
      await emptyChat(page);
      await openScopeMenu(page, width);
    },
  },
  {
    name: 'sidebar colapsado',
    sidebar: 'collapsed',
    applies: (width) => width >= drawerBreakpoint,
    run: async (page) => {
      await markdownConversation(page);
      await expect(page.getByRole('button', { name: 'Abrir barra lateral', exact: true })).toBeVisible();
    },
  },
  {
    name: 'drawer abierto',
    applies: (width) => width < drawerBreakpoint,
    run: async (page) => {
      await markdownConversation(page);
      await page.getByRole('button', { name: 'Abrir menú' }).click();
      await expect(page.getByRole('button', { name: 'Cerrar menú' })).toBeFocused();
    },
  },
  {
    name: 'composer en su altura máxima',
    run: async (page) => {
      await markdownConversation(page);
      await page.getByRole('textbox', { name: 'Mensaje' }).fill(
        Array.from({ length: 12 }, (_, index) => `Línea ${index + 1} del borrador con texto suficiente`).join('\n'),
      );
    },
  },
  {
    name: 'configuración',
    run: async (page) => {
      await page.goto('/settings?scope=personal');
      await expect(page.getByRole('heading', { name: 'Apariencia' })).toBeVisible();
    },
  },
];
