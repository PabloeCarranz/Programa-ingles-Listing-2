import { useEffect, useRef, useState } from 'react'
import JobProgress from './JobProgress'
import { errorText } from '../lib/saveFile'
import './VideoLink.css'

// Cuadro para pegar un link de YouTube y traer el video a la carpeta de videos.
// onDone(nombre): se llamó cuando terminó de bajar un video (la pantalla actualiza la lista)
// onOpen(video): abrir el video para practicar
export default function VideoLink({ onDone, onOpen }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)        // enviando el pedido
  const [error, setError] = useState('')
  // [{ id, state: 'running' | 'done' | 'have' | 'error' | 'cancelled', job, title, file, msg }]
  const [rows, setRows] = useState([])
  const rowsRef = useRef(rows); rowsRef.current = rows
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone
  const inputRef = useRef(null)

  const addRow = row => setRows(rs => [row, ...rs.filter(r => r.id !== row.id)])
  const patchRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const dropRow = id => setRows(rs => rs.filter(r => r.id !== id))

  // Si se recargó la página con una descarga en marcha, se vuelve a mostrar
  useEffect(() => {
    fetch('/api/download/active').then(r => r.json()).then(list => {
      if (!Array.isArray(list) || !list.length) return
      setRows(rs => [...list.filter(j => !rs.some(r => r.id === j.job)).map(j => ({ id: j.job, state: 'running', job: j, title: j.title })), ...rs])
    }).catch(() => {})
  }, [])

  // Mientras haya descargas en curso se consulta el avance
  const anyRunning = rows.some(r => r.state === 'running')
  useEffect(() => {
    if (!anyRunning) return
    let stop = false
    const tick = async () => {
      for (const r of rowsRef.current.filter(x => x.state === 'running')) {
        try {
          const s = await fetch(`/api/download/status/${r.id}`).then(x => x.json())
          if (stop) return
          if (s.status === 'done') { patchRow(r.id, { state: 'done', file: s.file, title: s.title, job: s }); onDoneRef.current?.(s.file) }
          else if (s.status === 'error') patchRow(r.id, { state: s.cancelled ? 'cancelled' : 'error', msg: s.msg })
          else if (s.status === 'idle') patchRow(r.id, { state: 'error', msg: 'Se perdió la descarga (¿se reinició el programa?).' })
          else patchRow(r.id, { job: s, title: s.title ?? r.title })
        } catch { /* sin conexión un momento: se reintenta */ }
      }
    }
    const t = setInterval(tick, 700)
    tick()
    return () => { stop = true; clearInterval(t) }
  }, [anyRunning])

  async function submit() {
    const text = url.trim()
    if (!text || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/download/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: text }),
      })
      if (!res.ok) { setError(await errorText(res)); return }
      const d = await res.json()
      if (d.exists) addRow({ id: `have-${d.exists}`, state: 'have', file: d.exists, title: d.exists.replace(/\.[^.]+$/, '') })
      else if (!rowsRef.current.some(r => r.id === d.job)) addRow({ id: d.job, state: 'running', job: { msg: 'Preparando…', progress: null, elapsed: 0 } })
      setUrl('')
    } catch {
      setError('No se pudo contactar con el programa.')
    } finally {
      setBusy(false)
    }
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText()
      if (t) { setUrl(t.trim()); setError('') }
    } catch { /* sin permiso para leer el portapapeles: se pega con Ctrl+V */ }
    inputRef.current?.focus()
  }

  const cancel = id => fetch(`/api/download/cancel/${id}`, { method: 'POST' }).catch(() => {})
  const open = file => onOpen?.({ name: file, segments: 0, has_subs_en: false, has_subs_es: false })

  return (
    <div className="vl-box">
      <div className="vl-title">🔗 Traer un video de YouTube</div>
      <div className="vl-form">
        <input
          ref={inputRef} className="vl-input" type="text" inputMode="url" spellCheck={false} autoComplete="off"
          placeholder="Pegá acá el link del video…" value={url} disabled={busy}
          onChange={e => { setUrl(e.target.value); if (error) setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          aria-label="Link de YouTube"
        />
        {typeof navigator !== 'undefined' && navigator.clipboard?.readText && (
          <button type="button" className="vl-btn" onClick={paste} title="Pegar el link que copiaste" disabled={busy}>📋 Pegar</button>
        )}
        <button type="button" className="vl-btn vl-btn-main" onClick={submit} disabled={busy || !url.trim()}>
          {busy ? 'Enviando…' : '⬇ Traer'}
        </button>
      </div>
      {error && <div className="vl-error" role="alert">⚠ {error}</div>}
      {!error && !rows.length && <div className="vl-hint">Se guarda en tu carpeta de videos y queda listo para practicar.</div>}

      {rows.map(r => (
        <div key={r.id} className={`vl-row vl-row-${r.state}`}>
          {r.state === 'running' && (
            <>
              <div className="vl-row-head">
                <span className="vl-name">{r.title || 'Trayendo el video…'}</span>
                <button type="button" className="vl-x" onClick={() => cancel(r.id)} title="Cancelar la descarga">■ Cancelar</button>
              </div>
              <JobProgress label="Descargando" job={r.job ?? { msg: 'Preparando…', progress: null, elapsed: 0 }} />
            </>
          )}
          {(r.state === 'done' || r.state === 'have') && (
            <div className="vl-row-head">
              <span className="vl-name">{r.state === 'done' ? '✅ Listo: ' : '📁 Ya lo tenías: '}<b>{r.title || r.file}</b></span>
              <span className="vl-actions">
                <button type="button" className="vl-btn vl-btn-main" onClick={() => open(r.file)}>▶ Abrir</button>
                <button type="button" className="vl-x" onClick={() => dropRow(r.id)} title="Quitar este aviso">✕</button>
              </span>
            </div>
          )}
          {(r.state === 'error' || r.state === 'cancelled') && (
            <div className="vl-row-head">
              <span className={r.state === 'error' ? 'vl-name vl-err' : 'vl-name'}>
                {r.state === 'cancelled' ? 'Descarga cancelada. No se guardó nada.' : `⚠ ${r.msg}`}
              </span>
              <button type="button" className="vl-x" onClick={() => dropRow(r.id)} title="Quitar este aviso">✕</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
