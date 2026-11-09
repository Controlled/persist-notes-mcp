// Síntese viva do projeto: <pasta do projeto>/_sintese.md, com temas, decisões e links para as reuniões.
// Atualizada de forma incremental: o Claude recebe a síntese atual e só o resumo da reunião nova.
const fs = require('fs');
const path = require('path');
const notes = require('./notes');
const { synthesisFile } = require('./projects');
const vocab = require('./vocab');
const { predominant } = require('./langDetect');
const { t } = require('./i18n');

// Idioma da síntese (#2534): o predominante das reuniões que a compõem; empate ou sem pista, o dos arquivos.
const LANG_NAME = { pt: 'português do Brasil', en: 'inglês', es: 'espanhol' };
const REPLACED = { pt: 'substituída em', en: 'superseded on', es: 'reemplazada el' };

function sectionsHelp(lang) {
  const h = k => vocab.heading(k, lang);
  return `${h('overview')}
<2 a 4 frases: objetivo do projeto e situação atual>

${h('themes')}
- **<tema>** — <situação atual do tema, em uma ou duas frases> (<links das reuniões onde foi tratado>)

${h('decisions')}
- <AAAA-MM-DD> — <decisão> (<link da reunião>)

${h('openIssues')}
- <pendências e dúvidas que continuam sem resposta; omita a seção se não houver>`;
}

function rules(lang) {
  const l = vocab.toLang(lang);
  return `Regras:
- Cite as reuniões usando os links Markdown exatamente como fornecidos, por exemplo [Título](<arquivo.md>).
- Mantenha os links que já existem na síntese.
- Se uma decisão nova substitui uma antiga, mantenha as duas e marque a antiga com "(${REPLACED[l]} AAAA-MM-DD)".
- Seja objetivo e não repita informação. Escreva em ${LANG_NAME[l]}, o idioma predominante destas reuniões, e use exatamente os títulos de seção abaixo.
- Responda SOMENTE com o Markdown das seções abaixo, sem texto antes ou depois.
- Não use ferramentas e não leia arquivos.

${sectionsHelp(l)}`;
}

// Idioma predominante de uma lista de reuniões ({ lang } de cada nota).
const langOf = list => predominant(list.map(n => n && n.lang)) || vocab.getFileLang();

const synthesisPath = projectDir => synthesisFile(projectDir);

// Link Markdown para uma reunião, relativo à pasta do projeto (funciona também no Obsidian/VS Code).
function noteLink(title, fileName) {
  return `[${String(title).replace(/[[\]]/g, '')}](<${fileName}>)`;
}

function isoDay(date) {
  const d = new Date(date);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function readSynthesis(projectDir) {
  const file = synthesisPath(projectDir);
  if (!fs.existsSync(file)) return { exists: false, file, meta: {}, body: '', included: [] };
  const md = fs.readFileSync(file, 'utf8');
  const { meta, body } = notes.parseFrontmatter(md);
  // O corpo editável pelo Claude é tudo entre o título e a seção "## Reuniões" (que o app gera; qualquer idioma).
  let content = body.replace(/^\s*#\s+.*\n?/, '').trim();
  const r = content.search(vocab.headingRe('meetings'));
  if (r >= 0) content = content.slice(0, r).trim();
  return { exists: true, file, meta, body: content, included: Array.isArray(meta.meetings) ? meta.meetings : [] };
}

// Escreve o _sintese.md. A seção "## Reuniões" é montada aqui, a partir das notas incluídas.
function writeSynthesis(projectDir, { project, body, included, noteEntries = [], lang = vocab.getFileLang() }) {
  const byName = new Map(noteEntries.map(n => [path.basename(n.file), n]));
  const list = included.map(name => {
    const n = byName.get(name);
    return `- ${n ? isoDay(n.date) + ' — ' : ''}${noteLink(n ? n.title : name.replace(/\.md$/, ''), name)}`;
  }).reverse();
  const NONE = { pt: '_Nenhuma reunião incluída ainda._', en: '_No meetings included yet._', es: '_Todavía no hay reuniones incluidas._' };
  let md = [
    '---',
    `project: ${JSON.stringify(project)}`,
    `updated: ${new Date().toISOString()}`,
    `meetings: ${JSON.stringify(included)}`,
    '---',
    '',
    `# ${project}`,
    '',
    body.trim(),
    '',
    vocab.heading('meetings', lang),
    '',
    list.length ? list.join('\n') : NONE[vocab.toLang(lang)],
    ''
  ].join('\n');
  fs.writeFileSync(synthesisPath(projectDir), md);
  return synthesisPath(projectDir);
}

function noteBlock(n) {
  return `### ${noteLink(n.title, path.basename(n.file))} — ${isoDay(n.date)}\n\n${n.summary.trim()}`;
}

function buildIncrementalPrompt({ project, current, note, lang = vocab.getFileLang() }) {
  return `Você mantém a síntese viva do projeto "${project}", escrita a partir das atas das reuniões.
Abaixo estão a síntese atual e o resumo de UMA reunião nova. Atualize a síntese incorporando a reunião nova:
mantenha o que continua válido, ajuste o que mudou e acrescente o que é novo.

${rules(lang)}

<sintese_atual>
${current.trim() || '(ainda vazia: esta é a primeira reunião do projeto)'}
</sintese_atual>

<reuniao_nova>
${noteBlock(note)}
</reuniao_nova>`;
}

function buildFullPrompt({ project, notes: list, lang = langOf(list) }) {
  return `Escreva a síntese viva do projeto "${project}" a partir dos resumos das reuniões abaixo, da mais antiga para a mais recente.

${rules(lang)}

<reunioes>
${list.map(noteBlock).join('\n\n')}
</reunioes>`;
}

// Quando uma nota do projeto é renomeada, os links e a lista de reuniões acompanham.
function renameRef(projectDir, oldName, newName) {
  const file = synthesisPath(projectDir);
  if (!fs.existsSync(file) || oldName === newName) return false;
  let md = fs.readFileSync(file, 'utf8');
  if (!md.includes(oldName)) return false;
  md = md.split(`<${oldName}>`).join(`<${newName}>`);
  const { meta } = notes.parseFrontmatter(md);
  if (Array.isArray(meta.meetings)) {
    md = notes.setFrontmatterField(md, 'meetings', meta.meetings.map(n => n === oldName ? newName : n));
  }
  fs.writeFileSync(file, md);
  return true;
}

// Lê uma nota do projeto no formato que os prompts usam. null se ainda não tem resumo.
function noteForPrompt(entry) {
  const parts = notes.splitNote(fs.readFileSync(entry.file, 'utf8'));
  if (parts.pending) return null;
  return { file: entry.file, title: parts.title || entry.title, date: entry.date, summary: parts.summary, lang: parts.lang };
}

const clean = out => String(out || '').trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim()
  .replace(/^[\s\S]*?(?=^## )/m, '');

// Inclui uma reunião na síntese (incremental). ask(prompt) → texto do Claude.
// Não faz nada se a reunião já foi incluída ou ainda não tem resumo.
async function addNote({ projectDir, project, entry, noteEntries, ask }) {
  const name = path.basename(entry.file);
  const cur = readSynthesis(projectDir);
  if (cur.included.includes(name)) return { skipped: 'já incluída' };
  const note = noteForPrompt(entry);
  if (!note) return { skipped: 'sem resumo' };
  // Idioma: o predominante entre as reuniões já incluídas e a nova.
  const byName = new Map(noteEntries.map(n => [path.basename(n.file), n]));
  const lang = langOf([...cur.included.map(n => byName.get(n)), note]);
  const body = clean(await ask(buildIncrementalPrompt({ project, current: cur.body, note, lang })));
  if (!body) throw new Error(t('notes.synthesisEmptyIncremental'));
  writeSynthesis(projectDir, { project, body, included: [...cur.included, name], noteEntries, lang });
  return { updated: true };
}

// Refaz a síntese do zero com todas as reuniões do projeto que têm resumo.
async function rebuild({ projectDir, project, noteEntries, ask }) {
  const list = [...noteEntries].sort((a, b) => new Date(a.date) - new Date(b.date)).map(noteForPrompt).filter(Boolean);
  if (!list.length) throw new Error(t('notes.synthesisNoSummaries'));
  const lang = langOf(list);
  const body = clean(await ask(buildFullPrompt({ project, notes: list, lang })));
  if (!body) throw new Error(t('notes.synthesisEmpty'));
  writeSynthesis(projectDir, { project, body, included: list.map(n => path.basename(n.file)), noteEntries, lang });
  return { updated: true, count: list.length };
}

module.exports = { addNote, rebuild, synthesisPath, readSynthesis, writeSynthesis, buildIncrementalPrompt, buildFullPrompt, renameRef, noteLink, isoDay };
