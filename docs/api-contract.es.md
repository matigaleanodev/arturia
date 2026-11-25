# Contrato de API

[English](api-contract.md)

El contrato de la API pertenece a [Arturia API](https://github.com/matigaleanodev/arturia-api/tree/dev/contracts). Este repositorio conserva una copia versionada y genera a partir de ella sus tipos TypeScript.

## Copia local

[`src/app/core/api/contract/`](../src/app/core/api/contract/) contiene:

| Archivo | Contenido |
| --- | --- |
| `openapi.json` | Documento OpenAPI de las rutas REST. |
| `sse.schema.json` | JSON Schema de los payloads de eventos SSE. |
| `fixtures/chat.json` | Fixture sintético de chat compartido con la API. |
| `sha256.txt` | Digest de los tres archivos de origen, calculado en el checkout de la API. |
| `openapi.generated.ts`, `sse.generated.ts` | Tipos generados. No editarlos a mano. |

Los archivos del contrato son la fuente de verdad para rutas, payloads y respuestas de error; este documento no los repite.

## Sincronización

1. Copiar `contracts/openapi.json`, `contracts/sse.schema.json` y `contracts/fixtures/chat.json` del checkout de la API byte por byte a la copia local, conservando sus rutas relativas.
2. Calculá el digest en la raíz de la API. Copiá el valor hexadecimal en el archivo `sha256.txt` de la copia local:

   ```sh
   sha256sum contracts/openapi.json contracts/sse.schema.json contracts/fixtures/chat.json | sha256sum
   ```

3. Ejecutar `npm run contract:generate` en este repositorio.
4. Versionar juntos la copia, el digest y los tipos generados.

`npm run contract:check` (parte de `npm run verify`) falla si el digest no coincide con los archivos o si los tipos generados están desactualizados.

## Comportamiento del cliente

El cliente REST es [`chat-api.ts`](../src/app/core/api/chat-api.ts) y el cliente SSE es [`sse-client.ts`](../src/app/core/api/sse-client.ts); el flujo de conversación está en [`chat.store.ts`](../src/app/features/chat/chat.store.ts).

- Toda solicitud envía `Authorization: Bearer <access token>`. Las rutas del contrato se resuelven debajo de `apiBaseUrl`, de modo que se conserva el prefijo del stage.
- Enviar un mensaje publica un turno con un `Idempotency-Key` que se mantiene mientras se reintenta el mismo mensaje. Un `400`, `401`, `403`, `404` o `409` descarta el intento; otras fallas permiten reintentar con la misma clave.
- Las respuestas llegan por `GET .../turns/{turnId}/events?after=<lastSeq>` como `text/event-stream`. Los eventos distintos de `text` y `status` se ignoran. Un payload que no coincide con su tipo de evento o su turno, o un salto en los números de secuencia de `text`, termina la conexión (los `seq` repetidos se omiten), y el cliente se reconecta desde el último `seq` aplicado. Cada intento de conexión vence a los 30 s.
- Tras tres intentos consecutivos de streaming sin avances, o ante un `403` o `404`, el cliente consulta el snapshot del turno a un intervalo base de 750 ms.
- Un `401` para el token vigente termina la sesión. Un `401`, `403` o `404` al leer un snapshot cierra la conversación en el ámbito actual.
- Después de un `429`, el cliente espera lo que sea mayor entre `Retry-After` y un backoff exponencial con jitter. Si el próximo reintento de streaming comenzaría más de 24 s después del primer `429` sin avances, el cliente pasa a consultar el snapshot. Los valores de [`throttle-backoff.ts`](../src/app/features/chat/throttle-backoff.ts) derivan de los límites de throttling de la API y deben actualizarse junto con ellos.
- Una respuesta activa puede cancelarse con `POST .../turns/{turnId}/cancel`.
