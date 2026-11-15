// Idiomas de la web pública y de la zona de usuarios. El panel de administración va siempre en español.
// Los textos están en locales/<código>.json. Para añadir un idioma: copia es.json, tradúcelo y añádelo a LANGS.
// Si falta una clave en un idioma, se usa la española.
const LANGS = {
  es: { name: 'Español', locale: 'es-ES' },
  en: { name: 'English', locale: 'en-GB' },
  fr: { name: 'Français', locale: 'fr-FR' },
  it: { name: 'Italiano', locale: 'it-IT' },
};
const DEFAULT = 'es';
const COOKIE = 'lang';

const TEXTS = Object.fromEntries(Object.keys(LANGS).map((code) => [code, require(`./locales/${code}.json`)]));
const lookup = (code, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), TEXTS[code]);

// t('signup.found', { n: 3, q: 'sorgo' }): {n} y {q} se sustituyen; si el texto tiene formas one/other, elige según n.
function translator(code) {
  const plural = new Intl.PluralRules(LANGS[code].locale);
  return (key, vars = {}) => {
    let text = lookup(code, key) ?? lookup(DEFAULT, key);
    if (text == null) return key;
    // La forma (one/other) sale de count o, si no se pasa, de n (así {n} puede llevar HTML alrededor del número).
    if (typeof text === 'object' && !Array.isArray(text) && 'other' in text) text = text[plural.select(Number(vars.count ?? vars.n) || 0)] ?? text.other;
    if (typeof text !== 'string') return text;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  };
}
const T = Object.fromEntries(Object.keys(LANGS).map((code) => [code, translator(code)]));

// Idioma de la petición: el elegido en el selector (cookie) o, la primera vez, el del navegador.
function pickLang(req) {
  const saved = (req.headers.cookie || '').match(/(?:^|;\s*)lang=(\w+)/);
  if (saved && LANGS[saved[1]]) return saved[1];
  return req.acceptsLanguages(...Object.keys(LANGS)) || DEFAULT;
}

module.exports = { LANGS, DEFAULT, COOKIE, T, pickLang };
