import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { tokenize, normWord } from '../lib/vocab'
import './SubtitleStack.css'

const MARGIN = 8        // px de aire contra los bordes de la imagen del video
const MAX_HEIGHT = 0.4  // los subtítulos no ocupan más de esta fracción de la altura de la imagen
const MIN_FIT = 0.25    // lo máximo que se achica la letra para que entre

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Rectángulo (px, relativo al contenedor) que ocupa la IMAGEN del video, sin las barras negras.
// Los subtítulos (y los stickers al exportar) se miden contra este rectángulo: así lo que se ve acá
// es lo mismo que sale en el archivo exportado.
export function contentRect(box, video) {
  const W = box.clientWidth, H = box.clientHeight
  if (!video || !video.videoWidth || !video.videoHeight) return { l: 0, t: 0, w: W, h: H }
  const vr = video.getBoundingClientRect(), br = box.getBoundingClientRect()
  const s = Math.min(vr.width / video.videoWidth, vr.height / video.videoHeight)
  const w = video.videoWidth * s, h = video.videoHeight * s
  return {
    l: vr.left - br.left - box.clientLeft + (vr.width - w) / 2,
    t: vr.top - br.top - box.clientTop + (vr.height - h) / 2,
    w, h,
  }
}

// Las palabras de una línea, cada una tocable (para ver la traducción y guardarla en "Mis palabras").
// Las ya guardadas se marcan con un subrayado punteado.
function Words({ text, onWord, savedWords, dragged }) {
  const parts = useMemo(() => tokenize(text), [text])
  return parts.map((p, i) => !p.w ? p.t : (
    <span
      key={i}
      className={`sub-word${savedWords?.has(normWord(p.t)) ? ' sub-word-saved' : ''}`}
      onClick={e => { if (!dragged()) onWord(p.t, e.currentTarget) }}
    >{p.t}</span>
  ))
}

// Una línea de subtítulo (inglés o español). Doble clic para editarla en el lugar.
function SubLine({ text, className, onEdit, onEditing, onWord, savedWords, dragged }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  if (!text && !editing) return null

  function start(e) { e.stopPropagation(); onWord?.(null); setVal(text); setEditing(true); onEditing(true) }
  function stop() { setEditing(false); onEditing(false) }
  function commit() { onEdit(val); stop() }

  return (
    <div className={className} onDoubleClick={start}>
      {editing ? (
        <input
          className="sub-inline-input" value={val} autoFocus
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') stop() }}
          onBlur={commit}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        />
      ) : onWord ? <Words text={text} onWord={onWord} savedWords={savedWords} dragged={dragged} /> : text}
    </div>
  )
}

// Subtítulos sobre el video: inglés arriba y español abajo en un mismo bloque, así nunca se pisan.
// El bloque se acomoda solo dentro de la imagen del video: baja de renglón, achica la letra si no entra y no se sale
// (ni al agrandar la letra, ni al arrastrarlo, ni al cambiar el tamaño del video o ir a pantalla completa).
// offset.x / offset.y son % del ancho / alto de la IMAGEN del video (igual que en la exportación).
export default function SubtitleStack({ en, es, enClass, esClass, fontSize, defaultX = 50, defaultY = 70, offset, onDrag, onEdit, onWord, savedWords, containerRef, videoRef }) {
  const ref = useRef(null)
  const draggedRef = useRef(false)   // el último gesto fue un arrastre (no un toque): no abre la palabra
  const fitRef = useRef(() => {})
  const [editing, setEditing] = useState(false)
  const hasText = !!(en || es)

  function fit() {
    const el = ref.current, box = containerRef.current
    if (!el || !box || !hasText) return
    const c = contentRect(box, videoRef?.current)
    if (!c.w || !c.h) return
    // En pantalla completa la letra crece con el video (referencia: un video de ~420 px de alto)
    el.style.setProperty('--grow', document.fullscreenElement === box ? Math.max(1, c.h / 420) : 1)
    el.style.setProperty('--maxw', `${c.w - 2 * MARGIN}px`)
    // 1) Que entre: si desborda a lo ancho o ocupa demasiada altura, se achica la letra de a poco
    let k = 1
    el.style.setProperty('--fit', 1)
    for (let i = 0; i < 24 && k > MIN_FIT; i++) {
      if (el.offsetHeight <= c.h * MAX_HEIGHT && el.scrollWidth <= c.w - 2 * MARGIN + 1) break
      k *= 0.92
      el.style.setProperty('--fit', k.toFixed(3))
    }
    // 2) Que no se salga: se corre lo justo para quedar dentro de la imagen
    const w = el.offsetWidth, h = el.offsetHeight
    const cx = clamp((c.w * (defaultX + offset.x)) / 100, w / 2 + MARGIN, c.w - w / 2 - MARGIN)
    const top = clamp((c.h * (defaultY + offset.y)) / 100, MARGIN, c.h - h - MARGIN)
    el.style.setProperty('--cx', `${c.l + cx}px`)
    el.style.setProperty('--cy', `${c.t + top}px`)
  }

  useLayoutEffect(() => { fitRef.current = fit })
  useLayoutEffect(() => { fit() }, [en, es, fontSize, offset.x, offset.y, defaultX, defaultY, hasText]) // eslint-disable-line react-hooks/exhaustive-deps

  // Si cambia el tamaño del video (ventana, arrastre del borde, pantalla completa, o recién se cargó) se vuelve a acomodar
  useEffect(() => {
    const box = containerRef.current, video = videoRef?.current
    if (!box) return
    const again = () => fitRef.current()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(again) : null
    ro?.observe(box)
    if (video) ro?.observe(video)
    video?.addEventListener('loadedmetadata', again)
    document.addEventListener('fullscreenchange', again)
    return () => { ro?.disconnect(); video?.removeEventListener('loadedmetadata', again); document.removeEventListener('fullscreenchange', again) }
  }, [containerRef, videoRef])

  // Arrastre: se escucha a nivel de ventana (aguanta movimientos rápidos y no interfiere con el doble clic de edición)
  function onPointerDown(e) {
    if (!hasText || editing || e.target.tagName === 'INPUT' || e.button > 0) return
    const start = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y }
    let active = false
    draggedRef.current = false
    function move(ev) {
      const box = containerRef.current, el = ref.current
      if (!box || !el) return
      if (!active) {
        if (Math.hypot(ev.clientX - start.mx, ev.clientY - start.my) < 4) return
        active = true
        draggedRef.current = true
      }
      const c = contentRect(box, videoRef?.current)
      const w = el.offsetWidth, h = el.offsetHeight
      // El bloque no puede salirse de la imagen del video mientras se arrastra
      const minX = ((w / 2 + MARGIN) / c.w) * 100 - defaultX
      const maxX = 100 - ((w / 2 + MARGIN) / c.w) * 100 - defaultX
      const minY = (MARGIN / c.h) * 100 - defaultY
      const maxY = 100 - ((h + MARGIN) / c.h) * 100 - defaultY
      onDrag({
        x: clamp(start.ox + ((ev.clientX - start.mx) / c.w) * 100, minX, maxX),
        y: clamp(start.oy + ((ev.clientY - start.my) / c.h) * 100, minY, maxY),
      })
    }
    function end() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  return (
    <div
      ref={ref}
      className={`sub-stack${hasText ? '' : ' sub-stack-hidden'}`}
      style={{ '--sub-fs': fontSize }}
      onPointerDown={onPointerDown}
    >
      <SubLine text={en} className={enClass} onEdit={t => onEdit('en', t)} onEditing={setEditing}
        onWord={onWord} savedWords={savedWords} dragged={() => draggedRef.current} />
      <SubLine text={es} className={esClass} onEdit={t => onEdit('es', t)} onEditing={setEditing} />
    </div>
  )
}
