import { useEffect, useRef, useState } from 'react'
import { apiError, OFFLINE } from '../lib/vocab'
import './WordPopup.css'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const CAN_SPEAK = typeof window !== 'undefined' && 'speechSynthesis' in window

// Ventanita que aparece al tocar una palabra del subtítulo: traducción, significados y botón para guardarla.
// Va dentro del contenedor del video (así también se ve en pantalla completa).
//   anchor: { word, rect: {l, t, w, h} (px dentro del contenedor), example: { video, start, end, en, es } }
//   card:   la palabra ya guardada (o undefined)
//   onSave({ word, translation, meanings, example }) / onRemove(card): devuelven una promesa (rechazan con Error)
export default function WordPopup({ anchor, boxRef, card, onSave, onRemove, onClose }) {
  const { word, rect, example } = anchor
  const [look, setLook] = useState({ status: 'loading' })   // loading | ok | error
  const [tr, setTr] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [attempt, setAttempt] = useState(0)
  const typed = useRef(false)
  const closeTimer = useRef(null)
  const closeRef = useRef(onClose)          // siempre la última versión, sin reiniciar los efectos en cada cambio
  useEffect(() => { closeRef.current = onClose })

  // Traducción de la palabra
  useEffect(() => {
    const ctl = new AbortController()
    setLook({ status: 'loading' })
    fetch(`/api/vocab/lookup?word=${encodeURIComponent(word)}`, { signal: ctl.signal })
      .then(async r => {
        if (!r.ok) throw new Error(await apiError(r))
        return r.json()
      })
      .then(data => {
        setLook({ status: 'ok', data })
        if (!typed.current) setTr(data.translation || '')
      })
      .catch(e => {
        if (ctl.signal.aborted) return
        setLook({ status: 'error', error: e instanceof TypeError ? OFFLINE : e.message })
      })
    return () => ctl.abort()
  }, [word, attempt])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(closeTimer.current) }
  }, [])

  const has = !!card && card.examples.some(e => e.video === example.video && Math.abs(e.start - example.start) < 0.05)

  async function save() {
    const translation = card ? card.translation : tr.trim()
    if (!translation || busy) return
    setBusy(true); setErr('')
    try {
      await onSave({ word, translation, meanings, example })
      setSaved(true)
      closeTimer.current = setTimeout(() => closeRef.current(), 800)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function remove() {
    if (busy) return
    setBusy(true); setErr('')
    try { await onRemove(card); onClose() } catch (e) { setErr(e.message); setBusy(false) }
  }

  function speak() {
    try {
      const u = new SpeechSynthesisUtterance(word)
      u.lang = 'en-US'; u.rate = 0.9
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u)
    } catch { /* sin voz disponible */ }
  }

  // Posición: arriba de la palabra si hay lugar (los subtítulos suelen estar abajo), si no abajo
  const box = boxRef.current
  const W = box?.clientWidth ?? 600, H = box?.clientHeight ?? 400
  const width = Math.min(330, W - 16)
  const left = clamp(rect.l + rect.w / 2 - width / 2, 8, W - width - 8)
  const above = rect.t > H * 0.4
  const style = above
    ? { left, width, bottom: H - rect.t + 8, maxHeight: Math.max(120, rect.t - 16) }
    : { left, width, top: rect.t + rect.h + 8, maxHeight: Math.max(120, H - rect.t - rect.h - 16) }

  const meanings = Array.isArray(look.data?.meanings) ? look.data.meanings : []

  return (
    <div
      className="wp" style={style} role="dialog" aria-label={`Palabra ${word}`}
      onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); e.stopPropagation() }}
    >
      <div className="wp-head">
        <span className="wp-word">{word}</span>
        {CAN_SPEAK && <button className="wp-icon" title="Escuchar cómo se dice" onClick={speak}>🔊</button>}
        <button className="wp-icon wp-close" title="Cerrar (Esc)" onClick={onClose}>✕</button>
      </div>

      {card ? (
        <div className="wp-tr wp-tr-saved">{card.translation}</div>
      ) : (
        <input
          className="wp-input" value={tr} autoFocus
          placeholder={look.status === 'loading' ? 'Buscando…' : 'Escribí la traducción'}
          onChange={e => { typed.current = true; setTr(e.target.value) }}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          maxLength={200}
        />
      )}

      {look.status === 'error' && (
        <div className="wp-error">
          {look.error} <button className="wp-link" onClick={() => setAttempt(a => a + 1)}>Reintentar</button>
          {!card && <div className="wp-sub">Igual podés escribir la traducción y guardarla.</div>}
        </div>
      )}

      {!card && meanings.length > 0 && (
        <div className="wp-meanings">
          {meanings.map(g => (
            <div className="wp-group" key={g.pos}>
              <span className="wp-pos">{g.pos}</span>
              {g.words.map(w => (
                <button key={w} className="wp-chip" title="Usar este significado" onClick={() => { typed.current = true; setTr(w) }}>{w}</button>
              ))}
            </div>
          ))}
        </div>
      )}

      {err && <div className="wp-error">{err}</div>}

      <div className="wp-actions">
        {saved ? (
          <div className="wp-ok">✓ Guardada en Mis palabras</div>
        ) : has ? (
          <>
            <span className="wp-ok">✓ Ya está en Mis palabras</span>
            <button className="wp-btn" disabled={busy} onClick={remove} title="Borra la palabra de Mis palabras">
              Quitar palabra{card.examples.length > 1 ? ` y sus ${card.examples.length} frases` : ''}
            </button>
          </>
        ) : card ? (
          <button className="wp-btn wp-btn-main" disabled={busy} onClick={save}>➕ Sumar esta frase a la palabra</button>
        ) : (
          <button className="wp-btn wp-btn-main" disabled={busy || !tr.trim()} onClick={save}>⭐ Guardar en Mis palabras</button>
        )}
      </div>
    </div>
  )
}
