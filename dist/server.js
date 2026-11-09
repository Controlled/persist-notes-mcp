// Servidor MCP público do Persist Notes (@persistnotes/mcp): stdio, JSON-RPC por linha, sem dependências.
// Só leitura: consulta reuniões, ações, projetos e resumos de período direto dos arquivos .md da pasta de notas.
// Não depende do Electron nem do app instalado. Este arquivo é copiado para dist/server.js pelo scripts/build.js,
// ao lado de dist/lib (as partes de leitura do lib/ do app, copiadas sem alteração).
// Pasta de notas: --notes-dir <pasta>, ou PERSIST_NOTES_DIR, ou o notesDir do settings.json do app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { Brain } = require('./lib/brain');
const notes = require('./lib/notes');
const projects = require('./lib/projects');
const i18n = require('./lib/i18n');

const VERSION = (() => { try { return require('../package.json').version; } catch (_) { return '0.0.0'; } })();
const NAME = 'persist-notes';

// ---------- Configuração ----------

// Pasta de dados do app (onde fica o settings.json), por sistema.
function appDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Persist Notes');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Persist Notes');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Persist Notes');
}

// Valor de uma opção: "--x valor" ou "--x=valor".
function argValue(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1] !== undefined) return argv[i + 1];
    if (argv[i].startsWith(name + '=')) return argv[i].slice(name.length + 1);
  }
  return undefined;
}

// Pasta de notas e de onde ela veio ('arg' | 'env' | 'settings' | 'default').
function resolveNotesDir({ argv = process.argv, env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const fromArg = argValue(argv, '--notes-dir');
  if (fromArg) return { dir: path.resolve(fromArg), source: 'arg' };
  if (env.PERSIST_NOTES_DIR) return { dir: path.resolve(env.PERSIST_NOTES_DIR), source: 'env' };
  const settings = path.join(appDataDir(platform, env, home), 'settings.json');
  try {
    const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
    if (s.notesDir) return { dir: path.resolve(s.notesDir), source: 'settings', settings };
  } catch (_) { /* sem app instalado: usa o padrão */ }
  return { dir: path.join(home, 'Documents', 'Persist Notes'), source: 'default', settings };
}

// Idioma das mensagens de erro: --lang, PERSIST_NOTES_LANG ou o do sistema (pt → pt-BR, es → es, outro → en).
function resolveLang({ argv = process.argv, env = process.env } = {}) {
  const pref = argValue(argv, '--lang') || env.PERSIST_NOTES_LANG || '';
  return i18n.resolveLocale(pref, [String(env.LC_ALL || env.LANG || '').replace('_', '-')]);
}

// ---------- Ferramentas ----------

const day = d => { const x = new Date(d); return isNaN(x) ? '' : x.toISOString().slice(0, 10); };
const str = description => ({ type: 'string', description });
const num = description => ({ type: 'number', description });
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });

// Mensagem do "não achei a reunião" com os nomes das ferramentas em inglês.
function resolveMeeting(brain, file) {
  try { return brain.resolveNote(file); } catch (_) {
    throw new Error(`Meeting "${file}" not found. Use search_meetings or list_meetings to find the file path.`);
  }
}

// Resumos de período (pasta summaries/), do mais recente para o mais antigo.
function periodSummaries(brain) {
  return notes.listPeriodSummaries(brain.root).map(n => ({
    file: brain.ref(n.file), title: n.title, period_start: n.periodFrom, period_end: n.periodTo, generated_at: day(n.date), _abs: n.file, _name: n.name
  }));
}

function readMeeting(brain, { file, full = false, include_notes = false }) {
  if (!file) throw new Error('Specify "file": a path returned by list_meetings/search_meetings, a file name or part of the title.');
  const abs = resolveMeeting(brain, file);
  const md = fs.readFileSync(abs, 'utf8');
  const ref = brain.ref(abs);
  if (full) return { file: ref, content: md };
  const p = notes.splitNote(md);
  const out = {
    file: ref, title: p.title, date: day(p.meta.date), duration: p.meta.duration || '', project: projects.projectOf(brain.root, abs),
    status: p.meta.status || '', summary: p.summary
  };
  if (p.pending) out.notice = 'The summary of this meeting has not been generated yet. Use full: true to read the transcript.';
  if (include_notes) out.notes = p.annotations;
  return out;
}

function readPeriodSummary(brain, { file } = {}) {
  const list = periodSummaries(brain);
  if (!list.length) throw new Error(`No period summaries found in "${notes.PERIOD_DIR}/". Create one in Persist Notes (Home → period summary).`);
  let hit = list[0];
  if (file) {
    const key = String(file).toLowerCase().trim();
    hit = list.find(s => s.file.toLowerCase() === key || s._name.toLowerCase() === key || s._name.toLowerCase() === key + '.md')
      || list.find(s => s.title.toLowerCase().includes(key) || s._name.toLowerCase().includes(key));
    if (!hit) throw new Error(`Period summary "${file}" not found. Use list_period_summaries to see the available ones.`);
  }
  const { meta, body } = notes.parseFrontmatter(fs.readFileSync(hit._abs, 'utf8'));
  return { file: hit.file, title: hit.title, period_start: meta.period_start || '', period_end: meta.period_end || '', generated_at: hit.generated_at, content: body.trim() };
}

const STATUS = { open: 'abertos', done: 'feitos', all: 'todos' };

const TOOLS = [
  { name: 'search_meetings',
    description: 'Full-text search (BM25) across meeting summaries, the user\'s own notes, transcripts and period summaries. Returns the most relevant excerpts with their source meeting, date and section.',
    inputSchema: obj({ query: str('What to look for'), project: str('Limit to one project (optional)'), limit: num('Maximum number of excerpts (default 10)') }, ['query']),
    run: (b, a) => b.search(a.query, { projeto: a.project, limite: a.limit }).map(c => ({
      file: c.arquivo, type: c.tipo === notes.PERIOD_KIND ? 'period_summary' : 'meeting', title: c.titulo, date: c.data, project: c.projeto || '',
      section: c.secao, ...(c.momento ? { time: c.momento, speaker: c.falante } : {}), excerpt: c.trecho
    })) },
  { name: 'list_meetings',
    description: 'Lists meetings, newest first, optionally filtered by project and date range. Period summaries appear with type "period_summary".',
    inputSchema: obj({ project: str('Project name (optional)'), from: str('Start date YYYY-MM-DD (optional)'), to: str('End date YYYY-MM-DD (optional)'), limit: num('Maximum number of meetings (default 50)') }),
    run: (b, a) => b.listNotes({ projeto: a.project, desde: a.from, ate: a.to, limite: a.limit || 50 }).map(n => n.tipo === notes.PERIOD_KIND
      ? { file: n.arquivo, type: 'period_summary', title: n.titulo, date: n.data, period_start: n.periodo_inicio, period_end: n.periodo_fim }
      : { file: n.arquivo, type: 'meeting', title: n.titulo, date: n.data, duration: n.duracao, project: n.projeto, has_summary: n.tem_resumo }) },
  { name: 'read_meeting',
    description: 'Reads one meeting. By default returns only the summary sections (summary, key points, decisions, next steps, open questions). Set full: true for the whole .md file (summary + the user\'s notes + transcript).',
    inputSchema: obj({ file: str('Path relative to the notes folder (as returned by the other tools), file name or part of the title'),
      full: { type: 'boolean', description: 'Return the whole file, including the transcript (default false)' },
      include_notes: { type: 'boolean', description: 'Also return the user\'s own notes section (default false)' } }, ['file']),
    run: readMeeting },
  { name: 'list_actions',
    description: 'Lists the action items (to-dos from the "Next steps" of the summaries) with owner, due date and status. Default: open items only.',
    inputSchema: obj({ project: str('Project (optional)'), status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Default: open' }, owner: str('Filter by owner (optional)') }),
    run: (b, a) => b.commitments({ projeto: a.project, status: STATUS[a.status] || 'abertos', responsavel: a.owner }).map(c => ({
      action: c.acao, owner: c.responsavel, due: c.prazo, done: c.feito, meeting: c.reuniao, date: c.data, file: c.arquivo, project: c.projeto
    })) },
  { name: 'list_decisions',
    description: 'Lists the decisions recorded in the meeting summaries, newest first, with date and source meeting. Filter by project and words.',
    inputSchema: obj({ project: str('Project (optional)'), query: str('Words the decision must contain (optional)') }),
    run: (b, a) => b.decisions({ projeto: a.project, consulta: a.query }).map(d => ({ decision: d.decisao, date: d.data, meeting: d.reuniao, file: d.arquivo, project: d.projeto })) },
  { name: 'list_projects',
    description: 'Lists the projects (folders) with their number of meetings and whether they have a living synthesis. Projects can sit inside a parent project ("Parent/Project"); a parent only groups projects. Any "project" argument also accepts a parent name, meaning all of its projects.',
    inputSchema: obj({}),
    run: b => b.listProjects().map(p => ({ name: p.nome, parent: p.pai, meetings: p.reunioes, has_synthesis: p.sintese, synthesis_updated: p.atualizada })) },
  { name: 'read_project_synthesis',
    description: 'Returns the living synthesis of a project (_synthesis.md): overview, themes, decisions, open issues and meetings.',
    inputSchema: obj({ project: str('Project name') }, ['project']),
    run: (b, a) => { const s = b.synthesis(a.project); return { project: s.projeto, updated: s.atualizada || '', synthesis: s.sintese, ...(s.aviso ? { notice: s.aviso } : {}) }; } },
  { name: 'list_period_summaries',
    description: 'Lists the period summaries (weekly/monthly reviews saved in summaries/), newest first.',
    inputSchema: obj({}),
    run: b => periodSummaries(b).map(({ _abs, _name, ...s }) => s) },
  { name: 'read_period_summary',
    description: 'Reads a period summary. Without "file", returns the most recent one.',
    inputSchema: obj({ file: str('Path, file name ("2026-11-01 to 2026-11-07") or part of the title (optional)') }),
    run: readPeriodSummary },
];

// Nomes em português do servidor que vem com o app (mcp/server.js): mesmo comportamento e mesma saída.
// Aceitos sempre em tools/call; só aparecem em tools/list com --legacy-tools.
const LEGACY_TOOLS = [
  { name: 'listar_projetos', description: 'Lista os projetos do Persist Notes, com o número de reuniões e se há síntese. Um projeto pode estar dentro de um projeto-pai ("Pai/Projeto"); o argumento projeto aceita também o pai (todos os projetos dele).',
    inputSchema: obj({}), run: b => b.listProjects() },
  { name: 'listar_reunioes', description: 'Lista reuniões e resumos de período, mais recentes primeiro, opcionalmente de um projeto e de um período.',
    inputSchema: obj({ projeto: str('Nome do projeto (opcional)'), desde: str('Data inicial AAAA-MM-DD (opcional)'), ate: str('Data final AAAA-MM-DD (opcional)'), limite: num('Máximo de reuniões (padrão 50)') }),
    run: (b, a) => b.listNotes(a) },
  { name: 'buscar', description: 'Busca nas reuniões e nos resumos de período e devolve os trechos mais relevantes.',
    inputSchema: obj({ consulta: str('O que procurar'), projeto: str('Restringir a um projeto (opcional)'), limite: num('Máximo de trechos (padrão 10)') }, ['consulta']),
    run: (b, a) => b.search(a.consulta, a) },
  { name: 'ler_reuniao', description: 'Lê o arquivo .md completo de uma reunião.',
    inputSchema: obj({ arquivo: str('Caminho relativo à pasta de notas, nome do arquivo ou título') }, ['arquivo']),
    run: (b, a) => b.readNote(a.arquivo) },
  { name: 'decisoes', description: 'Lista as decisões registradas nos resumos.',
    inputSchema: obj({ projeto: str('Projeto (opcional)'), consulta: str('Palavras que a decisão deve conter (opcional)') }),
    run: (b, a) => b.decisions(a) },
  { name: 'commitments', description: 'Lista os to-dos (próximos passos) das reuniões.',
    inputSchema: obj({ projeto: str('Projeto (opcional)'), status: { type: 'string', enum: ['abertos', 'feitos', 'todos'], description: 'Padrão: abertos' }, responsavel: str('Filtrar por responsável (opcional)') }),
    run: (b, a) => b.commitments(a) },
  { name: 'sintese_projeto', description: 'Devolve a síntese viva de um projeto.',
    inputSchema: obj({ projeto: str('Nome do projeto') }, ['projeto']),
    run: (b, a) => b.synthesis(a.projeto) },
];

const INSTRUCTIONS = 'Read-only access to the user\'s Persist Notes meetings (local Markdown files). Start with search_meetings or list_meetings; ' +
  'use read_meeting for the summary of one meeting, list_actions for pending to-dos and read_project_synthesis for a project overview. ' +
  'Always cite the meeting title and date in your answers.';

// Erro sem permissão de leitura (no macOS, a pasta Documentos é protegida): diz ao usuário o que fazer.
function errorText(e) {
  if (e && (e.code === 'EPERM' || e.code === 'EACCES')) {
    return `Permission denied reading ${e.path || 'the notes folder'}. Allow the app that runs this server (Claude, Terminal, your editor) ` +
      'to read that folder: on macOS, System Settings → Privacy & Security → Files and Folders (or Full Disk Access); then restart the client.';
  }
  return (e && e.message) || String(e);
}

// Trata uma mensagem JSON-RPC. Devolve a resposta (ou null para notificações).
// ctx: { brain, legacy (lista os nomes em português), missing (pasta de notas inexistente: mensagem de erro) }.
function handle(msg, ctx) {
  const { id, method, params = {} } = msg || {};
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return null; // notificação (ex.: notifications/initialized)
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: NAME, title: 'Persist Notes', version: VERSION },
        instructions: INSTRUCTIONS
      });
    case 'ping': return ok({});
    case 'tools/list': {
      const list = ctx.legacy ? TOOLS.concat(LEGACY_TOOLS) : TOOLS;
      return ok({ tools: list.map(({ run, ...t }) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: false } })) });
    }
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name) || LEGACY_TOOLS.find(t => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params.name}`);
      if (ctx.missing) return ok({ content: [{ type: 'text', text: ctx.missing }], isError: true });
      try {
        const data = tool.run(ctx.brain, params.arguments || {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: errorText(e) }], isError: true });
      }
    }
    default: return fail(-32601, `Method not supported: ${method}`);
  }
}

// ---------- Só leitura ----------

// Defesa extra: no processo do servidor, qualquer escrita em disco pelo módulo fs falha. As ferramentas só leem;
// isto garante que nenhum caminho do lib/ compartilhado (que também tem funções de escrita do app) grave algo.
const WRITE_FNS = ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp',
  'symlink', 'link', 'utimes', 'chmod', 'chown', 'truncate', 'createWriteStream'];
function lockWrites(target = fs) {
  const deny = name => () => { throw new Error(`Persist Notes MCP is read-only (blocked fs.${name})`); };
  for (const n of WRITE_FNS) {
    for (const k of [n, n + 'Sync']) if (typeof target[k] === 'function') target[k] = deny(k);
    if (target.promises && typeof target.promises[n] === 'function') target.promises[n] = async () => deny(n)();
  }
}

// ---------- Execução ----------

const HELP = `persist-notes-mcp ${VERSION}: read-only MCP server (stdio) for Persist Notes meeting notes.

Usage: persist-notes-mcp [--notes-dir <path>] [--lang en|pt-BR|es] [--legacy-tools]

Notes folder: --notes-dir, or PERSIST_NOTES_DIR, or "notesDir" in the Persist Notes app settings.json,
or ~/Documents/Persist Notes.
`;

function missingMessage(r) {
  return `Notes folder not found: ${r.dir}. Pass the folder of your Persist Notes meetings with --notes-dir "<path>" ` +
    '(or set PERSIST_NOTES_DIR) in your MCP configuration, then restart the client.';
}

function main(argv = process.argv) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return; }
  if (argv.includes('--version') || argv.includes('-v')) { process.stdout.write(VERSION + '\n'); return; }
  i18n.setLocale(resolveLang({ argv }));
  const r = resolveNotesDir({ argv });
  let exists = false;
  try { exists = fs.statSync(r.dir).isDirectory(); } catch (_) { /* não existe */ }
  lockWrites();
  const ctx = { brain: new Brain(r.dir), legacy: argv.includes('--legacy-tools'), missing: exists ? '' : missingMessage(r) };
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (_) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    const res = handle(msg, ctx);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  });
  rl.on('close', () => process.exit(0));
  process.stderr.write(`Persist Notes MCP ${VERSION} · notes folder (${r.source}): ${r.dir}${exists ? '' : ' (not found)'}\n`);
}

module.exports = { handle, main, TOOLS, LEGACY_TOOLS, resolveNotesDir, resolveLang, appDataDir, lockWrites, VERSION };
