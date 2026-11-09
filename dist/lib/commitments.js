// Commitments: os to-dos ("- [ ] ação — **responsável** (prazo)") dos resumos das reuniões.
// O .md é a fonte da verdade: marcar como feito grava [x] na linha de origem.
const fs = require('fs');
const notes = require('./notes');
const { isDueText } = require('./dueDate');
const vocab = require('./vocab');
const { t } = require('./i18n');

const TASK_RE = /^(\s*[-*+]\s+\[)( |x|X)(\]\s+)(.*)$/;

// Responsável ou prazo "desconhecido" escrito pelo Claude ("?", "a definir", "TBD", "por definir"…) conta como vazio.
const UNKNOWN = /^(\?+|n\/?a|-+|a definir|indefinido|desconhecido|n[ãa]o (mencionado|definido|informado|especificado)|sem respons[áa]vel|sem prazo|tbd|tba|unknown|unassigned|not (specified|mentioned|defined)|no (owner|deadline|due date)|none|por definir|desconocido|no (especificado|mencionado|definido)|sin responsable|sin plazo|sin fecha)$/i;
const known = s => { const t = String(s || '').trim(); return UNKNOWN.test(t) ? '' : t; };
// Nome próprio sem negrito, como nas notas antigas: "Ana", "Ana e Bruno", "Maria da Silva".
// Conectivos em pt, en e es: "Ana e Bruno", "Ana and Bruno", "Ana y Bruno", "María de la Cruz".
const NAME_RE = /^\p{Lu}[\p{L}.'-]*(?:,?\s+(?:e|y|and|de|da|do|das|dos|del|la|\p{Lu}[\p{L}.'-]*))*$/u;
const DASH = '[—–-]';

// Interpreta o texto de um to-do. Formato do resumo (v0.8): "<ação> — **<responsável>** (<prazo>)".
// Tolerante às notas antigas: prazo com "prazo:", "Responsável:" fora ou dentro do negrito,
// prazo depois do responsável sem parênteses ("— **Ana**, até sexta") e responsável sem negrito ("— Ana (sexta)").
// "Enviar a planilha — **Ana** (sexta)" → { action, owner: 'Ana', due: 'sexta' }
function parseTaskText(text) {
  const original = String(text).trim();
  let rest = original;
  let due = '', owner = '', extra = '';
  // Prazo só é aceito se for data, dia da semana ou expressão relativa reconhecida (#2502);
  // "(a definir)" e parecidos são "sem prazo"; qualquer outro texto continua na ação.
  const dueOk = s => UNKNOWN.test(s) || isDueText(s);
  const dm = /\s*\(([^()]*)\)\s*\.?$/.exec(rest);
  const DUE_LABEL = /^(prazo|due|deadline|plazo|fecha l[íi]mite):?\s*/i;
  if (dm && dueOk(dm[1].replace(DUE_LABEL, '').trim())) { due = dm[1].replace(DUE_LABEL, '').trim(); rest = rest.slice(0, dm.index).trim(); }
  const om = /\*\*([^*]+)\*\*([^*]*)$/.exec(rest);
  const tail = om ? om[2].trim() : '';
  // Depois do negrito só pode vir o prazo (", até sexta", "— 15/11", "prazo: sexta").
  const tailDue = om && tail && new RegExp(`^(?:[,;]|${DASH})?\\s*(?:(?:prazo|due|plazo):?\\s*)?(.+)$`, 'i').exec(tail);
  // Parêntese que não é prazo ("(Letícia e Camila)", "(reunião com o fornecedor)"): o texto volta para a ação.
  const tailParen = /^\(([^()]*)\)\s*\.?$/.exec(tail);
  if (om && (!tail || tailParen || (tailDue && !due && /^(?:[,;]|[—–-]|prazo|due|plazo|at[ée]\s|by\s|until\s|hasta\s)/i.test(tail)))) {
    owner = om[1].replace(/^(respons[áa]vel|owner|responsable):?\s*/i, '').trim();
    if (tailParen) extra = tailParen[1].trim();
    else if (tail && dueOk(tailDue[1].trim())) due = tailDue[1].trim();
    else if (tail) extra = tail.replace(/^[,;—–-]\s*/, '');
    rest = rest.slice(0, om.index).trim().replace(/(respons[áa]vel|owner|responsable):?\s*$/i, '').trim();
  } else if (!om) {
    // Sem negrito: "Ação — Ana — até sexta" / "Ação — Responsável: Ana".
    const parts = rest.split(new RegExp(`\\s+${DASH}+\\s+`));
    if (parts.length > 1 && !due && /^(prazo:?\s*|at[ée]\s)/i.test(parts[parts.length - 1])) {
      const t = parts.pop().replace(/^prazo:?\s*/i, '').trim();
      if (dueOk(t)) due = t; else extra = t;
    }
    if (parts.length > 1) {
      const last = parts[parts.length - 1].trim();
      const byLabel = /^(?:respons[áa]vel|owner|responsable):?\s*(.+)$/i.exec(last);
      if (byLabel || (NAME_RE.test(last) && last.split(/\s+/).length <= 4)) {
        owner = byLabel ? byLabel[1].trim() : last;
        parts.pop();
      }
    }
    rest = parts.join(' — ');
  }
  let action = rest.replace(new RegExp(`\\s*${DASH}+\\s*$`), '').replace(/\*\*/g, '').trim();
  if (extra) action += ` (${extra})`;
  return { action: action || original, owner: known(owner), due: known(due) };
}

// To-dos da parte do resumo (antes das anotações e da transcrição, com os títulos em qualquer idioma).
// line = índice da linha no arquivo. Checkboxes das anotações do usuário não viram ações.
function parseCommitments(md, file = '') {
  const lines = md.split('\n');
  const isH = (l, kind) => vocab.headingRe(kind, '').test(l);
  const tIdx = lines.findIndex(l => isH(l.replace(/\r$/, ''), 'transcript'));
  const aIdx = lines.findIndex((l, i) => isH(l.replace(/\r$/, ''), 'annotations') && (tIdx < 0 || i < tIdx));
  const end = aIdx >= 0 ? aIdx : tIdx < 0 ? lines.length : tIdx;
  const out = [];
  for (let i = 0; i < end; i++) {
    const m = TASK_RE.exec(lines[i].replace(/\r$/, ''));
    if (!m) continue;
    out.push({ file, line: i, raw: lines[i].replace(/\r$/, ''), done: m[2] !== ' ', ...parseTaskText(m[4]) });
  }
  return out;
}

// To-dos de várias reuniões: [{ file, title, date, project }] → lista achatada com a origem.
function collectCommitments(noteEntries) {
  const out = [];
  for (const n of noteEntries) {
    let md;
    try { md = fs.readFileSync(n.file, 'utf8'); } catch (_) { continue; }
    for (const c of parseCommitments(md, n.file)) out.push({ ...c, noteTitle: n.title, noteDate: n.date, project: n.project || '' });
  }
  return out;
}

// Marca/desmarca o to-do no .md. Confere se a linha ainda é a mesma; se o arquivo mudou,
// procura a linha idêntica. Se não achar (ou achar repetida), avisa em vez de gravar errado.
function setDone(file, line, raw, done) {
  const md = fs.readFileSync(file, 'utf8');
  const lines = md.split('\n');
  const same = i => lines[i] !== undefined && lines[i].replace(/\r$/, '') === raw;
  let idx = same(line) ? line : -1;
  if (idx < 0) {
    const hits = lines.map((_, i) => i).filter(same);
    if (hits.length === 1) idx = hits[0];
  }
  if (idx < 0) throw new Error(t('notes.todoChanged'));
  const cr = lines[idx].endsWith('\r') ? '\r' : '';
  const updated = raw.replace(TASK_RE, (_m, a, _c, b, t) => `${a}${done ? 'x' : ' '}${b}${t}`);
  lines[idx] = updated + cr;
  fs.writeFileSync(file, lines.join('\n'));
  return { line: idx, raw: updated, done: !!done };
}

// Marcação em lote (#2495): items [{ file, line, raw }]. Cada um passa pela mesma conferência do setDone;
// os que falharem voltam em "failed" com o motivo, sem impedir os outros.
function setManyDone(items, done) {
  const ok = [], failed = [];
  for (const it of items) {
    try { ok.push({ file: it.file, ...setDone(it.file, it.line, it.raw, done) }); }
    catch (e) { failed.push({ file: it.file, line: it.line, error: e.message }); }
  }
  return { ok, failed };
}

module.exports = { TASK_RE, parseTaskText, parseCommitments, collectCommitments, setDone, setManyDone };
