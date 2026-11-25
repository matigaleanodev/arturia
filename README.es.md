# Arturia

[![Validate](https://github.com/matigaleanodev/arturia/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/matigaleanodev/arturia/actions/workflows/ci.yml)
[![Angular 22](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)](https://angular.dev/overview)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/en/download)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/)
[![MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue)](LICENSE)

[English](README.md)

Arturia es un asistente personal autoalojado y de código abierto que podés usar como base para crear el tuyo. Este repositorio contiene el cliente web en Angular. La interfaz está en español.

## Características

- Inicio y cierre de sesión mediante Amazon Cognito.
- Chat en los ámbitos Personal y Laboral, cada uno con su historial. El navegador recuerda el último ámbito.
- Respuestas en streaming mediante Server-Sent Events, con reanudación, respaldo por snapshot y cancelación.
- Renderizado seguro de un subconjunto de Markdown en las respuestas.
- Temas claro, oscuro y del sistema.
- Configuración en tiempo de ejecución mediante `/config.json` para reutilizar el mismo build en cada despliegue.
- Modo fixtures con una conversación sintética que no necesita backend.

## Stack tecnológico

Angular 22 (componentes standalone, señales, router), TypeScript 6 en modo estricto, Tailwind CSS 4, Vitest, Playwright con axe-core y tipos TypeScript generados a partir de los esquemas OpenAPI y SSE.

## Primeros pasos

Usá la versión de Node.js indicada en [`.nvmrc`](.nvmrc) y npm 11.19.1. Iniciá una sesión local con datos sintéticos.

```sh
nvm use
npm ci
npm run start:fixtures
```

Abrí `http://localhost:4200`. La sesión de prueba funciona sin una API ni una cuenta de Cognito.

Para conectar tu propia API, serví la aplicación mediante HTTPS y publicá `/config.json` como indica [Configuración](docs/configuration.es.md). Ejecutá las comprobaciones de [Pruebas](docs/testing.es.md) antes de abrir un pull request.

## Documentación

- [Arquitectura](docs/architecture.es.md)
- [Configuración](docs/configuration.es.md)
- [Contrato de API](docs/api-contract.es.md)
- [Pruebas](docs/testing.es.md)

## Repositorio complementario

- [Arturia API](https://github.com/matigaleanodev/arturia-api)

## Autoría y licencia

Mantenido por [Matías Galeano](https://github.com/matigaleanodev). Distribuido bajo la [Mozilla Public License 2.0 (MPL-2.0)](LICENSE). Consultá [NOTICE](NOTICE) para ver el aviso de copyright y las atribuciones.
