// Cómo se agrupan y se llaman en pantalla las columnas del Excel.
// Se usa en la ficha del producto (secciones) y en el formulario de edición (pestañas).
// Las columnas que no aparecen aquí van al grupo «Otros», así un Excel con columnas nuevas sigue funcionando.
// half: true -> se muestra a media anchura junto a su pareja (p. ej. «por 100 g» y «por 100 kcal»).

const ICONS = {
  general: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
  nutrition: 'M12 21c-4.5 0-7-3.5-7-7.5C5 9 8 6 12 6s7 3 7 7.5c0 4-2.5 7.5-7 7.5zM12 6c0-2 1-3 3-3.5',
  production: 'M3 21V10l5 3V10l5 3V10l5 3V5h3v16zM7 17h2M12 17h2M17 17h2',
  impact: 'M12 3v18M16.5 7.5c0-1.700-2-3-4.500-3s-4.500 1.300-4.500 3S9 10.500 12 11s4.500 1.800 4.500 3.500-2 3-4.500 3-4.500-1.300-4.500-3',
  evidence: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.500-3 8-7 9-4-1-7-4.500-7-9V6z',
  other: 'M4 6h16M4 12h16M4 18h10',
  leaf: 'M5 19c0-8 5-14 15-15-1 10-7 15-15 15zM5 19l7-7',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  shield: 'M12 3l7 3v6c0 4.500-3 8-7 9-4-1-7-4.500-7-9V6z',
  pin: 'M12 21s-6-5.500-6-11a6 6 0 0112 0c0 5.500-6 11-6 11zM12 12.500a2.500 2.500 0 100-5 2.500 2.500 0 000 5z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.500 21c0-4 3.400-6.500 7.500-6.500s7.500 2.500 7.500 6.500',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.500V12l3 2',
  coin: 'M12 21a9 9 0 100-18 9 9 0 000 18zM14.500 9c-.5-1-1.500-1.500-2.500-1.500-1.500 0-2.500.8-2.500 2s1 1.700 2.500 2 2.500.8 2.500 2-1 2-2.500 2c-1.200 0-2.200-.5-2.700-1.500M12 6v1.500M12 16.500V18',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  back: 'M19 12H5M11 6l-6 6 6 6',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
};

// <svg> de un icono (trazo, hereda el color del texto).
const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true" viewBox="0 0 24 24"><path d="${ICONS[name] || ICONS.other}"/></svg>`;

const GROUPS = [
  { id: 'general', title: 'General', fields: [
    ['Type of production', 'Tipo de producción'],
    ['General Description', 'Descripción general'],
    ['Producer', 'Productor'],
    ['Production location', 'Lugar de producción'],
    ['Target Population', 'Población objetivo'],
    ['Picture', 'Imagen'],
  ] },
  { id: 'nutrition', title: 'Nutrición', fields: [
    ['Nutritional composition', 'Composición nutricional por 100 g'],
    ['Values per unit', 'Valores por unidad'],
    ['Minerals per 100g', 'Minerales por 100 g', true],
    ['Minerals per 100 kcal', 'Minerales por 100 kcal', true],
    ['Vitamins per 100g', 'Vitaminas por 100 g', true],
    ['Vitamins per 100 kcal', 'Vitaminas por 100 kcal', true],
    ['Ingredients', 'Ingredientes'],
    ['Food preference filter', 'Preferencias alimentarias'],
  ] },
  { id: 'production', title: 'Producción y uso', fields: [
    ['Processing', 'Procesado'],
    ['Control microbio', 'Control microbiológico y seguridad'],
    ['Package', 'Envase'],
    ['Shelf Life', 'Vida útil'],
    ['Directions for Use', 'Modo de uso'],
  ] },
  { id: 'impact', title: 'Coste e impacto', fields: [
    ['Cost', 'Coste'],
    ['Efficiency', 'Eficacia'],
    ['Acceptability', 'Aceptabilidad'],
    ['Downsides', 'Inconvenientes'],
  ] },
  { id: 'evidence', title: 'Evidencia y fuentes', fields: [
    ['Peer-reviewed / Grey literature', 'Tipo de publicación'],
    ['UNICEF supplier', 'Proveedor de UNICEF'],
    ['Link for UNICEF verified approvals', 'Aprobaciones verificadas por UNICEF'],
    ['Link', 'Enlaces y fuentes'],
  ] },
];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Índice de claves conocidas, de la más larga a la más corta, para que «Link» no se trague «Link for UNICEF…».
const KNOWN = GROUPS.flatMap((g) => g.fields.map(([key, label, half]) => ({ key: norm(key), label, half: Boolean(half), group: g.id })))
  .sort((a, b) => b.key.length - a.key.length);
const ORDER = new Map(KNOWN.map((k) => [k.key, GROUPS.flatMap((g) => g.fields.map(([key]) => norm(key))).indexOf(k.key)]));

function describe(field) {
  const n = norm(field);
  return KNOWN.find((k) => n === k.key) || KNOWN.find((k) => n.startsWith(`${k.key} `)) || null;
}

// Devuelve los grupos con sus campos (en el orden de GROUPS) y el valor de cada uno para este producto.
function groupFields(fields, data = {}) {
  const groups = [...GROUPS.map((g) => ({ id: g.id, title: g.title })), { id: 'other', title: 'Otros' }]
    .map((g) => ({ ...g, icon: ICONS[g.id], items: [] }));
  fields.forEach((name, index) => {
    const known = describe(name);
    const item = { name, index, label: known ? known.label : name.replace(/:$/, ''), half: known ? known.half : false,
      value: data[name] || '', order: known ? ORDER.get(known.key) : 1000 + index };
    groups.find((g) => g.id === (known ? known.group : 'other')).items.push(item);
  });
  for (const g of groups) {
    g.items.sort((a, b) => a.order - b.order);
    // Las parejas («Minerales por 100 g» + «Minerales por 100 kcal») solo van a media anchura si las dos tienen datos.
    const family = (i) => i.label.split(' ')[0];
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

// Etiquetas de colores para los valores cortos que se repiten mucho.
function typeBadge(value) {
  const v = norm(value || '');
  if (!v) return null;
  if (v.startsWith('industrial')) return { text: 'Industrial', tone: 'blue' };
  if (v.startsWith('small scale')) return { text: 'Pequeña escala', tone: 'green' };
  if (v.startsWith('locally')) return { text: 'Producción local', tone: 'green' };
  if (v.startsWith('theoric') || v.startsWith('theoretic')) return { text: 'Fórmula teórica', tone: 'amber' };
  return { text: value.split('\n')[0].slice(0, 40), tone: 'gray' };
}

function badges(data) {
  const list = [];
  const type = typeBadge(pick(data, 'Type of production'));
  if (type) list.push({ ...type, icon: 'production' });
  const diet = norm(pick(data, 'Food preference filter'));
  if (diet.startsWith('vegan')) list.push({ text: 'Vegano', tone: 'green', icon: 'leaf' });
  else if (diet.startsWith('vegetarian')) list.push({ text: 'Vegetariano', tone: 'green', icon: 'leaf' });
  else if (diet.startsWith('no dietary')) list.push({ text: 'Sin restricciones dietéticas', tone: 'gray', icon: 'leaf' });
  const pub = norm(pick(data, 'Peer-reviewed / Grey literature'));
  if (pub.startsWith('peer')) list.push({ text: 'Revisado por pares', tone: 'blue', icon: 'check' });
  else if (pub.startsWith('grey') || pub.startsWith('gray')) list.push({ text: 'Literatura gris', tone: 'gray', icon: 'doc' });
  if (pick(data, 'UNICEF supplier')) list.push({ text: 'Proveedor de UNICEF', tone: 'blue', icon: 'shield' });
  return list;
}

// Primer enlace http(s) de la columna «Link» (para el botón «Ver fuente»).
const firstUrl = (data) => (String(pick(data, 'Link')).match(/https?:\/\/[^\s<>"]*[^\s<>".,;:)\]]/) || [''])[0];

module.exports = { groupFields, pick, badges, typeBadge, firstUrl, icon };
