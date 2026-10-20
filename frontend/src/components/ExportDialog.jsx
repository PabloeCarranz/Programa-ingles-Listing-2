import { useEffect, useMemo, useRef, useState } from 'react'
import JobProgress from './JobProgress'
import { saveFileAs, fmtBytes, errorText } from '../lib/saveFile'
import './ExportDialog.css'

const STYLES = [
  ['default', 'Default'], ['comic', 'Comic'], ['gothic', 'Gothic'], ['console', 'Console'], ['neon', 'Neon'],
  ['neonblue', 'Neon Blue'], ['fire', 'Fire'], ['ice', 'Ice'], ['gold', 'Gold'], ['bubblegum', 'Bubblegum'],
  ['cinema', 'Cinema'], ['shadow', 'Shadow'], ['outline', 'Outline'],
]
const QUALITIES = [
  ['alta', 'Alta', 'Mejor imagen, archivo más grande'],
  ['media', 'Media', 'Recomendada: pesa parecido al original'],
  ['liviana', 'Liviana', 'Hasta 720p, para compartir'],
]

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('export_prefs') ?? '{}') ?? {} } catch { return {} }
}

// Diálogo para guardar el video (o un fragmento) con los subtítulos puestos.
// mode: 'video' = el video entero · 'segment' = un fragmento con sus vueltas y velocidades
export default function ExportDialog({ mode, video, segment, subsEn, subsEs, showEn = true, showEs = true, subStyle, subSize, subOffset, subShift, subBg = true, cover = null, refHeight, view = null, currentTime, onClose }) {
  const prefs = useMemo(loadPrefs, [])
  const isSeg = mode === 'segment'
  // Idiomas marcados al abrir: los que el usuario tiene activados (🇬🇧 / 🇪🇸) en el reproductor. Si no tiene ninguno activo, los que existan.
  const initLang = useMemo(() => {
    const en = showEn && subsEn.length > 0, es = showEs && subsEs.length > 0
    return en || es ? { en, es } : { en: subsEn.length > 0, es: subsEs.length > 0 }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [style, setStyle] = useState(segment?.subStyle || subStyle || 'default')
  const [en, setEn] = useState(initLang.en)
  const [es, setEs] = useState(initLang.es)
  const [format, setFormat] = useState(prefs.format === 'soft' ? 'soft' : 'hard')
  const [quality, setQuality] = useState(prefs.quality || 'media')
  const [useReps, setUseReps] = useState(true)       // fragmento: respetar las vueltas y velocidades
  const [withSubs, setWithSubs] = useState(true)     // fragmento: grabar subtítulos
  // Arrancan como están en el reproductor: 🔲 Fondo y ▬ franja negra (cover: {on, rect})
  const [bg, setBg] = useState(subBg)
  const [band, setBand] = useState(!!cover?.on)
  const [folder, setFolder] = useState('')
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState({ url: null, loading: false, error: '' })
  const pollRef = useRef(null)
  const running = !!jobId && !result && !error

  const reps = useMemo(() => {
    const rc = segment?.repConfig ?? [{ speed: 1, en: true, es: false }]
    return rc.map(r => ({ speed: r.speed ?? 1, en: !!r.en, es: !!r.es }))
  }, [segment])
  const hard = format === 'hard'
  const soft = !isSeg && format === 'soft'
  // Idiomas que realmente se van a grabar (en un fragmento con vueltas los decide cada vuelta)
  const repsLang = isSeg && useReps
  const enOn = en && subsEn.length > 0
  const esOn = es && subsEs.length > 0
  const lang = repsLang ? { en: reps.some(r => r.en), es: reps.some(r => r.es) } : { en: enOn, es: esOn }
  const nothing = !isSeg && !enOn && !esOn      // un video entero necesita al menos un idioma (un fragmento puede ir sin subtítulos)

  // Momento del video que se muestra en la vista previa: uno con subtítulo
  const previewT = useMemo(() => {
    const lo = isSeg ? segment.start : 0, hi = isSeg ? segment.end : Infinity
    const all = [...subsEn, ...subsEs].map(s => ({ a: s.start + subShift, b: s.end + subShift }))
    const cur = currentTime || 0
    if (all.some(s => cur >= s.a && cur <= s.b && cur >= lo && cur <= hi)) return cur
    const first = all.filter(s => s.b > lo && s.a < hi).sort((x, y) => x.a - y.a)[0]
    return first ? Math.max(lo, first.a) + Math.min(0.6, (first.b - first.a) / 2) : lo + 0.5
  }, [isSeg, segment, subsEn, subsEs, subShift, currentTime])

  const baseBody = () => ({
    video: video.name, style,
    en: lang.en, es: lang.es,
    size_rem: subSize, ref_h: refHeight || 400, offset: subOffset, shift: subShift, quality, mode: format,
    sub_bg: bg, cover: band && cover?.rect ? cover.rect : null,
  })

  useEffect(() => {
    fetch('/api/exports').then(r => r.json()).then(d => setFolder(d.folder || '')).catch(() => {})
    return () => { clearInterval(pollRef.current) }
  }, [])

  // Vista previa: el mismo fotograma, ya con los subtítulos como saldrán
  useEffect(() => {
    if (soft || (!lang.en && !lang.es) || (isSeg && !withSubs)) { setPreview(p => ({ ...p, loading: false, error: '' })); return }
    let stop = false
    const timer = setTimeout(async () => {
      setPreview(p => ({ ...p, loading: true, error: '' }))
      try {
        const res = await fetch('/api/export/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...baseBody(), t: previewT }),
        })
        if (!res.ok) throw new Error(await errorText(res))
        const blob = await res.blob()
        if (stop) return
        setPreview(p => { if (p.url) URL.revokeObjectURL(p.url); return { url: URL.createObjectURL(blob), loading: false, error: '' } })
      } catch (e) {
        if (!stop) setPreview(p => ({ ...p, loading: false, error: e.message }))
      }
    }, 300)
    return () => { stop = true; clearTimeout(timer) }
  }, [style, lang.en, lang.es, quality, format, previewT, withSubs, subSize, subOffset, subShift, refHeight, bg, band]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { setPreview(p => { if (p.url) URL.revokeObjectURL(p.url); return p }) }, [])

  async function start() {
    setError(''); setResult(null); setStatus(null)
    try { localStorage.setItem('export_prefs', JSON.stringify({ format, quality })) } catch { /* sin almacenamiento */ }
    const body = isSeg
      ? { ...baseBody(), start: segment.start, end: segment.end, phrase: segment.phrase, subs: withSubs,
          reps: useReps ? reps : [{ speed: 1, en: enOn, es: esOn }] }
      : baseBody()
    try {
      const res = await fetch(isSeg ? '/api/export/segment' : '/api/export/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) { setError(await errorText(res)); return }
      const { job } = await res.json()
      setJobId(job)
      pollRef.current = setInterval(async () => {
        try {
          const s = await fetch(`/api/export/status/${job}`).then(r => r.json())
          setStatus(s)
          if (s.status === 'done') { clearInterval(pollRef.current); setResult(s) }
          else if (s.status === 'error') { clearInterval(pollRef.current); setError(s.cancelled ? 'cancelado' : s.msg) }
          else if (s.status === 'idle') { clearInterval(pollRef.current); setError('Se perdió la exportación (¿se reinició el programa?).') }
        } catch { clearInterval(pollRef.current); setError('Se perdió la conexión con el programa.') }
      }, 600)
    } catch {
      setError('No se pudo contactar con el programa.')
    }
  }

  async function cancel() {
    if (jobId) await fetch(`/api/export/cancel/${jobId}`, { method: 'POST' }).catch(() => {})
  }
  function close() { if (running) cancel(); onClose() }
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const url = result ? `/api/exports/download?name=${encodeURIComponent(result.file)}` : ''
  const [saveMsg, setSaveMsg] = useState('')
  async function save() {
    const r = await saveFileAs(url, result.file)
    setSaveMsg(r === 'saved' ? '✓ Guardado' : r === 'downloaded' ? '✓ Descargando…' : '')
  }
  const reveal = () => fetch(`/api/exports/reveal?name=${encodeURIComponent(result.file)}`, { method: 'POST' }).catch(() => {})

  const title = isSeg ? `Exportar fragmento · ${segment.phrase}` : 'Exportar video con subtítulos'
  const canStart = !running && !result && !nothing

  return (
    <div className="exp-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) close() }}>
      <div className="exp-modal" role="dialog" aria-label={title}>
        <div className="exp-head">
          <span className="exp-title">💾 {title}</span>
          <button className="exp-x" onClick={close} title="Cerrar (Esc)">✕</button>
        </div>

        <div className="exp-body">
          {!soft && !(isSeg && !withSubs) && (
            // Del mismo tamaño que la imagen del video en el reproductor (view: {w, h} en px), así los subtítulos
            // se ven igual que como se pegaron. Si no entra en la ventana, se achica entera (no cambia el archivo).
            <div className="exp-preview"
              style={view?.w && view?.h ? { width: view.w, maxWidth: '100%', aspectRatio: `${view.w} / ${view.h}` } : undefined}>
              {preview.url && <img src={preview.url} alt="Vista previa" style={{ opacity: preview.loading ? 0.45 : 1 }} />}
              {!preview.url && !preview.loading && !preview.error && <div className="exp-preview-empty">Elegí al menos un idioma para ver cómo queda</div>}
              {preview.loading && <div className="exp-preview-spin">Armando vista previa…</div>}
              {preview.error && <div className="exp-preview-err">{preview.error}</div>}
              <span className="exp-preview-tag">Vista previa · así queda en el archivo</span>
            </div>
          )}

          {!result && (
            <fieldset className="exp-fields" disabled={running}>
              {!isSeg && (
                <div className="exp-row">
                  <span className="exp-lbl">Formato</span>
                  <div className="exp-opts exp-opts-col">
                    <label className="exp-radio"><input type="radio" checked={hard} onChange={() => setFormat('hard')} />
                      <span><b>Subtítulos en la imagen</b><small>Se ven en cualquier reproductor y en el celular. Tarda un poco más.</small></span></label>
                    <label className="exp-radio"><input type="radio" checked={soft} onChange={() => setFormat('soft')} />
                      <span><b>Pistas que se activan y desactivan</b><small>Muy rápido y sin perder calidad. Solo en reproductores como VLC.</small></span></label>
                  </div>
                </div>
              )}

              {isSeg && (
                <div className="exp-row">
                  <span className="exp-lbl">Vueltas</span>
                  <div className="exp-opts exp-opts-col">
                    <label className="exp-check"><input type="checkbox" checked={useReps} onChange={e => setUseReps(e.target.checked)} />
                      Usar las {reps.length} vueltas configuradas (velocidad e idioma de cada una)</label>
                    {useReps && (
                      <div className="exp-reps">
                        {reps.map((r, i) => (
                          <span key={i} className="exp-rep">V{i + 1} · {r.speed}x {r.en ? '🇺🇸' : ''}{r.es ? '🇪🇸' : ''}{!r.en && !r.es ? 'sin subs' : ''}</span>
                        ))}
                      </div>
                    )}
                    <label className="exp-check"><input type="checkbox" checked={withSubs} onChange={e => setWithSubs(e.target.checked)} /> Grabar los subtítulos en la imagen</label>
                  </div>
                </div>
              )}

              {(!repsLang) && (
                <div className="exp-row">
                  <span className="exp-lbl">Idiomas</span>
                  <div className="exp-opts">
                    <label className={`exp-check${subsEn.length ? '' : ' exp-off'}`}><input type="checkbox" checked={enOn} disabled={!subsEn.length} onChange={e => setEn(e.target.checked)} />
                      🇺🇸 Inglés {subsEn.length ? `(${subsEn.length})` : '— no hay'}</label>
                    <label className={`exp-check${subsEs.length ? '' : ' exp-off'}`}><input type="checkbox" checked={esOn} disabled={!subsEs.length} onChange={e => setEs(e.target.checked)} />
                      🇪🇸 Español {subsEs.length ? `(${subsEs.length})` : '— no hay'}</label>
                  </div>
                </div>
              )}

              {!soft && !(isSeg && !withSubs) && (
                <div className="exp-row">
                  <span className="exp-lbl">Estilo</span>
                  <div className="exp-pills">
                    {STYLES.map(([id, label]) => (
                      <button key={id} type="button" className={`exp-pill style-${id}${style === id ? ' exp-pill-on' : ''}`} onClick={() => setStyle(id)}>{label}</button>
                    ))}
                  </div>
                </div>
              )}

              {!soft && (
                <div className="exp-row">
                  <span className="exp-lbl">Imagen</span>
                  <div className="exp-opts">
                    {!(isSeg && !withSubs) && (
                      <label className="exp-check" title="El recuadro translúcido detrás de las letras (como el botón 🔲 Fondo del reproductor)">
                        <input type="checkbox" checked={bg} onChange={e => setBg(e.target.checked)} /> 🔲 Fondo detrás de las letras</label>
                    )}
                    <label className="exp-check" title="La franja negra (R) del reproductor, en el mismo lugar: tapa los subtítulos que ya traía el video">
                      <input type="checkbox" checked={band} onChange={e => setBand(e.target.checked)} /> ▬ Franja negra</label>
                  </div>
                </div>
              )}

              {!soft && (
                <div className="exp-row">
                  <span className="exp-lbl">Calidad</span>
                  <div className="exp-opts">
                    {QUALITIES.map(([id, label, hint]) => (
                      <button key={id} type="button" className={`exp-chip${quality === id ? ' exp-chip-on' : ''}`} onClick={() => setQuality(id)} title={hint}>{label}</button>
                    ))}
                  </div>
                </div>
              )}
              {folder && <div className="exp-folder">Se guarda en <code>{folder}</code></div>}
            </fieldset>
          )}

          {running && (
            <div className="exp-run">
              <JobProgress label="Exportando" job={status ?? { msg: 'Preparando…', progress: null, elapsed: 0 }} />
            </div>
          )}
          {error && !running && (
            <div className={`exp-msg ${error === 'cancelado' ? 'exp-msg-info' : 'exp-msg-err'}`}>
              {error === 'cancelado' ? 'Exportación cancelada. No se guardó nada.' : `⚠ ${error}`}
            </div>
          )}
          {result && (
            <div className="exp-done">
              <div className="exp-done-title">✅ Listo</div>
              <div className="exp-done-file">{result.file}<span> · {fmtBytes(result.size)}</span></div>
              <div className="exp-done-btns">
                <button className="exp-btn exp-btn-main" onClick={save}>💾 Guardar como…</button>
                <button className="exp-btn" onClick={reveal}>📂 Mostrar en la carpeta</button>
                <a className="exp-btn" href={`/videos/Exportados/${encodeURIComponent(result.file)}`} target="_blank" rel="noreferrer">▶ Verlo</a>
              </div>
              {saveMsg && <div className="exp-saved">{saveMsg}</div>}
              <div className="exp-folder">Ya quedó guardado también en <code>{folder}</code></div>
            </div>
          )}
        </div>

        <div className="exp-foot">
          {running ? (
            <button className="exp-btn exp-btn-danger" onClick={cancel}>■ Cancelar exportación</button>
          ) : result ? (
            <button className="exp-btn" onClick={onClose}>Cerrar</button>
          ) : (
            <>
              <button className="exp-btn" onClick={onClose}>Cancelar</button>
              <button className="exp-btn exp-btn-main" onClick={start} disabled={!canStart}>🎬 {soft ? 'Agregar las pistas' : 'Exportar'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
