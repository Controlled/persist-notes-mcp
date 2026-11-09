// Idiomas da interface (#2531): t(chave, variáveis), plurais e formatos por idioma (Intl).
// Implementação própria e pequena, sem dependências. Fica em src/ porque a interface a carrega por <script>
// (sem bundler); lib/i18n.js reexporta para o processo principal, o MCP e os testes.
//
// Mensagens: JSON aninhado por área ({ "sidebar": { "home": "Início" } }) e lidas por "sidebar.home".
// Variáveis: "Olá, {name}". Plural: objeto com as categorias do Intl.PluralRules ({ "one": "…", "other": "…" }),
// escolhido pela variável "count" (e "{count}" já sai formatado no idioma).
(function (root) {
const SUPPORTED = ['pt-BR', 'en', 'es'];
const FALLBACK = 'en';

// Idioma da interface: escolha do usuário ('pt-BR' | 'en' | 'es') ou, em 'auto', o primeiro idioma do sistema
// (pt → pt-BR, es → es, qualquer outro → en).
function resolveLocale(pref, systemLangs) {
  if (SUPPORTED.includes(pref)) return pref;
  return fromSystem(Array.isArray(systemLangs) ? systemLangs[0] : systemLangs);
}
function fromSystem(tag) {
  const l = String(tag || '').toLowerCase();
  if (l.startsWith('pt')) return 'pt-BR';
  if (l.startsWith('es')) return 'es';
  return 'en';
}
// 'pt-BR' → 'pt' (idioma de duas letras, usado no conteúdo e no e-mail).
const lang2 = locale => String(locale || '').slice(0, 2).toLowerCase();

function lookup(messages, key) {
  let v = messages;
  for (const part of String(key).split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[part];
  }
  return v;
}

function create(locale, messages, fallbackMessages) {
  const loc = SUPPORTED.includes(locale) ? locale : FALLBACK;
  const plural = new Intl.PluralRules(loc);
  const nf = new Intl.NumberFormat(loc);
  const cache = new Map();
  const dtf = opts => {
    const k = JSON.stringify(opts);
    if (!cache.has(k)) cache.set(k, new Intl.DateTimeFormat(loc, opts));
    return cache.get(k);
  };

  function fill(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (m, name) => {
      if (!vars || vars[name] === undefined || vars[name] === null) return m;
      const v = vars[name];
      return typeof v === 'number' ? nf.format(v) : String(v);
    });
  }

  function t(key, vars) {
    let v = lookup(messages, key);
    if (v === undefined && fallbackMessages) v = lookup(fallbackMessages, key);
    if (v === undefined) return key;
    if (v && typeof v === 'object') {
      const n = vars && typeof vars.count === 'number' ? vars.count : 0;
      v = v[plural.select(n)] ?? v.other ?? '';
    }
    return fill(v, vars);
  }
  const has = key => lookup(messages, key) !== undefined;

  const HOUR = loc === 'en' ? 'numeric' : '2-digit'; // "2:30 PM" · "14:30"
  const toDate = d => (d instanceof Date ? d : new Date(d));
  const fmt = {
    number: (n, opts) => (opts ? new Intl.NumberFormat(loc, opts) : nf).format(n),
    // "8 de novembro de 2026" / "November 8, 2026" / "8 de noviembre de 2026"
    dateLong: d => dtf({ day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(d)),
    // "8 de nov." / "Nov 8"
    dateShort: d => dtf({ day: 'numeric', month: 'short' }).format(toDate(d)),
    // "08/11/2026" / "11/08/2026"
    dateNumeric: d => dtf({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(toDate(d)),
    // "08/11" / "11/08"
    dayMonth: d => dtf({ day: '2-digit', month: '2-digit' }).format(toDate(d)),
    weekday: d => dtf({ weekday: 'long' }).format(toDate(d)),
    weekdayShort: d => dtf({ weekday: 'short' }).format(toDate(d)),
    time: d => dtf({ hour: HOUR, minute: '2-digit' }).format(toDate(d)),
    dateTime: d => dtf({ day: 'numeric', month: 'long', year: 'numeric', hour: HOUR, minute: '2-digit' }).format(toDate(d)),
    dateTimeShort: d => dtf({ day: '2-digit', month: '2-digit', year: 'numeric', hour: HOUR, minute: '2-digit' }).format(toDate(d)),
    // Duração em segundos: "45 min", "1 h 05 min" (pt/es) · "45 min", "1 h 05 min" (en). Os formatos vêm das mensagens.
    duration: sec => {
      const m = Math.round(Math.max(0, sec || 0) / 60);
      if (m < 60) return t('fmt.minutes', { m: String(m) });
      return t('fmt.hoursMinutes', { h: String(Math.floor(m / 60)), mm: String(m % 60).padStart(2, '0') });
    },
    // Horas do medidor: 12000 s → "3 h 20"; 2700 → "45 min"; 18000 → "5 h".
    hours: sec => {
      const s = Math.max(0, Math.round(sec || 0));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      if (!h) return t('fmt.minutes', { m: String(m) });
      return m ? t('fmt.hoursShort', { h: String(h), mm: String(m).padStart(2, '0') }) : t('fmt.hoursOnly', { h: String(h) });
    },
    // "há 3 dias", "in 2 days"…
    relative: (value, unit) => new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }).format(value, unit),
    // "Ana, Bruno e Carla" / "Ana, Bruno, and Carla"
    list: items => new Intl.ListFormat(loc, { style: 'long', type: 'conjunction' }).format(items.map(String)),
    // Nome de um idioma no idioma da interface: 'es' → "espanhol" / "Spanish" / "español".
    languageName: code => {
      try { return new Intl.DisplayNames([loc], { type: 'language' }).of(code) || code; } catch (_) { return code; }
    },
  };

  return { locale: loc, lang: lang2(loc), t, has, fmt };
}

// Chaves (com caminho) de um objeto de mensagens; plurais contam como uma chave só.
function keysOf(messages, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(messages || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !isPlural(v)) out.push(...keysOf(v, p));
    else out.push(p);
  }
  return out;
}
const PLURAL_CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const isPlural = v => v && typeof v === 'object' && Object.keys(v).length > 0 && Object.keys(v).every(k => PLURAL_CATS.includes(k)) && 'other' in v;

// Interface: aplica as mensagens no HTML estático.
//   data-i18n="chave"                 → textContent
//   data-i18n-html="chave"            → innerHTML (só textos nossos, com <strong>/<br>/<a>)
//   data-i18n-attr="placeholder:chave;title:chave;aria-label:chave"
function applyDom(doc, i18n) {
  doc.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = i18n.t(el.dataset.i18n); });
  doc.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = i18n.t(el.dataset.i18nHtml); });
  doc.querySelectorAll('[data-i18n-attr]').forEach(el => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) el.setAttribute(attr, i18n.t(key));
    }
  });
  if (doc.documentElement) doc.documentElement.lang = i18n.locale;
}

const api = { SUPPORTED, FALLBACK, resolveLocale, fromSystem, lang2, create, keysOf, isPlural, lookup, applyDom };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.I18n = api;
})(typeof self !== 'undefined' ? self : this);
