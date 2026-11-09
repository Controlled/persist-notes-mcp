// Leitura e escrita dos arquivos .md das reuniões.
const fs = require('fs');
const path = require('path');
const { normalize } = require('./text');
const attachments = require('./attachments');
const vocab = require('./vocab');

// Títulos e textos fixos em português (as notas criadas até a v0.12). As funções abaixo reconhecem
// também os equivalentes em inglês e espanhol (lib/vocab.js) e escrevem no idioma do conteúdo da nota.
const TRANSCRIPT_HEADING = '## Transcrição';
// Anotações do usuário (#2507): seção própria, entre o resumo e a transcrição.
const ANNOTATIONS_HEADING = '## Anotações';
// Identificadores do formato do arquivo: sempre em inglês, em qualquer idioma (README, "Fixed identifiers").
const PERIOD_DIR = 'summaries';            // resumos de período: <pasta de notas>/summaries/
const PERIOD_KIND = 'period_summary';      // valor do campo "type" no frontmatter deles
const SUMMARY_PENDING = vocab.NOTE_TEXT.summaryPending.pt;
// Nota viva (#2506): criada ao iniciar a gravação. Estados no frontmatter (status): recording → processing → done.
const REC_PENDING = vocab.NOTE_TEXT.recPending.pt;
const STATE = { recording: 'recording', processing: 'processing', done: 'done' };
const SOURCE = { recording: 'recording', import: 'imported' };
const PENDING_TEXTS = [...vocab.noteTexts('summaryPending'), ...vocab.noteTexts('recPending')];
const isPendingSummary = text => PENDING_TEXTS.some(p => String(text || '').includes(p));
// Idioma do conteúdo da nota (títulos das seções); sem título reconhecido, o idioma dos arquivos.
const noteLang = md => vocab.contentLang(md) || vocab.getFileLang();

function yamlStr(s) { return JSON.stringify(String(s ?? '')); }

function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch (_) { v = v.slice(1, -1); } }
    else if (/^\[.*\]$/.test(v)) { try { v = JSON.parse(v); } catch (_) { /* mantém texto */ } }
    meta[kv[1]] = v;
  }
  return { meta, body: md.slice(m[0].length) };
}

function fmtDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

function fmtDateLong(d, lang = 'pt') {
  return vocab.dateLine(d, '', lang);
}

function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = n => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

// lang: idioma do conteúdo (títulos das seções, linha de data, aviso de resumo pendente).
// O frontmatter é identificador do formato: sempre em inglês, em qualquer idioma (README, "Fixed identifiers").
function buildMarkdown({ title, date, durationSec, source, summary, transcriptMd, extra, annotations, lang = vocab.getFileLang() }) {
  let md = [
    '---',
    `title: ${yamlStr(title)}`,
    `date: ${isoLocal(date)}`,
    `duration: ${yamlStr(fmtDuration(durationSec))}`,
    `duration_seconds: ${Math.round(durationSec)}`,
    `source: ${yamlStr(source)}`,
    '---',
    '',
    `# ${title}`,
    '',
    `*${vocab.dateLine(date, fmtDuration(durationSec), lang)}*`,
    '',
    (summary && summary.trim()) || vocab.noteText('summaryPending', lang),
    '',
    '---',
    '',
    vocab.heading('transcript', lang),
    '',
    transcriptMd,
    ''
  ].join('\n');
  // Campos opcionais do frontmatter (ex.: falantes, evento, convidados, id).
  for (const [k, v] of Object.entries(extra || {})) {
    if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length) && v !== '') md = setFrontmatterField(md, k, v);
  }
  return annotations ? setAnnotations(md, annotations) : md;
}

function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'meeting';
}

function fileNameFor(date, title) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}h${pad(date.getMinutes())} - ${slugify(title)}.md`;
}

function uniquePath(dir, name) {
  let p = path.join(dir, name), i = 2;
  while (fs.existsSync(p)) p = path.join(dir, name.replace(/\.md$/, ` (${i++}).md`));
  return p;
}

function writeNote(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  const file = uniquePath(dir, fileNameFor(data.date, data.title));
  fs.writeFileSync(file, buildMarkdown(data));
  return file;
}

// Cache por arquivo: só relê o .md quando mtime ou tamanho mudam.
const noteCache = new Map(); // file → { mtimeMs, size, entry }
const cacheStats = { reads: 0 };

function readEntry(file, name) {
  const stat = fs.statSync(file);
  const hit = noteCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.entry;
  cacheStats.reads++;
  const md = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(md);
  const titleFromBody = (/^#\s+(.+)$/m.exec(body) || [])[1];
  const entry = {
    file, name,
    title: meta.title || titleFromBody || name.replace(/\.md$/, ''),
    date: meta.date || stat.mtime.toISOString(),
    duration: meta.duration || '',
    hasSummary: !isPendingSummary(md),
    id: meta.id || '',
    state: meta.status || '',         // 'recording' | 'processing' | 'done' | '' (notas antigas)
    recId: meta.recording || '',       // pasta da gravação em andamento (recuperação)
    suggestedProject: meta.suggested_project || '',
    speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
    // Resumo de período (Resumos/): aparece na busca e no MCP, não na lista de reuniões.
    kind: meta.type === PERIOD_KIND ? 'periodo' : meta.type === NOTE_KIND ? 'nota' : 'reuniao',
    lang: vocab.contentLang(body),
    ...(meta.type === PERIOD_KIND ? { periodFrom: meta.period_start || '', periodTo: meta.period_end || '', date: meta.generated_at || stat.mtime.toISOString() } : {}),
    mtimeMs: stat.mtimeMs,
    text: normalize(md)
  };
  noteCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
  return entry;
}

// Pastas de projeto: subpastas da pasta de notas, exceto audio/, Resumos/, anexos/, ocultas (.) e internas (_).
const RESERVED_DIRS = new Set(['audio', PERIOD_DIR.toLowerCase(), attachments.ATTACH_DIR]);
const isProjectDir = name => !!name && !name.startsWith('.') && !name.startsWith('_') && !RESERVED_DIRS.has(name.toLowerCase());
const isNoteFile = f => f.toLowerCase().endsWith('.md') && !f.startsWith('_') && !f.startsWith('.');

// Projetos em dois níveis (0.16.0, #2554): uma pasta da raiz é um grupo ("projeto-pai", só agrupamento) quando tem
// o marcador _group.md ou alguma subpasta de projeto. As subpastas do grupo são os sub-projetos (nome 'Pai/Filho').
const GROUP_FILE = '_group.md';
function projectSubdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && isProjectDir(d.name)).map(d => d.name); } catch (_) { return []; }
}
function isGroupDir(dir) {
  return fs.existsSync(path.join(dir, GROUP_FILE)) || projectSubdirs(dir).length > 0;
}
// O projeto da nota bate com o filtro: o próprio projeto ou, se o filtro é um grupo, qualquer filho dele.
const matchesProject = (project, filter) => project === filter || (!!filter && String(project || '').startsWith(filter + '/'));

function readDirNotes(dir, project) {
  return fs.readdirSync(dir).filter(isNoteFile).map(f => {
    try { return { ...readEntry(path.join(dir, f), f), project }; } catch (_) { return null; }
  }).filter(Boolean);
}

// Reuniões da raiz (sem projeto) e de cada pasta de projeto, da mais recente para a mais antiga.
// options.project: só as de um projeto ('' = só as sem projeto).
function listNotes(dir, options = {}) {
  if (!fs.existsSync(dir)) return [];
  let out = [];
  const only = options.project;
  if (only === undefined || only === '') out = readDirNotes(dir, '');
  if (only !== '') {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || !isProjectDir(d.name)) continue;
      const sub = path.join(dir, d.name);
      // Notas soltas direto na pasta do grupo ficam com o nome do grupo (entram no filtro do grupo).
      if (only === undefined || matchesProject(d.name, only)) out.push(...readDirNotes(sub, d.name));
      if (!isGroupDir(sub)) continue;
      for (const c of projectSubdirs(sub)) {
        const name = `${d.name}/${c}`;
        if (only === undefined || matchesProject(name, only)) out.push(...readDirNotes(path.join(sub, c), name));
      }
    }
  }
  return out.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Pasta dos resumos de período (sempre Resumos/).
const periodDir = dir => path.join(dir, PERIOD_DIR);

// Resumos de período salvos em Resumos/, do mais recente para o mais antigo.
function listPeriodSummaries(dir) {
  const sub = periodDir(dir);
  if (!fs.existsSync(sub)) return [];
  return readDirNotes(sub, '').filter(n => n.kind === 'periodo').sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Título "## Transcrição" (em qualquer idioma): { index, length } ou null.
function transcriptHeading(md) {
  const m = vocab.headingRe('transcript').exec(md);
  return m ? { index: m.index, length: m[0].length } : null;
}

function extractTranscript(md) {
  const h = transcriptHeading(md);
  return h ? md.slice(h.index + h.length).trim() : '';
}

// Troca o bloco do resumo (entre a linha de data e a transcrição) por um novo.
function replaceSummary(md, summary, newTitle) {
  const { a, t: i } = locate(md);
  if (i < 0) throw new Error(require('./i18n').t('notes.noTranscriptSection'));
  const end = a >= 0 ? a : i;
  const head = md.slice(0, end);
  const dateLine = /^\*[^*\n]+\*\s*$/m.exec(head);
  let start;
  if (dateLine) start = dateLine.index + dateLine[0].length;
  else { const h1 = /^#\s+.+$/m.exec(head); start = h1 ? h1.index + h1[0].length : 0; }
  let out = md.slice(0, start) + '\n\n' + summary.trim() + '\n\n---\n\n' + md.slice(end);
  if (newTitle) {
    const { meta } = parseFrontmatter(out);
    if (vocab.isDefaultTitle(meta.title)) {
      out = setFrontmatterField(out, 'title', newTitle).replace(/^# .*$/m, () => `# ${newTitle}`);
    }
  }
  return out;
}

// Separa a nota nas partes que a interface mostra: título, linha de data, resumo e transcrição.
function splitNote(md) {
  const { meta, body } = parseFrontmatter(md);
  const { a, t: tIdx } = locate(body);
  const head = a >= 0 ? body.slice(0, a) : tIdx >= 0 ? body.slice(0, tIdx) : body;
  const transcript = tIdx >= 0 ? extractTranscript(body.slice(tIdx)) : '';
  const annotations = annotationsOf(body);
  const lines = head.split('\n');
  let title = meta.title || '', i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (/^#\s+/.test(lines[i] || '')) { title = title || lines[i].replace(/^#\s+/, '').trim(); i++; }
  while (i < lines.length && !lines[i].trim()) i++;
  let dateLine = '';
  if (/^\*[^*].*\*\s*$/.test(lines[i] || '')) { dateLine = lines[i].trim().replace(/^\*|\*$/g, ''); i++; }
  const summary = lines.slice(i).join('\n').replace(/\n-{3,}\s*$/, '').trim();
  const pending = !summary || isPendingSummary(summary);
  return { meta, title, dateLine, summary: pending ? '' : summary, pending, transcript, annotations, state: meta.status || '', lang: vocab.contentLang(body) };
}

// Posição (índice do início da linha) dos títulos "## Anotações" e "## Transcrição" (em qualquer idioma);
// -1 se não houver. As anotações só valem antes da transcrição.
function headingAt(s, kind) {
  const m = vocab.headingRe(kind).exec(s);
  return m ? m.index : -1;
}
function locate(md) {
  const t = headingAt(md, 'transcript');
  const a = headingAt(t < 0 ? md : md.slice(0, t), 'annotations');
  return { a, t };
}

// Texto da seção "## Anotações" ('' se não houver).
function annotationsOf(md) {
  const { a, t } = locate(md);
  if (a < 0) return '';
  const start = a + vocab.headingRe('annotations').exec(md.slice(a))[0].length;
  return md.slice(start, t < 0 ? md.length : t).replace(/\s*\n-{3,}\s*$/, '').trim();
}

// Troca a seção "## Anotações" (texto vazio remove a seção). O resto da nota fica como está.
// Títulos que imitam as seções da nota viram ### para não quebrar a estrutura do arquivo.
function setAnnotations(md, text) {
  const names = [...vocab.sectionNames('annotations'), ...vocab.sectionNames('transcript')].map(vocab.escapeRe).join('|');
  const clean = String(text || '').replace(/\r\n?/g, '\n')
    .replace(new RegExp(`^##(\\s+(?:${names})\\s*)$`, 'gim'), '###$1').trim();
  const lang = noteLang(md);
  const { a, t } = locate(md);
  const end = a >= 0 ? a : t >= 0 ? t : md.length;
  const head = md.slice(0, end).replace(/\s*$/, '').replace(/\n-{3,}$/, '').replace(/\s*$/, '');
  const tail = t >= 0 ? md.slice(t) : '';
  let out = head + '\n\n---\n\n';
  if (clean) out += `${vocab.heading('annotations', lang)}\n\n${clean}\n\n` + (tail ? '---\n\n' : '');
  return tail ? out + tail : out.replace(/\n*(---\n*)?$/, '\n');
}

// Troca o texto da seção "## Transcrição".
function replaceTranscript(md, transcriptMd) {
  const h = transcriptHeading(md);
  if (!h) return md.replace(/\s*$/, '') + `\n\n---\n\n${vocab.heading('transcript', noteLang(md))}\n\n${transcriptMd}\n`;
  return md.slice(0, h.index + h.length).replace(/\r$/, '') + '\n\n' + String(transcriptMd || '').trim() + '\n';
}

// Passa os títulos das seções que o app escreve (Anotações, Transcrição) e o aviso de resumo pendente para
// o idioma do conteúdo (#2534). Usado quando o resumo define o idioma da reunião.
function setNoteLang(md, lang) {
  const l = vocab.toLang(lang);
  let out = md;
  for (const kind of ['annotations', 'transcript']) out = out.replace(vocab.headingRe(kind), () => vocab.heading(kind, l));
  for (const kind of ['summaryPending', 'recPending', 'liveTranscript', 'interrupted']) {
    for (const txt of vocab.noteTexts(kind)) if (txt !== vocab.noteText(kind, l)) out = out.split(txt).join(vocab.noteText(kind, l));
  }
  return out;
}

// ---------- Nota viva (#2506) ----------

const LIVE_TRANSCRIPT = vocab.NOTE_TEXT.liveTranscript.pt;
const isLiveTranscript = md => vocab.noteTexts('liveTranscript').some(t => String(md).includes(t));

// Cria a nota no início da gravação: título provisório, estado "gravando", id da gravação (para a recuperação).
// lang: idioma provável da reunião (o "Idioma falado", se não for "detectar"); senão, o dos arquivos.
function createLiveNote(dir, { date, title, recId, id = newId(), lang = vocab.getFileLang() }) {
  return writeNote(dir, { title, date, durationSec: 0, source: SOURCE.recording, summary: vocab.noteText('recPending', lang), transcriptMd: vocab.noteText('liveTranscript', lang),
    extra: { id, status: STATE.recording, recording: recId }, lang });
}

// Nota sem gravação (0.16.0, + de Reuniões | Notas): como a reunião, sem áudio nem transcrição. Frontmatter com
// type: note; corpo com título, data, resumo pendente e a seção de anotações (onde a pessoa escreve).
const NOTE_KIND = 'note';
function createTextNote(dir, { date = new Date(), title, id = newId(), lang = vocab.getFileLang() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const t = title || vocab.defaultNoteTitle(date, lang);
  const file = uniquePath(dir, fileNameFor(date, t));
  const md = [
    '---', `title: ${yamlStr(t)}`, `date: ${isoLocal(date)}`, `type: ${NOTE_KIND}`, `id: ${id}`, `status: ${STATE.done}`, '---', '',
    `# ${t}`, '', `*${vocab.dateLine(date, '', lang)}*`, '', vocab.noteText('summaryPending', lang), '', '---', '',
    vocab.heading('annotations', lang), '', ''
  ].join('\n');
  fs.writeFileSync(file, md);
  return file;
}

// Gravação encerrada (antes da transcrição final): duração real no frontmatter e na linha de data, e estado
// "processing". Assim a nota e a lista mostram a duração enquanto a transcrição e a separação de vozes rodam.
function setRecordingEnded(md, { date, durationSec }) {
  let out = setFrontmatterField(md, 'duration', fmtDuration(durationSec));
  out = setFrontmatterField(out, 'duration_seconds', Math.round(durationSec));
  out = setFrontmatterField(out, 'status', STATE.processing);
  if (date) out = out.replace(/^\*[^*\n]+\*[ \t]*$/m, () => `*${vocab.dateLine(date, fmtDuration(durationSec), noteLang(out))}*`);
  return out;
}

// Fim da gravação: duração, transcrição final, campos extras; o resumo fica pendente e o estado vira "done".
// As anotações e o título (que o usuário pode ter mudado durante a reunião) ficam como estão.
function finalizeLiveNote(md, { date, durationSec, transcriptMd, extra = {} }) {
  let out = replaceTranscript(md, transcriptMd);
  out = setFrontmatterField(out, 'duration', fmtDuration(durationSec));
  out = setFrontmatterField(out, 'duration_seconds', Math.round(durationSec));
  out = setFrontmatterField(out, 'status', STATE.done);
  out = setFrontmatterField(out, 'recording', null);
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length) && v !== '') out = setFrontmatterField(out, k, v);
  }
  const lang = noteLang(out);
  if (date) out = out.replace(/^\*[^*\n]+\*[ \t]*$/m, () => `*${vocab.dateLine(date, fmtDuration(durationSec), lang)}*`);
  return recToPending(out, lang);
}

// Troca o aviso "gravação em andamento" (em qualquer idioma) pelo de resumo pendente.
function recToPending(md, lang) {
  let out = md;
  for (const t of vocab.noteTexts('recPending')) out = out.split(t).join(vocab.noteText('summaryPending', lang));
  return out;
}

// Gravação interrompida sem áudio para recuperar: a nota sai do estado "gravando" e fica com o que tem.
function closeInterrupted(md) {
  let out = setFrontmatterField(setFrontmatterField(md, 'status', STATE.done), 'recording', null);
  const lang = noteLang(out);
  if (isLiveTranscript(out)) out = replaceTranscript(out, vocab.noteText('interrupted', lang));
  return recToPending(out, lang);
}

// Nota pelo id do frontmatter (o arquivo pode ter sido renomeado ou movido durante a gravação).
function findById(dir, id, hint) {
  if (!id) return hint && fs.existsSync(hint) ? hint : null;
  if (hint && fs.existsSync(hint) && parseFrontmatter(fs.readFileSync(hint, 'utf8')).meta.id === id) return hint;
  const hit = listNotes(dir).find(n => n.id === id);
  return hit ? hit.file : null;
}

// Troca (ou acrescenta) um campo do frontmatter. value null remove o campo.
function setFrontmatterField(md, key, value) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  // Listas de objetos (ex.: shares) vão como JSON numa linha; listas simples, como textos.
  const arr = v => JSON.stringify(v.some(x => x && typeof x === 'object') ? v : v.map(String));
  const line = value === null || value === undefined ? null
    : `${key}: ${Array.isArray(value) ? arr(value) : typeof value === 'number' ? value : yamlStr(value)}`;
  if (!m) return line ? `---\n${line}\n---\n\n${md}` : md;
  const re = new RegExp(`^${key}:.*$`, 'm');
  let fm = m[1];
  if (re.test(fm)) fm = line ? fm.replace(re, () => line) : fm.replace(new RegExp(`^${key}:.*(\\r?\\n)?`, 'm'), '').replace(/\n$/, '');
  else if (line) fm += '\n' + line;
  return md.slice(0, m.index) + `---\n${fm}\n---` + md.slice(m.index + m[0].length);
}

const PREFIX_RE = /^(\d{4}-\d{2}-\d{2} \d{2}h\d{2}) - /;

// Arquivos de áudio guardados de uma nota (na subpasta audio/ ao lado do .md).
function audioFilesFor(file) {
  const dir = path.join(path.dirname(file), 'audio');
  const base = path.basename(file, '.md');
  return ['microphone', 'system'].map(k => path.join(dir, `${base} - ${k}.wav`)).filter(p => fs.existsSync(p));
}

// Renomeia título (frontmatter e H1) e o arquivo, mantendo a data e hora no início do nome.
// Os áudios guardados acompanham. Devolve o caminho novo.
// root (pasta de notas): para levar junto a pasta de anexos.
function renameNote(file, title, root) {
  title = String(title).trim();
  if (!title) throw new Error(require('./i18n').t('notes.emptyTitle'));
  const md = setFrontmatterField(fs.readFileSync(file, 'utf8'), 'title', title).replace(/^# .*$/m, () => `# ${title}`);
  fs.writeFileSync(file, md);
  const name = path.basename(file);
  const pm = PREFIX_RE.exec(name);
  let prefix = pm && pm[1];
  if (!prefix) {
    const d = new Date(parseFrontmatter(md).meta.date || fs.statSync(file).mtime);
    prefix = fileNameFor(isNaN(d) ? new Date() : d, 'x').replace(/ - x\.md$/, '');
  }
  const wanted = `${prefix} - ${slugify(title)}.md`;
  if (wanted === name || wanted.replace(/\.md$/, '') === name.replace(/( \(\d+\))?\.md$/, '')) return file;
  const dest = uniquePath(path.dirname(file), wanted);
  const audios = audioFilesFor(file);
  const relinked = attachments.relink(root, md, file, dest);
  if (relinked !== md) fs.writeFileSync(file, relinked);
  fs.renameSync(file, dest);
  noteCache.delete(file);
  const oldBase = path.basename(file, '.md'), newBase = path.basename(dest, '.md');
  for (const a of audios) fs.renameSync(a, path.join(path.dirname(a), newBase + path.basename(a).slice(oldBase.length)));
  return dest;
}

// Id estável da nota (frontmatter "id"), usado para ligar a reunião às impressões de voz
// sem depender do nome do arquivo. Cria um se a nota ainda não tem.
function ensureId(file) {
  const md = fs.readFileSync(file, 'utf8');
  const { meta } = parseFrontmatter(md);
  if (meta.id) return meta.id;
  const id = newId();
  fs.writeFileSync(file, setFrontmatterField(md, 'id', id));
  return id;
}

function newId() {
  return require('crypto').randomUUID();
}

module.exports = {
  ANNOTATIONS_HEADING, REC_PENDING, STATE, SOURCE, LIVE_TRANSCRIPT, annotationsOf, setNoteLang, noteLang, periodDir, transcriptHeading, isLiveTranscript, setAnnotations, replaceTranscript, locate,
  createLiveNote, createTextNote, NOTE_KIND, setRecordingEnded, finalizeLiveNote, closeInterrupted, findById, isPendingSummary, fmtDateLong,
  ensureId, newId, listPeriodSummaries, isProjectDir, RESERVED_DIRS, GROUP_FILE, isGroupDir, projectSubdirs, matchesProject, PERIOD_DIR, PERIOD_KIND,
  buildMarkdown, writeNote, listNotes, parseFrontmatter, extractTranscript, replaceSummary, splitNote,
  setFrontmatterField, renameNote, audioFilesFor, slugify, uniquePath,
  fileNameFor, fmtDuration, isoLocal, TRANSCRIPT_HEADING, SUMMARY_PENDING, cacheStats
};
