# Configuración

[English](configuration.md)

El build de producción no contiene valores del ambiente. Antes de iniciar, la aplicación pide `/config.json` a su propio origen con `cache: 'no-store'`, sin credenciales ni redirecciones, y lo valida. Cada despliegue publica su propio archivo junto al mismo build. Las reglas de validación están en [`src/app/core/runtime-config.ts`](../src/app/core/runtime-config.ts).

## `/config.json`

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

- Solo se aceptan estos campos y `version` debe ser `1`. Un campo desconocido, como un secreto de cliente, invalida el archivo. Todos los valores son públicos.
- `apiBaseUrl` es una URL base HTTPS, con el path del stage, sin credenciales, query ni fragmento. Las rutas del contrato se resuelven debajo de ella.
- `cognito.domain` es un origen HTTPS sin path; la aplicación deriva `/oauth2/authorize`, `/oauth2/token` y `/logout` a partir de él.
- `cognito.clientId` identifica un cliente público sin secreto. `cognito.scopes` enumera scopes sin repetir (10 como máximo) y debe incluir `arturia/access`.
- `redirectUri` y `logoutUri` deben ser la URL raíz del origen de la página. Registrar los mismos valores como URL de callback y de cierre de sesión en Cognito.
- La página debe servirse por HTTPS; en cualquier otro origen la configuración se rechaza.

Si el archivo falta (403, 404 o fallback HTML), es inválido (incluido un tipo de contenido distinto de `application/json`), no responde o tarda más de 5 s, el inicio de sesión queda deshabilitado con un error visible y la aplicación no envía solicitudes a la API ni a la identidad.

## Requisitos del hosting

Ejecutá `npm run build` y publicá el contenido de `dist/arturia/browser/` en un hosting estático con HTTPS. Derivá las rutas del cliente, como `/chat` y `/settings`, a `index.html`.

- Servir `/config.json` con `Cache-Control: no-store`, fuera del fallback de la SPA y desde el mismo origen que la aplicación.
- No cachear `index.html`; los scripts, estilos y archivos de medios con hash admiten caché inmutable.
- Usar una CSP con `script-src 'self'` y `connect-src` que permita `'self'`, el origen de la API y el de Cognito. Ver [Arquitectura](architecture.es.md#decisiones) para las restricciones del build.
- La API debe permitir el origen web mediante CORS. Para que el navegador pueda leer el encabezado de respuesta opcional `Retry-After`, incluilo en `Access-Control-Expose-Headers`. Si el encabezado no está disponible, el cliente usa su espera progresiva local.

## Desarrollo local

`npm start` sirve el build de desarrollo, que carga `/config.json` igual que producción. Como la configuración solo se acepta en un origen HTTPS, para trabajar en local sin un despliegue usar `npm run start:fixtures`: la configuración de fixtures inyecta una sesión y una conversación sintéticas mediante un reemplazo de archivo en la compilación y nunca pide el archivo.
