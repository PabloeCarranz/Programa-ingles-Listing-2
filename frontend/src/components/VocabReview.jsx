import { useEffect, useRef, useState } from 'react'
import { splitByWord, fmtInterval, videoTitle, apiError, OFFLINE } from '../lib/vocab'
import './Vocabulary.css'

const GRADES = [
  { id: 'again', label: 'Otra vez', key: '1' },
  { id: 'hard',  label: 'Difícil',  key: '2' },
  { id: 'good',  label: 'Bien',     key: '3' },
  { id: 'easy',  label: 'Fácil',    key: '4' },
]
const AHEAD = 3          // una tarjeta que salió mal vuelve a aparecer después de estas

// Repaso: suena la frase del video donde escuchaste la palabra, intentás acordarte y marcás qué tal te fue.
export default function VocabReview({ cards, onExit, onMore, moreCount }) {
  const [queue, setQueue] = useState(cards)
  const [shown, setShown] = useState(false)           // ya se mostró la respuesta
  const [tally, setTally] = useState({ again: 0, hard: 0, good: 0, easy: 0 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [slow, setSlow] = useState(false)
  const [missing, setMissing] = useState(false)       // el video ya no está en la carpeta
  const [blocked, setBlocked] = useState(false)       // el navegador no dejó arrancar el sonido solo

  const vref = useRef(null)
  const loaded = useRef('')                           // video cargado en el <video>
  const timer = useRef(null)
  const total = cards.length
  const cur = queue[0]
  const ex = cur ? cur.examples[cur.reps % cur.examples.length] : null   // cada vuelta, una frase distinta

  function whenReady(v, fn) {
    if (v.readyState >= 1) fn()
    else v.addEventListener('loadedmetadata', fn, { once: true })
  }

  // Reproduce solo la frase (un poquito antes y después para que no suene cortada)
  function playClip() {
    const v = vref.current
    if (!v || !ex) return
    clearInterval(timer.current)
    const end = ex.end + 0.5
    whenReady(v, () => {
      v.currentTime = Math.max(0, ex.start - 0.4)
      v.playbackRate = slow ? 0.75 : 1
      v.play().then(() => {
        setBlocked(false)
        timer.current = setInterval(() => { if (v.currentTime >= end || v.ended) { v.pause(); clearInterval(timer.current) } }, 50)
      }).catch(() => setBlocked(true))
    })
  }

  // Al cambiar de tarjeta (o de frase) se carga el video si hace falta y suena la frase
  useEffect(() => {
    const v = vref.current
    if (!v || !ex) return
    setMissing(false)
    if (loaded.current !== ex.video) {
      loaded.current = ex.video
      v.src = `/videos/${encodeURIComponent(ex.video)}`
    }
    playClip()
    return () => { clearInterval(timer.current); v.pause() }
  }, [cur?.id, cur?.reps]) // eslint-disable-line react-hooks/exhaustive-deps

  async function grade(g) {
    if (busy || !cur) return
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/vocab/${cur.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grade: g }) })
      if (!r.ok && r.status !== 404) throw new Error(await apiError(r))
      const upd = r.ok ? await r.json() : null          // 404: la borraron mientras tanto → se la saltea
      setTally(t => ({ ...t, [g]: t[g] + 1 }))
      setQueue(q => {
        const rest = q.slice(1)
        if (g !== 'again' || !upd) return rest
        const at = Math.min(rest.length, AHEAD)
        return [...rest.slice(0, at), upd, ...rest.slice(at)]
      })
      setShown(false)
    } catch (e) { setErr(e instanceof TypeError ? OFFLINE : e.message) }
    setBusy(false)
  }

  // Teclado: Espacio/Enter muestra la respuesta (y después marca "Bien"), 1-4 marcan, R repite el audio, Esc sale.
  // Se vuelve a registrar en cada cambio para que siempre use lo último.
  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      if (e.key === 'Escape') { onExit(); return }
      if (!cur) return
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault(); document.activeElement?.blur?.()
        if (shown) grade('good'); else setShown(true)
      } else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); playClip() }
      else if (shown && GRADES.some(g => g.key === e.key)) grade(GRADES.find(g => g.key === e.key).id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const done = total - queue.length
  const pct = total ? Math.round((Math.max(0, done) / total) * 100) : 100

  const Header = (
    <div className="vr-top">
      <button className="back-btn" onClick={onExit}>← Salir</button>
      <div className="vr-progress" title={`${done} de ${total}`}><div className="vr-progress-fill" style={{ width: `${pct}%` }} /></div>
      <span className="vr-count">{Math.min(done + 1, total)} / {total}</span>
    </div>
  )

  if (!cur) {
    return (
      <div className="vlist-wrap vb-page vr-page">
        <div className="vb-box vr-end">
          <div className="vr-end-icon">🎉</div>
          <h2>¡Listo!</h2>
          <p>Repasaste {total} {total === 1 ? 'palabra' : 'palabras'}.</p>
          <div className="vr-tally">
            <span>😕 Otra vez <b>{tally.again}</b></span><span>😐 Difícil <b>{tally.hard}</b></span>
            <span>🙂 Bien <b>{tally.good}</b></span><span>😄 Fácil <b>{tally.easy}</b></span>
          </div>
          <div className="vr-end-actions">
            {moreCount > 0 && <button className="vb-btn vb-btn-main" onClick={onMore}>Seguir con las {moreCount} que faltan</button>}
            <button className="vb-btn" onClick={onExit}>Volver a Mis palabras</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="vlist-wrap vb-page vr-page">
      {Header}

      <div className="vb-box vr-card">
        <div className="vr-media">
          <video ref={vref} className="vr-video" playsInline preload="auto" onError={() => { loaded.current = ''; setMissing(true) }} style={missing ? { display: 'none' } : undefined} />
          {missing && <div className="vr-missing">🎬 El video «{videoTitle(ex.video)}» ya no está en tu carpeta.<br />Podés repasar igual con el texto.</div>}
        </div>
        <div className="vr-audio">
          <button className="vb-btn" onClick={playClip} disabled={missing}>🔁 Escuchar otra vez <kbd>R</kbd></button>
          <button className={`vb-btn${slow ? ' vb-btn-on' : ''}`} onClick={() => setSlow(s => !s)} disabled={missing} title="Más despacio (0.75x)">🐢 Lento</button>
        </div>
        {blocked && !missing && <div className="vr-hint">Tu navegador no dejó arrancar el sonido solo: tocá «Escuchar otra vez».</div>}

        <div className="vr-word">{cur.word}</div>
        {!cur.reps && <div className="vr-new">Palabra nueva</div>}

        {!shown ? (
          <button className="vb-btn vb-btn-main vr-show" onClick={() => setShown(true)}>Mostrar respuesta <kbd>Espacio</kbd></button>
        ) : (
          <div className="vr-back">
            <div className="vr-tr">{cur.translation}</div>
            {cur.meanings?.length > 0 && (
              <div className="vb-meanings">
                {cur.meanings.map(g => <div key={g.pos}><span className="vb-pos">{g.pos}</span> {g.words.join(', ')}</div>)}
              </div>
            )}
            <div className="vr-sentence">
              {splitByWord(ex.en, cur.word).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
            </div>
            {ex.es && <div className="vr-sentence-es">{ex.es}</div>}
            <div className="vr-src">🎬 {videoTitle(ex.video)}</div>
            <div className="vr-grades">
              {GRADES.map(g => (
                <button key={g.id} className={`vr-grade vr-grade-${g.id}`} disabled={busy} onClick={() => grade(g.id)}>
                  <span className="vr-grade-label">{g.label}</span>
                  <span className="vr-grade-when">{fmtInterval(cur.preview[g.id])}</span>
                  <kbd>{g.key}</kbd>
                </button>
              ))}
            </div>
          </div>
        )}
        {err && <div className="vb-error vr-err">{err}</div>}
      </div>
    </div>
  )
}
