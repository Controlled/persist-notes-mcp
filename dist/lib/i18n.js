// Idiomas no processo principal (#2531): carrega locales/<idioma>.json e mantém o idioma atual da interface.
// O núcleo (t, plurais, formatos) está em src/i18n.js, que a interface também usa.
const fs = require('fs');
const path = require('path');
const core = require('../src/i18n.js');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const loaded = new Map();

function messagesFor(locale) {
  if (!loaded.has(locale)) {
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8')); } catch (_) { /* idioma sem arquivo */ }
    loaded.set(locale, m);
  }
  return loaded.get(locale);
}

// Instância para um idioma (com o inglês de reserva para chaves que faltem).
const forLocale = locale => core.create(locale, messagesFor(locale), locale === core.FALLBACK ? null : messagesFor(core.FALLBACK));

let current = forLocale('pt-BR');
const listeners = new Set();

function setLocale(locale) {
  const next = core.SUPPORTED.includes(locale) ? locale : core.FALLBACK;
  if (next === current.locale) return current;
  current = forLocale(next);
  for (const fn of listeners) { try { fn(current); } catch (_) { /* um ouvinte com erro não para os outros */ } }
  return current;
}

module.exports = {
  ...core,
  LOCALES_DIR,
  messagesFor,
  forLocale,
  setLocale,
  get current() { return current; },
  locale: () => current.locale,
  t: (key, vars) => current.t(key, vars),
  fmt: () => current.fmt,
  onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  // Testes: limpa o cache dos arquivos.
  _reload: () => { loaded.clear(); current = forLocale(current.locale); },
};
