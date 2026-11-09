// Idioma predominante de um texto (#2534): pt, en ou es, por contagem de palavras muito frequentes.
// Serve de dica para o Claude (que decide o idioma do resumo) e para escolher os títulos das seções
// quando ainda não há resumo. Sem rede e sem modelo: só listas curtas de palavras de cada idioma.
const { normalize } = require('./text');

// Palavras comuns e exclusivas o bastante de cada idioma (sem acento, como sai do normalize).
const WORDS = {
  pt: 'nao voce entao isso esse essa tambem mais muito ele ela eles elas com uma uns umas pra para porque quando onde como ate seu sua nos gente tem estao esta fazer ficou vai vou foi sao sim obrigado agora aqui depois ainda ja mas ou nao ne tipo coisa',
  en: 'the and you that this with have what for not are was but they will would there their about just like know think yeah okay right going can because when where how who which also from been our your we it is of to in on does did',
  es: 'los las del pero esto eso esta este como porque cuando donde entonces tambien muy hay tiene tienen vamos bueno pues usted ustedes nosotros ellos ellas hacer fue son si gracias ahora aqui despues todavia ya mas y el un una con para',
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, new Set(w.split(/\s+/))]));
// Palavras que existem em pt e es com o mesmo sentido não decidem nada.
const SHARED = new Set([...SETS.pt].filter(w => SETS.es.has(w)));

// Devolve { lang, scores } com lang = 'pt' | 'en' | 'es' | null (texto curto ou sem maioria clara).
function detectLanguage(text, { minWords = 20 } = {}) {
  const words = normalize(String(text || '')).replace(/\*\*[^*]+\*\*:?/g, ' ').match(/[a-z]+/g) || [];
  const scores = { pt: 0, en: 0, es: 0 };
  for (const w of words) {
    if (SHARED.has(w)) continue;
    for (const l of Object.keys(SETS)) if (SETS[l].has(w)) scores[l]++;
  }
  const total = scores.pt + scores.en + scores.es;
  if (words.length < minWords || total < 5) return { lang: null, scores };
  const [best, second] = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return { lang: best[1] >= second[1] * 1.3 ? best[0] : null, scores };
}

// Idioma predominante de várias reuniões (lista de 'pt' | 'en' | 'es' | null): o mais frequente; empate → null.
function predominant(langs) {
  const n = {};
  for (const l of langs) if (l) n[l] = (n[l] || 0) + 1;
  const [best, second] = Object.entries(n).sort((a, b) => b[1] - a[1]);
  if (!best) return null;
  return second && second[1] === best[1] ? null : best[0];
}

module.exports = { detectLanguage, predominant };
