// Comparador: pone dos productos lado a lado con las mismas secciones que la ficha.
// Las listas tipo «Calcium: 300 mg» se alinean nutriente a nutriente aunque cada producto las tenga en otro orden.
const { groupFields, badges, kvRows, readEstimated, norm } = require('./fields');

// Dos valores son iguales si solo cambian mayúsculas o espacios (los símbolos sí cuentan: «<1 g» ≠ «>1 g»).
const flat = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const same = (a, b) => flat(a) === flat(b);
// Nombre de nutriente para alinear filas: sin plurales ni la errata «phosphorous» del Excel
// («Carbohydrates» = «Carbohydrate», «Phosphorous» = «Phosphorus»).
const keyOf = (name) => norm(name).replace(/phosphorous/g, 'phosphorus').split(' ').map((w) => w.replace(/s$/, '')).join(' ');

// fields: columnas del Excel (en orden); a y b: productos ({ id, name, data }); t: textos del idioma.
// Devuelve { groups: [{ id, title, rows, differs }], differences } donde cada fila es
//   { label, a, b, estA, estB, same } o, para listas, { label, list: [{ label, a, b, same }], same }.
function compareProducts(fields, a, b, t) {
  const ga = groupFields(fields, a.data, t);
  const gb = new Map(groupFields(fields, b.data, t).map((g) => [g.id, new Map(g.items.map((i) => [i.name, i]))]));
  let differences = 0;

  const groups = ga.map((g) => {
    const others = gb.get(g.id) || new Map();
    const rows = [];
    for (const item of g.items) {
      const ra = readEstimated(item.value);
      const rb = readEstimated((others.get(item.name) || {}).value);
      if (!ra.value && !rb.value) continue; // vacío en los dos: no aporta nada
      const la = kvRows(ra.value);
      const lb = kvRows(rb.value);
      let row;
      // Modo lista solo si las dos son listas (o una está vacía); si no, se comparan como texto.
      if ((la || lb) && (la || !ra.value) && (lb || !rb.value)) {
        const byKey = new Map();
        for (const [name, value] of la || []) byKey.set(keyOf(name), { label: name, a: value, b: '' });
        for (const [name, value] of lb || []) {
          const k = keyOf(name);
          if (byKey.has(k)) byKey.get(k).b = value;
          else byKey.set(k, { label: name, a: '', b: value });
        }
        const list = [...byKey.values()].map((r) => ({ ...r, same: same(r.a, r.b) }));
        row = { label: item.label, list, estA: ra.estimated, estB: rb.estimated, same: list.every((r) => r.same) };
      } else {
        row = { label: item.label, a: ra.value, b: rb.value, estA: ra.estimated, estB: rb.estimated, same: same(ra.value, rb.value) };
      }
      if (!row.same) differences++;
      rows.push(row);
    }
    return { id: g.id, title: g.title, rows, differs: rows.some((r) => !r.same) };
  }).filter((g) => g.rows.length);

  return { groups, differences, badgesA: badges(a.data, t), badgesB: badges(b.data, t) };
}

module.exports = { compareProducts };
