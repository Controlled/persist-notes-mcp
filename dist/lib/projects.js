// Projetos: cada projeto é uma pasta dentro da pasta de notas.
// Nada fica num banco interno: a pasta onde o .md está é o projeto dele.
const fs = require('fs');
const path = require('path');
const notes = require('./notes');
const attachments = require('./attachments');
const { isInside } = require('./paths');
const { t } = require('./i18n');

// Identificador do formato: sempre "_synthesis.md", em qualquer idioma.
const SYNTHESIS_FILE = '_synthesis.md';
const synthesisFile = dir => path.join(dir, SYNTHESIS_FILE);
const RESERVED = notes.RESERVED_DIRS; // audio/ e Resumos/ (resumos de período)

// Pastas ignoradas: audio/, Resumos/, ocultas (.) e internas (_).
function isProjectDirName(name) {
  return !!name && !name.startsWith('.') && !name.startsWith('_') && !RESERVED.has(name.toLowerCase());
}

// Limpa o nome digitado para virar nome de pasta válido no macOS e no Windows.
function cleanProjectName(name) {
  const n = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[._]+/, '').replace(/[. ]+$/, '').slice(0, 80);
  if (!n) throw new Error(t('notes.projectNameEmpty'));
  if (RESERVED.has(n.toLowerCase())) throw new Error(t('notes.projectNameReserved', { name: n }));
  return n;
}

// Projetos em dois níveis (0.16.0, #2554). O nome de um projeto é o caminho relativo com '/':
// 'Rastreabilidade' (nível 1, "sub-projeto sem pai") ou 'ControlLed/SkinMonitor' (sub-projeto dentro do grupo).
// O grupo (o "Projeto" da interface) é só agrupamento: pasta da raiz com _group.md ou com subpastas de projeto.
// Não tem síntese, ações nem reuniões próprias. Nada muda no disco para quem já tinha projetos de nível 1.
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const GROUP_FILE = notes.GROUP_FILE;
const splitName = name => String(name ?? '').split(/[\\/]+/).map(s => s.trim()).filter(Boolean);
const toDir = (root, name) => path.join(root, ...splitName(name));

function leafInfo(dir, name, parent) {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md') && !f.startsWith('_'));
  // created: criação da pasta (define os projetos ativos no plano grátis: os mais antigos).
  let created = 0;
  try { const st = fs.statSync(dir); created = st.birthtimeMs || st.ctimeMs || 0; } catch (_) {}
  const label = name.split('/').pop();
  return { name, label, parent, dir, noteCount: files.length, hasSynthesis: fs.existsSync(path.join(dir, SYNTHESIS_FILE)), created };
}

function topDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && isProjectDirName(d.name)).map(d => d.name);
}

// Só os projetos com reuniões (as folhas): os de nível 1 que não são grupo e os sub-projetos dos grupos.
function listProjects(root) {
  const out = [];
  for (const name of topDirs(root)) {
    const dir = path.join(root, name);
    if (notes.isGroupDir(dir)) {
      for (const c of notes.projectSubdirs(dir)) out.push(leafInfo(path.join(dir, c), `${name}/${c}`, name));
    } else out.push(leafInfo(dir, name, ''));
  }
  return out.sort((a, b) => collator.compare(a.parent || a.label, b.parent || b.label) || (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || collator.compare(a.label, b.label));
}

// Grupos (projetos-pai): { name, dir, children: [nomes dos sub-projetos], noteCount (soma) }.
function listGroups(root) {
  const leaves = listProjects(root);
  return topDirs(root).filter(name => notes.isGroupDir(path.join(root, name))).map(name => {
    const children = leaves.filter(p => p.parent === name);
    return { name, dir: path.join(root, name), children: children.map(p => p.name), noteCount: children.reduce((s, p) => s + p.noteCount, 0) };
  }).sort((a, b) => collator.compare(a.name, b.name));
}

// Procura sem diferenciar maiúsculas/acentos ("orcamento" acha "Orçamento"), segmento a segmento.
const key = s => splitName(s).map(x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()).join('/');
function findProject(root, name) {
  return listProjects(root).find(p => key(p.name) === key(name)) || null;
}
function findGroup(root, name) {
  return listGroups(root).find(g => key(g.name) === key(name)) || null;
}

function createGroup(root, name) {
  const clean = cleanProjectName(name);
  const existing = findGroup(root, clean);
  if (existing) return existing;
  const leaf = findProject(root, clean);
  if (leaf) throw new Error(t('notes.projectExists', { name: leaf.name }));
  const dir = path.join(root, clean);
  fs.mkdirSync(dir, { recursive: true });
  // Marcador do grupo: reconhece o grupo mesmo vazio. Identificadores do formato em inglês.
  const marker = path.join(dir, GROUP_FILE);
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, `---\ntype: group\ntitle: ${JSON.stringify(clean)}\n---\n`);
  return { name: clean, dir, children: [], noteCount: 0 };
}

// Cria um projeto com reuniões. name é um nome só (uma "/" digitada vira espaço); parent = o grupo onde fica.
function createProject(root, name, parent = '') {
  return ensureProject(root, parent ? [...splitName(parent), name] : [name]);
}
// Pelo caminho 'Pai/Filho' (sugestão do Claude, mover reunião): cria o que faltar.
function createProjectPath(root, fullName) {
  return ensureProject(root, splitName(fullName));
}
function ensureProject(root, segs) {
  if (!segs.length) throw new Error(t('notes.projectNameEmpty'));
  if (segs.length > 2) throw new Error(t('notes.projectTooDeep'));
  const clean = segs.map(cleanProjectName);
  const full = clean.join('/');
  const existing = findProject(root, full);
  if (existing) return existing;
  if (clean.length === 1 && findGroup(root, clean[0])) throw new Error(t('notes.projectIsGroup', { name: clean[0] }));
  if (clean.length === 2) {
    // O pai precisa ser grupo (ou nascer como grupo); um projeto de nível 1 com reuniões não vira pai.
    const g = findGroup(root, clean[0]);
    if (g) clean[0] = g.name;
    else if (findProject(root, clean[0])) throw new Error(t('notes.parentHasMeetings', { name: clean[0] }));
    else createGroup(root, clean[0]);
  }
  const dir = toDir(root, clean.join('/'));
  fs.mkdirSync(dir, { recursive: true });
  return leafInfo(dir, clean.join('/'), clean.length === 2 ? clean[0] : '');
}

function fixSynthesisName(dir, name) {
  const synth = synthesisFile(dir);
  if (!fs.existsSync(synth)) return;
  let md = fs.readFileSync(synth, 'utf8');
  md = notes.setFrontmatterField(md, 'project', name).replace(/^# .*$/m, () => `# ${name.split('/').pop()}`);
  fs.writeFileSync(synth, md);
}

// Renomeia o projeto (último segmento); continua no mesmo grupo.
function renameProject(root, oldName, newName) {
  const p = findProject(root, oldName);
  if (!p) throw new Error(t('notes.projectNotFound', { name: oldName }));
  const segs = splitName(newName);
  const clean = cleanProjectName(segs[segs.length - 1] || '');
  const full = p.parent ? `${p.parent}/${clean}` : clean;
  if (full === p.name) return p;
  const other = findProject(root, full) || (!p.parent && findGroup(root, clean));
  if (other && other.dir !== p.dir) throw new Error(t('notes.projectExists', { name: other.name }));
  const dest = toDir(root, full);
  fs.renameSync(p.dir, dest);
  fixSynthesisName(dest, full);
  return { ...p, name: full, label: clean, dir: dest };
}

// Renomeia o grupo (a pasta-pai); os sub-projetos vão junto.
function renameGroup(root, oldName, newName) {
  const g = findGroup(root, oldName);
  if (!g) throw new Error(t('notes.projectNotFound', { name: oldName }));
  const clean = cleanProjectName(newName);
  if (clean === g.name) return g;
  const other = findGroup(root, clean) || findProject(root, clean);
  if (other && other.dir !== g.dir) throw new Error(t('notes.projectExists', { name: other.name }));
  const dest = path.join(root, clean);
  fs.renameSync(g.dir, dest);
  const marker = path.join(dest, GROUP_FILE);
  if (fs.existsSync(marker)) fs.writeFileSync(marker, notes.setFrontmatterField(fs.readFileSync(marker, 'utf8'), 'title', clean));
  for (const c of g.children) fixSynthesisName(toDir(root, `${clean}/${c.split('/').pop()}`), `${clean}/${c.split('/').pop()}`);
  return { ...g, name: clean, dir: dest, children: g.children.map(c => `${clean}/${c.split('/').pop()}`) };
}

// "Mover para…": leva a pasta do projeto para dentro de um grupo (parent '' = volta ao nível 1).
// A pasta vai inteira (reuniões, áudio, anexos e síntese), então os links relativos continuam valendo.
function moveProject(root, name, parent = '') {
  const p = findProject(root, name);
  if (!p) throw new Error(t('notes.projectNotFound', { name }));
  let destParent = '';
  if (parent) {
    const g = findGroup(root, parent);
    if (g) destParent = g.name;
    else if (findProject(root, parent)) throw new Error(t('notes.parentHasMeetings', { name: parent }));
    else destParent = createGroup(root, parent).name;
  }
  if (destParent === p.parent) return p.name;
  const full = destParent ? `${destParent}/${p.label}` : p.label;
  const dest = toDir(root, full);
  if (fs.existsSync(dest)) throw new Error(t('notes.projectExists', { name: full }));
  fs.renameSync(p.dir, dest);
  // O grupo de origem fica, mesmo vazio: cria o marcador para continuar reconhecido.
  if (p.parent) {
    const src = path.join(root, p.parent), marker = path.join(src, GROUP_FILE);
    if (fs.existsSync(src) && !fs.existsSync(marker)) fs.writeFileSync(marker, `---\ntype: group\ntitle: ${JSON.stringify(p.parent)}\n---\n`);
  }
  fixSynthesisName(dest, full);
  return full;
}

// Nome do projeto de um arquivo de nota ('' = sem projeto, na raiz): 'A' ou 'A/B'.
function projectOf(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(path.dirname(file)));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  const segs = rel.split(path.sep);
  if (segs.length >= 2 && notes.isProjectDir(segs[1]) && notes.isGroupDir(path.join(root, segs[0]))) return `${segs[0]}/${segs[1]}`;
  return segs[0];
}

// Move a nota (e seus áudios) para um projeto; projectName '' devolve para a raiz.
// Devolve o novo caminho do .md.
function moveNote(root, file, projectName) {
  if (!isInside(root, file)) throw new Error(t('notes.outsideNotesDir'));
  const destDir = projectName ? (findGroup(root, projectName) || createProjectPath(root, projectName)).dir : root;
  if (path.resolve(path.dirname(file)) === path.resolve(destDir)) return file;
  fs.mkdirSync(destDir, { recursive: true });
  const dest = notes.uniquePath(destDir, path.basename(file));
  const audios = notes.audioFilesFor(file);
  // Ao mover, a sugestão de projeto deixa de valer.
  // Os links das imagens coladas (anexos/) são relativos à pasta da nota: acompanham a mudança.
  const md = attachments.relink(root, notes.setFrontmatterField(fs.readFileSync(file, 'utf8'), 'suggested_project', null), file, dest);
  fs.writeFileSync(file, md);
  fs.renameSync(file, dest);
  if (audios.length) {
    const audioDir = path.join(destDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const oldBase = path.basename(file, '.md'), newBase = path.basename(dest, '.md');
    for (const a of audios) fs.renameSync(a, path.join(audioDir, newBase + path.basename(a).slice(oldBase.length)));
  }
  return dest;
}

// ---------- Excluir (0.16.2) ----------
// Nada é apagado de vez: tudo vai para a Lixeira do sistema (trash = shell.trashItem no app).

// Reuniões (.md) que estão direto numa pasta (sem _synthesis.md, _group.md…).
const meetingFiles = dir => {
  try { return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md') && !f.startsWith('_')).map(f => path.join(dir, f)); }
  catch (_) { return []; }
};

// O que uma reunião leva para a Lixeira: o .md, os áudios guardados e a pasta de anexos (fica fora do projeto).
function noteTrashItems(root, file) {
  const items = [file, ...notes.audioFilesFor(file)];
  const att = attachments.dirFor(root, file);
  if (fs.existsSync(att)) items.push(att);
  return items;
}

// Para o modal: { kind: 'group'|'leaf', name, label, dir, children: [sub-projetos], files: [reuniões], noteCount }.
function deleteInfo(root, name) {
  const g = findGroup(root, name);
  if (g) {
    const leaves = listProjects(root).filter(p => p.parent === g.name);
    // Reuniões soltas na pasta do grupo (raras, mas possíveis à mão) entram também.
    const files = [...meetingFiles(g.dir), ...leaves.flatMap(p => meetingFiles(p.dir))];
    return { kind: 'group', name: g.name, label: g.name, dir: g.dir, children: leaves.map(p => p.name), files, noteCount: files.length };
  }
  const p = findProject(root, name);
  if (!p) throw new Error(t('notes.projectNotFound', { name }));
  const files = meetingFiles(p.dir);
  return { kind: 'leaf', name: p.name, label: p.label, dir: p.dir, children: [], files, noteCount: files.length };
}

// mode 'move': as reuniões vão para "Sem projeto" (raiz) com áudios e anexos; depois a pasta (síntese e o que
// sobrou) vai para a Lixeira. mode 'all': a pasta inteira e os anexos das reuniões vão para a Lixeira.
// Em cascata para o projeto-pai. onMoved(src, dest) avisa o app de cada reunião movida.
async function deleteProject(root, name, { mode = 'move', trash, onMoved } = {}) {
  if (typeof trash !== 'function') throw new Error('trash');
  const info = deleteInfo(root, name);
  const moved = [];
  if (mode === 'move') {
    for (const f of info.files) {
      const dest = moveNote(root, f, '');
      moved.push([f, dest]);
      if (onMoved) onMoved(f, dest);
    }
  } else {
    for (const f of info.files) {
      const att = attachments.dirFor(root, f);
      if (fs.existsSync(att)) await trash(att);
    }
  }
  await trash(info.dir);
  return { ...info, mode, moved };
}

module.exports = {
  SYNTHESIS_FILE, GROUP_FILE, synthesisFile, isProjectDirName, cleanProjectName, listProjects, listGroups, findProject, findGroup,
  createProject, createProjectPath, createGroup, renameProject, renameGroup, moveProject, projectOf, moveNote, splitName,
  deleteInfo, deleteProject, noteTrashItems, meetingFiles
};
