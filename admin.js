const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const { pool, q, getFields, findProducts, listCountries, readFilters } = require('./db');

const SHEET = 'RUTF';
// El Excel se procesa en memoria: nunca se escribe en el disco del servidor.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single('archivo');

const clean = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim();

// Lee la hoja "RUTF": la fila 1 son los nombres de los campos y la primera columna, el nombre del producto.
async function parseExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet(SHEET);
  if (!sheet) throw new Error(`El archivo no tiene una hoja llamada "${SHEET}".`);

  const headers = {}; // número de columna -> nombre del campo
  sheet.getRow(1).eachCell((cell, col) => {
    const header = clean(cell.text);
    if (col > 1 && header && !Object.values(headers).includes(header)) headers[col] = header;
  });
  const fields = Object.values(headers);
  if (!fields.length) throw new Error(`La hoja "${SHEET}" no tiene cabeceras en la primera fila.`);

  const rows = [];
  let skipped = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = clean(row.getCell(1).text);
    const data = {};
    row.eachCell((cell, col) => {
      const value = clean(cell.text);
      if (headers[col] && value) data[headers[col]] = value; // las celdas vacías no se guardan: se verán como "Sin datos"
    });
    if (name) rows.push({ name, data });
    else if (Object.keys(data).length) skipped++;
  });
  if (!rows.length) throw new Error(`La hoja "${SHEET}" no contiene productos.`);
  return { fields, rows, skipped };
}

// Empareja cada fila del Excel con un producto existente del mismo nombre (por orden, si el nombre se repite).
async function matchExisting(rows, db) {
  const { rows: existing } = await db.query('SELECT id, name FROM products ORDER BY id');
  const idsByName = new Map();
  for (const p of existing) idsByName.set(p.name, [...(idsByName.get(p.name) || []), p.id]);
  return rows.map((row) => ({ ...row, id: (idsByName.get(row.name) || []).shift() ?? null }));
}

function readProductForm(body, fields, previousData = {}) {
  const name = clean(body.name);
  const data = { ...previousData };
  fields.forEach((field, i) => {
    const value = clean(body[`f${i}`]);
    if (value) data[field] = value;
    else delete data[field];
  });
  return { name, data };
}

// Valida nombre, email y organización. Devuelve el mensaje de error o null.
function personError({ name, email, organization }) {
  if (!name || name.length > 100) return 'Escribe un nombre (máximo 100 caracteres).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'Escribe un email válido.';
  if (!organization || organization.length > 150) return 'Escribe una organización (máximo 150 caracteres).';
  return null;
}
const readPerson = (body) => ({
  name: clean(body.name),
  email: clean(body.email).toLowerCase(),
  organization: clean(body.organization),
});
const passwordError = (password) => (password.length < 12 || password.length > 72 ? 'La contraseña debe tener entre 12 y 72 caracteres.' : null);

module.exports = ({ verifyCsrf, authLimiter }) => {
  const router = express.Router();
  const flash = (req, type, text) => { req.session.flash = { type, text }; };
  const notFound = (res) => res.status(404).render('mensaje', { title: 'Página no encontrada', text: 'La página que buscas no existe o no tienes acceso a ella.' });

  router.param('id', (req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : notFound(res)));

  // ----- Solicitudes de registro -----
  router.get('/', async (req, res) => {
    const { rows } = await q("SELECT id, name, email, organization, created_at FROM users WHERE status = 'pending' ORDER BY created_at");
    res.render('admin-solicitudes', { title: 'Solicitudes', requests: rows });
  });

  router.post('/usuarios/:id/aprobar', async (req, res) => {
    const { rowCount } = await q("UPDATE users SET status = 'approved' WHERE id = $1 AND status = 'pending'", [req.params.id]);
    flash(req, rowCount ? 'success' : 'error', rowCount ? 'Solicitud aprobada. Esa persona ya puede iniciar sesión.' : 'La solicitud ya no está pendiente.');
    res.redirect('/admin');
  });

  router.get('/usuarios/:id/rechazar', async (req, res) => {
    const user = (await q("SELECT id, name, email FROM users WHERE id = $1 AND status = 'pending'", [req.params.id])).rows[0];
    if (!user) return notFound(res);
    res.render('confirmar', {
      title: 'Rechazar solicitud',
      text: `¿Rechazar la solicitud de ${user.name} (${user.email})? No podrá iniciar sesión.`,
      action: `/admin/usuarios/${user.id}/rechazar`, confirmLabel: 'Rechazar solicitud', cancelHref: '/admin',
    });
  });

  router.post('/usuarios/:id/rechazar', async (req, res) => {
    const { rowCount } = await q("UPDATE users SET status = 'rejected' WHERE id = $1 AND status = 'pending'", [req.params.id]);
    flash(req, rowCount ? 'success' : 'error', rowCount ? 'Solicitud rechazada.' : 'La solicitud ya no está pendiente.');
    res.redirect('/admin');
  });

  // ----- Productos -----
  router.get('/productos', async (req, res) => {
    const filters = readFilters(req.query);
    const state = ['visible', 'hidden'].includes(req.query.estado) ? req.query.estado : 'all';
    res.render('admin-productos', {
      title: 'Productos', ...filters, state,
      products: await findProducts({ ...filters, state }),
      countries: await listCountries(true),
      pendingImport: (await q('SELECT 1 FROM import_drafts WHERE user_id = $1', [req.user.id])).rowCount > 0,
    });
  });

  // ----- Importar Excel (desde la vista de productos): subir -> vista previa -> confirmar -----
  // Van antes de /productos/:id para que "importar" no se tome por un id.
  router.get('/productos/importar', async (req, res) => {
    const draft = (await q('SELECT payload FROM import_drafts WHERE user_id = $1', [req.user.id])).rows[0];
    if (!draft) return res.redirect('/admin/productos');
    res.render('admin-importar', { title: 'Importar Excel', preview: { ...draft.payload, rows: await matchExisting(draft.payload.rows, pool) } });
  });

  router.post('/productos/importar',
    (req, res, next) => upload(req, res, (err) => {
      if (!err) return next();
      flash(req, 'error', err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño máximo (25 MB).' : 'No se pudo recibir el archivo.');
      res.redirect('/admin/productos');
    }),
    verifyCsrf,
    async (req, res) => {
      if (!req.file || !/\.xlsx$/i.test(req.file.originalname)) {
        flash(req, 'error', 'Selecciona un archivo Excel (.xlsx).');
        return res.redirect('/admin/productos');
      }
      let payload;
      try {
        payload = await parseExcel(req.file.buffer);
      } catch (err) {
        flash(req, 'error', /hoja/i.test(err.message) ? err.message : 'No se pudo leer el archivo. Comprueba que es un Excel (.xlsx) válido.');
        return res.redirect('/admin/productos');
      }
      await q(
        `INSERT INTO import_drafts (user_id, payload) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()`,
        [req.user.id, JSON.stringify(payload)]
      );
      res.redirect('/admin/productos/importar');
    });

  router.post('/productos/importar/cancelar', async (req, res) => {
    await q('DELETE FROM import_drafts WHERE user_id = $1', [req.user.id]);
    flash(req, 'success', 'Importación cancelada. No se ha guardado nada.');
    res.redirect('/admin/productos');
  });

  router.post('/productos/importar/confirmar', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const draft = (await client.query('DELETE FROM import_drafts WHERE user_id = $1 RETURNING payload', [req.user.id])).rows[0];
      if (!draft) {
        await client.query('ROLLBACK');
        flash(req, 'error', 'No hay ninguna importación pendiente. Sube el Excel de nuevo.');
        return res.redirect('/admin/productos');
      }
      const { fields, rows } = draft.payload;
      let created = 0;
      let updated = 0;
      for (const row of await matchExisting(rows, client)) {
        if (row.id) {
          await client.query('UPDATE products SET data = $1, updated_at = now() WHERE id = $2', [JSON.stringify(row.data), row.id]);
          updated++;
        } else {
          await client.query('INSERT INTO products (name, data) VALUES ($1, $2)', [row.name, JSON.stringify(row.data)]);
          created++;
        }
      }
      await client.query('DELETE FROM fields');
      await client.query('INSERT INTO fields (position, name) SELECT ordinality, name FROM unnest($1::text[]) WITH ORDINALITY AS t(name, ordinality)', [fields]);
      await client.query('COMMIT');
      flash(req, 'success', `Importación completada: ${created} productos nuevos y ${updated} actualizados.`);
      res.redirect('/admin/productos');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  const renderForm = async (res, product, error = null, status = 200) =>
    res.status(status).render('admin-producto-form', {
      title: product.id ? `Editar ${product.name}` : 'Nuevo producto',
      product, fields: await getFields(), error,
    });

  router.get('/productos/nuevo', (req, res) => renderForm(res, { id: null, name: '', data: {} }));

  router.post('/productos', async (req, res) => {
    const { name, data } = readProductForm(req.body, await getFields());
    if (!name || name.length > 300) return renderForm(res, { id: null, name, data }, 'El nombre es obligatorio (máximo 300 caracteres).', 400);
    const { rows } = await q('INSERT INTO products (name, data) VALUES ($1, $2) RETURNING id', [name, JSON.stringify(data)]);
    flash(req, 'success', `Producto «${name}» creado.`);
    res.redirect(`/productos/${rows[0].id}`);
  });

  router.get('/productos/:id/editar', async (req, res) => {
    const product = (await q('SELECT id, name, data FROM products WHERE id = $1', [req.params.id])).rows[0];
    if (!product) return notFound(res);
    renderForm(res, product);
  });

  router.post('/productos/:id', async (req, res) => {
    const previous = (await q('SELECT id, data FROM products WHERE id = $1', [req.params.id])).rows[0];
    if (!previous) return notFound(res);
    const { name, data } = readProductForm(req.body, await getFields(), previous.data);
    if (!name || name.length > 300) return renderForm(res, { id: previous.id, name, data }, 'El nombre es obligatorio (máximo 300 caracteres).', 400);
    await q('UPDATE products SET name = $1, data = $2, updated_at = now() WHERE id = $3', [name, JSON.stringify(data), previous.id]);
    flash(req, 'success', `Ficha de «${name}» guardada.`);
    res.redirect(`/productos/${previous.id}`);
  });

  router.get('/productos/:id/ocultar', async (req, res) => {
    const product = (await q('SELECT id, name FROM products WHERE id = $1 AND NOT hidden', [req.params.id])).rows[0];
    if (!product) return notFound(res);
    res.render('confirmar', {
      title: 'Ocultar producto',
      text: `¿Ocultar «${product.name}»? Dejará de verse en la tabla y en los favoritos de los usuarios. No se borra: puedes volver a mostrarlo cuando quieras.`,
      action: `/admin/productos/${product.id}/ocultar`, confirmLabel: 'Ocultar producto', cancelHref: '/admin/productos',
    });
  });

  const setHidden = (hidden) => async (req, res) => {
    const { rows } = await q('UPDATE products SET hidden = $1, updated_at = now() WHERE id = $2 RETURNING name', [hidden, req.params.id]);
    if (!rows[0]) return notFound(res);
    flash(req, 'success', hidden ? `«${rows[0].name}» está oculto.` : `«${rows[0].name}» vuelve a ser visible.`);
    res.redirect('/admin/productos');
  };
  router.post('/productos/:id/ocultar', setHidden(true));
  router.post('/productos/:id/mostrar', setHidden(false));

  // ----- Sugerencias de los usuarios -----
  router.get('/sugerencias', async (req, res) => {
    const { rows } = await q(
      `SELECT s.*, u.name AS user_name, u.organization AS user_org
         FROM suggestions s JOIN users u ON u.id = s.user_id
        WHERE NOT s.reviewed ORDER BY s.created_at`
    );
    res.render('admin-sugerencias', { title: 'Sugerencias', suggestions: rows });
  });

  router.post('/sugerencias/:id/revisada', async (req, res) => {
    const { rowCount } = await q('UPDATE suggestions SET reviewed = true WHERE id = $1 AND NOT reviewed', [req.params.id]);
    flash(req, rowCount ? 'success' : 'error', rowCount ? 'Sugerencia marcada como revisada.' : 'Esa sugerencia ya estaba revisada.');
    res.redirect('/admin/sugerencias');
  });

  // ----- Mi cuenta (menú de perfil) -----
  router.get('/cuenta', async (req, res) => {
    const profile = (await q('SELECT name, email, organization FROM users WHERE id = $1', [req.user.id])).rows[0];
    res.render('admin-cuenta', { title: 'Mi cuenta', profile });
  });

  router.post('/cuenta/perfil', async (req, res) => {
    const person = readPerson(req.body);
    let error = personError(person);
    if (!error && (await q('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [person.email, req.user.id])).rowCount) {
      error = 'Ya existe otro usuario con ese email.';
    }
    if (!error) await q('UPDATE users SET name = $1, email = $2, organization = $3 WHERE id = $4', [person.name, person.email, person.organization, req.user.id]);
    flash(req, error ? 'error' : 'success', error || 'Datos guardados.');
    res.redirect('/admin/cuenta');
  });

  router.post('/cuenta/password', authLimiter, async (req, res) => {
    const current = String(req.body.current || '');
    const next = String(req.body.password || '');
    const { password_hash: hash } = (await q('SELECT password_hash FROM users WHERE id = $1', [req.user.id])).rows[0];
    let error = null;
    if (!(await bcrypt.compare(current, hash))) error = 'La contraseña actual no es correcta.';
    else if (next !== String(req.body.repeat || '')) error = 'Las dos contraseñas nuevas no coinciden.';
    else error = passwordError(next);
    if (!error) {
      await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 12), req.user.id]);
      // Se cierran las demás sesiones abiertas de esta cuenta.
      await q("DELETE FROM session WHERE sess->>'userId' = $1 AND sid <> $2", [String(req.user.id), req.sessionID]);
    }
    flash(req, error ? 'error' : 'success', error || 'Contraseña cambiada. Se han cerrado tus otras sesiones.');
    res.redirect('/admin/cuenta');
  });

  // ----- Usuarios: ver los que tienen acceso y añadir nuevos -----
  // El formulario de nuevo usuario está plegado; se abre con ?nuevo=1 o si hay un error que corregir.
  const renderUsers = async (res, values = {}, error = null, status = 200, openForm = Boolean(error)) => {
    const { rows } = await q("SELECT id, name, email, organization, role FROM users WHERE status = 'approved' ORDER BY role, lower(name)");
    res.status(status).render('admin-usuarios', { title: 'Usuarios', users: rows, values, error, openForm });
  };

  router.get('/usuarios', (req, res) => renderUsers(res, {}, null, 200, req.query.nuevo === '1'));

  router.post('/usuarios', async (req, res) => {
    const person = readPerson(req.body);
    const role = req.body.role === 'admin' ? 'admin' : 'user';
    const password = String(req.body.password || '');
    const error = personError(person) || passwordError(password);
    if (error) return renderUsers(res, { ...person, role }, error, 400);
    const { rowCount } = await q(
      `INSERT INTO users (name, email, password_hash, organization, role, status)
       VALUES ($1, $2, $3, $4, $5, 'approved') ON CONFLICT (email) DO NOTHING`,
      [person.name, person.email, await bcrypt.hash(password, 12), person.organization, role]
    );
    if (!rowCount) return renderUsers(res, { ...person, role }, 'Ya existe un usuario o una solicitud con ese email.', 400);
    flash(req, 'success', `${role === 'admin' ? 'Administrador' : 'Usuario'} «${person.name}» añadido. Ya puede iniciar sesión.`);
    res.redirect('/admin/usuarios');
  });

  return router;
};
