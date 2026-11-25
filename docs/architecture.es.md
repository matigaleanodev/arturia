# Arquitectura

[English](architecture.md)

Arturia es una aplicación Angular de una sola página construida con componentes standalone, señales, detección de cambios `OnPush` y el router de Angular. Solo se comunica con [Arturia API](https://github.com/matigaleanodev/arturia-api) y con la UI alojada de Amazon Cognito.

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `src/app/app-environment.ts` | Providers según el build. Producción carga `/config.json`. |
| `src/app/core/runtime-config.ts` | Obtiene y valida la configuración en tiempo de ejecución. |
| `src/app/core/auth/` | Sesión OAuth: inicio de sesión, callback, vencimiento y cierre de sesión. |
| `src/app/core/api/` | Cliente REST, cliente SSE, interpretación de `Retry-After` y la [copia del contrato](../src/app/core/api/contract/). |
| `src/app/features/chat/` | Página de chat, store de conversaciones, composer, renderizador de Markdown y backoff ante throttling. |
| `src/app/features/scopes/` | Ámbitos Personal y Laboral y su selector. |
| `src/app/features/settings/` | Selección de tema y cierre de sesión. |
| `src/app/core/theme/`, `src/theme-startup.js` | Preferencia de tema y su resolución antes del primer pintado. |
| `src/app/testing/` | Providers de fixtures e integrados, usados solo por configuraciones de prueba. |
| `scripts/` | Generación y comprobación del contrato, y comprobaciones del build de producción. |

Las rutas son `/` para iniciar sesión, `/chat?scope=personal` o `/chat?scope=work` para el chat y `/settings` para la configuración. El chat admite el parámetro opcional `conversation`. El chat y la configuración requieren una sesión activa. Si el ámbito es desconocido, la aplicación redirige a `/`.

## Decisiones

**Configuración en tiempo de ejecución.** El mismo build se puede promover entre despliegues. `scripts/check-production.mjs` hace fallar el build si contiene un `config.json` u orígenes ajenos al framework. Ver [Configuración](configuration.es.md) para publicar los valores de cada despliegue.

**Cliente OAuth público con PKCE.** La aplicación usa el flujo authorization code con PKCE (`S256`) contra la UI alojada de Cognito, sin secreto de cliente, porque un navegador no puede guardarlo. La transacción de inicio de sesión (state y verifier) vence a los 10 minutos. La aplicación quita los parámetros del callback de la URL del navegador y usa la transacción guardada una sola vez. Solo se usa el access token: se guarda en `sessionStorage` (limitado a la pestaña) y se descarta al vencer; después el usuario vuelve a iniciar sesión. El cierre de sesión también termina la sesión alojada, para que el siguiente inicio pueda usar otra cuenta.

**Solicitudes defensivas.** Toda solicitud a la API y al endpoint de tokens usa `credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'` y `referrerPolicy: 'no-referrer'`. Los identificadores se validan y se codifican como un único segmento de path. Un `401` para el token vigente termina la sesión como denegada, o como vencida si ocurre dentro de los 30 s previos al vencimiento local.

**Ámbitos como scope IDs de la API.** Las claves de la UI `personal` y `work` se traducen a scope IDs de la API mediante `AppOptions.scopeIds` (`src/app/core/app-options.ts`); producción usa los mismos valores. Las configuraciones de prueba los asignan a IDs sintéticos.

**Markdown renderizado desde un árbol, nunca desde HTML.** Las respuestas son salida de un modelo y se tratan como no confiables. `src/app/features/chat/markdown/` analiza un subconjunto (encabezados, listas, énfasis, enlaces, tablas, código inline y bloques de código) en un árbol que se renderiza solo con interpolación: no hay `innerHTML`, el HTML crudo queda como texto literal, las imágenes no se cargan y los enlaces conservan únicamente URLs absolutas `http`, `https` y `mailto`. Las mismas reglas valen durante el streaming.

**Compatibilidad con una CSP estricta.** La Content Security Policy del hosting solo admite scripts del mismo origen. Por eso el inlining de CSS crítico está desactivado, y `scripts/prepare-theme.mjs` mueve el script `theme-startup` con hash al `<head>` como script clásico, para resolver el tema antes de cargar el CSS sin un script inline. `scripts/check-production.mjs` rechaza scripts o manejadores de eventos inline en `index.html` y scripts, estilos o archivos de medios sin hash de contenido.

**Código de prueba fuera de producción.** Los environments de fixtures e integrado reemplazan `src/app/app-environment.ts` mediante `fileReplacements` en `angular.json`. `scripts/check-production.mjs` falla si `src/app/testing/` o los fixtures del contrato llegan al bundle de producción.

**Tipos del contrato generados.** Los tipos de la API y de SSE se generan a partir de la copia versionada del contrato y nunca se editan a mano. Ver [Contrato de API](api-contract.es.md).

## Almacenamiento del navegador

| Almacenamiento | Clave | Contenido |
| --- | --- | --- |
| `sessionStorage` | `arturia.oauth.transaction` | Estado de login pendiente y verifier PKCE. |
| `sessionStorage` | `arturia.oauth.session` | Access token y su vencimiento. |
| `localStorage` | `arturia.scope` | Último ámbito usado. |
| `localStorage` | `arturia.theme` | Preferencia de tema. |

Si el almacenamiento está bloqueado, el ámbito y el tema funcionan en la página actual sin recordarse.
