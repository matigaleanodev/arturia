# Arturia

[![Angular 22](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)](https://angular.dev/overview)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/en/download)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/)
[![MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue)](LICENSE)

[English](README.md)

Cliente web Angular de Arturia, un asistente personal que usa [Arturia API](https://github.com/matigaleanodev/arturia-api). La aplicación usa componentes standalone, entradas con señales y el router de Angular.

Las respuestas muestran un subconjunto de Markdown (encabezados, listas, énfasis, enlaces, tablas, código inline y bloques de código) a partir de un árbol analizado y solo con interpolación: el HTML crudo queda como texto literal, las imágenes no se cargan y los enlaces conservan únicamente URLs absolutas `http`, `https` y `mailto`. Las mismas reglas valen durante el streaming.

## Desarrollo

Usar la versión de Node indicada en `.nvmrc` y npm 11.19.1.

```sh
nvm use
npm ci
npm start
```

Ejecutar `npm run start:fixtures` para servir la aplicación con una conversación de ejemplo sintética. Angular selecciona el módulo de fixtures mediante un reemplazo de archivo en la compilación. La sesión sintética y el historial funcionan en loopback sin una API remota.

## Configuración de la aplicación

El build de producción no contiene valores del ambiente. Antes de iniciar, la aplicación pide `/config.json` a su propio origen con `cache: 'no-store'`, sin credenciales ni redirecciones, y lo valida. Un mismo build se publica con un archivo distinto en cada despliegue.

```json
{
  "version": 1,
  "apiBaseUrl": "https://<rest-api-id>.execute-api.<region>.amazonaws.com/<stage>/",
  "cognito": {
    "domain": "https://<prefijo>.auth.<region>.amazoncognito.com",
    "clientId": "<ID público del cliente>",
    "scopes": ["openid", "arturia/access"]
  },
  "redirectUri": "https://<origen web>/",
  "logoutUri": "https://<origen web>/"
}
```

- Solo se aceptan estos campos; uno desconocido, como un secreto de cliente, invalida el archivo. Todos los valores son públicos.
- `apiBaseUrl` es una URL base HTTPS, con el path del stage, sin credenciales, query ni fragmento. Las solicitudes resuelven las rutas del contrato debajo de ella.
- `cognito.domain` es un origen HTTPS sin path; la aplicación deriva `/oauth2/authorize`, `/oauth2/token` y `/logout`. `clientId` es un cliente público sin secreto y `scopes` debe incluir `arturia/access`.
- `redirectUri` y `logoutUri` deben ser la URL raíz del origen de la página, que debe ser HTTPS. Los mismos valores se registran como URL de callback y de cierre de sesión en Cognito.
- Si el archivo falta (403, 404 o fallback HTML), es inválido (incluido un tipo distinto de `application/json`), no responde o tarda más de 5 s, el inicio de sesión queda deshabilitado con un error visible y sin solicitudes a la API ni a la identidad.

El hosting sirve `/config.json` con `Cache-Control: no-store`, fuera del fallback de la SPA y como contenido del mismo origen (`connect-src 'self'`). `index.html` no se cachea; los bundles con hash admiten caché inmutable. Las configuraciones de fixtures e integrada inyectan sus providers mediante el reemplazo de archivos del build y nunca piden el archivo. El build falla si contiene un `config.json` u orígenes distintos de los del framework. La CSP del hosting solo admite scripts del mismo origen: por eso el inlining de CSS crítico está desactivado, y el build también falla si `index.html` tiene un script o un manejador de eventos inline, o si un script, una hoja de estilos o un archivo de medios no lleva hash de contenido.

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

`npm run test:e2e:aws` comprueba un ambiente desplegado en Chromium y nunca se ejecuta en `verify`. Requiere `ARTURIA_E2E_WEB_URL` (raíz de la distribución), `ARTURIA_E2E_API_URL` (URL base de la API con su stage) y `ARTURIA_E2E_ACCESS_TOKEN`, y acepta `ARTURIA_E2E_SCOPE` (`personal` o `work`). Todos los valores se validan antes de abrir el navegador, el token solo se guarda en el `sessionStorage` de la página, solo resuelven los dos hosts declarados y no se conservan traces, videos, capturas ni salida de las pruebas. Cada ejecución crea una conversación en el ámbito elegido.

## Licencia

[Matías Galeano](https://github.com/matigaleanodev) mantiene Arturia. El proyecto se distribuye bajo la [MPL-2.0](LICENSE). El archivo [NOTICE](NOTICE) contiene el aviso del código fuente y la atribución.
