# Arturia

[![Angular 22](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)](https://angular.dev/overview)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/en/download)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/)
[![MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue)](LICENSE)

[English](README.md)

Cliente web Angular de Arturia, un asistente personal que usa [Arturia API](https://github.com/matigaleanodev/arturia-api). La aplicación usa componentes standalone, entradas con señales y el router de Angular.

## Desarrollo

Usar la versión de Node indicada en `.nvmrc` y npm 11.19.1.

```sh
nvm use
npm ci
npm start
```

Ejecutar `npm run start:fixtures` para servir la aplicación con una conversación de ejemplo sintética. Angular selecciona el módulo de fixtures mediante un reemplazo de archivo en la compilación. La sesión sintética y el historial funcionan en loopback sin una API remota.

## Configuración de la aplicación

Los providers de `src/app/app-environment.ts` definen el origen HTTPS de la API, los endpoints OAuth de autorización y token, el ID público del cliente, los scopes solicitados y los IDs de ámbito. Registrá la URL raíz del origen web como URI de redirección de OAuth. La aplicación intercambia el código de autorización con PKCE S256.

## Contrato de API

La [copia local](src/app/core/api/contract/) proviene del [directorio de contratos de Arturia API](https://github.com/matigaleanodev/arturia-api/tree/dev/contracts). Incluye OpenAPI, el esquema de payloads SSE, el fixture sintético de chat y el digest de origen en `sha256.txt`.

Para sincronizar, copiar los tres archivos de origen byte por byte, registrar el digest desde la raíz del API y ejecutar `npm run contract:generate` en el checkout web. Versionar juntos la copia, el digest y el TypeScript generado.

```sh
sha256sum contracts/openapi.json contracts/sse.schema.json contracts/fixtures/chat.json | sha256sum
```

## Verificación

```sh
npm exec -- playwright install chromium
npm run verify
```

`verify` comprueba el digest y los tipos generados, ejecuta Vitest, compila para producción y ejecuta Playwright con la configuración de fixtures. Ejecutar `npm test` o `npm run test:e2e` para seleccionar una suite.

## Licencia

[Matías Galeano](https://github.com/matigaleanodev) mantiene Arturia. El proyecto se distribuye bajo la [MPL-2.0](LICENSE). El archivo [NOTICE](NOTICE) contiene el aviso del código fuente y la atribución.
