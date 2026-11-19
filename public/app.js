// Único JavaScript de la app. Todo funciona sin él; solo mejora cuatro cosas:
// 1) Los menús desplegables se cierran al hacer clic fuera o al pulsar Escape.
// 2) Con sesión iniciada (panel y zona de usuarios), ⌘K / Ctrl+K lleva al buscador.
// 3) Las tablas se ordenan pulsando la cabecera de una columna.
// 4) Catálogo en tarjetas, tabla o mapa, recordado en este navegador.
// 5) Formularios: botón de ver/ocultar contraseña y mensajes de error bajo cada campo.
// 6) Semáforo de normas (formulario del panel): el estado de cada valor se recalcula al escribir.
// Se carga con defer: el DOM ya está listo cuando se ejecuta.
(() => {
  const openDropdowns = () => document.querySelectorAll('details.dropdown[open]');
  document.addEventListener('click', (e) => {
    // También se cierran al elegir un enlace (el menú móvil lleva a anclas de la misma página).
    openDropdowns().forEach((d) => { if (!d.contains(e.target) || e.target.closest('.menu a')) d.open = false; });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    openDropdowns().forEach((d) => { d.open = false; d.querySelector('summary').focus(); });
  });

  // ⌘K (o Ctrl+K) lleva al buscador de la barra superior.
  const appSearch = document.getElementById('app-search');
  if (appSearch) {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const kbd = appSearch.parentElement.querySelector('.kbd');
    if (kbd && !mac) kbd.textContent = 'Ctrl K';
    document.addEventListener('keydown', (e) => {
      if ((mac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); appSearch.focus(); appSearch.select(); }
    });
  }

  // Tablas con data-sortable: las cabeceras con data-sort ordenan la tabla (ascendente ↔ descendente).
  // Cada celda se ordena por su data-value si lo tiene (fechas ISO, o "" para «Sin datos») y si no por su texto.
  // Las celdas vacías van siempre al final.
  const collator = new Intl.Collator(document.documentElement.lang || 'es', { numeric: true, sensitivity: 'base' });
  const ARROWS = '<svg class="icon sort-ico" viewBox="0 0 24 24" aria-hidden="true"><path class="sort-up" d="M8 10l4-4 4 4"/><path class="sort-down" d="M8 14l4 4 4-4"/></svg>';
  document.querySelectorAll('table[data-sortable]').forEach((table) => {
    const heads = [...table.tHead.rows[0].cells];
    const body = table.tBodies[0];
    heads.forEach((th, col) => {
      if (!th.hasAttribute('data-sort')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sort-btn';
      button.innerHTML = th.innerHTML + ARROWS;
      th.replaceChildren(button);
      button.addEventListener('click', () => {
        const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        heads.forEach((h) => h.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', dir);
        const key = (row) => { const cell = row.cells[col]; return (cell.dataset.value ?? cell.textContent).trim(); };
        const rows = [...body.rows].sort((a, b) => {
          const ka = key(a); const kb = key(b);
          if (!ka || !kb) return !ka - !kb;
          return dir === 'ascending' ? collator.compare(ka, kb) : collator.compare(kb, ka);
        });
        body.append(...rows);
      });
    });
  });

  const KEY = 'rutfinder.products-view';
  const toggles = [...document.querySelectorAll('[data-toggle-view]')];
  const show = (view) => {
    document.querySelectorAll('.products-view').forEach((el) => { el.hidden = el.dataset.view !== view; });
    toggles.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.toggleView === view)));
  };
  if (toggles.length) {
    let saved = 'grid';
    try { const v = localStorage.getItem(KEY); if (v === 'table' || v === 'map') saved = v; } catch (e) {}
    toggles.forEach((b) => {
      b.hidden = false;
      b.addEventListener('click', () => {
        show(b.dataset.toggleView);
        try { localStorage.setItem(KEY, b.dataset.toggleView); } catch (e) {}
      });
    });
    show(saved);
  }

  // Ver/ocultar contraseña: el botón (oculto sin JavaScript) cambia el tipo del campo que controla.
  document.querySelectorAll('.pw-toggle').forEach((btn) => {
    const input = document.getElementById(btn.getAttribute('aria-controls'));
    btn.hidden = false;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? btn.dataset.hide : btn.dataset.show);
      input.focus();
    });
  });

  // Formularios con data-validate: cada campo se comprueba al salir de él y al enviar.
  // El mensaje sale de su data-error; el servidor vuelve a validar todo igualmente.
  document.querySelectorAll('form[data-validate]').forEach((form) => {
    form.noValidate = true;
    const fields = [...form.querySelectorAll('input[data-error]')];
    const check = (input) => {
      const ok = input.checkValidity() && (input.type === 'password' || input.value.trim() !== '');
      const error = document.getElementById(input.id + '-error');
      input.setAttribute('aria-invalid', String(!ok));
      input.classList.toggle('is-valid', ok);
      if (error) { error.textContent = ok ? '' : input.dataset.error; error.hidden = ok; }
      return ok;
    };
    fields.forEach((input) => {
      input.addEventListener('blur', () => { if (input.value || input.dataset.touched) { input.dataset.touched = '1'; check(input); } });
      input.addEventListener('input', () => { if (input.dataset.touched) check(input); });
    });
    form.addEventListener('submit', (e) => {
      const bad = fields.filter((input) => { input.dataset.touched = '1'; return !check(input); });
      if (bad.length) { e.preventDefault(); bad[0].focus(); }
    });
  });

  // Semáforo de normas: misma lógica que standards.js (evaluate). El servidor vuelve a calcularlo al guardar.
  // data-std: las comprobaciones; data-std-labels: los textos. Los botones «Usar …» copian el valor encontrado en el Excel.
  document.querySelectorAll('[data-std]').forEach((box) => {
    const checks = JSON.parse(box.dataset.std);
    const labels = JSON.parse(box.dataset.stdLabels);
    const parse = (v) => { const m = String(v || '').replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
    const field = (key) => box.querySelector(`[name="s_${key}"]`);
    const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    const update = () => {
      const energy = parse(field('energy') && field('energy').value);
      const count = { in: 0, out: 0, none: 0 };
      checks.forEach((c) => {
        const raw = field(c.key) ? field(c.key).value : '';
        let status;
        if (c.kind === 'absence') status = raw === 'absent' ? 'in' : raw === 'present' ? 'high' : 'none';
        else {
          let v = parse(raw);
          if (v != null && c.ratio && v > 1 && v <= 100) v /= 100;
          if (v != null && c.perEnergy) v = energy > 0 ? (v * c.perEnergy) / energy : null;
          status = v == null ? 'none' : c.min != null && v < c.min ? 'low' : c.max != null && v > c.max ? 'high' : 'in';
        }
        const tone = status === 'in' ? 'in' : status === 'none' ? 'none' : 'out';
        count[tone] += 1;
        const chip = box.querySelector(`template[data-chip="${tone}"]`).content.firstElementChild.cloneNode(true);
        chip.querySelector('b').textContent = c.kind === 'absence' && status === 'high' ? labels.present : labels[status];
        box.querySelector(`[data-status="${c.key}"]`).replaceChildren(chip);
      });
      const parts = [fill(labels.inRange, { n: count.in, total: checks.length })];
      if (count.out) parts.push(fill(labels.outCount, { n: count.out }));
      if (count.none) parts.push(fill(labels.noneCount, { n: count.none }));
      box.querySelector('[data-std-summary]').textContent = parts.join(' · ');
    };
    box.addEventListener('input', update);
    box.addEventListener('change', update);
    box.querySelectorAll('[data-fill]').forEach((btn) => {
      btn.hidden = false;
      btn.addEventListener('click', () => {
        const input = field(btn.dataset.fill.replace(/^s_/, ''));
        input.value = btn.dataset.value;
        btn.closest('.std-sug').remove();
        update();
        input.focus();
      });
    });
  });
})();
