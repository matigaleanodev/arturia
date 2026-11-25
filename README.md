# Arturia

[![Validate](https://github.com/matigaleanodev/arturia/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/matigaleanodev/arturia/actions/workflows/ci.yml)
[![Angular 22](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)](https://angular.dev/overview)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/en/download)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/)
[![MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue)](LICENSE)

[Español](README.es.md)

Arturia is an open-source, self-hosted personal assistant you can use as a base for your own. This repository contains the Angular web client. Its interface is in Spanish.

## Features

- Sign-in and sign-out through Amazon Cognito.
- Personal and Work chat scopes with separate conversation histories. The browser remembers the last scope.
- Streamed replies over Server-Sent Events, with resumption, snapshot fallback and cancellation.
- Safe rendering of a Markdown subset in replies.
- Light, dark and system themes.
- Runtime configuration through `/config.json` so a single build serves every deployment.
- Fixture mode with a synthetic conversation that needs no backend.

## Tech stack

Angular 22 (standalone components, signals, router), TypeScript 6 in strict mode, Tailwind CSS 4, Vitest, Playwright with axe-core, and TypeScript types generated from the OpenAPI and SSE schemas.

## Getting started

Use the Node.js version in [`.nvmrc`](.nvmrc) and npm 11.19.1. Start a local session with synthetic data.

```sh
nvm use
npm ci
npm run start:fixtures
```

Open `http://localhost:4200`. The fixture session runs without an API or a Cognito account.

To connect to your own API, serve the app over HTTPS and publish `/config.json` as described in [Configuration](docs/configuration.md). Run the checks in [Testing](docs/testing.md) before opening a pull request.

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [API contract](docs/api-contract.md)
- [Testing](docs/testing.md)

## Companion repository

- [Arturia API](https://github.com/matigaleanodev/arturia-api)

## Author and license

Maintained by [Matías Galeano](https://github.com/matigaleanodev). Licensed under the [Mozilla Public License 2.0 (MPL-2.0)](LICENSE). See [NOTICE](NOTICE) for copyright and attribution.
