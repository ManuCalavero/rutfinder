// Único JavaScript de la app: plegar/desplegar la barra lateral del admin y recordarlo en este navegador.
// Se carga en <head> para aplicar el estado antes de pintar la página (sin parpadeo).
(function () {
  var KEY = 'rutfinder.sidebar';
  var root = document.documentElement;
  var sync = function () {
    var button = document.querySelector('[data-toggle-sidebar]');
    if (button) button.setAttribute('aria-expanded', String(!root.classList.contains('sidebar-collapsed')));
  };
  try { if (localStorage.getItem(KEY) === 'collapsed') root.classList.add('sidebar-collapsed'); } catch (e) {}
  document.addEventListener('DOMContentLoaded', sync);
  document.addEventListener('click', function (event) {
    if (!event.target.closest('[data-toggle-sidebar]')) return;
    var collapsed = root.classList.toggle('sidebar-collapsed');
    try { localStorage.setItem(KEY, collapsed ? 'collapsed' : 'open'); } catch (e) {}
    sync();
  });
})();
