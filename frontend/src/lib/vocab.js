// Ayudas para "Mis palabras": partir un subtítulo en palabras, normalizarlas y mostrar tiempos.

// Una palabra: letras o números, con ' o - en el medio (don't, well-known)
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

// "I don't know." → [{t:'I', w:true}, {t:' ', w:false}, {t:"don't", w:true}, …]  (w: se puede tocar para buscarla)
export function tokenize(text) {
  text = String(text || '')
  const out = []
  let last = 0
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), w: false })
    out.push({ t: m[0], w: /\p{L}/u.test(m[0]) })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ t: text.slice(last), w: false })
  return out
}

// Igual que el servidor: minúsculas, comilla recta, sin signos en los bordes
export function normWord(w) {
  return String(w || '').replace(/’/g, "'").toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

// Parte una frase en tramos [{t, hit}] marcando dónde aparece la palabra guardada
export function splitByWord(text, word) {
  const out = []
  for (const k of tokenize(text)) {
    const hit = k.w && normWord(k.t) === word
    const prev = out[out.length - 1]
    if (prev && prev.hit === hit) prev.t += k.t
    else out.push({ t: k.t, hit })
  }
  return out
}

// "10 min", "12 h", "3 días", "2 sem", "4 meses" (se redondea antes de elegir la unidad: 23 h 59 min es "1 día", no "24 h")
export function fmtInterval(secs) {
  const m = Math.round(secs / 60)
  if (m < 60) return `${Math.max(1, m)} min`
  const h = Math.round(secs / 3600)
  if (h < 24) return `${h} h`
  const d = Math.round(secs / 86400)
  if (d < 7) return `${d} ${d === 1 ? 'día' : 'días'}`
  if (d < 30) return `${Math.round(d / 7)} sem`
  const mo = Math.round(d / 30)
  return `${mo} ${mo === 1 ? 'mes' : 'meses'}`
}

export function fmtClock(s) {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export function videoTitle(name) {
  return String(name || '').replace(/\.[^.]+$/, '')
}

// Mensaje claro para un error de red o de la API (si el backend es viejo falta reiniciar iniciar.bat)
export async function apiError(res) {
  if (res.status === 404) return 'Falta reiniciar el programa (cerrá y abrí iniciar.bat) para usar el vocabulario.'
  try { const j = await res.json(); if (j?.detail) return typeof j.detail === 'string' ? j.detail : 'No se pudo completar la acción.' } catch { /* sin cuerpo */ }
  return `No se pudo completar la acción (error ${res.status}).`
}

export const OFFLINE = 'No se pudo conectar con el programa. ¿Está abierto iniciar.bat?'
