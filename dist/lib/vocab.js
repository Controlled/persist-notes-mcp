// Vocabulário do que o usuário LÊ nos .md, em pt, en e es (#2534): títulos das seções (## Resumo / ## Summary /
// ## Resumen), textos-marcador, rótulos de falante, título provisório e linha de data.
// - Seções e marcadores acompanham o idioma do CONTEÚDO (o da reunião) e são reconhecidos nos três idiomas.
// - Rótulos ("Você", "Pessoa 1") e título provisório seguem o idioma escolhido na primeira configuração (fileLang).
//
// Os IDENTIFICADORES do formato do arquivo NÃO são traduzidos (0.13.1): chaves e valores do frontmatter
// (titulo, estado: concluída…), pastas (anexos/, Resumos/, audio/), _sintese.md, "- microfone.wav" e o slug
// "reuniao" são sempre em português, em qualquer instalação. lib/migrateIds.js corrige os arquivos que a 0.13.0
// chegou a criar com esses nomes em inglês ou espanhol.
const { normalize } = require('./text');

const LANGS = ['pt', 'en', 'es'];
const toLang = l => {
  const s = String(l || '').slice(0, 2).toLowerCase();
  return LANGS.includes(s) ? s : 'pt';
};

let fileLang = 'pt';
const setFileLang = l => { fileLang = toLang(l); };
const getFileLang = () => fileLang;

// ---------- Seções ----------

const SECTIONS = {
  // Nota da reunião (o resumo é escrito pelo Claude com estes títulos)
  summary: { pt: 'Resumo', en: 'Summary', es: 'Resumen' },
  keyPoints: { pt: 'Principais pontos', en: 'Key points', es: 'Puntos principales' },
  decisions: { pt: 'Decisões', en: 'Decisions', es: 'Decisiones' },
  nextSteps: { pt: 'Próximos passos', en: 'Next steps', es: 'Próximos pasos' },
  openQuestions: { pt: 'Perguntas em aberto', en: 'Open questions', es: 'Preguntas abiertas' },
  // 0.20.0 (#2596): trechos que o usuário marcou durante a gravação ("> ⚑ marker 00:31:05" na transcrição)
  markedMoments: { pt: 'Momentos marcados', en: 'Marked moments', es: 'Momentos marcados' },
  annotations: { pt: 'Anotações', en: 'Notes', es: 'Notas' },
  transcript: { pt: 'Transcrição', en: 'Transcript', es: 'Transcripción' },
  // Síntese do projeto
  overview: { pt: 'Visão geral', en: 'Overview', es: 'Visión general' },
  themes: { pt: 'Temas', en: 'Themes', es: 'Temas' },
  openIssues: { pt: 'Questões em aberto', en: 'Open issues', es: 'Cuestiones abiertas' },
  meetings: { pt: 'Reuniões', en: 'Meetings', es: 'Reuniones' },
  // Resumo de período
  panorama: { pt: 'Panorama', en: 'At a glance', es: 'Panorama' },
  byProject: { pt: 'Por projeto', en: 'By project', es: 'Por proyecto' },
  recurringThemes: { pt: 'Temas recorrentes', en: 'Recurring themes', es: 'Temas recurrentes' },
  attention: { pt: 'Atenção', en: 'Needs attention', es: 'Atención' },
};

const sectionTitle = (kind, lang) => SECTIONS[kind][toLang(lang)];
const heading = (kind, lang) => `## ${sectionTitle(kind, lang)}`;
const sectionNames = kind => LANGS.map(l => SECTIONS[kind][l]);

// Tipo da seção a partir do texto do título ("Próximos passos", "next steps"…); null se não for uma das nossas.
// Comparação sem acentos e sem maiúsculas; aceita texto depois do nome ("Decisões tomadas").
function sectionKind(title, kinds = Object.keys(SECTIONS)) {
  const t = normalize(String(title || '').replace(/^#+\s*/, '')).trim();
  let best = null, len = 0;
  for (const k of kinds) {
    for (const name of sectionNames(k)) {
      const n = normalize(name);
      if ((t === n || t.startsWith(n + ' ') || t.startsWith(n + ':')) && n.length > len) { best = k; len = n.length; }
    }
  }
  return best;
}
// Idioma de um título de seção ('pt' | 'en' | 'es'), ou null.
function sectionLang(title) {
  const t = normalize(String(title || '').replace(/^#+\s*/, '')).trim();
  for (const k of Object.keys(SECTIONS)) for (const l of LANGS) if (normalize(SECTIONS[k][l]) === t && SECTIONS[k].pt !== SECTIONS[k].es) return l;
  return null;
}

// Regex de uma linha de título (## <qualquer idioma>) de um tipo de seção.
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headingRe = (kind, flags = 'm') => new RegExp(`^##[ \\t]+(?:${sectionNames(kind).map(escapeRe).join('|')})[ \\t]*\\r?$`, flags);

// ---------- Textos fixos dentro das notas ----------

const NOTE_TEXT = {
  summaryPending: {
    pt: '> ⏳ Resumo ainda não gerado. Use **Gerar resumo** no app.',
    en: '> ⏳ Summary not generated yet. Use **Generate summary** in the app.',
    es: '> ⏳ Resumen aún no generado. Usa **Generar resumen** en la app.',
  },
  recPending: {
    pt: '> 🔴 Gravação em andamento. O resumo é gerado quando a gravação terminar.',
    en: '> 🔴 Recording in progress. The summary is generated when the recording ends.',
    es: '> 🔴 Grabación en curso. El resumen se genera cuando termine la grabación.',
  },
  liveTranscript: {
    pt: '_A transcrição aparece aqui durante a reunião, em blocos de alguns minutos._',
    en: '_The transcript appears here during the meeting, in blocks of a few minutes._',
    es: '_La transcripción aparece aquí durante la reunión, en bloques de unos minutos._',
  },
  interrupted: {
    pt: '_A gravação foi interrompida antes de ser transcrita._',
    en: '_The recording was interrupted before it was transcribed._',
    es: '_La grabación se interrumpió antes de transcribirse._',
  },
  discarded: {
    pt: '_Gravação descartada: o áudio e a transcrição foram apagados._',
    en: '_Recording discarded: the audio and transcript were deleted._',
    es: '_Grabación descartada: se borraron el audio y la transcripción._',
  },
  me: { pt: 'Você', en: 'Me', es: 'Yo' },
  // Pausa por canal (0.14.0; "pausa" desde a 0.16.0) e fim automático da gravação ao fim da reunião
  muteMic: { pt: '[microfone em pausa {from}–{to}]', en: '[microphone paused {from}–{to}]', es: '[micrófono en pausa {from}–{to}]' },
  muteSys: { pt: '[áudio do computador em pausa {from}–{to}]', en: '[computer audio paused {from}–{to}]', es: '[audio de la computadora en pausa {from}–{to}]' },
  autoStopped: {
    pt: '_Gravação encerrada automaticamente às {time}, ao fim da reunião._',
    en: '_Recording ended automatically at {time}, when the meeting ended._',
    es: '_Grabación terminada automáticamente a las {time}, al terminar la reunión._',
  },
  others: { pt: 'Participantes', en: 'Participants', es: 'Participantes' },
  person: { pt: 'Pessoa', en: 'Person', es: 'Persona' },
  noProject: { pt: 'Sem projeto', en: 'No project', es: 'Sin proyecto' },
};
const noteText = (kind, lang = fileLang) => NOTE_TEXT[kind][toLang(lang)];
const noteTexts = kind => LANGS.map(l => NOTE_TEXT[kind][l]);

// Título provisório de uma reunião: "Reunião de 8 de novembro 14:30" / "Meeting on November 8, 2:30 PM" / "Reunión del 8 de noviembre 14:30".
const LOCALE_OF = { pt: 'pt-BR', en: 'en-US', es: 'es' };
const TITLE_PREFIX = { pt: 'Reunião de ', en: 'Meeting on ', es: 'Reunión del ' };
function defaultTitle(date, lang = fileLang) {
  const l = toLang(lang);
  return TITLE_PREFIX[l] + new Date(date).toLocaleString(LOCALE_OF[l], { day: 'numeric', month: 'long', hour: l === 'en' ? 'numeric' : '2-digit', minute: '2-digit' });
}
// Nota sem gravação (0.16.0): "Nota de 9 de novembro 14:30" / "Note on November 9, 2:30 PM" / "Nota del 9 de noviembre 14:30".
const NOTE_PREFIX = { pt: 'Nota de ', en: 'Note on ', es: 'Nota del ' };
function defaultNoteTitle(date, lang = fileLang) {
  const l = toLang(lang);
  return NOTE_PREFIX[l] + new Date(date).toLocaleString(LOCALE_OF[l], { day: 'numeric', month: 'long', hour: l === 'en' ? 'numeric' : '2-digit', minute: '2-digit' });
}
// Título provisório (de reunião ou de nota): o resumo pode trocá-lo por um título melhor.
const isDefaultTitle = title => [...Object.values(TITLE_PREFIX), ...Object.values(NOTE_PREFIX)].some(p => String(title || '').startsWith(p));

// Linha de data da nota, abaixo do título: "*8 de novembro de 2026 às 14:30 · 45 min*".
function dateLine(date, durationText, lang) {
  const l = toLang(lang);
  const d = new Date(date).toLocaleString(LOCALE_OF[l], { day: 'numeric', month: 'long', year: 'numeric', hour: l === 'en' ? 'numeric' : '2-digit', minute: '2-digit' });
  return durationText ? `${d} · ${durationText}` : d;
}

// Idioma do conteúdo de uma nota: pelo título da transcrição, das anotações ou do resumo; null se não der para saber.
function contentLang(md) {
  for (const m of String(md || '').matchAll(/^##[ \t]+(.+?)[ \t]*\r?$/gm)) {
    const l = sectionLang(m[1]);
    if (l) return l;
  }
  return null;
}

// "Pessoa 2" / "Person 2" / "Persona 2" → 2 (rótulos da separação de vozes, em qualquer idioma).
const PERSON_RE = new RegExp(`^(?:${LANGS.map(l => NOTE_TEXT.person[l]).join('|')}) (\\d+)$`);

module.exports = {
  LANGS, toLang, setFileLang, getFileLang,
  SECTIONS, sectionTitle, heading, sectionNames, sectionKind, sectionLang, headingRe, escapeRe,
  NOTE_TEXT, noteText, noteTexts, PERSON_RE, defaultTitle, defaultNoteTitle, isDefaultTitle, dateLine, contentLang, LOCALE_OF,
};
