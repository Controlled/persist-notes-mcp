// Guarda de caminhos: os handlers de nota só podem tocar arquivos dentro da pasta de notas.
const path = require('path');
const i18n = require('./i18n');

// true se "p" está dentro de "root" (ou é o próprio root).
function isInside(root, p) {
  if (!root || !p) return false;
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Lança erro com mensagem útil se o arquivo estiver fora da pasta de notas.
function assertInside(root, p) {
  if (!isInside(root, p)) {
    throw new Error(i18n.t('errors.outsideNotes'));
  }
  return path.resolve(p);
}

module.exports = { isInside, assertInside };
