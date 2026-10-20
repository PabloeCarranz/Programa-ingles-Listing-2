import { useEffect, useState } from 'react'
import { contentRect } from './SubtitleStack'
import './SubtitleCover.css'

// Franja negra para tapar los subtítulos que ya vienen pegados en la imagen del video (a veces chiquitos o en
// otro idioma) y poner los nuestros encima. Se prende y apaga con la R; se arrastra con el mouse y se agranda
// desde la esquina. Queda debajo de los subtítulos de la app, que se pueden arrastrar sobre ella.
// rect.x / rect.y / rect.w / rect.h son % de la IMAGEN del video (sin las barras negras), igual que los
// subtítulos: así no se corre al cambiar el tamaño del video ni en pantalla completa.

export const DEFAULT_COVER = { x: 10, y: 80, w: 80, h: 15 }
const MIN_W = 5, MIN_H = 3   // % mínimos para que no desaparezca al achicarla

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Lo guardado para un video; si no tiene, la última franja usada (los videos de un mismo canal suelen
// tener los subtítulos en el mismo lugar), apagada.
export function loadCover(videoName) {
  try {
    const own = JSON.parse(localStorage.getItem(`cover_${videoName}`) ?? 'null')
    if (own?.rect) return own
    const last = JSON.parse(localStorage.getItem('cover_last') ?? 'null')
    return { on: false, rect: last ?? DEFAULT_COVER }
  } catch { return { on: false, rect: DEFAULT_COVER } }
}

export function saveCover(videoName, cover) {
  try {
    localStorage.setItem(`cover_${videoName}`, JSON.stringify(cover))
    localStorage.setItem('cover_last', JSON.stringify(cover.rect))
  } catch { /* sin localStorage la franja anda igual, solo no se recuerda */ }
}

export default function SubtitleCover({ rect, onChange, containerRef, videoRef }) {
  const [img, setImg] = useState(null)   // px que ocupa la imagen del video dentro del contenedor

  // Se vuelve a medir si cambia el tamaño del video (ventana, S/M/L, pantalla completa, o recién se cargó)
  useEffect(() => {
    const box = containerRef.current, video = videoRef.current
    if (!box) return
    const measure = () => setImg(contentRect(box, videoRef.current))
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(box)
    if (video) ro?.observe(video)
    video?.addEventListener('loadedmetadata', measure)
    document.addEventListener('fullscreenchange', measure)
    return () => { ro?.disconnect(); video?.removeEventListener('loadedmetadata', measure); document.removeEventListener('fullscreenchange', measure) }
  }, [containerRef, videoRef])

  // Arrastre (mode 'move') o cambio de tamaño ('resize'), escuchando a nivel de ventana como los subtítulos
  function onPointerDown(e, mode) {
    if (e.button > 0) return
    e.preventDefault(); e.stopPropagation()
    const mx = e.clientX, my = e.clientY, start = { ...rect }
    function move(ev) {
      const c = contentRect(containerRef.current, videoRef.current)
      if (!c.w || !c.h) return
      const dx = ((ev.clientX - mx) / c.w) * 100, dy = ((ev.clientY - my) / c.h) * 100
      if (mode === 'move') {
        onChange({ ...start, x: clamp(start.x + dx, 0, 100 - start.w), y: clamp(start.y + dy, 0, 100 - start.h) })
      } else {
        onChange({ ...start, w: clamp(start.w + dx, MIN_W, 100 - start.x), h: clamp(start.h + dy, MIN_H, 100 - start.y) })
      }
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

  if (!img?.w) return null
  return (
    <div className="sub-cover"
      style={{
        left: img.l + (img.w * rect.x) / 100, top: img.t + (img.h * rect.y) / 100,
        width: (img.w * rect.w) / 100, height: (img.h * rect.h) / 100,
      }}
      title="Franja negra (R): arrastrala sobre los subtítulos del video; la esquina la agranda"
      onPointerDown={e => onPointerDown(e, 'move')}
      onClick={e => e.stopPropagation()}
    >
      <div className="sub-cover-grip" onPointerDown={e => onPointerDown(e, 'resize')} />
    </div>
  )
}
