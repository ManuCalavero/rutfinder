// Mapa mundial del inicio del panel.
// world-map.json: Natural Earth 1:110m (dominio público) vía world-atlas@2.0.2, proyección Equal Earth (d3-geo),
// sin la Antártida, en un lienzo de 960 × 424. Cada país: id (ISO 3166-1 numérico), name (nombre de Natural Earth) y d (su trazado).
const MAP = require('./world-map.json');

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\bthe\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();

// Nombres del Excel que no coinciden con los del mapa → nombre en el mapa. Para añadir uno: en minúsculas, sin tildes.
const ALIASES = {
  usa: 'United States of America', us: 'United States of America', 'united states': 'United States of America',
  uk: 'United Kingdom', 'great britain': 'United Kingdom', england: 'United Kingdom',
  'democratic republic of congo': 'Dem. Rep. Congo', 'dr congo': 'Dem. Rep. Congo', drc: 'Dem. Rep. Congo',
  'republic of congo': 'Congo', 'ivory coast': "Côte d'Ivoire", 'central african republic': 'Central African Rep.',
  'south sudan': 'S. Sudan', 'dominican republic': 'Dominican Rep.', 'czech republic': 'Czechia',
  swaziland: 'eSwatini', 'north macedonia': 'Macedonia', 'bosnia and herzegovina': 'Bosnia and Herz.',
  'russian federation': 'Russia', 'united republic of tanzania': 'Tanzania', 'lao pdr': 'Laos', 'viet nam': 'Vietnam',
  'equatorial guinea': 'Eq. Guinea', 'western sahara': 'W. Sahara', 'solomon islands': 'Solomon Is.',
};

// Centro de cada país para su marcador: el centroide de su trozo más grande (Francia continental, no la Guayana).
function centroid(d) {
  let best = null;
  for (const ring of d.split('M').filter(Boolean)) {
    const pts = [...ring.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    let a = 0; let cx = 0; let cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      const k = x0 * y1 - x1 * y0;
      a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
    }
    if (!a) continue;
    if (!best || Math.abs(a) > Math.abs(best.a)) best = { a, x: cx / (3 * a), y: cy / (3 * a) };
  }
  return best ? { x: Math.round(best.x * 10) / 10, y: Math.round(best.y * 10) / 10 } : null;
}

const FEATURES = MAP.map((f) => ({ ...f, center: centroid(f.d) }));
const BY_NAME = new Map(FEATURES.map((f) => [norm(f.name), f]));
const findCountry = (raw) => BY_NAME.get(norm(ALIASES[norm(raw)] || raw)) || null;

// rows: [{ id, location }] (location: países separados por saltos de línea, como en el Excel).
// Devuelve un elemento por país (las variantes de un mismo país se juntan): { label, n, feature }, de más a menos productos.
function countryStats(rows) {
  const byKey = new Map();
  for (const r of rows) {
    for (const raw of String(r.location || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
      const feature = findCountry(raw);
      const key = feature ? feature.name : norm(raw);
      if (!byKey.has(key)) byKey.set(key, { feature, ids: new Set(), names: new Map() });
      const e = byKey.get(key);
      e.ids.add(r.id);
      e.names.set(raw, (e.names.get(raw) || 0) + 1);
    }
  }
  return [...byKey.values()]
    .map((e) => ({
      // Se muestra (y se filtra por) la variante del nombre más usada en el Excel.
      label: [...e.names].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0],
      n: e.ids.size,
      ids: [...e.ids],
      feature: e.feature,
    }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

module.exports = { FEATURES, countryStats };
