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
- `ADMIN_EMAIL` y `ADMIN_PASSWORD` solo sirven para crear el primer administrador (cuando no existe ninguno). Después, sus datos y su contraseña se cambian en **Mi cuenta** (menú del avatar) y los usuarios o administradores nuevos se añaden desde **Usuarios**.
- No hay recuperación de contraseña: conviene tener un segundo administrador por si uno pierde la suya.
- La app no envía emails: tras aprobar una solicitud, avisa tú a esa persona.
- Los datos del Excel están en inglés: el buscador traduce las búsquedas más comunes en español, francés e italiano (cacahuete / arachide / arachidi → peanut). Para añadir palabras, edita `search-terms.js`.
- Comparador (`/comparar`, zona de usuarios): dos productos lado a lado con «Solo diferencias»; las listas de nutrientes se alinean fila a fila (`compare.js`). Cada comparación se guarda en la tabla `comparisons` y el inicio del panel muestra «Lo más comparado».
- «Sobre los datos» (`/datos`, zona de usuarios): estado del directorio, qué significa cada etiqueta de la ficha y cómo sugerir un cambio.
- Idiomas: la web pública y la zona de usuarios están en español, inglés, francés e italiano; el panel de administración, solo en español. Los textos están en `locales/<idioma>.json` (si falta una clave, se usa la española). El idioma se elige con el selector de la cabecera o del pie y se recuerda en una cookie; la primera visita usa el idioma del navegador. Para añadir un idioma, copia `locales/es.json`, tradúcelo y añádelo a `LANGS` en `i18n.js`.
- Tipografías de la web pública (en `public/fonts/`): Roboto Condensed para titulares e Instrument Serif cursiva para el «inder» de RUTFinder. Se cambian con `--font-display` y `--font-serif` (y su `@font-face`) en `public/style.css`.
- Los mensajes del formulario de contacto de la portada llegan a **Admin → Mensajes**. Se contestan desde tu correo (botón «Responder») y se marcan como atendidos.
- El Excel no se guarda en el servidor ni en git (`private/` está en `.gitignore`).
- Al reimportar, los productos se emparejan por nombre: los que ya existen se actualizan con los datos del Excel y los demás no se tocan.
