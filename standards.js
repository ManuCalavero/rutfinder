// Semáforo de normas: compara los datos de una ficha con los rangos oficiales para RUTF.
// Es la única fuente de los rangos: la ficha, el formulario del panel, el listado del panel y la página /normas salen de aquí.
//
// Cifras copiadas de los documentos originales (revisados el 2026-11-19, ver REVIEWED):
//  - codex:  FAO/OMS, «Guidelines for Ready-to-Use Therapeutic Foods», CXG 95-2022. Sección 6 (6.1 energía, 6.2 proteínas,
//            6.3 lípidos, 6.5 actividad de agua) y tabla del anexo (ácidos grasos n-6 y n-3 por 100 kcal).
//  - unicef: UNICEF Supply Division, «Product Specification Sheet: RUTF paste 92 g», S0000240, versión 4.1 (21-07-2022).
//            Sección 5 (composición), 20 (microbiología) y 21 (contaminantes).
// Si sale una versión nueva de alguno, cambia aquí las cifras, la fecha de REVIEWED y el enlace de GUIDES.
//
// Los datos de cada producto se guardan en products.specs (no en products.data), así importar el Excel no los borra:
//   { energy: 545, protein: 14.9, …, salmonella: 'absent', src: { energy: 'sheet' }, unicefChecked: '2026-11-12', coa: 'https://…' }
// El admin escribe lo que viene en las fichas técnicas (g/100 g) y aquí se pasa a % de la energía o mg/100 kcal cuando hace falta.

const REVIEWED = '2026-11-19';

// key: nombre en products.specs y en locales (standards.params.<key>).
// inUnit: unidad en la que escribe el admin. unit: unidad en la que se compara (locales: standards.units.<unit>).
// perEnergy: el valor se divide por la energía (kcal/100 g) y se multiplica por este factor:
//   proteína 4 kcal/g → ×400 da % de la energía; grasa 9 kcal/g → ×900; g → mg por 100 kcal → ×100 000.
// ratio: si el admin escribe un porcentaje (p. ej. PDCAAS 92) se pasa a tanto por uno (0,92).
// kind 'absence': no es un número, sino «ausente / presente» en la muestra.
const CHECKS = [
  { key: 'energy', group: 'composition', inUnit: 'kcal/100 g', unit: 'kcal100', min: 520, max: 550, digits: 0, refs: ['codex', 'unicef'] },
  { key: 'protein', group: 'composition', inUnit: 'g/100 g', perEnergy: 400, unit: 'pctE', min: 10, max: 12, digits: 1, refs: ['codex', 'unicef'] },
  { key: 'pdcaas', group: 'composition', inUnit: '0–1', ratio: true, unit: 'ratio', min: 0.9, digits: 2, refs: ['codex', 'unicef'] },
  { key: 'dairy', group: 'composition', inUnit: '% de la proteína', unit: 'pctProtein', min: 50, digits: 0, refs: ['unicef'] },
  { key: 'fat', group: 'composition', inUnit: 'g/100 g', perEnergy: 900, unit: 'pctE', min: 45, max: 60, digits: 1, refs: ['codex', 'unicef'] },
  { key: 'n6', group: 'composition', inUnit: 'g/100 g', perEnergy: 100000, unit: 'mg100kcal', min: 330, max: 780, digits: 0, refs: ['codex', 'unicef'] },
  { key: 'n3', group: 'composition', inUnit: 'g/100 g', perEnergy: 100000, unit: 'mg100kcal', min: 110, max: 280, digits: 0, refs: ['codex', 'unicef'] },
  { key: 'aw', group: 'composition', inUnit: '0–1', unit: 'ratio', max: 0.6, digits: 2, refs: ['codex', 'unicef'] },
  { key: 'moisture', group: 'composition', inUnit: '%', unit: 'pct', max: 2.5, digits: 1, refs: ['unicef'] },
  { key: 'aflatoxin', group: 'safety', inUnit: 'µg/kg', unit: 'ugkg', max: 10, digits: 1, refs: ['unicef'] },
  { key: 'salmonella', group: 'safety', kind: 'absence', refs: ['unicef'] },
  { key: 'entero', group: 'safety', inUnit: 'ufc/g', unit: 'cfug', max: 10, digits: 0, refs: ['unicef'] },
];
const GROUPS = ['composition', 'safety'];
const SOURCES = ['sheet', 'lab', 'estimated']; // de dónde sale cada dato: ficha técnica, análisis de laboratorio o estimado

// Guías oficiales de la página /normas (textos en locales: standards.guides.<id>). Enlaces a la fuente, nunca copias.
// year y code salen en el pie de la portada; tone es el color de la portada (.book-<tone> en style.css).
const GUIDES = [
  { id: 'codex', year: 2022, code: 'CXG 95-2022', tone: 'mint', url: 'https://doi.org/10.4060/cc4593en' },
  { id: 'unicefSpec', year: 2022, code: 'S0000240 · v4.1', tone: 'sun', url: 'https://www.unicef.org/supply/media/18021/file/S0000240-RUTF-specification.pdf' },
  { id: 'who2023', year: 2023, code: 'ISBN 978-92-4-008283-0', tone: 'lilac', url: 'https://www.who.int/publications/i/item/9789240082830' },
  { id: 'who2021', year: 2021, code: 'ISBN 978-92-4-002227-0', tone: 'peach', url: 'https://www.who.int/publications/i/item/9789240022270' },
  { id: 'unicefPage', year: null, code: 'unicef.org/supply', tone: 'blue', url: 'https://www.unicef.org/supply/ready-use-therapeutic-food-rutf' },
  { id: 'joint2007', year: 2007, code: 'ISBN 978-92-806-4147-9', tone: 'ink', url: 'https://www.who.int/publications/i/item/9789280641479' },
];

// «11,2», «11.2», «< 4 µg/kg» → número (o null).
function parseNum(value) {
  const m = String(value ?? '').replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Lee el formulario del panel (campos s_<key>, src_<key>, unicefChecked y coa) y devuelve el objeto specs limpio.
function readSpecs(body) {
  const specs = { src: {} };
  for (const c of CHECKS) {
    const raw = String(body[`s_${c.key}`] ?? '').trim();
    if (c.kind === 'absence') {
      if (['absent', 'present'].includes(raw)) specs[c.key] = raw;
    } else {
      let n = parseNum(raw);
      if (n != null && c.ratio && n > 1 && n <= 100) n /= 100;
      if (n != null && n >= 0 && n < 1e6) specs[c.key] = n;
    }
    const src = String(body[`src_${c.key}`] || '');
    if (specs[c.key] != null && SOURCES.includes(src)) specs.src[c.key] = src;
  }
  const date = String(body.unicefChecked || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) specs.unicefChecked = date;
  const coa = String(body.coa || '').trim();
  if (/^https?:\/\/\S+\.\S+$/i.test(coa) && coa.length <= 500) specs.coa = coa;
  return specs;
}

// Estado de una comprobación: 'in' (dentro), 'low' / 'high' (fuera, por debajo / por encima) o 'none' (sin dato).
function judge(c, value) {
  if (value == null) return 'none';
  if (c.kind === 'absence') return value === 'absent' ? 'in' : 'high';
  if (c.min != null && value < c.min) return 'low';
  if (c.max != null && value > c.max) return 'high';
  return 'in';
}

// Compara las specs de un producto con todas las normas.
// rows: una por comprobación (con el valor ya convertido a la unidad de la norma); summary: cuentas por grupo y en total.
function evaluate(specs = {}) {
  specs = specs || {};
  const energy = typeof specs.energy === 'number' && specs.energy > 0 ? specs.energy : null;
  const rows = CHECKS.map((c) => {
    const raw = specs[c.key] ?? null;
    let value = raw;
    let needsEnergy = false;
    if (raw != null && c.perEnergy) {
      if (energy) value = (raw * c.perEnergy) / energy;
      else { value = null; needsEnergy = true; }
    }
    return { ...c, raw, value, needsEnergy, status: judge(c, value), src: (specs.src || {})[c.key] || '' };
  });
  const count = (list) => ({
    in: list.filter((r) => r.status === 'in').length,
    out: list.filter((r) => r.status === 'low' || r.status === 'high').length,
    none: list.filter((r) => r.status === 'none').length,
    total: list.length,
  });
  const summary = Object.fromEntries(GROUPS.map((g) => [g, count(rows.filter((r) => r.group === g))]));
  summary.all = count(rows);
  return { rows, summary, hasData: summary.all.none < summary.all.total };
}

// Rango de una norma para mostrarlo: «520–550 kcal/100 g», «≤ 2,5 %», «≥ 0,9», «Ausente en 25 g».
// t: textos del idioma; num: formateador de números (num(valor, decimales, sinCerosDeRelleno)).
function rangeText(c, t, num) {
  if (c.kind === 'absence') return t('standards.absent25');
  const unit = t(`standards.units.${c.unit}`);
  const u = unit ? ` ${unit}` : '';
  const f = (n) => num(n, c.digits, true);
  if (c.min != null && c.max != null) return `${f(c.min)}–${f(c.max)}${u}`;
  if (c.max != null) return `≤ ${f(c.max)}${u}`;
  return `≥ ${f(c.min)}${u}`;
}

// Valor declarado para mostrarlo, ya en la unidad de la norma: «11,2 % de la energía». null si no hay dato.
function valueText(row, t, num) {
  if (row.value == null) return null;
  if (row.kind === 'absence') return t(`standards.${row.value}`);
  const unit = t(`standards.units.${row.unit}`);
  return `${num(row.value, row.digits)}${unit ? ` ${unit}` : ''}`;
}

// ----- Sugerencias para el formulario del panel: valores que ya están escritos en el texto del Excel -----
// Solo propone; el admin decide si lo usa. Busca línea a línea en todos los campos menos «Values per unit» (va por sobre, no por 100 g).
const N = '(\\d+(?:[.,]\\d+)?)';
const HINTS = {
  energy: { words: /energ|kcal/i, value: new RegExp(`${N}\\s*kcal`, 'i'), skip: /kg\s*\/\s*d|\/\s*kg|sachet|sobre|per\s+unit/i },
  protein: { words: /prote/i, value: new RegExp(`${N}\\s*g\\b`, 'i'), skip: /100\s*kcal|kcal\s*\/|%/i },
  fat: { words: /\b(fat|lipid|grasa|l[ií]pido)/i, value: new RegExp(`${N}\\s*g\\b`, 'i'), skip: /fatty|acid|trans|saturat|100\s*kcal|%/i },
  n6: { words: /n-?6|omega[\s-]?6|\blinoleic\b|linoleico/i, value: new RegExp(`${N}\\s*(m?g)\\b`, 'i'), skip: /100\s*kcal|%/i },
  n3: { words: /n-?3|omega[\s-]?3|linolenic|linol[eé]nico|\bALA\b|\bDHA\b/i, value: new RegExp(`${N}\\s*(m?g)\\b`, 'i'), skip: /100\s*kcal|%/i },
  moisture: { words: /moisture|humedad|water content/i, value: new RegExp(`${N}\\s*%`, 'i') },
  aw: { words: /water activity|actividad de agua|\baw\b/i, value: /(0[.,]\d+)/ },
  pdcaas: { words: /pdcaas/i, value: /(0[.,]\d+|\d{2,3}(?:[.,]\d+)?\s*%)/ },
  aflatoxin: { words: /aflatox/i, value: new RegExp(`${N}\\s*(?:µg|μg|ug|ppb)`, 'i') },
};
function suggest(data = {}, specs = {}) {
  const lines = Object.entries(data)
    .filter(([field]) => !/values per unit/i.test(field))
    .flatMap(([field, text]) => String(text).split('\n').map((line) => ({ field, line: line.trim() })))
    .filter((l) => l.line);
  const out = {};
  for (const [key, h] of Object.entries(HINTS)) {
    if (specs && specs[key] != null) continue; // ya tiene valor: no se propone nada
    for (const { field, line } of lines) {
      if (!h.words.test(line) || (h.skip && h.skip.test(line))) continue;
      const m = line.match(h.value);
      if (!m) continue;
      let n = parseNum(m[1]);
      if (n == null) continue;
      if (m[2] && m[2].toLowerCase() === 'mg') n /= 1000;
      if (key === 'pdcaas' && n > 1) n /= 100;
      out[key] = { value: Math.round(n * 1000) / 1000, field: field.replace(/:$/, ''), line: line.slice(0, 160) };
      break;
    }
  }
  return out;
}

module.exports = { REVIEWED, CHECKS, GROUPS, SOURCES, GUIDES, parseNum, readSpecs, evaluate, judge, rangeText, valueText, suggest };
