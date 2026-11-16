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
const { groupFields, badges, BADGE_KINDS, typeLabel, firstUrl, kvRows, readEstimated } = require('./fields');
const { compareProducts } = require('./compare');
const { FEATURES, countryStats } = require('./world');
const { LANGS, DEFAULT, COOKIE, T, pickLang } = require('./i18n');

const PROD = process.env.NODE_ENV === 'production';
// URL pública de la web (para canonical, Open Graph y sitemap). Si no se define, se usa la de la petición.
const siteUrl = (req) => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
// Datos del titular para el aviso legal y la política de privacidad (variables LEGAL_* en .env / Render).
const LEGAL = {
  name: process.env.LEGAL_NAME || '',
  id: process.env.LEGAL_ID || '',
  address: process.env.LEGAL_ADDRESS || '',
  email: process.env.LEGAL_EMAIL || '',
};
const LEGAL_UPDATED = '2026-11-15'; // cámbialo cuando cambie el texto de las páginas legales
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

// ---------- Idioma (va antes que todo lo demás: hasta las páginas de error salen traducidas) ----------
const setLang = (req, res, lang) => {
  const t = T[lang];
  req.lang = res.locals.lang = lang;
  req.t = res.locals.t = t;
  res.locals.typeLabel = (value) => typeLabel(value, t);
  res.locals.countries_text = (value) => (value || '').split('\n').map((s) => s.trim()).filter(Boolean).join(', ') || t('noData');
  res.locals.num = (n) => n.toLocaleString(LANGS[lang].locale);
  res.locals.longDate = (d) => new Date(d).toLocaleDateString(LANGS[lang].locale, { day: 'numeric', month: 'long', year: 'numeric' });
};
app.use((req, res, next) => {
  setLang(req, res, pickLang(req));
  res.locals.langs = LANGS;
  // Enlace del selector: cambia el idioma y vuelve a esta misma página.
  const back = req.method === 'GET' ? req.originalUrl : ({ '/contacto': '/#contacto' }[req.path] || req.path);
  res.locals.langHref = (code) => `/idioma/${code}?volver=${encodeURIComponent(back)}`;
  res.locals.esc = esc;
  res.locals.year = new Date().getFullYear();
  res.locals.siteUrl = siteUrl(req);
  next();
});

// ---------- SEO: páginas indexables, robots.txt y sitemap.xml ----------
// Solo se indexa la web pública. Lo demás (zona de usuarios, panel, login, búsquedas) lleva noindex en head.ejs.
app.locals.SEO_PATHS = ['/', '/sobre', '/registro', '/privacidad', '/aviso-legal'];
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /buscar\nDisallow: /idioma/\nAllow: /\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const urls = app.locals.SEO_PATHS.map((p) => `  <url><loc>${esc(siteUrl(req) + p)}</loc></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});
app.get('/idioma/:code', (req, res) => {
  if (LANGS[req.params.code]) {
    res.cookie(COOKIE, req.params.code, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax', secure: PROD, httpOnly: true });
  }
  const back = String(req.query.volver || '');
  res.redirect(/^\/(?![/\\])/.test(back) ? back : '/');
});

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
// «hace 5 minutos», «ayer»…
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const UNITS = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
app.locals.hace = (d) => {
  const s = (new Date(d) - Date.now()) / 1000;
  const [unit, n] = UNITS.find(([, n]) => Math.abs(s) >= n) || [];
  return unit ? rtf.format(Math.round(s / n), unit) : 'ahora mismo';
};
app.locals.typeLabel = typeLabel;
app.locals.kvRows = kvRows;
app.locals.readEstimated = readEstimated;
// Iconos de trazo (heredan el color del texto).
const ICONS = {
  back: 'M19 12H5M11 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  down: 'M6 9l6 6 6-6',
  up: 'M12 19V5M6 11l6-6 6 6',
  plus: 'M12 5v14M5 12h14',
  bell: 'M6 16v-5a6 6 0 1112 0v5l1.5 2h-15zM10 20.5a2 2 0 004 0',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  feed: 'M4 5h11v14H5a1 1 0 01-1-1zM15 9h4a1 1 0 011 1v8a1 1 0 01-1 1h-4M7 9h5M7 12h5M7 15h3',
  eye: 'M2.5 12c1-2 4.5-6 9.5-6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6zM12 15a3 3 0 100-6 3 3 0 000 6z',
  lock: 'M7 11h10a1 1 0 011 1v7a1 1 0 01-1 1H7a1 1 0 01-1-1v-7a1 1 0 011-1zM8.5 11V8a3.5 3.5 0 017 0v3',
  hidden: 'M3 3l18 18M10.6 6.1c.5-.1.9-.1 1.4-.1 5 0 8.5 4 9.5 6-.5 1-1.6 2.6-3.2 3.9M6.6 6.6C4.6 7.9 3.2 10 2.5 12c1 2 4.5 6 9.5 6 1.6 0 3.1-.4 4.4-1.1M9.9 9.9a3 3 0 004.2 4.2',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  leaf: 'M5 19C5 11 11 5 20 5c0 9-6 15-14 15M5 19l7-7',
  swap: 'M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list: 'M4 6h16M4 12h16M4 18h16',
  // Menú del panel
  home: 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5 5h14l2 8v6H3v-6z',
  users: 'M9 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.8a3.5 3.5 0 010 6.4M18 14.8c2 .7 3.5 2.4 3.5 5.2',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0012 3z',
  // Grupos de la ficha (índice lateral)
  general: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
  nutrition: 'M12 21c-4.5 0-7-3.5-7-7.5C5 9 8 6 12 6s7 3 7 7.5c0 4-2.5 7.5-7 7.5zM12 6c0-2 1-3 3-3.5',
  production: 'M3 21V10l5 3V10l5 3V10l5 3V5h3v16zM7 17h2M12 17h2M17 17h2',
  impact: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3S9 10.5 12 11s4.5 1.8 4.5 3.5-2 3-4.5 3-4.5-1.3-4.5-3',
  evidence: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z',
  other: 'M4 6h16M4 12h16M4 18h10',
};
app.locals.icon = (name) => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${ICONS[name]}"/></svg>`;

// Páginas de aviso: key es el prefijo de sus textos en locales/*.json (msg.<key>Title y msg.<key>Text).
const message = (res, status, key) => {
  const t = res.locals.t || T[DEFAULT];
  res.status(status).render('mensaje', { title: t(`msg.${key}Title`), text: t(`msg.${key}Text`) });
};
const notFound = (res) => message(res, 404, 'notFound');

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
    setLang(req, res, 'es'); // el panel de administración solo está en español
    // Avisos del menú del panel: lo que está esperando a un administrador.
    res.locals.counts = (await q("SELECT (SELECT count(*)::int FROM users WHERE status = 'pending') AS pending, (SELECT count(*)::int FROM suggestions WHERE NOT reviewed) AS suggestions, (SELECT count(*)::int FROM messages WHERE NOT answered) AS messages")).rows[0];
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
  message(res, 403, 'csrf');
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
const limiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => message(res, 429, 'tooMany'),
});
const authLimiter = limiter();
const suggestLimiter = limiter();
const contactLimiter = limiter();
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

const renderHome = (res, contact = {}) => res.render('home', { title: res.locals.t('home.title'), contact: { values: {}, error: null, sent: false, ...contact } });

app.get('/', (req, res) => {
  if (req.user) return res.redirect(homeOf(req.user));
  const sent = Boolean(req.session.contactSent);
  delete req.session.contactSent;
  renderHome(res, { sent });
});

// Formulario de contacto de la portada: lo lee un administrador en /admin/mensajes.
app.post('/contacto', contactLimiter, async (req, res) => {
  const text = (field, max) => String(req.body[field] || '').replace(/\r\n?/g, '\n').trim().slice(0, max);
  const values = { name: text('name', 100), email: text('email', 254).toLowerCase(), message: text('message', 4000) };
  // Campo trampa: invisible para personas; si llega relleno es un bot y se descarta sin avisar.
  if (!text('web', 200)) {
    let error = null;
    if (!values.name) error = req.t('errors.name');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) error = req.t('errors.email');
    else if (!values.message) error = req.t('errors.message');
    if (error) return renderHome(res.status(400), { values, error });
    await q('INSERT INTO messages (name, email, message) VALUES ($1, $2, $3)', [values.name, values.email, values.message]);
  }
  req.session.contactSent = true;
  res.redirect('/#contacto');
});

app.get('/sobre', async (req, res) => {
  const products = (await q('SELECT count(*)::int AS n FROM products WHERE NOT hidden')).rows[0].n;
  res.render('sobre', { title: req.t('about.title'), description: req.t('meta.about'), products, countries: (await listCountries()).length });
});

// Política de privacidad y aviso legal: textos en locales/*.json (legalPages.*), datos del titular en LEGAL.
for (const [route, key] of [['/privacidad', 'privacy'], ['/aviso-legal', 'legal']]) {
  app.get(route, (req, res) => res.render('legal', {
    title: req.t(`legalPages.${key}.title`), description: req.t(`legalPages.${key}.description`),
    page: req.t(`legalPages.${key}`), owner: LEGAL, updated: LEGAL_UPDATED,
  }));
}

// Solicitar acceso. Si viene de buscar en la portada, dice cuántos productos coinciden (solo el número).
const readSearch = (value) => String(value || '').trim().slice(0, 100);
const renderRegistro = async (res, { error = null, values = {}, search = '' } = {}) => res.render('registro', {
  title: res.locals.t('signup.title'), description: res.locals.t('meta.signup'), error, values, search,
  count: search ? (await findProducts({ search })).length : null,
});

app.get('/registro', (req, res) => (req.user ? res.redirect(homeOf(req.user)) : renderRegistro(res)));

// Buscador de la portada: quien tiene acceso va al catálogo; quien no, a solicitar acceso.
app.get('/buscar', (req, res) => {
  const search = readSearch(req.query.q);
  if (!search) return res.redirect('/');
  if (req.user) return res.redirect(`${isAdmin(req) ? '/admin/productos' : '/productos'}?q=${encodeURIComponent(search)}`);
  renderRegistro(res, { search });
});

app.post('/registro', authLimiter, async (req, res) => {
  const values = {
    name: String(req.body.name || '').trim(),
    email: String(req.body.email || '').trim().toLowerCase(),
    organization: String(req.body.organization || '').trim(),
  };
  const password = String(req.body.password || '');
  const search = readSearch(req.body.busqueda);
  let error = null;
  if (!values.name || values.name.length > 100) error = req.t('errors.nameMax');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) || values.email.length > 254) error = req.t('errors.email');
  else if (!values.organization || values.organization.length > 150) error = req.t('errors.organization');
  else if (password.length < 8 || password.length > 72) error = req.t('errors.password');
  if (error) return renderRegistro(res.status(400), { error, values, search });

  // Si el email ya existe no se cambia nada y se muestra el mismo mensaje (no se revela qué emails están registrados).
  await q(
    'INSERT INTO users (name, email, password_hash, organization, signup_search) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING',
    [values.name, values.email, await bcrypt.hash(password, 12), values.organization, search || null]
  );
  message(res, 200, 'pending');
});

app.get('/login', (req, res) => (req.user ? res.redirect(homeOf(req.user)) : res.render('login', { title: req.t('login.title'), error: null, email: '', bare: true })));

app.post('/login', authLimiter, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = (await q('SELECT id, password_hash, role, status, last_login_at, signup_search FROM users WHERE email = $1', [email])).rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).render('login', { title: req.t('login.title'), error: req.t('login.error'), email, bare: true });
  if (user.status === 'pending') return message(res, 403, 'pending');
  if (user.status === 'rejected') return message(res, 403, 'rejected');
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    q('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]).catch(console.error);
    // Primer acceso: aterriza en lo que buscó al pedir acceso.
    const first = !user.last_login_at && user.signup_search && user.role !== 'admin';
    res.redirect(first ? `/productos?q=${encodeURIComponent(user.signup_search)}` : homeOf(user));
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
  const products = await findProducts({ ...filters, userId: req.user.id, onlyFavorites });
  res.render('productos', {
    title: req.t(onlyFavorites ? 'nav.favorites' : 'nav.products'),
    onlyFavorites, ...filters, products,
    // Vista de mapa: cada país con sus productos (world.js junta las variantes del nombre) y el mapa base.
    places: countryStats(products), world: FEATURES,
    countries: await listCountries(),
    here: req.originalUrl,
    openSuggest: req.query.sugerir === '1',
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
  res.render('producto', {
    title: product.name, product, here: req.originalUrl,
    groups: groupFields(await getFields(), product.data, req.t),
    badges: badges(product.data, req.t), source: firstUrl(product.data),
  });
});

app.post('/favoritos/:id', requireMember, async (req, res) => {
  // La estrella cambia de estado: solo se avisa si algo sale mal.
  const removed = await q('DELETE FROM favorites WHERE user_id = $1 AND product_id = $2', [req.user.id, req.params.id]);
  if (!removed.rowCount) {
    const added = await q(
      'INSERT INTO favorites (user_id, product_id) SELECT $1, id FROM products WHERE id = $2 AND NOT hidden',
      [req.user.id, req.params.id]
    );
    if (!added.rowCount) req.session.flash = { type: 'error', text: req.t('errors.unavailable') };
  }
  // Solo se vuelve a rutas internas (con el ancla del producto, para no perder la posición).
  const back = String(req.body.volver || '');
  res.redirect(/^\/(?![/\\])/.test(back) ? back : '/productos');
});

// ---------- Comparador: dos productos lado a lado ----------
const readId = (v) => (/^\d{1,9}$/.test(String(v || '')) ? Number(v) : null);
app.get('/comparar', requireMember, async (req, res) => {
  const { rows: products } = await q(
    `SELECT p.id, p.name, p.data->>'Producer' AS producer, (f.user_id IS NOT NULL) AS favorite
       FROM products p LEFT JOIN favorites f ON f.product_id = p.id AND f.user_id = $1
      WHERE NOT p.hidden ORDER BY lower(p.name), p.id`,
    [req.user.id]
  );
  const load = async (id) => (id ? (await q('SELECT id, name, data FROM products WHERE id = $1 AND NOT hidden', [id])).rows[0] || null : null);
  const a = await load(readId(req.query.a));
  const b = await load(readId(req.query.b));
  let comparison = null;
  if (a && b && a.id !== b.id) {
    comparison = compareProducts(await getFields(), a, b, req.t);
    // Medición: una vez por pareja y usuario cada 30 minutos (recargar la página no cuenta dos veces).
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    q(`INSERT INTO comparisons (user_id, product_a, product_b) SELECT $1, $2, $3
        WHERE NOT EXISTS (SELECT 1 FROM comparisons WHERE user_id = $1 AND product_a = $2 AND product_b = $3 AND created_at > now() - interval '30 minutes')`,
      [req.user.id, x, y]).catch(console.error);
  }
  res.render('comparar', { title: req.t('compare.title'), products, a, b, comparison });
});

// ---------- RUTFeed: de momento solo avisa de que pronto habrá entradas y posts (usuarios y admin) ----------
app.get('/feed', requireUser, (req, res) => res.render('feed', { title: req.t('feed.title') }));

// ---------- Sobre los datos: estado del directorio y cómo leer una ficha ----------
app.get('/datos', requireMember, async (req, res) => {
  const { rows } = await q("SELECT id, data->>'Production location' AS location, updated_at FROM products WHERE NOT hidden");
  res.render('datos', {
    title: req.t('nav.data'), kinds: BADGE_KINDS,
    products: rows.length,
    countries: countryStats(rows).length,
    updated: rows.reduce((max, r) => (!max || r.updated_at > max ? r.updated_at : max), null),
  });
});

// ---------- Sugerencias de productos (un enlace, los datos a mano, o ambos) ----------
app.post('/sugerencias', requireMember, suggestLimiter, async (req, res) => {
  const text = (field, max) => String(req.body[field] || '').replace(/\r\n?/g, '\n').trim().slice(0, max);
  const s = { url: text('url', 500), name: text('name', 300), producer: text('producer', 150), country: text('country', 100), notes: text('notes', 2000) };
  let error = null;
  if (!s.url && !s.name) error = req.t('errors.suggestEmpty');
  else if (s.url && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(s.url)) error = req.t('errors.suggestUrl');
  if (!error) {
    await q('INSERT INTO suggestions (user_id, url, name, producer, country, notes) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, s.url, s.name, s.producer, s.country, s.notes]);
  }
  req.session.flash = error ? { type: 'error', text: error } : { type: 'success', text: req.t('errors.suggestThanks') };
  res.redirect(error ? '/productos?sugerir=1' : '/productos');
});

// ---------- Panel de administración (responde 404 a quien no sea admin) ----------
app.use('/admin', requireAdmin, require('./admin')({ verifyCsrf, authLimiter }));

// ---------- 404 y errores ----------
app.use((req, res) => notFound(res));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  message(res, 500, 'error');
});

const port = process.env.PORT || 3000;
init()
  .then(() => app.listen(port, () => {
    console.log(`RUTFinder escuchando en el puerto ${port}`);
    if (!LEGAL.name || !LEGAL.email) console.warn('Aviso: faltan LEGAL_NAME y/o LEGAL_EMAIL; el aviso legal y la política de privacidad saldrán sin los datos del titular.');
  }))
  .catch((err) => {
    console.error('No se pudo iniciar la base de datos:', err.message);
    process.exit(1);
  });
