# Rutfinder

Repositorio de alimentos terapéuticos listos para usar (RUTF). Una sola aplicación Node.js (Express + EJS) con PostgreSQL.

## Arrancar en local

Requisitos: Node.js 18 o superior y PostgreSQL.

```bash
createdb rutfinder_mvp
cp .env.example .env      # rellena SESSION_SECRET, ADMIN_EMAIL y ADMIN_PASSWORD
npm install
npm start                 # http://localhost:3000
```

Las tablas se crean solas al arrancar. Entra con `ADMIN_EMAIL` / `ADMIN_PASSWORD`, ve a
**Admin → Importar Excel** y sube `private/RUTF.xlsx` (hoja `RUTF`).

## Desplegar en Render

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y elige el repositorio. Render lee `render.yaml` y crea la web y la base de datos.
3. Render pide `ADMIN_EMAIL` y `ADMIN_PASSWORD` (12 caracteres como mínimo). `SESSION_SECRET` y `DATABASE_URL` se rellenan solos.
4. Cuando termine el despliegue, inicia sesión como admin y sube el Excel desde **Admin → Importar Excel**.

## Cosas que conviene saber

- El panel de administración está en `/admin`. No se enlaza desde la web pública y responde 404 a quien no sea administrador.
- `ADMIN_EMAIL` y `ADMIN_PASSWORD` solo sirven para crear el primer administrador (cuando no existe ninguno). Después, sus datos y su contraseña se cambian desde el menú de perfil del panel, donde también se añaden más usuarios o administradores.
- No hay recuperación de contraseña: conviene tener un segundo administrador por si uno pierde la suya.
- La app no envía emails: tras aprobar una solicitud, avisa tú a esa persona.
- El Excel no se guarda en el servidor ni en git (`private/` está en `.gitignore`).
- Al reimportar, los productos se emparejan por nombre: los que ya existen se actualizan con los datos del Excel y los demás no se tocan.
