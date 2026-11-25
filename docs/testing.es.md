# Pruebas

[English](testing.md)

## Verificación completa

```sh
npm exec -- playwright install chromium
npm run verify
```

En Linux, si faltan las bibliotecas del sistema que necesita el navegador, usá `npm exec -- playwright install --with-deps chromium`.

La CI ejecuta `verify`, que cubre el contrato y los tipos generados, las pruebas unitarias, el build de producción y las pruebas end-to-end con fixtures en Chromium.

## Suites

| Comando | Alcance |
| --- | --- |
| `npm test` | Pruebas unitarias y de componentes con Vitest (`src/**/*.spec.ts`). |
| `npm run test:e2e` | Pruebas end-to-end con Playwright en `tests/e2e/`, en Chromium, contra `npm run start:fixtures` en `127.0.0.1:4201`. Incluye controles de accesibilidad con axe-core. |
| `npm run test:e2e:cross` | La misma suite en Chromium, Firefox y WebKit. Antes, instalar esos navegadores con `npm exec -- playwright install firefox webkit`. |
| `npm run test:contract` | Prueba que la comprobación del digest detecte cambios en el contrato. |
| `npm run contract:check` | El digest de la copia y los tipos generados están al día. |
| `npm run test:e2e:aws:unit` | Pruebas unitarias de la suite de ambiente desplegado (`tests/e2e-aws/*.test.ts`). |
| `npm run build` | Build de producción más las comprobaciones de `scripts/check-production.mjs`. |

Las pruebas con fixtures usan datos sintéticos de `src/app/testing/` y el fixture del contrato; no hacen solicitudes fuera de loopback.

## Ambiente desplegado

`npm run test:e2e:aws` comprueba un ambiente desplegado en Chromium. Nunca se ejecuta en `verify` y no tiene un destino predeterminado. Configuración ([`playwright.aws.config.ts`](../playwright.aws.config.ts), [`tests/e2e-aws/target.ts`](../tests/e2e-aws/target.ts)):

| Variable | Valor |
| --- | --- |
| `ARTURIA_E2E_WEB_URL` | URL raíz de la distribución web. |
| `ARTURIA_E2E_API_URL` | URL base de la API, con su stage. |
| `ARTURIA_E2E_ACCESS_TOKEN` | Access token de un usuario de prueba. |
| `ARTURIA_E2E_SCOPE` | Opcional: `personal` (predeterminado) o `work`. |

Todos los valores se validan antes de abrir el navegador, y los errores nombran la variable, nunca su valor. El token llega al navegador solo mediante el `sessionStorage` de la página; solo resuelven los dos hosts declarados; no se conservan traces, videos, capturas ni salida de las pruebas. Cada ejecución crea una conversación en el ámbito elegido.

## Ejecución integrada con la API

`tests/e2e/chat-real-api.spec.ts` y la configuración Angular `integrated` ejecutan el cliente web contra una Arturia API local en loopback. Se inician desde el checkout de la API (`npm run verify:integrated` con `ARTURIA_WEB_DIR` apuntando a este repositorio), que provee el origen de la API y define `ARTURIA_INTEGRATED=1`. `npm run test:e2e` omite esta spec.
