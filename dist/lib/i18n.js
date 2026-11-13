// Idiomas no processo principal (#2531): carrega os textos de locales/<idioma>/ e mantém o idioma atual da interface.
// Desde a 0.21.0 (#2601), um arquivo por tela ou recurso: locales/<idioma>/<área>.json guarda o conteúdo da área
// (dash.json → chaves "dash.…"), para que PRs em telas diferentes não mexam no mesmo arquivo.
// O núcleo (t, plurais, formatos) está em src/i18n.js, que a interface também usa.
const fs = require('fs');
const path = require('path');
const core = require('../src/i18n.js');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const loaded = new Map();

// Áreas de um idioma, na ordem do nome do arquivo (o mesmo em pt-BR, en e es; test/i18n.tests.js confere).
function areasOf(locale) {
  try { return fs.readdirSync(path.join(LOCALES_DIR, locale)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort(); } catch (_) { return []; }
}

function messagesFor(locale) {
  if (!loaded.has(locale)) {
    const m = {};
    for (const area of areasOf(locale)) {
      // Um arquivo com JSON inválido derruba só a própria área (as chaves caem no inglês de reserva).
      try { m[area] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, `${area}.json`), 'utf8')); } catch (_) { /* área ilegível */ }
    }
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
  areasOf,
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
