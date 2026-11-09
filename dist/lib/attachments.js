// Anexos das anotações (#2507): imagens coladas na nota ficam em <pasta de notas>/anexos/<nome da nota>/
// e são referenciadas no .md com caminho relativo, entre < > por causa dos espaços: ![](<anexos/… /imagem-1.png>).
// Abrem no app, no Obsidian e no VS Code. Ao renomear ou mover a nota, a pasta e os links acompanham.
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');

// Identificador do formato: sempre "attachments/" e "image-N", em qualquer idioma (README, "Fixed identifiers").
const ATTACH_DIR = 'attachments';
const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const EXT_RE = /\.(png|jpe?g|gif|webp)$/i;

const posix = p => p.split(path.sep).join('/');
const dirFor = (root, noteFile) => path.join(root, ATTACH_DIR, path.basename(noteFile, '.md'));
// Caminho da pasta de anexos visto a partir da pasta da nota ("anexos/X" ou "../anexos/X").
const relDir = (root, noteFile) => posix(path.relative(path.dirname(noteFile), dirFor(root, noteFile)));

// Salva a imagem e devolve o Markdown para inserir no texto.
function saveImage(root, noteFile, data, type) {
  const ext = TYPES[String(type || '').toLowerCase()];
  if (!ext) throw new Error(t('notes.imageType'));
  const buf = Buffer.from(data);
  if (!buf.length) throw new Error(t('notes.imageEmpty'));
  if (buf.length > MAX_BYTES) throw new Error(t('notes.imageTooBig'));
  const dir = dirFor(root, noteFile);
  fs.mkdirSync(dir, { recursive: true });
  let n = 1;
  while (fs.readdirSync(dir).some(f => f.replace(EXT_RE, '') === `image-${n}`)) n++;
  const name = `image-${n}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  const rel = `${relDir(root, noteFile)}/${name}`;
  return { file: path.join(dir, name), rel, markdown: `![](<${rel}>)` };
}

// A nota mudou de nome ou de pasta: renomeia anexos/<nome antigo> e reescreve os links do texto.
// Devolve o Markdown atualizado (igual ao recebido se não havia anexos).
function relink(root, md, oldFile, newFile) {
  if (!root) return md;
  const oldDir = dirFor(root, oldFile), newDir = dirFor(root, newFile);
  const oldRel = relDir(root, oldFile), newRel = relDir(root, newFile);
  if (oldDir !== newDir && fs.existsSync(oldDir)) {
    if (fs.existsSync(newDir)) throw new Error(t('notes.attachDirExists', { dir: posix(path.relative(root, newDir)) }));
    fs.renameSync(oldDir, newDir);
  }
  if (oldRel === newRel) return md;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Links com < > (como o app escreve) e sem (escritos à mão, com espaços em %20).
  return md.replace(new RegExp(`\\]\\(<${esc(oldRel)}/`, 'g'), () => `](<${newRel}/`)
    .replace(new RegExp(`\\]\\(${esc(oldRel.replace(/ /g, '%20'))}/`, 'g'), () => `](${newRel.replace(/ /g, '%20')}/`);
}

// Imagens referenciadas num trecho de Markdown (caminhos relativos à nota, sem < >).
function imageRefs(md) {
  const out = [];
  const re = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))\s*\)/g;
  let m;
  while ((m = re.exec(String(md || '')))) out.push(m[1] || decodeURI(m[2]));
  return out;
}

module.exports = { ATTACH_DIR, MAX_BYTES, TYPES, dirFor, relDir, saveImage, relink, imageRefs, isImagePath: p => EXT_RE.test(p) };
