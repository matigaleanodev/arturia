# Architecture

[Español](architecture.es.md)

Arturia is a single-page Angular application built with standalone components, signals, `OnPush` change detection and the Angular router. It talks only to [Arturia API](https://github.com/matigaleanodev/arturia-api) and to the Amazon Cognito hosted UI.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/app/app-environment.ts` | Build-specific providers. Production loads `/config.json`. |
| `src/app/core/runtime-config.ts` | Fetches and validates the runtime configuration. |
| `src/app/core/auth/` | OAuth session: sign-in, callback, expiry and sign-out. |
| `src/app/core/api/` | REST client, SSE client, `Retry-After` parsing and the [contract snapshot](../src/app/core/api/contract/). |
| `src/app/features/chat/` | Chat page, conversation store, composer, Markdown renderer and throttling backoff. |
| `src/app/features/scopes/` | Personal and Work scopes and the scope picker. |
| `src/app/features/settings/` | Theme selection and sign-out. |
| `src/app/core/theme/`, `src/theme-startup.js` | Theme preference and its resolution before the first paint. |
| `src/app/testing/` | Fixture and integrated providers, used only by test configurations. |
| `scripts/` | Contract generation and checks, and production build checks. |

The routes are `/` for sign-in, `/chat?scope=personal` or `/chat?scope=work` for chat, and `/settings`. Chat accepts an optional `conversation` parameter. Chat and settings require an active session. An unknown scope redirects to `/`.

## Decisions

**Runtime configuration.** One build can be promoted across deployments. `scripts/check-production.mjs` fails the build if it contains a `config.json` or non-framework origins. See [Configuration](configuration.md) for how each deployment supplies its own values.

**Public OAuth client with PKCE.** The app uses the authorization code flow with PKCE (`S256`) against the Cognito hosted UI, without a client secret, because a browser cannot keep one. The login transaction (state and verifier) expires after 10 minutes. The app removes the callback parameters from the browser URL and consumes the stored transaction once. Only the access token is used: it is kept in `sessionStorage` (scoped to the tab) and dropped at its expiry, after which the user signs in again. Sign-out also ends the hosted session, so the next sign-in can use another account.

**Defensive requests.** Every request to the API and the token endpoint uses `credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'` and `referrerPolicy: 'no-referrer'`. Identifiers are validated and percent-encoded as single path segments. A `401` for the token still held ends the session as denied, or as expired when it falls within 30 s of the local expiry.

**Scopes as API scope IDs.** The UI keys `personal` and `work` map to API scope IDs through `AppOptions.scopeIds` (`src/app/core/app-options.ts`); production uses the same values. Test configurations map them to synthetic IDs.

**Markdown rendered from a tree, never from HTML.** Replies are model output and are treated as untrusted. `src/app/features/chat/markdown/` parses a subset (headings, lists, emphasis, links, tables, inline code and code blocks) into a tree rendered with interpolation only: there is no `innerHTML`, raw HTML stays literal text, images are not loaded and links keep only absolute `http`, `https` and `mailto` URLs. The same rules apply while a reply is streaming.

**Strict CSP compatibility.** The hosting Content Security Policy allows only same-origin scripts. Therefore critical CSS inlining is disabled, and `scripts/prepare-theme.mjs` moves the hashed `theme-startup` script into `<head>` as a classic script so the theme resolves before CSS loads, without an inline script. `scripts/check-production.mjs` rejects inline scripts or event handlers in `index.html` and scripts, styles or media without a content hash.

**Test code outside production.** Fixture and integrated environments replace `src/app/app-environment.ts` through `fileReplacements` in `angular.json`. `scripts/check-production.mjs` fails if `src/app/testing/` or the contract fixtures reach the production bundle.

**Generated contract types.** API and SSE types are generated from the versioned contract snapshot and are never edited by hand. See [API contract](api-contract.md).

## Browser storage

| Storage | Key | Content |
| --- | --- | --- |
| `sessionStorage` | `arturia.oauth.transaction` | Pending login state and PKCE verifier. |
| `sessionStorage` | `arturia.oauth.session` | Access token and its expiry. |
| `localStorage` | `arturia.scope` | Last scope used. |
| `localStorage` | `arturia.theme` | Theme preference. |

If storage is blocked, the scope and theme still work for the current page without being remembered.
