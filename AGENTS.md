# Arturia

Frontend Angular standalone, TypeScript estricto y señales. Leer también el AGENTS.md y el README administrativos del workspace en los directorios padre cuando estén disponibles.

- Usar OnPush, control de flujo moderno y entradas/salidas readonly. Mantener la lógica fuera de las plantillas.
- Usar la copia versionada en `src/app/core/api/contract/` como fuente de tipos. Regenerar con `npm run contract:generate` después de sincronizar el contrato y el digest del API. Evitar editar los tipos generados a mano.
- Reservar los fixtures sintéticos para la configuración de pruebas. Mantener su punto de entrada en `src/app/testing/`.
- Validar con `npm ci` y `npm run verify`. La referencia técnica se mantiene en README.md y README.es.md.

## Flujo Git

- `dev` es la rama predeterminada y la base de todo desarrollo. Crear desde `dev` únicamente ramas `feat/<tema>` o `fix/<tema>` y devolverlas mediante PR a `dev`.
- Para publicar una versión, crear `release/x.x.x` desde `dev` y abrir PR hacia `main`.
- Fuera de `dev` y `main`, solo se permiten los prefijos `feat/`, `fix/` y `release/`. Verificar el nombre antes de crear una rama. No usar `codex/`.
- `dev` y `main` requieren PR, CI y el control `branch-policy` aprobados, conversaciones resueltas y merge commit. No hacer push directo, force-push ni borrar estas ramas.
- Escribir títulos semánticos en español para commits y PR, y describir el alcance y la validación en el cuerpo del PR.
- Commit, push, merge, release y despliegue requieren autorización del pedido vigente.
- Tras un merge autorizado, eliminar la rama remota integrada una vez comprobado que no queden cambios ni integraciones pendientes. Conservar las ramas destino, los tags y las ramas locales.
