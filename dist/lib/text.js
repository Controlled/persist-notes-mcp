// Utilitários de texto: normalização para busca (sem acentos, minúsculas).

// "Reunião" → "reuniao". Usado no texto indexado e no termo buscado.
function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Quebra a consulta em termos normalizados.
function queryTerms(q) {
  return normalize(q).split(/\s+/).filter(Boolean);
}

// Todos os termos aparecem no texto (já normalizado)?
function matchesAll(normalizedText, q) {
  return queryTerms(q).every(t => normalizedText.includes(t));
}

module.exports = { normalize, queryTerms, matchesAll };
