// "Segundo cérebro": consultas sobre a pasta de notas, usadas pelo servidor MCP e pela pergunta no app.
// Tudo é derivado dos arquivos .md (nenhum banco interno).
const fs = require('fs');
const path = require('path');
const notes = require('./notes');
const projects = require('./projects');
const commitments = require('./commitments');
const synthesis = require('./synthesis');
const { SearchIndex } = require('./searchIndex');
const { isInside } = require('./paths');
const { normalize } = require('./text');
const vocab = require('./vocab');
const { t } = require('./i18n');

const day = d => { const x = new Date(d); return isNaN(x) ? '' : x.toISOString().slice(0, 10); };

class Brain {
  constructor(root) {
    this.root = root;
    this.index = new SearchIndex();
  }

  entries(project) {
    return notes.listNotes(this.root, project === undefined ? {} : { project });
  }

  // Reuniões + resumos de período (Resumos/): entram na busca, na listagem e na leitura.
  allEntries(project) {
    const list = this.entries(project);
    return project === undefined ? list.concat(notes.listPeriodSummaries(this.root)) : list;
  }

  // Resolve o nome digitado para o nome real do projeto (sem diferenciar acentos/maiúsculas).
  projectName(name) {
    if (name === undefined || name === null || name === '') return undefined;
    // Aceita um sub-projeto ('Pai/Filho') ou um grupo ('Pai', a união dos sub-projetos).
    const p = projects.findProject(this.root, name) || projects.findGroup(this.root, name);
    if (!p) throw new Error(t('notes.brainProjectNotFound', { name, list: [...projects.listGroups(this.root), ...projects.listProjects(this.root)].map(x => x.name).join(', ') || t('notes.brainNone') }));
    return p.name;
  }

  ref(file) {
    return path.relative(this.root, file).split(path.sep).join('/');
  }

  listProjects() {
    return projects.listProjects(this.root).map(p => {
      const s = synthesis.readSynthesis(p.dir);
      return { nome: p.name, pai: p.parent || '', reunioes: p.noteCount, sintese: s.exists, atualizada: s.meta.updated || '' };
    });
  }

  listNotes({ projeto, desde, ate, limite = 50 } = {}) {
    const proj = this.projectName(projeto);
    return this.allEntries(proj)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .filter(n => (!desde || day(n.date) >= desde) && (!ate || day(n.date) <= ate))
      .slice(0, limite)
      .map(n => n.kind === 'periodo'
        ? { arquivo: this.ref(n.file), tipo: notes.PERIOD_KIND, titulo: n.title, data: day(n.date), periodo_inicio: n.periodFrom, periodo_fim: n.periodTo }
        : { arquivo: this.ref(n.file), tipo: 'reunião', titulo: n.title, data: day(n.date), duracao: n.duration, projeto: n.project || '', tem_resumo: n.hasSummary });
  }

  search(consulta, { projeto, limite = 10 } = {}) {
    const proj = this.projectName(projeto);
    this.index.update(this.allEntries());
    return this.index.searchChunks(consulta, { project: proj, limit: limite }).map(c => ({
      arquivo: this.ref(c.file), tipo: c.kind === 'periodo' ? notes.PERIOD_KIND : 'reunião', titulo: c.title, data: day(c.date), projeto: c.project, secao: c.section,
      ...(c.time ? { momento: c.time, falante: c.speaker } : {}), trecho: c.text
    }));
  }

  // Aceita caminho relativo à pasta de notas, nome do arquivo ou parte do título.
  resolveNote(arquivo) {
    const all = this.allEntries();
    const full = path.resolve(this.root, String(arquivo || ''));
    if (isInside(this.root, full) && fs.existsSync(full) && full.endsWith('.md')) return full;
    const key = normalize(arquivo).trim();
    const hit = all.find(n => normalize(n.name) === key || normalize(path.basename(n.name, '.md')) === key)
      || all.find(n => normalize(n.title) === key) || all.find(n => normalize(n.title).includes(key));
    if (!hit) throw new Error(t('notes.brainNoteNotFound', { file: arquivo }));
    return hit.file;
  }

  readNote(arquivo) {
    const file = this.resolveNote(arquivo);
    return { arquivo: this.ref(file), conteudo: fs.readFileSync(file, 'utf8') };
  }

  // Decisões de todas as reuniões (seção "## Decisões" dos resumos), da mais recente para a mais antiga.
  decisions({ projeto, consulta } = {}) {
    const proj = this.projectName(projeto);
    const q = consulta ? normalize(consulta).split(/\s+/).filter(Boolean) : [];
    const out = [];
    for (const n of this.entries(proj)) {
      const parts = notes.splitNote(fs.readFileSync(n.file, 'utf8'));
      let inDec = false;
      for (const line of parts.summary.split('\n')) {
        const h = /^##\s+(.+)$/.exec(line);
        if (h) { inDec = vocab.sectionKind(h[1], ['decisions']) === 'decisions'; continue; }
        if (!inDec) continue;
        const t = line.replace(/^\s*[-*+]\s+/, '').trim();
        if (!t || /^(nenhuma decis|no decisions?|ninguna decisi)/i.test(normalize(t))) continue;
        if (q.length && !q.every(w => normalize(t + ' ' + n.title).includes(w))) continue;
        out.push({ decisao: t, data: day(n.date), reuniao: n.title, arquivo: this.ref(n.file), projeto: n.project || '' });
      }
    }
    return out;
  }

  commitments({ projeto, status = 'abertos', responsavel } = {}) {
    const proj = this.projectName(projeto);
    const who = responsavel ? normalize(responsavel) : '';
    return commitments.collectCommitments(this.entries(proj))
      .filter(c => status === 'todos' || (status === 'feitos' ? c.done : !c.done))
      .filter(c => !who || normalize(c.owner).includes(who))
      .map(c => ({ acao: c.action, responsavel: c.owner, prazo: c.due, feito: c.done, reuniao: c.noteTitle, data: day(c.noteDate), arquivo: this.ref(c.file), projeto: c.project }));
  }

  synthesis(projeto) {
    const name = this.projectName(projeto);
    if (!name) throw new Error(t('notes.brainProjectRequired'));
    const p = projects.findProject(this.root, name);
    if (!p) return { projeto: name, sintese: '', aviso: t('notes.brainGroupNoSynthesis') }; // grupo: só agrupamento
    const s = synthesis.readSynthesis(p.dir);
    if (!s.exists) return { projeto: name, sintese: '', aviso: t('notes.brainNoSynthesis') };
    return { projeto: name, atualizada: s.meta.updated || '', sintese: fs.readFileSync(s.file, 'utf8') };
  }
}

// ---------- Perguntas no app ----------

const MAX_CONTEXT = 14000; // caracteres de trechos enviados ao Claude

// Monta o contexto numerado [1], [2]… a partir dos trechos mais relevantes (e da síntese do projeto).
function buildQuestionContext(brain, question, project) {
  const proj = brain.projectName(project);
  brain.index.update(brain.allEntries());
  const chunks = brain.index.searchChunks(question, { project: proj, limit: 40 });
  const sources = [];
  const lines = [];
  let size = 0;
  const add = (src, text) => {
    if (size + text.length > MAX_CONTEXT) return false;
    sources.push(src);
    lines.push(`[${sources.length}] ${text}`);
    size += text.length;
    return true;
  };
  if (proj) {
    // Grupo: as sínteses dos sub-projetos (cada uma menor, para caber).
    const leaf = projects.findProject(brain.root, proj);
    const list = leaf ? [leaf] : projects.listProjects(brain.root).filter(x => x.parent === proj);
    for (const p of list) {
      const s = synthesis.readSynthesis(p.dir);
      if (s.exists) add({ file: s.file, title: `Síntese do projeto ${p.name}`, date: s.meta.updated || '' }, `Síntese do projeto "${p.name}":\n${s.body.slice(0, leaf ? 5000 : 2500)}`);
    }
  }
  for (const c of chunks) {
    const where = c.section === 'Transcrição' ? `transcrição, ${c.time}, ${c.speaker}` : c.section;
    if (!add({ file: c.file, title: c.title, date: c.date }, `Reunião "${c.title}" (${day(c.date)}${c.project ? ', projeto ' + c.project : ''}) — ${where}: ${c.text}`)) break;
  }
  return { sources, context: lines.join('\n\n') };
}

// A resposta sai no idioma da pergunta (#2534), qualquer que seja o idioma das reuniões citadas.
function buildQuestionPrompt(question, context) {
  return `Você responde perguntas sobre as reuniões de trabalho do usuário.
Responda no mesmo idioma em que a pergunta foi escrita, mesmo que os trechos estejam em outro idioma.
Use SOMENTE os trechos abaixo. Cite as fontes com o número entre colchetes, por exemplo [2], logo após cada afirmação.
Se os trechos não bastarem para responder, diga claramente o que não foi encontrado. Não invente.
Seja direto: comece pela resposta, depois os detalhes. Use Markdown simples.
Não use ferramentas e não leia arquivos.

<trechos>
${context || '(nenhum trecho encontrado)'}
</trechos>

Pergunta: ${question}`;
}

// Pergunta completa: recupera trechos, chama o Claude (ask) e devolve a resposta com as fontes citadas.
async function answerQuestion({ brain, question, project, ask }) {
  const q = String(question || '').trim();
  if (!q) throw new Error(t('notes.askEmpty'));
  const { sources, context } = buildQuestionContext(brain, q, project);
  if (!sources.length) {
    return { answer: project ? t('notes.askNothingProject', { project }) : t('notes.askNothing'), sources: [] };
  }
  const answer = String(await ask(buildQuestionPrompt(q, context))).trim();
  // Só as fontes citadas, na ordem do número.
  const cited = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map(m => +m[1]))].filter(n => n >= 1 && n <= sources.length).sort((a, b) => a - b);
  return { answer, sources: cited.map(n => ({ n, ...sources[n - 1] })) };
}

module.exports = { Brain, buildQuestionContext, buildQuestionPrompt, answerQuestion };
