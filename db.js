const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);

// Los campos de la ficha (columnas del Excel) se guardan tal cual en products.data.
// La tabla fields guarda el orden y el nombre de esas columnas.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  organization  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'    CHECK (role IN ('user', 'admin')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  hidden     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fields (
  position INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS import_drafts (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Administrador: se crea con las variables de entorno al arrancar si no existe.
// La contraseña de ADMIN_PASSWORD siempre se sincroniza (si está definida y es válida).
async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    if (!(await q("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")).rowCount) {
      console.warn('AVISO: ADMIN_EMAIL / ADMIN_PASSWORD no definidos; no se crea ningún administrador.');
    }
    return;
  }
  if (password.length < 12 || password.length > 72) {
    console.warn('AVISO: ADMIN_PASSWORD debe tener entre 12 y 72 caracteres; no se sincroniza la contraseña del admin.');
    return;
  }
  await q(
    `INSERT INTO users (name, email, password_hash, organization, role, status)
     VALUES ('Administrador', $1, $2, 'Rutfinder', 'admin', 'approved')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', status = 'approved'`,
    [email, await bcrypt.hash(password, 12)]
  );
}

async function init() {
  await q(SCHEMA);
  await ensureAdmin();
}

const getFields = async () => (await q('SELECT name FROM fields ORDER BY position')).rows.map((r) => r.name);

// Columnas del Excel que se usan en las tablas de productos y en el filtro por país.
const COL = { producer: 'Producer', type: 'Type of production', location: 'Production location' };
const COUNTRY_ROWS = `unnest(string_to_array(p.data->>'${COL.location}', E'\\n'))`;

// state: 'visible' | 'hidden' | 'all'. userId solo se usa para marcar los favoritos de ese usuario.
async function findProducts({ search = '', country = '', state = 'visible', userId = 0, onlyFavorites = false }) {
  const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await q(
    `SELECT p.id, p.name, p.hidden, p.updated_at, p.data->>'${COL.producer}' AS producer, p.data->>'${COL.type}' AS type,
            p.data->>'${COL.location}' AS location, (f.user_id IS NOT NULL) AS favorite
       FROM products p
       LEFT JOIN favorites f ON f.product_id = p.id AND f.user_id = $1
      WHERE ($2 = '' OR p.name ILIKE $3 OR EXISTS (SELECT 1 FROM jsonb_each_text(p.data) e WHERE e.value ILIKE $3))
        AND ($4 = '' OR EXISTS (SELECT 1 FROM ${COUNTRY_ROWS} c WHERE trim(c) = $4))
        AND ($5 = 'all' OR p.hidden = ($5 = 'hidden'))
        AND ($6 = false OR f.user_id IS NOT NULL)
      ORDER BY lower(p.name), p.id`,
    [userId, search, like, country, state, onlyFavorites]
  );
  return rows;
}

async function listCountries(includeHidden = false) {
  const { rows } = await q(
    `SELECT DISTINCT trim(c) AS name FROM products p, ${COUNTRY_ROWS} c WHERE ($1 OR NOT p.hidden) AND trim(c) <> '' ORDER BY 1`,
    [includeHidden]
  );
  return rows.map((r) => r.name);
}

// Lee los filtros de la URL (?q=&pais=).
const readFilters = (query) => ({
  search: String(query.q || '').trim().slice(0, 100),
  country: String(query.pais || '').trim().slice(0, 100),
});

module.exports = { pool, q, init, getFields, findProducts, listCountries, readFilters };
