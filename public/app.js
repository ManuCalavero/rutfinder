// Único JavaScript de la app. Todo funciona sin él; solo mejora dos cosas:
// 1) Plegar/desplegar el menú lateral y recordarlo en este navegador.
// 2) Pestañas del formulario de producto (sin JavaScript se ven todos los grupos seguidos).
// Se carga en <head> para aplicar el estado del menú antes de pintar la página (sin parpadeo).
(function () {
  var KEY = 'rutfinder.sidebar';
  var root = document.documentElement;
  var syncSidebar = function () {
    var button = document.querySelector('[data-toggle-sidebar]');
    if (button) button.setAttribute('aria-expanded', String(!root.classList.contains('sidebar-collapsed')));
  };
  try { if (localStorage.getItem(KEY) === 'collapsed') root.classList.add('sidebar-collapsed'); } catch (e) {}

  function setupTabs(box) {
    var tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]'));
    var select = function (tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    };
    box.querySelector('[role="tablist"]').hidden = false;
    box.classList.add('tabs-on');
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab); });
      tab.addEventListener('keydown', function (e) {
        var next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        select(tabs[(next + tabs.length) % tabs.length], true);
      });
    });
    select(tabs[0]);
  }

  document.addEventListener('DOMContentLoaded', function () {
    syncSidebar();
    Array.prototype.forEach.call(document.querySelectorAll('[data-tabs]'), setupTabs);
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('[data-toggle-sidebar]')) return;
    var collapsed = root.classList.toggle('sidebar-collapsed');
    try { localStorage.setItem(KEY, collapsed ? 'collapsed' : 'open'); } catch (e) {}
    syncSidebar();
  });

  // Vista de productos: alternar entre grid y tabla
  var VIEW_KEY = 'rutfinder.products-view';
  var viewButtons = Array.prototype.slice.call(document.querySelectorAll('.view-toggle'));
  if (viewButtons.length) {
    var savedView = null;
    try { savedView = localStorage.getItem(VIEW_KEY) || 'grid'; } catch (e) { savedView = 'grid'; }

    var showView = function (view) {
      Array.prototype.forEach.call(document.querySelectorAll('.products-view'), function (el) {
        el.hidden = el.dataset.view !== view;
      });
      Array.prototype.forEach.call(viewButtons, function (btn) {
        btn.classList.toggle('active', btn.dataset.toggleView === view);
      });
      try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}
    };

    viewButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        showView(btn.dataset.toggleView);
      });
      if (btn.dataset.toggleView === savedView) btn.classList.add('active');
    });

    showView(savedView);
  }
})();
