# API contract

[Español](api-contract.es.md)

The API contract is owned by [Arturia API](https://github.com/matigaleanodev/arturia-api/tree/dev/contracts). This repository keeps a versioned copy and generates its TypeScript types from it.

## Snapshot

[`src/app/core/api/contract/`](../src/app/core/api/contract/) contains:

| File | Content |
| --- | --- |
| `openapi.json` | OpenAPI document of the REST routes. |
| `sse.schema.json` | JSON Schema of the SSE event payloads. |
| `fixtures/chat.json` | Synthetic chat fixture shared with the API. |
| `sha256.txt` | Digest of the three source files, computed in the API checkout. |
| `openapi.generated.ts`, `sse.generated.ts` | Generated types. Do not edit by hand. |

The contract files are the source of truth for routes, payloads and error responses; this document does not repeat them.

## Synchronization

1. Copy `contracts/openapi.json`, `contracts/sse.schema.json` and `contracts/fixtures/chat.json` from the API checkout byte for byte into the snapshot, keeping their relative paths.
2. In the API root, compute the digest. Copy the hexadecimal value to the snapshot's `sha256.txt`:

   ```sh
   sha256sum contracts/openapi.json contracts/sse.schema.json contracts/fixtures/chat.json | sha256sum
   ```

3. Run `npm run contract:generate` in this repository.
4. Commit the snapshot, the digest and the generated types together.

`npm run contract:check` (part of `npm run verify`) fails if the digest does not match the files or the generated types are out of date.

## Client behavior

The REST client is [`chat-api.ts`](../src/app/core/api/chat-api.ts) and the SSE client is [`sse-client.ts`](../src/app/core/api/sse-client.ts); the conversation flow lives in [`chat.store.ts`](../src/app/features/chat/chat.store.ts).

- Every request sends `Authorization: Bearer <access token>`. Contract paths resolve under `apiBaseUrl`, so a stage prefix is preserved.
- Sending a message posts a turn with an `Idempotency-Key` that is kept while the same message is retried. A `400`, `401`, `403`, `404` or `409` discards the attempt; other failures let the user retry with the same key.
- Replies stream from `GET .../turns/{turnId}/events?after=<lastSeq>` as `text/event-stream`. Events other than `text` and `status` are ignored. A payload that does not match its event type or turn, or a gap in `text` sequence numbers, ends the connection (repeated `seq` values are skipped), and the client reconnects from the last applied `seq`. Each connection attempt times out after 30 s.
- After three consecutive stream attempts without progress, or a `403` or `404`, the client polls the turn snapshot at a base interval of 750 ms.
- A `401` for the current token ends the session. A `401`, `403` or `404` while reading a snapshot closes the conversation in the current scope.
- After a `429`, the client waits for the longer of `Retry-After` and a jittered exponential backoff. If the next stream retry would start more than 24 s after the first `429` without progress, the client falls back to the snapshot. The values in [`throttle-backoff.ts`](../src/app/features/chat/throttle-backoff.ts) derive from the API throttling limits and must be updated together with them.
- An active reply can be cancelled with `POST .../turns/{turnId}/cancel`.
