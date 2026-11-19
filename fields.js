// Cómo se agrupan y se llaman en pantalla las columnas del Excel.
// Se usa en la ficha del producto (secciones) y en el formulario de edición (pestañas).
// Las columnas que no aparecen aquí van al grupo «Otros», así un Excel con columnas nuevas sigue funcionando.
// Cada campo: [columna del Excel, clave del texto en locales/*.json (fields.<clave>), half].
// half: true -> se muestra a media anchura junto a su pareja (p. ej. «por 100 g» y «por 100 kcal»).
// Los títulos de los grupos están en locales/*.json (groups.<id>).
const { T, DEFAULT } = require('./i18n');

const GROUPS = [
  { id: 'general', fields: [
    ['Type of production', 'type'],
    ['General Description', 'description'],
    ['Producer', 'producer'],
    ['Production location', 'location'],
    ['Target Population', 'population'],
    ['Picture', 'picture'],
  ] },
  { id: 'nutrition', fields: [
    ['Nutritional composition', 'composition'],
    ['Values per unit', 'perUnit'],
    ['Minerals per 100g', 'minerals100g', true],
    ['Minerals per 100 kcal', 'minerals100kcal', true],
    ['Vitamins per 100g', 'vitamins100g', true],
    ['Vitamins per 100 kcal', 'vitamins100kcal', true],
    ['Ingredients', 'ingredients'],
    ['Food preference filter', 'diet'],
  ] },
  { id: 'production', fields: [
    ['Processing', 'processing'],
    ['Control microbio', 'microbio'],
    ['Package', 'package'],
    ['Shelf Life', 'shelfLife'],
    ['Directions for Use', 'directions'],
  ] },
  { id: 'impact', fields: [
    ['Cost', 'cost'],
    ['Efficiency', 'efficiency'],
    ['Acceptability', 'acceptability'],
    ['Downsides', 'downsides'],
  ] },
  { id: 'evidence', fields: [
    ['Peer-reviewed / Grey literature', 'publication'],
    ['UNICEF supplier', 'unicef'],
    ['Link for UNICEF verified approvals', 'unicefLink'],
    ['Link', 'links'],
  ] },
];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Índice de claves conocidas, de la más larga a la más corta, para que «Link» no se trague «Link for UNICEF…».
const KNOWN = GROUPS.flatMap((g) => g.fields.map(([key, id, half]) => ({ key: norm(key), id, half: Boolean(half), group: g.id })))
  .sort((a, b) => b.key.length - a.key.length);
const ORDER = new Map(KNOWN.map((k) => [k.key, GROUPS.flatMap((g) => g.fields.map(([key]) => norm(key))).indexOf(k.key)]));

function describe(field) {
  const n = norm(field);
  return KNOWN.find((k) => n === k.key) || KNOWN.find((k) => n.startsWith(`${k.key} `)) || null;
}

// Devuelve los grupos con sus campos (en el orden de GROUPS) y el valor de cada uno para este producto.
// t: textos del idioma de la página (por defecto, español).
function groupFields(fields, data = {}, t = T[DEFAULT]) {
  const groups = [...GROUPS.map((g) => g.id), 'other'].map((id) => ({ id, title: t(`groups.${id}`), items: [] }));
  fields.forEach((name, index) => {
    const known = describe(name);
    const item = { name, index, id: known ? known.id : '', label: known ? t(`fields.${known.id}`) : name.replace(/:$/, ''), half: known ? known.half : false,
      value: data[name] || '', order: known ? ORDER.get(known.key) : 1000 + index };
    groups.find((g) => g.id === (known ? known.group : 'other')).items.push(item);
  });
  for (const g of groups) {
    g.items.sort((a, b) => a.order - b.order);
    // Las parejas («Minerales por 100 g» + «Minerales por 100 kcal») solo van a media anchura si las dos tienen datos.
    const family = (i) => i.id.replace(/100.*$/, '');
    const pairs = g.items.map((i) => i.half && Boolean(i.value) && g.items.some((o) => o !== i && o.half && o.value && family(o) === family(i)));
    g.items.forEach((i, k) => { i.half = pairs[k]; });
    const filled = g.items.filter((i) => i.value);
    g.filled = filled.length;
    g.total = g.items.length;
    g.empty = g.items.filter((i) => !i.value).map((i) => i.label);
  }
  return groups.filter((g) => g.total);
}

// Valor de una columna buscando por su nombre "normalizado" (las cabeceras del Excel varían un poco).
function pick(data, key) {
  const k = norm(key);
  const name = Object.keys(data).find((f) => norm(f) === k || norm(f).startsWith(`${k} `));
  return name ? data[name] : '';
}

// La columna «UNICEF supplier» es texto libre: cuenta como proveedor si tiene algo que no sea un «no».
const isUnicef = (value) => Boolean(String(value || '').trim()) && !/^(no|none|n\/?a|-|–|unknown|desconocido)\b/i.test(String(value).trim());
// Proveedor de UNICEF y enlace a la aprobación (primera URL de «Link for UNICEF verified approvals»).
const unicefInfo = (data = {}) => ({
  approved: isUnicef(pick(data, 'UNICEF supplier')),
  link: (String(pick(data, 'Link for UNICEF verified approvals')).match(/https?:\/\/[^\s<>"]*[^\s<>".,;:)\]]/) || [''])[0],
});

// Texto corto para el tipo de producción (se repite mucho y en inglés en el Excel).
function typeLabel(value, t = T[DEFAULT]) {
  const v = norm(value || '');
  if (!v) return '';
  if (v.startsWith('industrial')) return t('badges.industrial');
  if (v.startsWith('small scale')) return t('badges.smallScale');
  if (v.startsWith('locally')) return t('badges.local');
  if (v.startsWith('theoric') || v.startsWith('theoretic')) return t('badges.theoretical');
  return value.split('\n')[0].slice(0, 40);
}

// Etiquetas de la cabecera de la ficha, agrupadas por tipo: cada tipo tiene su color y su icono.
// (BADGE_KINDS: el color está en style.css, .badge-<tone>; el icono, en ICONS de server.js.)
const BADGE_KINDS = {
  production: { tone: 'blue', icon: 'production' },  // Industrial, pequeña escala, producción local…
  diet: { tone: 'green', icon: 'leaf' },             // Vegano, vegetariano
  evidence: { tone: 'violet', icon: 'evidence' },    // Revisado por pares, literatura gris
  unicef: { tone: 'amber', icon: 'globe' },          // Proveedor de UNICEF
};
function badges(data, t = T[DEFAULT]) {
  const list = [];
  const add = (kind, text) => { if (text) list.push({ kind, text, ...BADGE_KINDS[kind] }); };
  add('production', typeLabel(pick(data, 'Type of production'), t));
  const diet = norm(pick(data, 'Food preference filter'));
  if (diet.startsWith('vegan')) add('diet', t('badges.vegan'));
  else if (diet.startsWith('vegetarian')) add('diet', t('badges.vegetarian'));
  const pub = norm(pick(data, 'Peer-reviewed / Grey literature'));
  if (pub.startsWith('peer')) add('evidence', t('badges.peer'));
  else if (pub.startsWith('grey') || pub.startsWith('gray')) add('evidence', t('badges.grey'));
  if (isUnicef(pick(data, 'UNICEF supplier'))) add('unicef', t('badges.unicef'));
  return list;
}

// Listas tipo «Calcium: 300–600 mg» (una por línea): devuelve [[nombre, valor], …] o null si el texto no es una lista así.
// La ficha las muestra como tabla y el comparador las alinea nutriente a nutriente.
function kvRows(value) {
  const lines = String(value || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => l.match(/^[•\-–]?\s*([^:]{2,48}):\s*(.+)$/)).filter(Boolean);
  return lines.length >= 3 && rows.length >= lines.length * 0.7 ? rows.map((m) => [m[1].trim(), m[2].trim()]) : null;
}

// «(estimated) 450 kcal» → { value: '450 kcal', estimated: true }
const readEstimated = (value) => ({ value: String(value || '').replace(/^\(estimated\)\s*/i, ''), estimated: /^\(estimated\)/i.test(value || '') });

// Primer enlace http(s) de la columna «Link» (para el botón «Ver fuente»).
const firstUrl = (data) => (String(pick(data, 'Link')).match(/https?:\/\/[^\s<>"]*[^\s<>".,;:)\]]/) || [''])[0];

module.exports = { groupFields, badges, BADGE_KINDS, typeLabel, firstUrl, kvRows, readEstimated, norm, isUnicef, unicefInfo };
