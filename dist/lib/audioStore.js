// Onde ficam os áudios guardados das reuniões (#2605).
// - 'notes' (padrão): na subpasta audio/ ao lado da nota, "<nome da nota> - microphone.wav".
// - 'local': só neste computador, em <userData>/audio, "<id da nota> - microphone.wav". O id do frontmatter
//   não muda ao renomear ou mover a nota, então renomear/mover não mexe nos áudios.
// Os nomes "microphone"/"system" e a pasta audio/ são identificadores fixos do formato (em inglês).
const fs = require('fs');
const path = require('path');

const KINDS = ['microphone', 'system'];
const AUDIO_DIR = 'audio';
const SKIP_DIRS = new Set(['attachments', 'summaries', 'node_modules']);

let cfg = { getMode: () => 'notes', localRoot: '' };

// getMode: função que devolve 'notes' | 'local' (lida a cada uso, a configuração pode mudar).
function configure({ getMode, mode, localRoot } = {}) {
  cfg = {
    getMode: typeof getMode === 'function' ? getMode : () => mode || 'notes',
    localRoot: localRoot || ''
  };
}
const mode = () => (cfg.localRoot && cfg.getMode() === 'local' ? 'local' : 'notes');
const localRoot = () => cfg.localRoot;

const notesLib = () => require('./notes');
const noteId = file => { try { return notesLib().parseFrontmatter(fs.readFileSync(file, 'utf8')).meta.id || ''; } catch (_) { return ''; } };
const isWav = f => f.toLowerCase().endsWith('.wav');

// Áudios na pasta audio/ ao lado da nota (nomes fixos).
function notesAudioFiles(file) {
  const dir = path.join(path.dirname(file), AUDIO_DIR);
  const base = path.basename(file, '.md');
  return KINDS.map(k => path.join(dir, `${base} - ${k}.wav`)).filter(p => fs.existsSync(p));
}

// Áudios da nota guardados só neste computador (pelo id; "(2)" de uma colisão também conta).
function localAudioFiles(id, root = cfg.localRoot) {
  if (!id || !root) return [];
  let names;
  try { names = fs.readdirSync(root); } catch (_) { return []; }
  return names.filter(n => n.startsWith(`${id} - `) && isWav(n)).sort().map(n => path.join(root, n));
}

// Todos os áudios de uma nota, nos dois lugares (sobras de uma mudança interrompida também aparecem).
function audioFilesFor(file) {
  const out = notesAudioFiles(file);
  if (cfg.localRoot) out.push(...localAudioFiles(noteId(file)));
  return out;
}

// Caminho para gravar o áudio de uma nota nova. kind: 'microphone' | 'system'. id: o do frontmatter.
function targetFor(file, kind, id) {
  if (mode() === 'local') return path.join(cfg.localRoot, `${id} - ${kind}.wav`);
  return path.join(path.dirname(file), AUDIO_DIR, `${path.basename(file, '.md')} - ${kind}.wav`);
}

// Nome livre na pasta: "x.wav", "x (2).wav"…; nunca sobrescreve.
function uniqueFile(dest) {
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(dest), stem = dest.slice(0, -ext.length);
  for (let i = 2; ; i++) { const c = `${stem} (${i})${ext}`; if (!fs.existsSync(c)) return c; }
}

// Move um arquivo. Entre discos (EXDEV): copia, confere o tamanho e manda o original para a Lixeira.
async function moveFile(src, dest, trash) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.renameSync(src, dest); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  if (fs.statSync(dest).size !== fs.statSync(src).size) {
    try { fs.rmSync(dest, { force: true }); } catch (_) {}
    throw new Error('copy size mismatch');
  }
  await trash(src);
}

// Notas (.md) da pasta de notas, em todas as subpastas (sem as pastas reservadas e ocultas).
function walkNotes(root) {
  const out = [];
  const walk = dir => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== AUDIO_DIR && !SKIP_DIRS.has(e.name)) walk(p); }
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md') && !e.name.startsWith('_')) out.push(p);
    }
  };
  walk(root);
  return out;
}

// Remove a pasta audio/ se ficou vazia (só se vazia: rmdirSync falha se houver algo).
function removeIfEmpty(dir) {
  try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch (_) {}
}

// Pasta de notas → este computador. Notas sem id ganham um no frontmatter antes.
// Devolve { moved, failed } (número de arquivos). trash(p): Lixeira (só usado entre discos).
async function moveToLocal(notesDir, { localRoot: root = cfg.localRoot, trash } = {}) {
  if (!root) throw new Error('localRoot');
  const r = { moved: 0, failed: 0 };
  const dirs = new Set();
  for (const file of walkNotes(notesDir)) {
    const audios = notesAudioFiles(file);
    if (!audios.length) continue;
    dirs.add(path.dirname(audios[0]));
    let id;
    try { id = notesLib().ensureId(file); } catch (_) { r.failed += audios.length; continue; }
    const base = path.basename(file, '.md');
    for (const a of audios) {
      const kind = path.basename(a, '.wav').slice(base.length + 3);
      try { await moveFile(a, uniqueFile(path.join(root, `${id} - ${kind}.wav`)), trash); r.moved++; }
      catch (_) { r.failed++; }
    }
  }
  for (const d of dirs) removeIfEmpty(d);
  return r;
}

// Este computador → pasta de notas (audio/ ao lado de cada nota). Áudios sem nota ficam onde estão.
async function moveToNotes(notesDir, { localRoot: root = cfg.localRoot, trash } = {}) {
  const r = { moved: 0, failed: 0 };
  if (!root || !fs.existsSync(root)) return r;
  for (const file of walkNotes(notesDir)) {
    const id = noteId(file);
    const audios = localAudioFiles(id, root);
    if (!audios.length) continue;
    const base = path.basename(file, '.md');
    const dir = path.join(path.dirname(file), AUDIO_DIR);
    for (const a of audios) {
      const kind = path.basename(a, '.wav').slice(id.length + 3).replace(/ \(\d+\)$/, '');
      try { await moveFile(a, uniqueFile(path.join(dir, `${base} - ${kind}.wav`)), trash); r.moved++; }
      catch (_) { r.failed++; }
    }
  }
  return r;
}

// Quantos áudios estão na pasta de notas (para saber se o aviso tem o que oferecer).
function countNotesAudio(notesDir) {
  return walkNotes(notesDir).reduce((n, f) => n + notesAudioFiles(f).length, 0);
}

module.exports = {
  KINDS, AUDIO_DIR, configure, mode, localRoot, notesAudioFiles, localAudioFiles, audioFilesFor, targetFor,
  uniqueFile, moveFile, moveToLocal, moveToNotes, countNotesAudio, walkNotes
};
