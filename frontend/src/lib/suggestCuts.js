// Sugerencias de corte: lee la conversación (los subtítulos en inglés) y propone fragmentos buenos para practicar.
// Sin internet ni IA externa: arma oraciones completas, las agrupa por las pausas naturales de la charla y les
// pone puntaje según si sirven para repetir (ni muy cortas ni muy largas, ritmo de habla cómodo, frases completas).

const END_RE    = /[.?!…]["'”’)\]]*\s*$/            // la línea termina una oración
const FILLER_RE = /^(yeah|yes|no|ok|okay|oh|uh|um|hmm|mm|ah|hey|hi|right|sure|what|huh|wow|thanks|thank you|bye|well|so)[\s.,!?…]*$/i
const MIN_DUR = 1.6, IDEAL_MIN = 2.5, IDEAL_MAX = 8, MAX_DUR = 11
const MAX_WORDS = 32
const PAUSE_SENT = 0.9     // pausa que corta una oración aunque no tenga punto
const PAUSE_GROUP = 0.7    // pausa máxima para juntar dos oraciones en el mismo fragmento

const words = t => (t.match(/[A-Za-z0-9']+/g) ?? []).length
const clean = t => String(t ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

// Subtítulos → oraciones (unidades que terminan en punto o en una pausa larga)
function sentences(subs, shift) {
  const out = []
  let cur = null
  for (const s of subs) {
    const text = clean(s.phrase)
    if (!text) continue
    const a = s.start + shift, b = s.end + shift
    if (cur && a - cur.end > PAUSE_SENT) { out.push(cur); cur = null }
    if (!cur) cur = { start: a, end: b, text }
    else { cur.end = Math.max(cur.end, b); cur.text += ' ' + text }
    if (END_RE.test(text)) { out.push(cur); cur = null }
  }
  if (cur) out.push(cur)
  return out
}

// Puntaje 0..100 de lo buena que es una porción para practicar
function score(chunk) {
  const dur = chunk.end - chunk.start
  const w = words(chunk.text)
  if (dur < MIN_DUR || w < 3) return 0
  if (FILLER_RE.test(chunk.text)) return 0
  let sc = 50
  // duración cómoda para repetir
  if (dur >= IDEAL_MIN && dur <= IDEAL_MAX) sc += 20
  else if (dur > MAX_DUR) sc -= 25
  else sc -= 5
  // cantidad de palabras: suficiente contenido, sin ser un párrafo
  if (w >= 6 && w <= 22) sc += 15
  else if (w > MAX_WORDS) sc -= 20
  // ritmo de habla (palabras por segundo): muy rápido cuesta, muy lento suele ser ruido o silencio
  const wps = w / dur
  if (wps >= 1.6 && wps <= 3.6) sc += 10
  else if (wps > 4.5 || wps < 0.9) sc -= 15
  // oración completa (termina con puntuación) y preguntas: muy útiles en una conversación
  if (END_RE.test(chunk.text)) sc += 8
  if (/\?\s*["'”’)]*\s*$/.test(chunk.text)) sc += 5
  // ida y vuelta (dos personas): "- Hola. - ¿Qué tal?"
  if (chunk.n > 1) sc += 4
  return Math.max(0, Math.min(100, sc))
}

/**
 * @param {Array<{start:number,end:number,phrase:string}>} subs  subtítulos en inglés
 * @param {object} o
 * @param {number} [o.shift]     delay de los subtítulos (s), para cortar donde se oye la frase
 * @param {number} [o.duration]  largo del video
 * @param {Array<{start:number,end:number}>} [o.existing]  banderas que ya hay (no se proponen encima)
 * @returns {Array<{id:string,start:number,end:number,text:string,score:number,stars:number}>}
 */
export function suggestCuts(subs, { shift = 0, duration = 0, existing = [] } = {}) {
  const list = [...(subs ?? [])].filter(s => s && isFinite(s.start) && isFinite(s.end)).sort((a, b) => a.start - b.start)
  const sents = sentences(list, shift)
  if (!sents.length) return []

  // Agrupar oraciones seguidas (sin pausa larga) mientras el fragmento siga siendo cómodo de repetir
  const chunks = []
  let cur = null
  for (const s of sents) {
    if (cur) {
      const gap = s.start - cur.end
      const nextDur = s.end - cur.start
      const nextWords = words(cur.text) + words(s.text)
      const curDur = cur.end - cur.start
      if (gap <= PAUSE_GROUP && nextDur <= IDEAL_MAX && nextWords <= MAX_WORDS - 8 && (curDur < IDEAL_MIN + 1.5 || words(cur.text) < 7)) {
        cur.end = s.end; cur.text += ' ' + s.text; cur.n++
        continue
      }
      chunks.push(cur)
    }
    cur = { ...s, n: 1 }
  }
  if (cur) chunks.push(cur)

  // Margen para no comerse la primera ni la última sílaba (sin pisar la frase de al lado)
  const out = []
  chunks.forEach((c, i) => {
    const sc = score(c)
    if (sc < 60) return
    const prevEnd = i > 0 ? chunks[i - 1].end : 0
    const nextStart = i < chunks.length - 1 ? chunks[i + 1].start : (duration || c.end + 1)
    const start = Math.max(0, Math.max(c.start - 0.3, (prevEnd + c.start) / 2))
    let end = Math.min(c.end + 0.4, (c.end + nextStart) / 2)
    if (duration) end = Math.min(end, duration)
    const r2 = v => Math.round(v * 100) / 100
    const cut = { start: r2(start), end: r2(end) }
    if (existing.some(e => cut.start < e.end - 0.2 && cut.end > e.start + 0.2)) return
    out.push({
      id: `sug-${i}-${cut.start}`,
      ...cut,
      text: c.text,
      score: sc,
      stars: sc >= 85 ? 3 : sc >= 72 ? 2 : 1,
    })
  })
  return out
}

// Nombre corto para la bandera a partir de la frase
export function cutName(text, max = 42) {
  const t = clean(text)
  return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, '') + '…'
}
