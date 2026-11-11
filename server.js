require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { pool, q, init, getFields, findProducts, listCountries, readFilters } = require('./db');

const PROD = process.env.NODE_ENV === 'production';
if (!process.env.DATABASE_URL || (process.env.SESSION_SECRET || '').length < 32) {
  console.error('Faltan variables de entorno: DATABASE_URL y SESSION_SECRET (mínimo 32 caracteres). Mira .env.example.');
  process.exit(1);
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Render sirve la app detrás de un proxy HTTPS
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: { directives: { upgradeInsecureRequests: PROD ? [] : null } },
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  name: 'rutfinder.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ---------- Utilidades de vistas ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Escapa el texto y convierte las URLs http(s) en enlaces.
app.locals.linkify = (text) => String(text)
  .split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:)\]])/g)
  .map((part, i) => (i % 2 ? `<a href="${esc(part)}" target="_blank" rel="noopener noreferrer nofollow">${esc(part)}</a>` : esc(part)))
  .join('');
app.locals.countries_text = (value) => (value || '').split('\n').map((s) => s.trim()).filter(Boolean).join(', ') || 'Sin datos';
app.locals.fecha = (d) => new Date(d).toLocaleDateString('es-ES');

const message = (res, status, title, text) => res.status(status).render('mensaje', { title, text });
const notFound = (res) => message(res, 404, 'Página no encontrada', 'La página que buscas no existe o no tienes acceso a ella.');

// ---------- Usuario actual, mensajes flash y CSRF ----------
app.use(async (req, res, next) => {
  req.user = res.locals.user = null;
  if (req.session.userId) {
    // Se comprueba en cada petición: si se retira el acceso, la sesión deja de valer.
    const { rows } = await q('SELECT id, name, email, role, status FROM users WHERE id = $1', [req.session.userId]);
    if (rows[0] && rows[0].status === 'approved') req.user = res.locals.user = rows[0];
    else delete req.session.userId;
  }
  if (req.user && req.user.role === 'admin') {
    // Contadores de la barra lateral del panel.
    res.locals.counts = (await q("SELECT (SELECT count(*)::int FROM users WHERE status = 'pending') AS pending, (SELECT count(*)::int FROM products) AS products")).rows[0];
  }
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.path = req.path;
  res.locals.csrf = () => (req.session.csrf ||= crypto.randomBytes(32).toString('hex'));
  next();
});

function verifyCsrf(req, res, next) {
  const sent = Buffer.from(String((req.body && req.body._csrf) || ''));
  const real = Buffer.from(req.session.csrf || '');
  if (real.length && sent.length === real.length && crypto.timingSafeEqual(sent, real)) return next();
  message(res, 403, 'Formulario caducado', 'El formulario ha caducado. Vuelve atrás, recarga la página e inténtalo de nuevo.');
}
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  // La subida del Excel es multipart: su token se verifica en admin.js, después de leer el formulario.
  if (req.method === 'POST' && req.path === '/admin/productos/importar') return next();
  verifyCsrf(req, res, next);
});

const isAdmin = (req) => Boolean(req.user && req.user.role === 'admin');
const homeOf = (user) => (user.role === 'admin' ? '/admin' : '/productos');
const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));
// La tabla de usuario y los favoritos no son para el admin: él trabaja desde su panel.
const requireMember = (req, res, next) => (!req.user ? res.redirect('/login') : isAdmin(req) ? res.redirect('/admin/productos') : next());
const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : notFound(res));
app.param('id', (req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : notFound(res)));

// ---------- Páginas públicas, registro y sesión ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => message(res, 429, 'Demasiados intentos', 'Has hecho demasiados intentos. Espera unos minutos y vuelve a probar.'),
});
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
const PENDING = ['Solicitud pendiente de aprobación', 'Hemos recibido tu solicitud. Podrás iniciar sesión cuando un administrador la apruebe.'];

app.get('/', (req, res) => (req.user ? res.redirect(homeOf(req.user)) : res.render('home', { title: 'Inicio' })));

app.get('/registro', (req, res) => (req.user ? res.redirect(homeOf(req.user)) : res.render('registro', { title: 'Solicitar acceso', error: null, values: {} })));

app.post('/registro', authLimiter, async (req, res) => {
  const values = {
    name: String(req.body.name || '').trim(),
    email: String(req.body.email || '').trim().toLowerCase(),
    organization: String(req.body.organization || '').trim(),
  };
  const password = String(req.body.password || '');
  let error = null;
  if (!values.name || values.name.length > 100) error = 'Escribe tu nombre (máximo 100 caracteres).';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) || values.email.length > 254) error = 'Escribe un email válido.';
  else if (!values.organization || values.organization.length > 150) error = 'Escribe tu organización (máximo 150 caracteres).';
  else if (password.length < 8 || password.length > 72) error = 'La contraseña debe tener entre 8 y 72 caracteres.';
  if (error) return res.status(400).render('registro', { title: 'Solicitar acceso', error, values });

  // Si el email ya existe no se cambia nada y se muestra el mismo mensaje (no se revela qué emails están registrados).
  await q(
    'INSERT INTO users (name, email, password_hash, organization) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
    [values.name, values.email, await bcrypt.hash(password, 12), values.organization]
  );
  message(res, 200, ...PENDING);
});

app.get('/login', (req, res) => (req.user ? res.redirect(homeOf(req.user)) : res.render('login', { title: 'Iniciar sesión', error: null, email: '' })));

app.post('/login', authLimiter, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = (await q('SELECT id, password_hash, role, status FROM users WHERE email = $1', [email])).rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).render('login', { title: 'Iniciar sesión', error: 'Email o contraseña incorrectos.', email });
  if (user.status === 'pending') return message(res, 403, ...PENDING);
  if (user.status === 'rejected') return message(res, 403, 'Solicitud no aprobada', 'Tu solicitud de acceso no ha sido aprobada.');
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    res.redirect(homeOf(user));
  });
});

app.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('rutfinder.sid');
    res.redirect('/');
  });
});

// ---------- Productos y favoritos (usuarios aprobados) ----------
async function listProducts(req, res, onlyFavorites) {
  const filters = readFilters(req.query);
  res.render('productos', {
    title: onlyFavorites ? 'Mis favoritos' : 'Productos',
    onlyFavorites, ...filters,
    products: await findProducts({ ...filters, userId: req.user.id, onlyFavorites }),
    countries: await listCountries(),
    here: req.originalUrl,
  });
}

app.get('/productos', requireMember, (req, res) => listProducts(req, res, false));
app.get('/favoritos', requireMember, (req, res) => listProducts(req, res, true));

app.get('/productos/:id', requireUser, async (req, res) => {
  const product = (await q(
    `SELECT p.*, EXISTS (SELECT 1 FROM favorites f WHERE f.product_id = p.id AND f.user_id = $2) AS favorite
       FROM products p WHERE p.id = $1 AND (NOT p.hidden OR $3)`,
    [req.params.id, req.user.id, isAdmin(req)]
  )).rows[0];
  if (!product) return notFound(res);
  res.render('producto', { title: product.name, product, fields: await getFields(), here: req.originalUrl });
});

app.post('/favoritos/:id', requireMember, async (req, res) => {
  const removed = await q('DELETE FROM favorites WHERE user_id = $1 AND product_id = $2', [req.user.id, req.params.id]);
  if (removed.rowCount) {
    req.session.flash = { type: 'success', text: 'Producto eliminado de tus favoritos.' };
  } else {
    const added = await q(
      'INSERT INTO favorites (user_id, product_id) SELECT $1, id FROM products WHERE id = $2 AND NOT hidden',
      [req.user.id, req.params.id]
    );
    req.session.flash = added.rowCount
      ? { type: 'success', text: 'Producto guardado en tus favoritos.' }
      : { type: 'error', text: 'Ese producto ya no está disponible.' };
  }
  // Solo se vuelve a rutas internas.
  const back = String(req.body.volver || '');
  res.redirect(/^\/(?![/\\])/.test(back) ? back : '/productos');
});

// ---------- Panel de administración (responde 404 a quien no sea admin) ----------
app.use('/admin', requireAdmin, require('./admin')({ verifyCsrf, authLimiter }));

// ---------- 404 y errores ----------
app.use((req, res) => notFound(res));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  message(res, 500, 'Algo ha fallado', 'Ha ocurrido un error inesperado. Inténtalo de nuevo en unos minutos.');
});

const port = process.env.PORT || 3000;
init()
  .then(() => app.listen(port, () => console.log(`Rutfinder escuchando en el puerto ${port}`)))
  .catch((err) => {
    console.error('No se pudo iniciar la base de datos:', err.message);
    process.exit(1);
  });
