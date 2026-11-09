// Prazos dos próximos passos escritos em português, inglês ou espanhol ("até sexta", "by Friday",
// "hasta el viernes", "amanhã", "tomorrow", "mañana", "15/11", "Nov 15"), resolvidos a partir da data da
// reunião. O que não for reconhecido devolve null e a interface mostra o texto como está, sem destaque.
const { normalize } = require('./text');

const WEEKDAYS = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5,
};
const WEEKDAY_RE = Object.keys(WEEKDAYS).join('|');
// Três primeiras letras do mês em pt, en e es.
const MONTHS = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
  feb: 1, apr: 3, may: 4, aug: 7, sep: 8, oct: 9, dec: 11, ene: 0, dic: 11,
};
const DAY_MS = 86400000;
const MONTH_NAME = /^(jan(eiro|uary)?|fev(ereiro)?|feb(ruary|rero)?|mar(co|ch|zo)?|abr(il)?|apr(il)?|mai(o)?|may(o)?|jun(ho|e|io)?|jul(ho|y|io)?|ago(sto)?|aug(ust)?|set(embro|iembre)?|sep(t|tember|tiembre)?|out(ubro)?|oct(ober|ubre)?|nov(embro|ember|iembre)?|dez(embro)?|dec(ember)?|dic(iembre)?|ene(ro)?)$/;

const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const endOfMonth = (y, m) => new Date(y, m + 1, 0);
// Sexta-feira da semana da data (se já passou da sexta, a própria data).
const fridayOf = d => d.getDay() <= 5 ? addDays(d, 5 - d.getDay()) : d;

// "AAAA-MM-DD" no fuso local.
function localDay(date) {
  const d = new Date(date);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function validDate(y, m, d) {
  const x = new Date(y, m, d);
  return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d ? x : null;
}

// Data sem ano: o ano da reunião; se ficar bem antes da reunião (> 60 dias), é do ano seguinte.
function withYear(base, m, d, y) {
  if (y !== undefined) return validDate(y < 100 ? 2000 + y : y, m, d);
  let x = validDate(base.getFullYear(), m, d);
  if (x && x < addDays(base, -60)) x = validDate(base.getFullYear() + 1, m, d);
  return x;
}

// Devolve a data do prazo (meia-noite local) ou null se o texto não for reconhecido.
// Texto composto ("sexta, 07/11", "amanhã (antes da reunião)"): vale a primeira parte reconhecida.
// lang ('pt' | 'en' | 'es'): idioma da nota; decide a ordem de "11/05" (em inglês, mês/dia).
function resolveDue(text, meetingDate, lang) {
  const whole = resolveOne(text, meetingDate, lang);
  if (whole || !text) return whole;
  for (const part of String(text).split(/\s*[,;()]\s*|\s+[—–-]\s+/)) {
    const d = part.trim() && resolveOne(part, meetingDate, lang);
    if (d) return d;
  }
  return null;
}

// O texto é um prazo (data, dia da semana ou expressão relativa reconhecida)? Usado pelo parser das ações:
// o que não for prazo continua no texto da ação (#2502).
const isDueText = text => !!resolveDue(text, new Date(2026, 0, 7));

function resolveOne(text, meetingDate, lang) {
  const raw = new Date(meetingDate);
  if (!text || isNaN(raw)) return null;
  const base = startOfDay(raw);
  let t = normalize(text).replace(/[.!;,]+$/, '').replace(/\s+/g, ' ').trim();
  // Palavras de ligação no início: "prazo:", "até", "até o dia", "by", "until", "hasta el", "para el"…
  for (let prev = ''; prev !== t;) {
    prev = t;
    t = t.replace(/^(prazo:?|due:?|deadline:?|plazo:?|ate|para|pra|no dia|dia|no|na|em|o|a|by|until|till|before|on|the|due by|hasta|antes del?|el|la|en)\s+/, '').trim();
  }
  let m;
  const isMonth = w => MONTH_NAME.test(w || '');
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) return validDate(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t))) {
    // Dia/mês (pt, es); em inglês, mês/dia. Se um dos números passa de 12, ele é o dia.
    let [d, mo] = [+m[1], +m[2]];
    if ((lang === 'en' && mo <= 12 && d <= 12) || (d <= 12 && mo > 12)) [d, mo] = [mo, d];
    return withYear(base, mo - 1, d, m[3] === undefined ? undefined : +m[3]);
  }
  // "15 de novembro", "15 nov", "15 November", "15 de noviembre de 2026"
  if ((m = /^(\d{1,2})(?: de)? ([a-z]+)(?:,? (?:de )?(\d{4}))?$/.exec(t)) && isMonth(m[2]) && MONTHS[m[2].slice(0, 3)] !== undefined) {
    return withYear(base, MONTHS[m[2].slice(0, 3)], +m[1], m[3] === undefined ? undefined : +m[3]);
  }
  // "November 15", "Nov 15th", "November 15, 2026"
  if ((m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(t)) && isMonth(m[1]) && MONTHS[m[1].slice(0, 3)] !== undefined) {
    return withYear(base, MONTHS[m[1].slice(0, 3)], +m[2], m[3] === undefined ? undefined : +m[3]);
  }
  if (/^(hoje|hoje a (tarde|noite)|fim do dia|final do dia|ainda hoje|today|tonight|end of (the )?day|eod|hoy|hoy mismo|fin del dia)$/.test(t)) return base;
  if (/^(amanha( cedo| de manha| a tarde)?|tomorrow( morning| afternoon)?|manana( temprano| por la manana| por la tarde)?)$/.test(t)) return addDays(base, 1);
  if (/^(depois de amanha|(the )?day after tomorrow|pasado manana)$/.test(t)) return addDays(base, 2);
  if ((m = new RegExp(`^(?:(?:esta|essa|nesta|nessa|este|esse|proxima|proximo|a proxima|na proxima|this|next|this coming|el proximo|proximo)\\s+)?(${WEEKDAY_RE})(?:-feira| feira)?(?: que vem| que viene)?$`).exec(t))) {
    // Próxima ocorrência depois da reunião ("sexta" dita numa sexta é a da semana seguinte).
    const diff = (WEEKDAYS[m[1]] - base.getDay() + 7) % 7 || 7;
    return addDays(base, diff);
  }
  if (/^(fim|final) (da|de) semana$|^(esta|essa|nesta|nessa) semana$|^(end of (the )?week|this week|eow)$|^(fin de (la )?semana|esta semana)$/.test(t)) return fridayOf(base);
  if (/^(semana que vem|(a )?proxima semana|next week|(la )?(proxima semana|semana que viene))$/.test(t)) return fridayOf(addDays(base, 7 - base.getDay() + 1));
  if (/^(fim|final) do mes$|^(este|esse|neste|nesse) mes$|^(end of (the )?month|this month|eom)$|^(fin de(l)? mes|este mes)$/.test(t)) return endOfMonth(base.getFullYear(), base.getMonth());
  if (/^(mes que vem|(o )?proximo mes|next month|(el )?(proximo mes|mes que viene))$/.test(t)) return endOfMonth(base.getFullYear(), base.getMonth() + 1);
  if ((m = /^(?:daqui a |in |within |dentro de )?(\d{1,3}) (dias?|semanas?|days?|weeks?|business days?)( uteis| habiles)?$/.exec(t))) return addDays(base, +m[1] * (/^(semana|week)/.test(m[2]) ? 7 : 1));
  // Mês: "novembro", "fim de novembro", "início de dezembro", "meados de janeiro", "end of November",
  // "early December", "mid January", "finales de noviembre", "principios de diciembre", "mediados de enero".
  if ((m = /^(?:(inicio|comeco|meados|metade|fim|final|principios|comienzos|mediados|finales|fin) d[eo]l? |(early|mid|late|end of|beginning of|the end of|middle of) )?([a-z]{3})[a-z]*(?:,? (?:de )?(\d{4}))?$/.exec(t)) && MONTHS[m[3]] !== undefined && MONTH_NAME.test(t.split(' ').find(w => w.startsWith(m[3])) || '')) {
    m = [m[0], m[1] || m[2], m[3], m[4]];
    const day = !m[1] ? 0 : /inicio|comeco|principios|comienzos|early|beginning/.test(m[1]) ? 1 : /meados|metade|mediados|mid|middle/.test(m[1]) ? 15 : 0;
    const y = m[3] ? +m[3] : undefined;
    if (day) return withYear(base, MONTHS[m[2]], day, y);
    const first = withYear(base, MONTHS[m[2]], 1, y);
    return first && endOfMonth(first.getFullYear(), first.getMonth());
  }
  return null;
}

// Vencido: o dia do prazo já terminou (now em ms ou Date).
function isOverdue(dueDate, now = new Date()) {
  return !!dueDate && startOfDay(new Date(now)) - startOfDay(dueDate) >= DAY_MS;
}

module.exports = { resolveDue, isDueText, isOverdue, localDay, addDays, startOfDay };
