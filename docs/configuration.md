# Configuration

[Español](configuration.es.md)

The production build carries no environment values. Before bootstrapping, the app requests `/config.json` from its own origin with `cache: 'no-store'`, without credentials or redirects, and validates it. Each deployment publishes its own file next to the same build. The validation rules live in [`src/app/core/runtime-config.ts`](../src/app/core/runtime-config.ts).

## `/config.json`

```json
{
  "version": 1,
  "apiBaseUrl": "https://<rest-api-id>.execute-api.<region>.amazonaws.com/<stage>/",
  "cognito": {
    "domain": "https://<prefix>.auth.<region>.amazoncognito.com",
    "clientId": "<public app client ID>",
    "scopes": ["openid", "arturia/access"]
  },
  "redirectUri": "https://<web origin>/",
  "logoutUri": "https://<web origin>/"
}
```

- Only these fields are accepted and `version` must be `1`. Unknown fields, such as a client secret, make the file invalid. Every value is public.
- `apiBaseUrl` is an HTTPS base URL, stage path included, without credentials, query or fragment. Contract paths resolve under it.
- `cognito.domain` is an HTTPS origin without a path; the app derives `/oauth2/authorize`, `/oauth2/token` and `/logout` from it.
- `cognito.clientId` identifies a public app client without a secret. `cognito.scopes` lists unique scopes (at most 10) and must include `arturia/access`.
- `redirectUri` and `logoutUri` must equal the root URL of the page origin. Register the same values as the Cognito callback and sign-out URLs.
- The page itself must be served over HTTPS; on any other origin the configuration is rejected.

If the file is missing (403, 404 or the HTML fallback), invalid (including a content type other than `application/json`), unreachable or slower than 5 s, sign-in stays disabled with a visible error and the app sends no API or identity requests.

## Hosting requirements

Run `npm run build` and publish the contents of `dist/arturia/browser/` on an HTTPS static host. Route client-side paths such as `/chat` and `/settings` to `index.html`.

- Serve `/config.json` with `Cache-Control: no-store`, outside the SPA fallback and from the same origin as the app.
- Do not cache `index.html`; hashed scripts, styles and media can be cached as immutable.
- Use a CSP with `script-src 'self'` and `connect-src` allowing `'self'`, the API origin and the Cognito origin. See [Architecture](architecture.md#decisions) for the build constraints.
- The API must allow the web origin through CORS. To make an optional `Retry-After` response header readable by the browser, list it in `Access-Control-Expose-Headers`. If the header is unavailable, the client uses its local backoff.

## Local development

`npm start` serves the development build, which loads `/config.json` like production. Because the configuration is accepted only on an HTTPS origin, use `npm run start:fixtures` for local work without a deployment: the fixture configuration injects a synthetic session and conversation through a build-time file replacement and never requests the file.
