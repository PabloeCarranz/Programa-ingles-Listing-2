import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { StickerSelector } from './StickerSelector'
import { ThemeDropdown } from './ThemeDropdown'
import JobProgress from './JobProgress'
import SubtitleStack, { contentRect } from './SubtitleStack'
import SubtitleCover, { loadCover, saveCover } from './SubtitleCover'
import ExportDialog from './ExportDialog'
import WordPopup from './WordPopup'
import { normWord, apiError, OFFLINE } from '../lib/vocab'
import escobaImg from '../themes/escoba.png'
import botonComic2Img from '../themes/botonComic2.png'
import gothicImg from '../themes/gothic.png'
import consoleImg from '../themes/Console.png'
import defaultImg from '../themes/default.png'
import neonImg from '../themes/neon.png'
import neonblueImg from '../themes/neonblue.png'
import fireImg from '../themes/fire.png'
import iceImg from '../themes/ice.png'
import goldImg from '../themes/gold.png'
import bubblegumImg from '../themes/bubblegum.png'
import cinemaImg from '../themes/cinema.png'
import shadowImg from '../themes/shadow.png'
import outlineImg from '../themes/outline.png'
const SPEEDS = [0.5, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.25, 1.5, 2]
const SPEEDS_COMPACT = SPEEDS.filter(s => s <= 1.5)   // barra de control y vueltas de cada fragmento

const BUILTIN_STYLES = [
  { id: 'default',   label: 'Default',   img: defaultImg },
  { id: 'comic',     label: 'Comic',     img: botonComic2Img },
  { id: 'gothic',    label: 'Gothic',    img: gothicImg },
  { id: 'console',   label: 'Console',   img: consoleImg },
  { id: 'neon',      label: 'Neon',      img: neonImg },
  { id: 'neonblue',  label: 'Neon Blue', img: neonblueImg },
  { id: 'fire',      label: 'Fire',      img: fireImg },
  { id: 'ice',       label: 'Ice',       img: iceImg },
  { id: 'gold',      label: 'Gold',      img: goldImg },
  { id: 'bubblegum', label: 'Bubblegum', img: bubblegumImg },
  { id: 'cinema',    label: 'Cinema',    img: cinemaImg },
  { id: 'shadow',    label: 'Shadow',    img: shadowImg },
  { id: 'outline',   label: 'Outline',   img: outlineImg },
]

// ── Sticker arrastrable con tiempo editable ──────────────────
function DraggableSticker({ sticker, selected, onSelect, onUpdate, onRemove, containerRef }) {
  const { url, x, y, size, startTime, endTime } = sticker
  const [editing, setEditing] = useState(false)
  const dragging = useRef(false)
  const resizing = useRef(false)
  const moved    = useRef(false)
  const origin   = useRef(null)

  // Cerrar editor cuando se deselecciona
  useEffect(() => { if (!selected) setEditing(false) }, [selected])

  function fmt(t) {
    if (t == null) return '∞'
    const m = Math.floor(t / 60)
    return `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}`
  }

  function onPointerDown(e) {
    const tag = e.target.tagName
    if (tag === 'INPUT' || tag === 'BUTTON') return
    if (e.target.closest?.('.sticker-time-editor, .sticker-time-badge')) return
    e.preventDefault()
    e.stopPropagation()   // no deselect el video-wrap
    moved.current = false
    if (e.target.dataset.handle === 'resize') {
      resizing.current = true
      origin.current = { mx: e.clientX, sw: size }
    } else {
      dragging.current = true
      origin.current = { mx: e.clientX, my: e.clientY, ox: x, oy: y }
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    if (!containerRef.current || (!dragging.current && !resizing.current)) return
    moved.current = true
    const { offsetWidth: w, offsetHeight: h } = containerRef.current
    if (dragging.current) {
      onUpdate({
        x: origin.current.ox + (e.clientX - origin.current.mx) / w * 100,
        y: origin.current.oy + (e.clientY - origin.current.my) / h * 100,
      })
    } else {
      onUpdate({ size: Math.max(40, origin.current.sw + (e.clientX - origin.current.mx)) })
    }
  }

  function onPointerUp(e) {
    if (!moved.current) onSelect()   // click sin mover = seleccionar
    dragging.current = false
    resizing.current = false
  }

  return (
    <div
      className={`sticker-on-video${selected ? ' sticker-selected' : ''}`}
      style={{ left: `${x}%`, top: `${y}%`, width: `${size}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img src={url} style={{ width: '100%', display: 'block', pointerEvents: 'none' }} />

      {/* ✕ siempre visible al hacer hover */}
      <button className="sticker-remove-btn" onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>

      {/* badge de tiempo — visible al hover o cuando está seleccionado */}
      {selected && (
        <div
          className="sticker-time-badge sticker-time-badge-visible"
          onClick={e => { e.stopPropagation(); setEditing(v => !v) }}
          title="Click para editar tiempo"
        >⏱ {fmt(startTime)}–{fmt(endTime)}</div>
      )}

      {/* puntito resize — solo cuando está seleccionado */}
      {selected && <div data-handle="resize" className="sticker-resize-handle" />}

      {/* editor de tiempo */}
      {selected && editing && (
        <div className="sticker-time-editor" onPointerDown={e => e.stopPropagation()}>
          <div className="ste-row">
            <span>Inicio (s)</span>
            <input type="number" min="0" step="0.5" value={startTime ?? 0}
              onChange={e => onUpdate({ startTime: +e.target.value })}
              className="ste-input" />
          </div>
          <div className="ste-row">
            <span>Fin (s)</span>
            <input type="number" min="0" step="0.5" value={endTime ?? 0}
              onChange={e => onUpdate({ endTime: +e.target.value })}
              className="ste-input" />
          </div>
          <div className="ste-btns">
            <button className="ste-always-btn" onClick={() => onUpdate({ startTime: null, endTime: null })}>♾ Siempre</button>
            <button className="ste-close-btn" onClick={() => setEditing(false)}>✓</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Colores únicos por fragmento (inicio y fin comparten el mismo color)
const FLAG_COLORS = [
  '#63b3ed', // azul
  '#b794f4', // violeta
  '#f6ad55', // naranja
  '#f687b3', // rosa
  '#4fd1c5', // teal
  '#f6e05e', // amarillo
  '#68d391', // verde
  '#fc8181', // rojo
  '#76e4f7', // celeste
  '#fbb6ce', // rosado
]

// ── Barra de progreso con banderas ───────────────────────
const FLAG_DRAG_THRESHOLD = 6 // px mínimos para considerar arrastre

const SeekBar = forwardRef(function SeekBar({ duration, currentTime, segments, markStart, seekMode = 'seek', activeIdx = null, onSeek, onEndFlag, onMoveFlag, onMoveBlock, onPlayBlock, onZoomChange }, ref) {
  const wrapRef     = useRef(null)
  const dragging    = useRef(false)
  const flagPending = useRef(null)
  const flagDrag    = useRef(null)
  const [hover, setHover] = useState(null)
  const zoomState   = useRef({ zoom: 1, offset: 0 })
  const [zoomTick,  setZoomTick] = useState(0)

  const { zoom: zoomLevel, offset: viewOffset } = zoomState.current
  const visibleDuration = duration ? duration / zoomLevel : 0

  function pct(t) {
    if (!duration || !visibleDuration) return 0
    return Math.max(0, Math.min(100, ((t - viewOffset) / visibleDuration) * 100))
  }
  function fmt(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}` }
  function timeAt(e) {
    if (!wrapRef.current || !duration) return 0
    const { left, width } = wrapRef.current.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - left) / width))
    return viewOffset + frac * visibleDuration
  }

  // Aplica un factor de zoom manteniendo fijo el instante ubicado en `frac`
  // (0 = borde izquierdo del área visible, 1 = borde derecho, 0.5 = centro).
  const zoomAtFrac = useCallback((factor, frac) => {
    if (!duration) return
    const { zoom, offset } = zoomState.current
    const visDur = duration / zoom
    const newZoom = Math.max(1, Math.min(30, zoom * factor))
    const anchorTime = offset + frac * visDur
    const newVisDur = duration / newZoom
    let newOffset = anchorTime - frac * newVisDur
    newOffset = Math.max(0, Math.min(Math.max(0, duration - newVisDur), newOffset))
    zoomState.current = { zoom: newZoom, offset: newOffset }
    setZoomTick(t => t + 1)
  }, [duration])

  useEffect(() => { onZoomChange?.(zoomLevel) }, [zoomTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    zoomIn:    () => zoomAtFrac(1.4, 0.5),
    zoomOut:   () => zoomAtFrac(1 / 1.4, 0.5),
    resetZoom: () => { zoomState.current = { zoom: 1, offset: 0 }; setZoomTick(t => t + 1) },
  }), [zoomAtFrac])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || !duration) return
    function handleWheel(e) {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const factor = e.deltaY < 0 ? 1.3 : 1 / 1.3
      zoomAtFrac(factor, frac)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [duration, zoomAtFrac])

  const panState = useRef({ active: false, startX: 0, startOffset: 0 })
  const PAN_THRESHOLD = 6

  return (
    <div className="seekbar" ref={wrapRef}
      style={{ cursor: seekMode === 'pan' ? 'grab' : 'pointer' }}
      onPointerDown={e => {
        if (flagPending.current || flagDrag.current) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        panState.current = { active: false, startX: e.clientX, startOffset: zoomState.current.offset }
      }}
      onPointerMove={e => {
        const t  = timeAt(e)
        const rx = e.clientX - wrapRef.current.getBoundingClientRect().left

        // Arrastre de banderas
        if (flagPending.current && !flagDrag.current) {
          const moved = Math.abs(e.clientX - flagPending.current.startX)
          if (moved >= FLAG_DRAG_THRESHOLD) {
            flagDrag.current = { idx: flagPending.current.idx, type: flagPending.current.type }
          }
        }
        if (flagDrag.current) {
          if (flagDrag.current.type === 'move') {
            const { idx, startT, origStart, origEnd } = flagPending.current
            const delta = t - startT
            onMoveBlock(idx, origStart + delta, origEnd + delta)
          } else {
            onMoveFlag(flagDrag.current.idx, flagDrag.current.type, t)
          }
          setHover({ x: rx, label: fmt(t) })
          return
        }

        // Pan del timeline — solo en modo lupa
        if (seekMode === 'pan' && panState.current.startX !== undefined) {
          const moved = e.clientX - panState.current.startX
          if (!panState.current.active && Math.abs(moved) >= PAN_THRESHOLD) {
            panState.current.active = true
            wrapRef.current.style.cursor = 'grabbing'
          }
          if (panState.current.active && duration) {
            const { width } = wrapRef.current.getBoundingClientRect()
            const timeDelta = (moved / width) * visibleDuration
            let newOffset = panState.current.startOffset - timeDelta
            newOffset = Math.max(0, Math.min(duration - visibleDuration, newOffset))
            zoomState.current = { ...zoomState.current, offset: newOffset }
            setZoomTick(tk => tk + 1)
          }
        }

        const nearSeg = segments.find(s =>
          Math.abs(pct(s.start) - pct(t)) < 2 || Math.abs(pct(s.end) - pct(t)) < 2
        )
        setHover({ x: rx, label: nearSeg ? nearSeg.phrase : fmt(t) })
      }}
      onPointerUp={e => {
        if (flagDrag.current) {
          if (flagDrag.current.type === 'move') {
            const { idx, startT, origStart, origEnd } = flagPending.current
            const delta = timeAt(e) - startT
            onMoveBlock(idx, origStart + delta, origEnd + delta, true)
          } else {
            onMoveFlag(flagDrag.current.idx, flagDrag.current.type, timeAt(e), true)
          }
          flagDrag.current = null
          flagPending.current = null
        } else if (flagPending.current) {
          const { idx, type } = flagPending.current
          if (type === 'start') onSeek(segments[idx].start)
          else if (type === 'end') onEndFlag(segments[idx].end)
          else if (type === 'move') onSeek(timeAt(e)) // clic sin arrastre sobre un bloque = buscar ahí
          flagPending.current = null
        } else if (seekMode === 'seek') {
          onSeek(timeAt(e))
        } else if (seekMode === 'pan' && !panState.current.active) {
          onSeek(timeAt(e))
        }
        panState.current = { active: false, startX: undefined, startOffset: 0 }
        wrapRef.current.style.cursor = ''
      }}
      onPointerLeave={() => { setHover(null) }}
    >
      {/* Track (fondo gris) */}
      <div className="sb-track" />
      {/* Fill de progreso (azul) — indica posición del video, independiente del pan */}
      <div className="sb-fill" style={{ width: `${pct(currentTime)}%` }} />
      {/* Cabeza de reproducción */}
      <div className="sb-head" style={{ left: `${pct(currentTime)}%` }} />

      {/* Bloques por fragmento — franja de color de inicio a fin */}
      {segments.map((seg, idx) => {
        const color  = FLAG_COLORS[idx % FLAG_COLORS.length]
        const left   = pct(seg.start)
        const width  = Math.max(0.4, pct(seg.end) - pct(seg.start))
        const isActive = activeIdx === idx
        return (
          <div key={seg.id ?? idx}
            className={`sb-block${isActive ? ' sb-block-active' : ''}`}
            style={{ left: `${left}%`, width: `${width}%`, '--flag-color': color }}
            title={`${seg.phrase} — arrastrar para mover · doble clic para reproducir`}
            onPointerDown={e => {
              e.stopPropagation()
              e.preventDefault()
              flagPending.current = {
                idx, type: 'move',
                startX: e.clientX,
                startT: timeAt(e),
                origStart: seg.start,
                origEnd: seg.end,
              }
              wrapRef.current.setPointerCapture(e.pointerId)
            }}
            onDoubleClick={e => { e.stopPropagation(); onPlayBlock?.(idx) }}
          >
            <div className="sb-block-fill" />
            <span className="sb-block-num" style={{ background: color }}>{idx + 1}</span>

            {/* Manija de INICIO */}
            <div className="sb-handle sb-handle-start"
              style={{ background: color, boxShadow: `0 0 4px ${color}` }}
              onPointerDown={e => {
                e.stopPropagation()
                e.preventDefault()
                flagPending.current = { idx, type: 'start', startX: e.clientX }
                wrapRef.current.setPointerCapture(e.pointerId)
              }}
              title={`⠿ Arrastrar inicio · ${seg.phrase}`}
            />
            {/* Manija de FIN */}
            <div className="sb-handle sb-handle-end"
              onPointerDown={e => {
                e.stopPropagation()
                e.preventDefault()
                flagPending.current = { idx, type: 'end', startX: e.clientX }
                wrapRef.current.setPointerCapture(e.pointerId)
              }}
              title={`⠿ Arrastrar fin · ${seg.phrase}`}
            />
          </div>
        )
      })}

      {/* Bandera temporal de inicio pendiente */}
      {markStart != null && duration > 0 && (
        <div className="sb-mark-pending"
          style={{ left: `${pct(markStart)}%` }}
          title={`Inicio marcado: ${fmt(markStart)}`}
        >
          <div className="sb-mark-pending-label">[ ▶</div>
          <div className="sb-mark-pending-pole" />
        </div>
      )}

      {hover && (
        <div className="sb-tooltip" style={{
          left: Math.max(40, Math.min(hover.x, (wrapRef.current?.offsetWidth ?? 999) - 90))
        }}>{hover.label}</div>
      )}

      {/* Indicador de zoom: muestra qué porción del timeline es visible */}
      {zoomLevel > 1 && duration > 0 && (
        <div className="sb-zoom-bar">
          <div className="sb-zoom-range" style={{
            left:  `${(viewOffset / duration) * 100}%`,
            width: `${(visibleDuration / duration) * 100}%`,
          }} />
        </div>
      )}
    </div>
  )
})

// ── Schedule visual de vueltas ────────────────────────────
function RepSchedule({ repConfig, activeRep = null }) {
  return (
    <div className="rep-schedule">
      {repConfig.map((rc, i) => (
        <span key={i} className={`rep-chip ${activeRep === i ? 'rep-chip-active' : ''}`}>
          <span className="rep-chip-num">V{i + 1}</span>
          <span className="rep-chip-speed">{rc.speed ?? 1}x</span>
          {rc.en && <span className="rep-chip-flag">🇺🇸</span>}
          {rc.es && <span className="rep-chip-flag">🇪🇸</span>}
          {!rc.en && !rc.es && <span className="rep-chip-nosub">—</span>}
        </span>
      ))}
    </div>
  )
}

// ── Player principal ──────────────────────────────────────
export default function Player({ video, onBack, theme, onThemeChange }) {
  const videoRef   = useRef(null)
  const videoWrap  = useRef(null)
  const srtEnInput = useRef(null)
  const srtEsInput = useRef(null)
  const seekBarRef = useRef(null)

  const [segments,     setSegments]     = useState([])
  const [subsEn,       setSubsEn]       = useState([])
  const [subsEs,       setSubsEs]       = useState([])
  const [currentEn,    setCurrentEn]    = useState('')
  const [currentEs,    setCurrentEs]    = useState('')
  // Franja negra para tapar los subtítulos pegados en el video (R); se recuerda por video
  const [cover, setCover] = useState(() => loadCover(video.name))
  useEffect(() => { saveCover(video.name, cover) }, [cover, video.name])
  const _stickerKey = `stickers_${video.name}`
  const [stickers, setStickers] = useState(() => {
    try { return JSON.parse(localStorage.getItem(_stickerKey) ?? '[]') ?? [] }
    catch { return [] }
  })
  const [videoTime,         setVideoTime]         = useState(0)
  const [videoDuration,     setVideoDuration]     = useState(0)
  const [playing,           setPlaying]           = useState(false)
  const [muted,             setMuted]             = useState(false)
  const [seekMode,          setSeekMode]          = useState('seek') // 'seek' | 'pan'
  const [zoomPct,           setZoomPct]           = useState(100)
  const [selectedStickerId, setSelectedStickerId] = useState(null)
  const [currentRepDisplay, setCurrentRepDisplay] = useState(0)
  const [activeSubOverride, setActiveSubOverride] = useState(null) // { en, es }
  const [exportReq,         setExportReq]         = useState(null) // { mode: 'video' | 'segment', idx, t, h }
  const currentRepRef  = useRef(0)
  const loopSeeking    = useRef(false)

  // ── Mis palabras: tocar una palabra del subtítulo en inglés ──
  const [vocab,      setVocab]      = useState([])     // palabras guardadas (las del subtítulo se marcan con subrayado punteado)
  const [wordAnchor, setWordAnchor] = useState(null)   // palabra tocada: { word, rect, example }
  const pausedByWord = useRef(false)                   // el video lo pausó la ventanita de la palabra: se retoma al cerrarla
  useEffect(() => {
    fetch('/api/vocab').then(r => (r.ok ? r.json() : null)).then(d => { if (Array.isArray(d?.words)) setVocab(d.words) }).catch(() => {})
  }, [])
  const savedWords = useMemo(() => new Set(vocab.map(c => c.word)), [vocab])

  // ── Plantilla global de vueltas ──
  const [template, setTemplate] = useState(() => {
    try { return JSON.parse(localStorage.getItem('seg_template') ?? 'null') ?? [{ speed: 1, en: true, es: false }] }
    catch { return [{ speed: 1, en: true, es: false }] }
  })

  const [active,       setActive]       = useState(null)
  const [looping,      setLooping]      = useState(false)
  const [speed,        setSpeed]        = useState(1)
  const [rewindSecs,   setRewindSecs]   = useState(3)

  const [showEn,       setShowEn]       = useState(true)
  const [showEs,       setShowEs]       = useState(true)
  const [subStyle,     setSubStyle]     = useState('default')
  const [subBg,        setSubBg]        = useState(() => {   // recuadro detrás de las letras: a elección, se recuerda
    try { return localStorage.getItem('sub_bg') !== '0' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem('sub_bg', subBg ? '1' : '0') } catch { /* sin localStorage no se recuerda */ } }, [subBg])
  const [subSize,     setSubSize]      = useState(() => {   // tamaño de letra: se recuerda entre videos y recargas (y lo usa Exportar)
    try { const v = parseFloat(localStorage.getItem('sub_size')); return v >= 0.7 && v <= 3 ? v : 1.1 } catch { return 1.1 }
  })
  const [subOffset,    setSubOffset]    = useState({ x: 0, y: 0 })
  const [subShift,     setSubShift]     = useState(0)   // offset de timing en segundos
  const rewindRef = useRef(rewindSecs)
  useEffect(() => { try { localStorage.setItem('sub_size', String(subSize)) } catch { /* sin almacenamiento */ } }, [subSize])

  const [markStart,    setMarkStart]    = useState(null)
  const [marking,      setMarking]      = useState(false)
  const [newPhrase,    setNewPhrase]    = useState('')

  const [saved,        setSaved]        = useState(false)
  const [editingIdx,   setEditingIdx]   = useState(null)
  const [editVal,      setEditVal]      = useState('')
  const [rightTab,     setRightTab]     = useState('fragments')

  const [transEn,      setTransEn]      = useState(false)
  const [transMsgEn,   setTransMsgEn]   = useState('')
  const [translating,  setTranslating]  = useState(false)
  const [transMsgEs,   setTransMsgEs]   = useState('')
  const [jobs,         setJobs]         = useState({ en: null, es: null }) // estado detallado de los trabajos en curso (relojito)
  const [subsEnReady,  setSubsEnReady]  = useState(false) // ya se consultó si hay subs en inglés guardados
  const [autoFetch,    setAutoFetch]    = useState(() => { try { return localStorage.getItem('auto_fetch_subs') !== '0' } catch { return true } })
  const pollRef = useRef({ en: null, es: null })          // sondeos activos de transcripción / traducción

  const [editSubKey,   setEditSubKey]   = useState(null)
  const [editSubVal,   setEditSubVal]   = useState('')
  const [collapsed,    setCollapsed]    = useState(new Set())
  const [videoSize,    setVideoSize]    = useState(1)   // 0=chico 1=medio 2=grande
  const [escobaAnim,   setEscobaAnim]   = useState('idle')
  const [videoMaxH,    setVideoMaxH]    = useState(42)  // vh
  const [rightWidth,   setRightWidth]   = useState(340) // px
  const resizeDrag = useRef(null)

  // ── Control remoto ──
  const wsRef              = useRef(null)
  const segmentsRef        = useRef([])
  const activeRef          = useRef(null)
  const activeSegOverride  = useRef(null) // { ...seg } con repeat/repConfig temporales
  const [remoteUrl,        setRemoteUrl]   = useState(null)
  const [showRemote,       setShowRemote]  = useState(false)
  const [wsConnected,      setWsConnected] = useState(false)

  useEffect(() => {
    const onMove = e => {
      const d = resizeDrag.current
      if (!d) return
      if (d.type === 'v') {
        const dy = e.clientY - d.startY
        const vhPx = window.innerHeight / 100
        setVideoMaxH(h => Math.max(15, Math.min(85, d.startVal + dy / vhPx)))
      } else {
        const dx = d.startX - e.clientX
        setRightWidth(w => Math.max(220, Math.min(660, d.startVal + dx)))
      }
    }
    const onUp = () => { resizeDrag.current = null; document.body.style.cursor = '' }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  function handleEscobaClick() {
    if (escobaAnim !== 'idle') return
    setEscobaAnim('flyaway')
    setTimeout(() => setEscobaAnim('return'), 900)
    setTimeout(() => setEscobaAnim('idle'),  1700)
  }
  const [clickFlash,   setClickFlash]   = useState(null) // 'play'|'pause'
  const VIDEO_SIZES = ['28vh', '42vh', '62vh']
  const VIDEO_SIZE_LABELS = ['Tamaño video: S', 'Tamaño video: M', 'Tamaño video: L']

  // ── Cargar datos ──
  useEffect(() => {
    fetch(`/api/segments/${encodeURIComponent(video.name)}`).then(r => r.json()).then(data => {
      setSegments(data)
      setCollapsed(new Set(data.map((_, i) => i)))
    })
    const enc = encodeURIComponent(video.name)
    // Subtítulos en inglés: se cargan; si el programa los está generando se retoma el seguimiento (p. ej. se recargó
    // la página); y si no hay ninguno se traen solos al entrar (una vez por video, y se puede desactivar)
    ;(async () => {
      let subs = []
      try { const d = await fetch(`/api/subtitles/${enc}?lang=en`).then(r => r.json()); if (Array.isArray(d)) subs = d } catch { /* sin conexión */ }
      setSubsEn(subs); setSubsEnReady(true)
      let job
      try { job = await fetch(`/api/transcribe/status/${enc}?lang=en`).then(r => r.json()) } catch { return }
      if (job.status === 'running') watchTranscribe()
      else if (subs.length === 0 && autoFetchEnabled() && !autoFetchTried()) startTranscribe('en', { auto: true })
    })()
    fetch(`/api/subtitles/${enc}?lang=es`).then(r => r.json()).then(d => setSubsEs(Array.isArray(d) ? d : []))
    fetch(`/api/translate/status/${enc}`).then(r => r.json()).then(d => {
      if (d.status === 'running') watchJob('es', `/api/translate/status/${enc}`, { setBusy: setTranslating, setMsg: setTransMsgEs, onDone: setSubsEs })
    }).catch(() => {})
  }, [video.name]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mantener refs de segments y active actualizados para los handlers del WS
  useEffect(() => { segmentsRef.current = segments }, [segments])
  useEffect(() => { activeRef.current = active }, [active])

  // ── WebSocket control remoto ──
  useEffect(() => {
    fetch('/api/server-info').then(r => r.json()).then(info => {
      setRemoteUrl(`http://${info.ip}:${info.port}/remote`)
    }).catch(() => {})

    function connect() {
      // Misma dirección de la página (el proxy de Vite reenvía /ws al backend): sirve con cualquier puerto
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        // Enviar estado actual al celular que acaba de conectarse
        ws.send(JSON.stringify({
          type: 'state',
          video: video.name,
          segments,
          activeIdx: active,
        }))
      }
      ws.onclose = () => {
        setWsConnected(false)
        setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()

      ws.onmessage = e => {
        let msg
        try { msg = JSON.parse(e.data) } catch { return }

        if (msg.type === 'request_state') {
          ws.send(JSON.stringify({
            type: 'state',
            video: video.name,
            segments: segmentsRef.current,
            activeIdx: activeRef.current,
          }))
        } else if (msg.type === 'remote_play') {
          const idx = msg.idx
          const seg = segmentsRef.current[idx]
          if (!seg || !videoRef.current) return
          const repeatCount = Math.max(1, msg.repeat ?? seg.repeat ?? 1)
          // Usar el repConfig enviado por el celular si coincide en longitud; si no, construir desde el segmento
          let repConfig
          if (Array.isArray(msg.repConfig) && msg.repConfig.length === repeatCount) {
            repConfig = msg.repConfig
          } else {
            const baseRc = seg.repConfig ?? [{ speed: 1, en: true, es: false }]
            repConfig = Array.from({ length: repeatCount },
              (_, j) => baseRc[j] ?? { ...baseRc[baseRc.length - 1] })
          }
          // Guardar override temporal — no modifica el estado permanente
          activeSegOverride.current = { ...seg, repeat: repeatCount, repConfig }
          currentRepRef.current = 0
          loopSeeking.current = false
          setCurrentRepDisplay(0)
          const rc0 = repConfig[0]
          setActiveSubOverride({ en: rc0.en ?? true, es: rc0.es ?? false })
          if (seg.subStyle) setSubStyle(seg.subStyle)
          setActive(idx); setLooping(true)
          videoRef.current.playbackRate = rc0.speed ?? 1
          videoRef.current.currentTime = seg.start
          videoRef.current.play()
          ws.send(JSON.stringify({ type: 'playing', idx }))
        } else if (msg.type === 'remote_stop') {
          activeSegOverride.current = null
          setLooping(false); setActive(null)
          currentRepRef.current = 0; setCurrentRepDisplay(0)
          setActiveSubOverride(null)
          if (videoRef.current) { videoRef.current.playbackRate = 1; videoRef.current.pause() }
          ws.send(JSON.stringify({ type: 'stopped' }))
        }
      }
    }

    connect()
    return () => { wsRef.current?.close() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Broadcast estado cuando cambian los segments o el fragmento activo
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'state',
      video: video.name,
      segments,
      activeIdx: active,
    }))
  }, [segments, active, video.name])

  // Persistir stickers (excluir blob: URLs que son temporales del navegador)
  useEffect(() => {
    const persistable = stickers.filter(s => !s.url.startsWith('blob:'))
    localStorage.setItem(_stickerKey, JSON.stringify(persistable))
  }, [stickers, _stickerKey])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed])

  // Mantener ref de rewindSecs actualizado para el keydown handler
  useEffect(() => { rewindRef.current = rewindSecs }, [rewindSecs])

  // ── Teclado: Space, ←, → ──
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const v = videoRef.current
      if (!v) return
      if (e.key === 't') { e.preventDefault(); setSeekMode('pan') }
      else if (e.key === 'p') { e.preventDefault(); setSeekMode('seek') }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setCover(c => ({ ...c, on: !c.on })) }
      else if (e.code === 'Space') {
        e.preventDefault()
        v.paused ? v.play() : v.pause()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        v.currentTime = Math.max(0, v.currentTime - rewindRef.current)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        v.currentTime = Math.min(v.duration || v.currentTime, v.currentTime + rewindRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Estado play/pause del video ──
  useEffect(() => {
    const v = videoRef.current; if (!v) return
    const onPlay  = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener('play',  onPlay)
    v.addEventListener('pause', onPause)
    return () => { v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause) }
  }, [])

  function togglePlay() {
    const v = videoRef.current; if (!v) return
    v.paused ? v.play() : v.pause()
  }

  function closeWord() {
    setWordAnchor(null)
    if (pausedByWord.current) { pausedByWord.current = false; videoRef.current?.play().catch(() => {}) }
  }
  function openWord(word, el) {
    if (!word) { closeWord(); return }
    const box = videoWrap.current, v = videoRef.current
    if (!box || !el) return
    const t = v?.currentTime ?? 0
    const at = list => list.find(s => t >= s.start + subShift && t <= s.end + subShift)
    const en = at(subsEn), es = at(subsEs)
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect()
    if (v && !v.paused) { v.pause(); pausedByWord.current = true }
    const start = Math.max(0, (en ? en.start : t - 2) + subShift)
    setWordAnchor({
      word,
      rect: { l: r.left - b.left - box.clientLeft, t: r.top - b.top - box.clientTop, w: r.width, h: r.height },
      // La frase donde se escuchó: el repaso vuelve a reproducir justo esa parte del video
      example: { video: video.name, start, end: Math.max((en ? en.end : t + 2) + subShift, start + 0.5), en: en ? en.phrase : currentEn, es: es ? es.phrase : '' },
    })
  }
  async function saveWord(payload) {
    let r
    try { r = await fetch('/api/vocab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }
    catch { throw new Error(OFFLINE) }
    if (!r.ok) throw new Error(await apiError(r))
    const { card } = await r.json()
    setVocab(list => [card, ...list.filter(c => c.id !== card.id)])
  }
  async function removeWord(card) {
    let r
    try { r = await fetch(`/api/vocab/${card.id}`, { method: 'DELETE' }) }
    catch { throw new Error(OFFLINE) }
    if (!r.ok && r.status !== 404) throw new Error(await apiError(r))
    setVocab(list => list.filter(c => c.id !== card.id))
  }
  function toggleMute() {
    const v = videoRef.current; if (!v) return
    v.muted = !v.muted; setMuted(v.muted)
  }
  function fmtT(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}` }

  // ── Subtítulos en tiempo real ──
  const onTimeUpdate = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0
    setVideoTime(t)
    // Visibilidad de subs: override por rep si hay loop activo
    const effEn = (looping && active !== null && activeSubOverride) ? activeSubOverride.en : showEn
    const effEs = (looping && active !== null && activeSubOverride) ? activeSubOverride.es : showEs
    if (effEn && subsEn.length) {
      const s = subsEn.find(s => t >= s.start + subShift && t <= s.end + subShift)
      setCurrentEn(s ? s.phrase : '')
    } else setCurrentEn('')
    if (effEs && subsEs.length) {
      const s = subsEs.find(s => t >= s.start + subShift && t <= s.end + subShift)
      setCurrentEs(s ? s.phrase : '')
    } else setCurrentEs('')
    if (looping && active !== null && segments[active]) {
      // Usa el override temporal del control remoto si existe, si no usa el segmento normal
      const seg = activeSegOverride.current ?? segments[active]
      // Reset guard cuando el video ya está antes del fin (seek completado)
      if (t < seg.end - 0.3) loopSeeking.current = false
      if (t >= seg.end && !loopSeeking.current) {
        loopSeeking.current = true
        const totalReps = seg.repeat ?? 1
        const nextRep   = currentRepRef.current + 1
        if (nextRep >= totalReps) {
          // Terminaron todas las repeticiones
          activeSegOverride.current = null
          setLooping(false); setActive(null)
          currentRepRef.current = 0; setCurrentRepDisplay(0)
          setActiveSubOverride(null)
          if (videoRef.current) { videoRef.current.playbackRate = 1; videoRef.current.pause() }
          // Notificar al celular que terminó
          const ws = wsRef.current
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stopped' }))
        } else {
          currentRepRef.current = nextRep
          setCurrentRepDisplay(nextRep)
          const rc = (seg.repConfig ?? [])[nextRep] ?? { speed: 1, en: true, es: false }
          setActiveSubOverride({ en: rc.en ?? true, es: rc.es ?? false })
          videoRef.current.playbackRate = rc.speed ?? 1
          videoRef.current.currentTime = seg.start
          videoRef.current.play()
        }
      }
    }
  }, [showEn, showEs, subsEn, subsEs, segments, looping, active, subShift, activeSubOverride])

  useEffect(() => {
    const v = videoRef.current; if (!v) return
    v.addEventListener('timeupdate', onTimeUpdate)
    return () => v.removeEventListener('timeupdate', onTimeUpdate)
  }, [onTimeUpdate])

  // ── Fragmentos ──
  function saveAsTemplate(repConfig) {
    const t = repConfig.map(rc => ({ ...rc }))
    setTemplate(t)
    localStorage.setItem('seg_template', JSON.stringify(t))
    flashSaved()
  }

  function playSegment(idx) {
    const seg = segments[idx]; if (!seg || !videoRef.current) return
    activeSegOverride.current = null
    currentRepRef.current = 0
    loopSeeking.current = false
    setCurrentRepDisplay(0)
    const rc0 = (seg.repConfig ?? [{ speed: 1, en: true, es: false }])[0]
    setActiveSubOverride({ en: rc0.en ?? true, es: rc0.es ?? false })
    if (seg.subStyle) setSubStyle(seg.subStyle)
    setActive(idx); setLooping(true)
    videoRef.current.playbackRate = rc0.speed ?? 1
    videoRef.current.currentTime = seg.start; videoRef.current.play()
  }
  function pauseSegment() {
    if (!videoRef.current) return
    if (videoRef.current.paused) videoRef.current.play()
    else videoRef.current.pause()
  }
  function stopLoop() {
    activeSegOverride.current = null
    setLooping(false); setActive(null)
    currentRepRef.current = 0; setCurrentRepDisplay(0)
    setActiveSubOverride(null)
    if (videoRef.current) videoRef.current.playbackRate = speed
  }
  function markIn() {
    setMarkStart(videoRef.current?.currentTime ?? 0)
    setMarking(true)
    setNewPhrase('')
    videoRef.current?.play()
  }
  function markOut() {
    const t = videoRef.current?.currentTime ?? 0
    if (markStart === null || t <= markStart) return
    const sub    = subsEn.find(s => s.start >= markStart && s.end <= t)
    const ORDINALS = ['Primer','Segundo','Tercer','Cuarto','Quinto','Sexto','Séptimo','Octavo','Noveno','Décimo']
    const n = segments.length + 1
    const ordinal = n <= ORDINALS.length ? `${ORDINALS[n-1]} bloque` : `Bloque ${n}`
    const phrase = newPhrase.trim() || ordinal
    const newSeg = {
      id: Date.now(), start: markStart, end: t, phrase,
      repeat: template.length,
      repConfig: template.map(rc => ({ ...rc })),
      subStyle: subStyle
    }
    const updated = [...segments, newSeg].sort((a, b) => a.start - b.start)
    setSegments(updated)
    setCollapsed(new Set(updated.map((_, i) => i)))
    persistSegs(updated)
    setMarkStart(null); setMarking(false); setNewPhrase(''); flashSaved()
  }
  function updateSegConfig(idx, changes) {
    const updated = segments.map((s, i) => {
      if (i !== idx) return s
      const merged = { ...s, ...changes }
      if ('repeat' in changes) {
        const n = Math.max(1, changes.repeat)
        const old = s.repConfig ?? [{ speed: 1, en: true, es: false }]
        // Extender o recortar el array de vueltas
        merged.repConfig = Array.from({ length: n }, (_, j) =>
          old[j] ?? { ...old[old.length - 1] }   // hereda config de la última vuelta
        )
        merged.repeat = n
      }
      return merged
    })
    setSegments(updated); persistSegs(updated)
  }
  function updateRepConfig(segIdx, repIdx, changes) {
    const seg = segments[segIdx]
    const repConfig = (seg.repConfig ?? [{ speed: 1, en: true, es: false }]).map((rc, i) =>
      i === repIdx ? { ...rc, ...changes } : rc
    )
    updateSegConfig(segIdx, { repConfig })
  }
  // Abre el diálogo para guardar el video entero o un fragmento con sus subtítulos
  function openExport(mode, idx = null) {
    videoRef.current?.pause()
    const wrap = videoWrap.current
    const c = wrap ? contentRect(wrap, videoRef.current) : null     // la imagen del video dentro del contenedor (sin barras negras)
    setExportReq({ mode, idx, t: videoRef.current?.currentTime ?? 0, h: c?.h ?? 400, content: c, wrapW: wrap?.clientWidth ?? 0, wrapH: wrap?.clientHeight ?? 0 })
  }
  function moveFlag(idx, type, time, persist = false) {
    const t = Math.round(time * 100) / 100
    setSegments(prev => {
      const updated = prev.map((s, i) => {
        if (i !== idx) return s
        if (type === 'start') return { ...s, start: Math.min(t, s.end - 0.1) }
        return { ...s, end: Math.max(t, s.start + 0.1) }
      })
      if (persist) persistSegs(updated)
      return updated
    })
  }
  function moveBlock(idx, newStart, newEnd, persist = false) {
    setSegments(prev => {
      const seg = prev[idx]; if (!seg) return prev
      let s = newStart, e = newEnd
      if (s < 0) { e += -s; s = 0 }
      if (videoDuration && e > videoDuration) { const over = e - videoDuration; s -= over; e = videoDuration }
      s = Math.max(0, Math.round(s * 100) / 100)
      e = Math.round(e * 100) / 100
      const updated = prev.map((s2, i) => i === idx ? { ...s2, start: s, end: e } : s2)
      if (persist) persistSegs(updated)
      return updated
    })
  }

  function deleteSegment(idx) {
    const updated = segments.filter((_, i) => i !== idx)
    setSegments(updated); persistSegs(updated)
    if (active === idx) stopLoop()
  }
  function saveSegEdit(idx) {
    const updated = segments.map((s, i) => i === idx ? { ...s, phrase: editVal } : s)
    setSegments(updated); persistSegs(updated); setEditingIdx(null)
  }
  function persistSegs(segs) {
    fetch(`/api/segments/${encodeURIComponent(video.name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: segs })
    })
  }

  // ── Subtítulos ──
  function persistSubs(lang, subs) {
    fetch(`/api/subtitles/${encodeURIComponent(video.name)}?lang=${lang}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subs })
    })
  }
  function saveSubEdit(lang, idx) {
    const subs    = lang === 'en' ? subsEn : subsEs
    const setter  = lang === 'en' ? setSubsEn : setSubsEs
    const updated = subs.map((s, i) => i === idx ? { ...s, phrase: editSubVal } : s)
    setter(updated); persistSubs(lang, updated); setEditSubKey(null)
  }
  function deleteSub(lang, idx) {
    const subs   = lang === 'en' ? subsEn : subsEs
    const setter = lang === 'en' ? setSubsEn : setSubsEs
    const updated = subs.filter((_, i) => i !== idx)
    setter(updated); persistSubs(lang, updated)
  }
  function syncSubToNow(lang, idx) {
    const t      = videoRef.current?.currentTime ?? 0
    const subs   = lang === 'en' ? subsEn : subsEs
    const setter = lang === 'en' ? setSubsEn : setSubsEs
    const delta  = t - subs[idx].start
    const updated = subs.map((s, i) => i < idx ? s : {
      ...s,
      start: +(s.start + delta).toFixed(2),
      end:   +(s.end   + delta).toFixed(2),
    })
    setter(updated)
    persistSubs(lang, updated)
    flashSaved()
  }

  function editSubOverlay(lang, newText) {
    const t      = videoRef.current?.currentTime ?? 0
    const subs   = lang === 'en' ? subsEn : subsEs
    const setter = lang === 'en' ? setSubsEn : setSubsEs
    const idx    = subs.findIndex(s => t >= s.start && t <= s.end)
    if (idx === -1) return
    const updated = subs.map((s, i) => i === idx ? { ...s, phrase: newText } : s)
    setter(updated); persistSubs(lang, updated); flashSaved()
  }
  function seekTo(t) {
    if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.play() }
  }

  
  // ── Transcripción y traducción: trabajos que corren en el programa (backend) ──
  function stopPoll(key) { clearInterval(pollRef.current[key]); pollRef.current[key] = null }
  useEffect(() => () => { stopPoll('en'); stopPoll('es') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sondea el estado de un trabajo hasta que termina (listo o con error)
  function watchJob(key, url, { setBusy, setMsg, onDone, onEnd }) {
    stopPoll(key)
    setBusy(true)
    const finish = () => { stopPoll(key); setBusy(false); setJobs(j => ({ ...j, [key]: null })) }
    const tick = async () => {
      try {
        const data = await fetch(url).then(r => r.json())
        if (data.status === 'done') {
          finish(); setMsg(''); onDone(Array.isArray(data.subs) ? data.subs : []); flashSaved(); onEnd?.()
        } else if (data.status === 'error') {
          finish(); setMsg('Error: ' + data.msg); onEnd?.()
        } else if (data.status === 'running') {
          setMsg(data.msg || 'Procesando…')
          setJobs(j => ({ ...j, [key]: data }))      // alimenta el relojito (porcentaje, tiempo que falta…)
        } else {   // 'idle' o respuesta rara: el programa se reinició y perdió el trabajo
          finish(); setMsg('Error: se perdió el trabajo (¿se reinició el programa?). Probá de nuevo.')
        }
      } catch {
        finish(); setMsg('Error: se perdió la conexión con el programa.')
      }
    }
    pollRef.current[key] = setInterval(tick, 1000)
    tick()
  }

  function startErrorText(res) {
    if (res?.detail === 'Not Found') return 'Error: falta reiniciar el programa (iniciar.bat) para activar esta función.'
    return 'Error: ' + (res?.error || res?.detail || 'no se pudo iniciar.')
  }

  // Traer solos los subtítulos al abrir un video sin subtítulos: se intenta una sola vez por video
  // (si falló o el video no tiene voz, no se repite; queda el botón Auto) y se puede desactivar
  const autoTriedKey = `autosubs_tried:${video.name}`
  function autoFetchEnabled() { try { return localStorage.getItem('auto_fetch_subs') !== '0' } catch { return true } }
  function autoFetchTried()   { try { return localStorage.getItem(autoTriedKey) === '1' } catch { return false } }
  function markAutoFetchTried() { try { localStorage.setItem(autoTriedKey, '1') } catch { /* sin almacenamiento */ } }
  function toggleAutoFetch(on) {
    setAutoFetch(on)
    try { localStorage.setItem('auto_fetch_subs', on ? '1' : '0') } catch { /* sin almacenamiento */ }
  }

  function watchTranscribe() {
    watchJob('en', `/api/transcribe/status/${encodeURIComponent(video.name)}?lang=en`,
      { setBusy: setTransEn, setMsg: setTransMsgEn, onDone: setSubsEn, onEnd: markAutoFetchTried })
  }

  // opts.force: volver a traer aunque ya haya subtítulos (los actuales se conservan hasta que termine bien)
  // opts.auto:  lo disparó la apertura del video, no el botón
  async function startTranscribe(lang, { force = false, auto = false } = {}) {
    const setTrans = lang === 'en' ? setTransEn   : () => {}
    const setMsg   = lang === 'en' ? setTransMsgEn : () => {}
    const setSubs  = lang === 'en' ? setSubsEn    : setSubsEs
    // Si ya están los subtítulos no se vuelven a pedir: se pisarían las ediciones hechas a mano
    if (!force && (lang === 'en' ? subsEn : subsEs).length > 0) return
    const enc = encodeURIComponent(video.name)
    setTrans(true); setMsg(auto ? 'Trayendo los subtítulos automáticamente…' : 'Iniciando…')
    try {
      const res = await fetch(`/api/transcribe/start/${enc}?model=small&lang=${lang}${force ? '&force=true' : ''}`, { method: 'POST' }).then(r => r.json())
      if (res.status === 'exists') {   // ya estaban generados (p. ej. desde otra pestaña): se cargan
        const d = await fetch(`/api/subtitles/${enc}?lang=${lang}`).then(r => r.json())
        setSubs(Array.isArray(d) ? d : []); setTrans(false); setMsg('')
        return
      }
      if (res.status !== 'started' && res.status !== 'running') { setTrans(false); setMsg(startErrorText(res)); return }
    } catch {
      setTrans(false); setMsg('Error: no se pudo contactar con el programa.')
      return
    }
    watchJob(lang, `/api/transcribe/status/${enc}?lang=${lang}`, { setBusy: setTrans, setMsg, onDone: setSubs, onEnd: markAutoFetchTried })
  }

  // Vuelve a traer los subtítulos en inglés (con confirmación): se reemplazan solo si la nueva transcripción termina bien
  function redoSubsEn() {
    if (transEn) return
    if (!window.confirm(`Ya tenés ${subsEn.length} subtítulos en inglés.\n\nSi los volvés a traer se reemplazan por una transcripción nueva (se pierden los cambios que hayas hecho a mano).\n\n¿Seguir?`)) return
    startTranscribe('en', { force: true })
  }

  const [syncing, setSyncing] = useState({ en: false, es: false })

  async function autoSync(lang) {
    setSyncing(s => ({ ...s, [lang]: true }))
    try {
      const data = await fetch(`/api/autosync/${encodeURIComponent(video.name)}?lang=${lang}`, { method: 'POST' }).then(r => r.json())
      if (data.error) { alert('Error: ' + data.error); return }
      if (lang === 'en') setSubsEn(Array.isArray(data) ? data : [])
      else               setSubsEs(Array.isArray(data) ? data : [])
      flashSaved()
    } finally { setSyncing(s => ({ ...s, [lang]: false })) }
  }

  async function translateToEs() {
    if (translating) return
    const enc = encodeURIComponent(video.name)
    setTranslating(true); setTransMsgEs('Iniciando…')
    try {
      const res = await fetch(`/api/translate/start/${enc}`, { method: 'POST' }).then(r => r.json())
      if (res.status !== 'started' && res.status !== 'running') { setTranslating(false); setTransMsgEs(startErrorText(res)); return }
    } catch {
      setTranslating(false); setTransMsgEs('Error: no se pudo contactar con el programa.')
      return
    }
    watchJob('es', `/api/translate/status/${enc}`, { setBusy: setTranslating, setMsg: setTransMsgEs, onDone: setSubsEs })
  }

  async function importSrt(e, lang) {
    const file = e.target.files[0]; if (!file) return
    const form = new FormData(); form.append('file', file)
    const data = await fetch(`/api/parse-srt/${encodeURIComponent(video.name)}?lang=${lang}`, { method: 'POST', body: form }).then(r => r.json())
    if (lang === 'en') setSubsEn(Array.isArray(data) ? data : [])
    else               setSubsEs(Array.isArray(data) ? data : [])
    flashSaved(); e.target.value = ''
  }

  function flashSaved() { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  function fmt(s) { const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}` }

  const builtinClass   = `sub-overlay sub-${subStyle}${subBg ? '' : ' sub-nobg'}`

  return (
    <div className="player-shell">

      {/* ── IZQUIERDA ── */}
      <div className="player-left">
        <div className="player-topbar">
          {theme === 'harry' && (
            <img
              src={escobaImg}
              className={`escoba-deco escoba-player escoba-${escobaAnim}`}
              onClick={handleEscobaClick}
              alt=""
            />
          )}
          <button className="back-btn" onClick={onBack}>← Volver</button>
          <span className="player-title">{video.name.replace(/\.[^.]+$/, '')}</span>
          <button className="vcb-btn video-size-btn" title="Cambiar tamaño video"
            onClick={() => setVideoSize(s => (s + 1) % 3)}>
            {VIDEO_SIZE_LABELS[videoSize]}
          </button>
          <button
            className={`vcb-btn remote-btn ${wsConnected ? 'remote-connected' : ''}`}
            title="Control remoto desde el celular"
            onClick={() => setShowRemote(v => !v)}
          >
            📱 {wsConnected ? '●' : '○'}
          </button>
          <button className="vcb-btn export-btn" title="Guardar el video con los subtítulos puestos" onClick={() => openExport('video')}>
            💾 Exportar
          </button>
          <ThemeDropdown theme={theme} onChange={onThemeChange} />
        </div>

        {showRemote && (
          <div className="remote-panel">
            <div className="remote-panel-title">
              📱 Control desde el celular
              <span className={`remote-panel-status ${wsConnected ? 'ws-on' : 'ws-off'}`}>
                {wsConnected ? '● Conectado' : '○ Sin conexión'}
              </span>
            </div>
            <div className="remote-panel-body">
              {remoteUrl ? (
                <>
                  <div className="remote-qr-wrap">
                    <QRCodeSVG value={remoteUrl} size={160} bgColor="#ffffff" fgColor="#0f1117" level="M" />
                  </div>
                  <p className="remote-hint">Escaneá con el celular <strong>(misma red WiFi)</strong></p>
                  <div className="remote-url-box">{remoteUrl}</div>
                </>
              ) : (
                <p className="remote-hint">Cargando…</p>
              )}
            </div>
          </div>
        )}

        <div className="video-wrap" ref={videoWrap}
          style={{ '--video-max-h': videoMaxH + 'vh' }}
          onClick={e => {
            setSelectedStickerId(null)
            // solo clic directo sobre el wrap (no sobre stickers ni subs)
            if (e.target === videoWrap.current || e.target === videoRef.current) {
              if (wordAnchor) { closeWord(); return }     // un clic afuera cierra la ventanita de la palabra (y sigue el video)
              const v = videoRef.current; if (!v) return
              if (v.paused) { v.play(); setClickFlash('play') }
              else          { v.pause(); setClickFlash('pause') }
              setTimeout(() => setClickFlash(null), 600)
            }
          }}
        >
          <video ref={videoRef} className="video-el"
            src={`/videos/${encodeURIComponent(video.name)}`}
            preload="metadata"
            onLoadedMetadata={e => setVideoDuration(e.target.duration)} />
          {clickFlash && (
            <div className={`click-flash click-flash-${clickFlash}`}>
              {clickFlash === 'play' ? '▶' : '⏸'}
            </div>
          )}
          {/* --- STICKERS sobre el video --- */}
          {stickers.filter(s =>
            (s.startTime == null && s.endTime == null) ||
            (videoTime >= (s.startTime ?? 0) && videoTime <= (s.endTime ?? Infinity))
          ).map(s => (
            <DraggableSticker
              key={s.id}
              sticker={s}
              selected={selectedStickerId === s.id}
              onSelect={() => setSelectedStickerId(s.id)}
              containerRef={videoWrap}
              onUpdate={changes => setStickers(prev => prev.map(sk => sk.id === s.id ? { ...sk, ...changes } : sk))}
              onRemove={() => setStickers(prev => prev.filter(sk => sk.id !== s.id))}
            />
          ))}
          {/* Franja negra (R) sobre los subtítulos que ya trae el video; los nuestros van encima */}
          {cover.on && (
            <SubtitleCover rect={cover.rect} onChange={rect => setCover(c => ({ ...c, rect }))}
              containerRef={videoWrap} videoRef={videoRef} />
          )}
          {/* Subtítulos: un solo bloque (inglés arriba, español abajo) que se acomoda solo dentro del video */}
          <SubtitleStack
            en={showEn ? currentEn : ''}
            es={showEs ? currentEs : ''}
            enClass={builtinClass}
            esClass={`${builtinClass} sub-es`}
            fontSize={`${subSize}rem`}
            defaultX={50} defaultY={70}
            offset={subOffset} onDrag={setSubOffset}
            onEdit={editSubOverlay}
            onWord={openWord} savedWords={savedWords}
            containerRef={videoWrap} videoRef={videoRef}
          />
          {wordAnchor && (
            <WordPopup
              key={`${wordAnchor.word}@${wordAnchor.example.start}`}
              anchor={wordAnchor} boxRef={videoWrap}
              card={vocab.find(c => c.word === normWord(wordAnchor.word))}
              onSave={saveWord} onRemove={removeWord} onClose={closeWord}
            />
          )}
          <div className="resize-handle-v"
            onMouseDown={e => {
              e.preventDefault()
              document.body.style.cursor = 'ns-resize'
              resizeDrag.current = { type: 'v', startY: e.clientY, startVal: videoMaxH }
            }}
          ><span className="resize-dots" /></div>
        </div>

        {/* ── Controles de video + barra con banderas ── */}
        <div className="vcb">
          <button className="vcb-btn vcb-play" onClick={togglePlay}>
            {playing ? '⏸' : '▶'}
          </button>
          <span className="vcb-time">{fmtT(videoTime)}</span>
          <div className="seekmode-btns">
            <button
              className={`seekmode-btn ${seekMode === 'seek' ? 'seekmode-on' : ''}`}
              onClick={() => setSeekMode('seek')}
              title="Modo puntero — clic para ir a escena (P)">
              👆
            </button>
            <button
              className={`seekmode-btn ${seekMode === 'pan' ? 'seekmode-on' : ''}`}
              onClick={() => setSeekMode('pan')}
              title="Modo lupa — arrastrar para moverse, scroll para zoom (T)">
              🔍
            </button>
          </div>
          <button
            className={`seekmode-btn ${cover.on ? 'seekmode-on' : ''}`}
            onClick={() => setCover(c => ({ ...c, on: !c.on }))}
            title="Franja negra para tapar los subtítulos que ya trae el video (R)">
            ▬
          </button>
          <SeekBar
            ref={seekBarRef}
            duration={videoDuration}
            currentTime={videoTime}
            segments={segments}
            markStart={markStart}
            seekMode={seekMode}
            activeIdx={active}
            onSeek={t => { if (videoRef.current) videoRef.current.currentTime = t; stopLoop() }}
            onEndFlag={t => {
              if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.pause() }
              stopLoop()
            }}
            onMoveFlag={moveFlag}
            onMoveBlock={moveBlock}
            onPlayBlock={playSegment}
            onZoomChange={z => setZoomPct(Math.round(z * 100))}
          />
          <div className="zoom-btns">
            <button className="seekmode-btn" onClick={() => seekBarRef.current?.zoomOut()} title="Alejar zoom">－</button>
            <span className="zoom-pct">{zoomPct}%</span>
            <button className="seekmode-btn" onClick={() => seekBarRef.current?.zoomIn()} title="Acercar zoom">＋</button>
            {zoomPct > 100 && (
              <button className="seekmode-btn zoom-reset-btn" onClick={() => seekBarRef.current?.resetZoom()} title="Restablecer zoom">⤢</button>
            )}
          </div>
          <span className="vcb-time">{fmtT(videoDuration)}</span>
          <div className="vcb-speed-group">
            {SPEEDS_COMPACT.map(s => (
              <button key={s} className={`vcb-speed-btn ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>{s}x</button>
            ))}
          </div>
          <button className="vcb-btn" onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
          {/* Pantalla completa del contenedor (no solo del <video>) para que se vean los subtítulos y los stickers */}
          <button className="vcb-btn" title="Pantalla completa" onClick={() => {
            if (document.fullscreenElement) document.exitFullscreen()
            else videoWrap.current?.requestFullscreen()
          }}>⛶</button>
        </div>

        <div className="player-left-scroll">
        {/* Velocidad + retroceso */}
        <div className="controls-row">
          <div className="speed-group">
            <span className="ctrl-label">Velocidad:</span>
            {SPEEDS.map(s => (
              <button key={s} className={`speed-btn ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>{s}x</button>
            ))}
          </div>
          <div className="rewind-group">
            <button className="rewind-btn" onClick={() => {
              if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - rewindSecs)
            }}>⏪ {rewindSecs}s</button>
            <button className="rewind-adj" onClick={() => setRewindSecs(s => Math.max(1, s - 1))}>−</button>
            <button className="rewind-adj" onClick={() => setRewindSecs(s => Math.min(30, s + 1))}>+</button>
          </div>
        </div>

        {/* Subtítulos */}
        <div className="sub-controls-row">
          <button className={`sub-toggle ${showEn ? 'active' : ''}`} onClick={() => setShowEn(v => !v)}>🇬🇧 {showEn ? 'ON' : 'OFF'}</button>
          <button className={`sub-toggle ${showEs ? 'active' : ''}`} onClick={() => setShowEs(v => !v)}>🇪🇸 {showEs ? 'ON' : 'OFF'}</button>
          <button className={`sub-toggle ${subBg ? 'active' : ''}`} onClick={() => setSubBg(v => !v)}
            title="Recuadro translúcido detrás de las letras (apagado: solo letras con borde, ideal con la franja negra)">
            🔲 Fondo {subBg ? 'ON' : 'OFF'}
          </button>
          <div className="style-group">
            {BUILTIN_STYLES.map(st => (
              <button key={st.id} className={`style-btn style-${st.id} ${subStyle === st.id ? 'active' : ''}`} onClick={() => setSubStyle(st.id)}>
                {(st.img && theme === 'harry') ? <img src={st.img} className="style-btn-img" alt={st.label} /> : st.label}
              </button>
            ))}
          </div>
          <StickerSelector onSelect={url => {
            const t = videoRef.current?.currentTime ?? 0
            // Buscar subtítulo activo para anclar el sticker a su tiempo
            const activeSub = subsEn.find(s => t >= s.start + subShift && t <= s.end + subShift)
                           || subsEs.find(s => t >= s.start + subShift && t <= s.end + subShift)
            const startTime = activeSub ? activeSub.start + subShift : t
            const endTime   = activeSub ? activeSub.end   + subShift : t + 5
            const newId = Date.now()
            setStickers(prev => [...prev, { id: newId, url, x: 68, y: 74, size: 100, startTime, endTime }])
            setSelectedStickerId(newId)   // seleccionar inmediatamente
          }} />
          <div className="size-group">
            <button className="size-btn" onClick={() => setSubSize(s => Math.max(0.7, +(s - 0.1).toFixed(1)))}>A−</button>
            <span className="size-val">{subSize}rem</span>
            <button className="size-btn" onClick={() => setSubSize(s => Math.min(3, +(s + 0.1).toFixed(1)))}>A+</button>
          </div>
          <button className="size-btn" onClick={() => setSubOffset({ x: 0, y: 0 })} title="Resetear posición subs">⊙</button>
          <div className="shift-group">
            <span className="ctrl-label" title="Si los subs aparecen antes, subí el valor">Delay:</span>
            <button className="rewind-adj" onClick={() => setSubShift(s => +(s - 0.5).toFixed(1))}>−</button>
            <span className="size-val">{subShift > 0 ? '+' : ''}{subShift}s</span>
            <button className="rewind-adj" onClick={() => setSubShift(s => +(s + 0.5).toFixed(1))}>+</button>
          </div>
          {saved && <span className="saved-badge">✓ Listo</span>}
        </div>

        {/* Marcar fragmento */}
        <div className="mark-panel">
          <div className="mark-title">✂️ Marcar fragmento</div>
          <div className="mark-row">
            {marking && playing ? (
              <button className="mark-btn mark-btn-stop" onClick={() => videoRef.current?.pause()}>
                ⏹ Stop
              </button>
            ) : (
              <button className={`mark-btn ${markStart !== null ? 'active' : ''}`} onClick={markIn}>
                {markStart !== null ? `▶ Inicio: ${fmt(markStart)}` : '[ Marcar inicio'}
              </button>
            )}
            <button className="mark-btn" onClick={markOut} disabled={markStart === null}>] Marcar fin</button>
          </div>
          {marking && (
            <div className="mark-phrase-row">
              <input className="mark-input" placeholder="Nombre del fragmento (opcional)…"
                value={newPhrase} onChange={e => setNewPhrase(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && markOut()} autoFocus />
            </div>
          )}
        </div>

        {/* Transcripción */}
        <div className="trans-row">
          <div className="trans-col">
            <div className="trans-label">🇺🇸 Inglés</div>
            <div className="trans-btns">
              <button className={`auto-btn ${transEn ? 'auto-busy' : ''} ${subsEn.length > 0 ? 'auto-done' : ''}`}
                onClick={() => startTranscribe('en')}
                disabled={transEn || !subsEnReady || subsEn.length > 0}
                title={subsEn.length > 0
                  ? `Ya están los subtítulos en inglés (${subsEn.length}). Si querés hacerlos de nuevo, usá ↻ Volver a traer.`
                  : 'Traer los subtítulos en inglés automáticamente'}>
                {transEn ? '⏳ Auto' : subsEn.length > 0 ? '✓ Ya traídos' : '✨ Auto'}
              </button>
              <button className="srt-btn" onClick={() => srtEnInput.current.click()}>📄 SRT</button>
              <input ref={srtEnInput} type="file" accept=".srt" style={{ display: 'none' }} onChange={e => importSrt(e, 'en')} />
              {subsEn.length > 0 && !transEn && <span className="subs-badge">{subsEn.length} subs</span>}
              {subsEn.length > 0 && !transEn && (
                <button className="srt-btn" onClick={redoSubsEn} title="Volver a traer los subtítulos en inglés (reemplaza los actuales)">↻ Volver a traer</button>
              )}
            </div>
            <label className="auto-fetch-toggle" title="Al abrir un video que no tiene subtítulos en inglés, se traen solos (una vez por video)">
              <input type="checkbox" checked={autoFetch} onChange={e => toggleAutoFetch(e.target.checked)} /> Traer solos al abrir un video sin subtítulos
            </label>
            {transEn && <JobProgress label="Subtítulos en inglés" job={jobs.en ?? { msg: transMsgEn, progress: null, elapsed: 0 }} />}
            {!transEn && transMsgEn && <div className={`trans-status ${transMsgEn.startsWith('Error') ? 'trans-error' : ''}`}>{transMsgEn}</div>}
          </div>
          <div className="trans-col">
            <div className="trans-label">🇪🇸 Español</div>
            <div className="trans-btns">
              <button className={`auto-btn ${translating ? 'auto-busy' : ''}`} onClick={translateToEs} disabled={translating || subsEn.length === 0}>
                {translating ? '⏳' : '🌐'} Traducir
              </button>
              <button className="srt-btn" onClick={() => srtEsInput.current.click()}>📄 SRT</button>
              <input ref={srtEsInput} type="file" accept=".srt" style={{ display: 'none' }} onChange={e => importSrt(e, 'es')} />
              {subsEs.length > 0 && <span className="subs-badge">{subsEs.length} subs</span>}
            </div>
            {translating && <JobProgress label="Traducción al español" job={jobs.es ?? { msg: transMsgEs, progress: null, elapsed: 0 }} />}
            {!translating && transMsgEs && <div className={`trans-status ${transMsgEs.startsWith('Error') ? 'trans-error' : ''}`}>{transMsgEs}</div>}
          </div>
        </div>
        </div>{/* end player-left-scroll */}
      </div>

      {/* ── HANDLE HORIZONTAL ── */}
      <div className="resize-handle-h"
        onMouseDown={e => {
          e.preventDefault()
          document.body.style.cursor = 'ew-resize'
          resizeDrag.current = { type: 'h', startX: e.clientX, startVal: rightWidth }
        }}
      ><span className="resize-dots" /></div>

      {/* ── DERECHA ── */}
      <div className="player-right" style={{ width: rightWidth, minWidth: rightWidth, maxWidth: rightWidth }}>
        <div className="right-tabs">
          <button className={`rtab ${rightTab === 'fragments' ? 'rtab-active' : ''}`} onClick={() => setRightTab('fragments')}>
            ✂️ {segments.length > 0 ? `Fragmentos (${segments.length})` : 'Fragmentos'}
          </button>
          <button className={`rtab ${rightTab === 'subs-en' ? 'rtab-active' : ''}`} onClick={() => setRightTab('subs-en')}>
            🇺🇸 EN {subsEn.length > 0 && `(${subsEn.length})`}
          </button>
          <button className={`rtab ${rightTab === 'subs-es' ? 'rtab-active' : ''}`} onClick={() => setRightTab('subs-es')}>
            🇪🇸 ES {subsEs.length > 0 && `(${subsEs.length})`}
          </button>
        </div>

        {rightTab === 'fragments' && (
          <div className="seg-list">
            {segments.length === 0 && (
              <div className="seg-empty">
                Pausá en la frase que querés y usá<br />
                <strong>[ Marcar inicio</strong> y <strong>] Marcar fin</strong>.<br /><br />
                El fragmento aparece acá con ▶ para repetirlo.
              </div>
            )}
            {segments.map((seg, idx) => {
              const isActive    = active === idx && looping
              const segRepeat   = seg.repeat ?? 1
              const repConfig   = seg.repConfig ?? [{ speed: 1, en: true, es: false }]
              const segSubStyle = seg.subStyle ?? 'default'
              const isCollapsed = collapsed.has(idx) && !isActive
              function toggleCollapse() {
                setCollapsed(prev => {
                  const next = new Set(prev)
                  next.has(idx) ? next.delete(idx) : next.add(idx)
                  return next
                })
              }
              return (
              <div key={seg.id ?? idx} className={`fc ${isActive ? 'fc-active' : ''}`} data-fc-idx={idx}>

                {/* Header siempre visible */}
                {isCollapsed && (
                  <div className="fc-collapsed-name">{seg.phrase}</div>
                )}
                <div className="fc-header">
                  <div className="fc-time">{fmt(seg.start)} → {fmt(seg.end)}</div>
                  {isCollapsed && !isActive && (
                    <button className="fc-play-mini" onClick={() => playSegment(idx)} title="Reproducir">▶</button>
                  )}
                  {isCollapsed && isActive && (
                    <button className="fc-play-mini fc-stop-mini" onClick={stopLoop} title="Detener">■</button>
                  )}
                  <button className="fc-toggle" onClick={toggleCollapse} title={isCollapsed ? 'Expandir' : 'Colapsar'}>
                    {isCollapsed ? '▲' : '▼'}
                  </button>
                </div>

                {/* Contenido expandido */}
                {!isCollapsed && <>

                {/* Nombre / dots cuando reproduce */}
                {isActive ? (
                  <div className="fc-playing-top">
                    <div className="fc-dots">
                      {Array.from({ length: segRepeat }, (_, i) => (
                        <span key={i}
                          className={`fc-dot fc-dot-btn ${i < currentRepDisplay ? 'fc-dot-done' : i === currentRepDisplay ? 'fc-dot-current' : ''}`}
                          title={`Vuelta ${i + 1}`}
                          onClick={() => {
                            const rc = (seg.repConfig ?? [])[i] ?? { speed: 1, en: true, es: false }
                            currentRepRef.current = i
                            setCurrentRepDisplay(i)
                            setActiveSubOverride({ en: rc.en ?? true, es: rc.es ?? false })
                            if (videoRef.current) {
                              videoRef.current.playbackRate = rc.speed ?? 1
                              videoRef.current.currentTime = seg.start
                              videoRef.current.play()
                            }
                            loopSeeking.current = false
                          }}
                        />
                      ))}
                    </div>
                    <div className="fc-playing-info">
                      <span className="fc-name-active">{seg.phrase}</span>
                      <span className="fc-vuelta-lbl">Vuelta {currentRepDisplay + 1} de {segRepeat}</span>
                    </div>
                  </div>
                ) : editingIdx === idx ? (
                  <div className="seg-edit-row">
                    <input className="seg-edit-input" value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveSegEdit(idx); if (e.key === 'Escape') setEditingIdx(null) }}
                      autoFocus />
                    <button className="seg-save-btn" onClick={() => saveSegEdit(idx)}>✓</button>
                    <button className="seg-cancel-btn" onClick={() => setEditingIdx(null)}>✕</button>
                  </div>
                ) : (
                  <div className="fc-name"
                    onClick={() => { setEditingIdx(idx); setEditVal(seg.phrase) }}
                    title="Clic para renombrar">{seg.phrase}</div>
                )}

                {/* Botones de reproducción */}
                {isActive ? (
                  <div className="fc-btns">
                    <button className="fc-seguir-btn" onClick={pauseSegment}>
                      {playing ? '⏸ Pausar' : '▶ Seguir'}
                    </button>
                    <button className="fc-detener-btn" onClick={stopLoop}>■ Detener</button>
                  </div>
                ) : (
                  <button className="fc-play-btn" onClick={() => playSegment(idx)}>▶ Reproducir</button>
                )}

                {/* Caja de config */}
                <div className="fc-config">
                  {/* Vueltas */}
                  <div className="fc-vueltas-row">
                    <span className="fc-vueltas-icon">🔁</span>
                    <button className="fc-adj" onClick={() => updateSegConfig(idx, { repeat: segRepeat - 1 })}>−</button>
                    <span className="fc-vueltas-num">{segRepeat} {segRepeat === 1 ? 'vuelta' : 'vueltas'}</span>
                    <button className="fc-adj" onClick={() => updateSegConfig(idx, { repeat: segRepeat + 1 })}>+</button>
                  </div>
                  {/* Fila por vuelta */}
                  {repConfig.map((rc, ri) => (
                    <div key={ri} className={`fc-rep-row ${isActive && currentRepDisplay === ri ? 'fc-rep-active' : ''}`}>
                      <div className="fc-rep-speeds">
                        <span className="fc-rep-lbl">V{ri + 1}</span>
                        {SPEEDS_COMPACT.map(v => (
                          <button key={v}
                            className={`fc-speed ${(rc.speed ?? 1) === v ? 'fc-speed-on' : ''}`}
                            onClick={() => updateRepConfig(idx, ri, { speed: v })}>
                            {v}x
                          </button>
                        ))}
                      </div>
                      <div className="fc-rep-idioma">
                        <span className="fc-idioma-lbl">Idioma:</span>
                        <button className={`fc-flag ${rc.en ? 'fc-flag-on' : ''}`}
                          onClick={() => updateRepConfig(idx, ri, { en: !rc.en })}>🇺🇸</button>
                        <button className={`fc-flag ${rc.es ? 'fc-flag-on' : ''}`}
                          onClick={() => updateRepConfig(idx, ri, { es: !rc.es })}>🇪🇸</button>
                      </div>
                    </div>
                  ))}
                  {/* Estilo de subtítulo */}
                  <div className="fc-style-row">
                    <span className="fc-idioma-lbl">🎨 Estilo sub:</span>
                    <div className="fc-style-pills">
                      {BUILTIN_STYLES.map(st => (
                        <button key={st.id}
                          className={`fc-style-pill style-${st.id} ${segSubStyle === st.id ? 'fc-style-on' : ''}`}
                          onClick={() => updateSegConfig(idx, { subStyle: st.id })}>
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="fc-footer">
                  <button className="fc-template-btn" onClick={() => saveAsTemplate(repConfig)} title="Guardar config como plantilla">📋 Plantilla</button>
                  <button className="fc-dl-btn" onClick={() => openExport('segment', idx)} title="Guardar este fragmento (con sus vueltas, velocidades y subtítulos)">
                    ⬇️ Bajar
                  </button>
                  <button className="fc-del-btn" onClick={() => deleteSegment(idx)}>🗑</button>
                </div>

                </>} {/* fin !isCollapsed */}

              </div>
              )
            })}
          </div>
        )}

        {(rightTab === 'subs-en' || rightTab === 'subs-es') && (() => {
          const lang = rightTab === 'subs-en' ? 'en' : 'es'
          const subs = lang === 'en' ? subsEn : subsEs
          return (
            <div className="seg-list">
              {subs.length > 0 && (
                <a className="srt-download" href={`/api/subtitles/${encodeURIComponent(video.name)}/srt?lang=${lang}&shift=${subShift}`}
                   download title="Descargar estos subtítulos como archivo .srt (con el delay actual)">⬇ Descargar .srt</a>
              )}
              {subs.length === 0 && (
                <div className="seg-empty">
                  Sin subtítulos todavía.<br />
                  Usá ✨ Auto o importá un .SRT.
                </div>
              )}
              {subs.map((sub, idx) => (
                <div key={sub.id ?? idx} className="seg-item sub-item">
                  <div className="seg-time">{fmt(sub.start)} → {fmt(sub.end)}</div>
                  {editSubKey === `${lang}-${idx}` ? (
                    <div className="seg-edit-row">
                      <input className="seg-edit-input" value={editSubVal}
                        onChange={e => setEditSubVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveSubEdit(lang, idx); if (e.key === 'Escape') setEditSubKey(null) }}
                        autoFocus />
                      <button className="seg-save-btn" onClick={() => saveSubEdit(lang, idx)}>✓</button>
                      <button className="seg-cancel-btn" onClick={() => setEditSubKey(null)}>✕</button>
                    </div>
                  ) : <div className="seg-phrase"
                        onDoubleClick={() => { setEditSubKey(`${lang}-${idx}`); setEditSubVal(sub.phrase) }}
                        title="Doble clic para editar">{sub.phrase}</div>}
                  <div className="seg-actions">
                    <button className="seg-play-btn" onClick={() => seekTo(sub.start)}>▶</button>
                    <button className="seg-sync-btn" onClick={() => syncSubToNow(lang, idx)} title="Pausá el video cuando el personaje diga esta frase, luego hacé clic acá para sincronizar este y todos los siguientes">📍</button>
                    <button className="seg-edit-btn" onClick={() => { setEditSubKey(`${lang}-${idx}`); setEditSubVal(sub.phrase) }}>✏️</button>
                    <button className="seg-del-btn" onClick={() => deleteSub(lang, idx)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {exportReq && (
        <ExportDialog
          mode={exportReq.mode} video={video}
          segment={exportReq.mode === 'segment' ? segments[exportReq.idx] : null}
          subsEn={subsEn} subsEs={subsEs} showEn={showEn} showEs={showEs}
          subStyle={subStyle} subSize={subSize} subOffset={subOffset} subShift={subShift}
          refHeight={exportReq.h} currentTime={exportReq.t}
          onClose={() => setExportReq(null)}
        />
      )}
    </div>
    
  )
}
