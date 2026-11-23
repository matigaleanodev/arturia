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

Run `npm run start:fixtures` to serve the app with a synthetic conversation example. Angular selects the fixture module through a build-time file replacement.

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
