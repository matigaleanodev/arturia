# Arturia

[![Angular 22](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)](https://angular.dev/overview)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/en/download)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/)
[![MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue)](LICENSE)

[Español](README.es.md)

Angular web client for Arturia, a personal assistant backed by [Arturia API](https://github.com/matigaleanodev/arturia-api). The application uses standalone components, signal inputs, and the Angular router.

## Development

Use the Node version in `.nvmrc` and npm 11.19.1.

```sh
nvm use
npm ci
npm start
```

Run `npm run start:fixtures` to serve the app with a synthetic conversation example. Angular selects the fixture module through a build-time file replacement. The synthetic session and conversation history run on loopback without a remote API.

## Application configuration

The production build carries no environment values. Before bootstrapping, the app requests `/config.json` from its own origin with `cache: 'no-store'`, without credentials or redirects, and validates it. The same build can be published with a different file per deployment.

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

- Only these fields are accepted; unknown fields such as a client secret make the file invalid. Every value is public.
- `apiBaseUrl` is an HTTPS base URL, stage path included, without credentials, query or fragment. Requests resolve contract paths under it.
- `cognito.domain` is an HTTPS origin without a path; the app derives `/oauth2/authorize`, `/oauth2/token` and `/logout` from it. `clientId` is a public client without a secret, and `scopes` must include `arturia/access`.
- `redirectUri` and `logoutUri` must equal the root URL of the page origin, which must be HTTPS. The same values are registered as the Cognito callback and sign-out URLs.
- A missing (403, 404 or HTML fallback), invalid (including a type other than `application/json`) or unreachable file, or one that takes longer than 5 s, leaves sign-in disabled with a visible error and no API or identity requests.

Hosting serves `/config.json` with `Cache-Control: no-store`, outside the SPA fallback, and as same-origin content (`connect-src 'self'`). `index.html` is not cached; hashed bundles can be cached immutably. The fixture and integrated configurations inject their providers through a build-time file replacement and never request the file. The build fails if it contains a `config.json` or origins other than the framework's own.

## API contract

The [local snapshot](src/app/core/api/contract/) comes from the [Arturia API contracts directory](https://github.com/matigaleanodev/arturia-api/tree/dev/contracts). It includes OpenAPI, the SSE payload schema, the synthetic chat fixture, and the source digest in `sha256.txt`.

To synchronize, copy the three source files byte for byte, record the digest from the API root, and run `npm run contract:generate` in the web checkout. Commit the snapshot, digest, and generated TypeScript together.

```sh
sha256sum contracts/openapi.json contracts/sse.schema.json contracts/fixtures/chat.json | sha256sum
```

## Verification

```sh
npm exec -- playwright install chromium
npm run verify
```

`verify` checks the snapshot digest and generated types, runs Vitest, builds for production, and runs Playwright with the fixture configuration. Run `npm test` or `npm run test:e2e` to select a suite.

## License

Arturia is maintained by [Matías Galeano](https://github.com/matigaleanodev) and distributed under [MPL-2.0](LICENSE). See [NOTICE](NOTICE) for the source notice and attribution.
