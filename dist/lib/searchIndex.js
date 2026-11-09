// Índice de busca local sobre todas as reuniões (BM25), com trechos.
// Cada reunião vira vários "trechos": itens do resumo e falas da transcrição.
// Atualização incremental: só reindexa arquivos com mtime/tamanho diferentes.
const fs = require('fs');
const notes = require('./notes');
const { normalize } = require('./text');

const STOP = new Set(('a o as os um uma uns umas de da do das dos em na no nas nos por para pra com sem e ou que se ' +
  'eu voce ele ela nos eles elas me te lhe isso isto esse essa este esta aquele aquela ao aos à às é foi ser ter tem ' +
  'mais menos muito muita ja não nao sim como quando onde qual quais quem porque pelo pela pelos pelas sobre entre ' +
  'the of and to in is it for on').split(/\s+/).map(normalize));

// Radical simples por truncamento (6 letras): "hospedagem" e "hospedar" viram "hosped".
// Em português funciona bem para busca e não precisa de dicionário.
const STEM_LEN = 6;
function tokenize(text) {
  return normalize(text).split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t))
    .map(t => /^\d+$/.test(t) ? t : t.slice(0, STEM_LEN));
}

// Tira a marcação Markdown simples (negrito, itálico, links) do texto de um trecho.
const plain = t => t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
  .replace(/\[([^\]]+)\]\(<?[^)>]*>?\)/g, '$1').trim();

// Divide a nota em trechos pesquisáveis.
function chunkNote(md) {
  const parts = notes.splitNote(md);
  const chunks = [];
  let section = 'Resumo';
  if (parts.title) chunks.push({ section: 'Título', text: parts.title });
  for (const line of (parts.summary || '').split('\n')) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    const t = line.replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '').trim();
    if (t) chunks.push({ section, text: plain(t) });
  }
  // Anotações do usuário (#2507): pesquisáveis e visíveis no MCP como seção própria.
  for (const line of (parts.annotations || '').split('\n')) {
    const t = line.replace(/^\s*(#+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
    if (t) chunks.push({ section: 'Anotações', text: plain(t) });
  }
  for (const line of (parts.transcript || '').split('\n')) {
    const m = /^\*\*\[(\d{2}:\d{2}:\d{2})\] ([^*]+?):\*\*\s*(.*)$/.exec(line);
    if (m && m[3].trim()) chunks.push({ section: 'Transcrição', time: m[1], speaker: m[2], text: plain(m[3]) });
  }
  return chunks;
}

class SearchIndex {
  constructor() {
    this.docs = new Map();   // file → { mtimeMs, size, meta, chunks: [{ ..., tf: Map, len }] }
    this.df = null;          // termo → nº de trechos que o contêm (recalculado quando algo muda)
    this.total = 0; this.avgLen = 1;
  }

  // entries: saída de notes.listNotes (file, title, date, project). Remove o que sumiu.
  update(entries) {
    const seen = new Set();
    let changed = false;
    for (const e of entries) {
      seen.add(e.file);
      let st;
      try { st = fs.statSync(e.file); } catch (_) { continue; }
      const cur = this.docs.get(e.file);
      if (cur && cur.mtimeMs === st.mtimeMs && cur.size === st.size) { cur.meta = e; continue; }
      const md = fs.readFileSync(e.file, 'utf8');
      const chunks = chunkNote(md).map(c => {
        const toks = tokenize(c.text);
        const tf = new Map();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        return { ...c, tf, len: toks.length || 1 };
      });
      this.docs.set(e.file, { mtimeMs: st.mtimeMs, size: st.size, meta: e, chunks });
      changed = true;
    }
    for (const f of [...this.docs.keys()]) if (!seen.has(f)) { this.docs.delete(f); changed = true; }
    if (changed || !this.df) this.recount();
    return changed;
  }

  recount() {
    this.df = new Map();
    let n = 0, len = 0;
    for (const d of this.docs.values()) for (const c of d.chunks) {
      n++; len += c.len;
      for (const t of c.tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    }
    this.total = n; this.avgLen = n ? len / n : 1;
  }

  // Termos da consulta; o último aceita prefixo (busca enquanto digita).
  expand(q, prefixLast) {
    const terms = tokenize(q);
    return terms.map((t, i) => {
      if (!(prefixLast && i === terms.length - 1)) return [t];
      const out = [...this.df.keys()].filter(k => k.startsWith(t) && k !== t).slice(0, 20);
      return [t, ...out];
    });
  }

  scoreChunk(c, groups) {
    const k1 = 1.2, b = 0.75;
    let score = 0, matched = 0;
    for (const group of groups) {
      let best = 0;
      for (const t of group) {
        const f = c.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) || 0;
        const idf = Math.log(1 + (this.total - df + 0.5) / (df + 0.5));
        best = Math.max(best, idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * c.len / this.avgLen)));
      }
      if (best > 0) matched++;
      score += best;
    }
    // Resumo e título valem mais que uma fala solta da transcrição.
    const boost = c.section === 'Título' ? 1.6 : c.section === 'Transcrição' ? 1 : 1.3;
    return { score: score * boost, matched };
  }

  // Trechos mais relevantes. mode 'all': a reunião precisa ter todos os termos; 'any': qualquer termo.
  searchChunks(q, { project, limit = 12, mode = 'any', prefixLast = false } = {}) {
    const groups = this.expand(q, prefixLast);
    if (!groups.length) return [];
    const out = [];
    for (const d of this.docs.values()) {
      if (project !== undefined && !notes.matchesProject(d.meta.project || '', project)) continue;
      if (mode === 'all') {
        const toks = new Set(); for (const c of d.chunks) for (const t of c.tf.keys()) toks.add(t);
        if (!groups.every(g => g.some(t => toks.has(t)))) continue;
      }
      for (const c of d.chunks) {
        const { score, matched } = this.scoreChunk(c, groups);
        if (score > 0) out.push({ file: d.meta.file, title: d.meta.title, date: d.meta.date, project: d.meta.project || '', kind: d.meta.kind || 'reuniao',
          section: c.section, time: c.time || '', speaker: c.speaker || '', text: c.text, score: score * (1 + 0.5 * (matched - 1)) });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Reuniões ordenadas por relevância, com o melhor trecho de cada uma.
  searchNotes(q, { project, limit = 200 } = {}) {
    const chunks = this.searchChunks(q, { project, limit: 5000, mode: 'all', prefixLast: true });
    const byFile = new Map();
    for (const c of chunks) {
      const cur = byFile.get(c.file);
      if (!cur) byFile.set(c.file, { file: c.file, score: c.score, best: c });
      else cur.score += c.score * 0.25;
    }
    return [...byFile.values()].sort((a, b) => b.score - a.score).slice(0, limit)
      .map(r => ({ file: r.file, score: r.score, snippet: snippet(r.best.text, q), section: r.best.section, time: r.best.time }));
  }
}

// Recorte de ~160 caracteres em torno do primeiro termo encontrado.
function snippet(text, q, size = 160) {
  const terms = tokenize(q);
  const norm = normalize(text);
  let at = -1;
  for (const t of terms) { const i = norm.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (text.length <= size) return text;
  const start = Math.max(0, Math.min(text.length - size, at < 0 ? 0 : at - 50));
  return (start > 0 ? '…' : '') + text.slice(start, start + size).trim() + (start + size < text.length ? '…' : '');
}

module.exports = { SearchIndex, tokenize, chunkNote, snippet };
