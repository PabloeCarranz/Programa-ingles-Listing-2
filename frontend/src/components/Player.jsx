import { useEffect, useRef, useState, useCallback } from 'react'
import { StickerSelector } from './StickerSelector';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

const BUILTIN_STYLES = [
  { id: 'default',   label: 'Default'   },
  { id: 'comic',     label: 'Comic'     },
  { id: 'gothic',    label: 'Gothic'    },
  { id: 'console',   label: 'Console'   },
  { id: 'neon',      label: 'Neon'      },
  { id: 'neonblue',  label: 'Neon Blue' },
  { id: 'fire',      label: 'Fire'      },
  { id: 'ice',       label: 'Ice'       },
  { id: 'gold',      label: 'Gold'      },
  { id: 'bubblegum', label: 'Bubblegum' },
  { id: 'cinema',    label: 'Cinema'    },
  { id: 'shadow',    label: 'Shadow'    },
  { id: 'outline',   label: 'Outline'   },
]

// ── Subtítulo arrastrable ──────────────────────────────────
function DraggableSub({ text, baseClass, customStyleObj, fontSize, defaultX, defaultY, fixedOffsetPx = 0, offset, onDrag, onEdit, containerRef }) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')
  const dragging = useRef(false)
  const origin   = useRef(null)

  function onPointerDown(e) {
    if (!text || editing) return
    e.preventDefault()
    dragging.current = true
    origin.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e) {
    if (!dragging.current || !containerRef.current) return
    const { offsetWidth: w, offsetHeight: h } = containerRef.current
    onDrag({
      x: origin.current.ox + (e.clientX - origin.current.mx) / w * 100,
      y: origin.current.oy + (e.clientY - origin.current.my) / h * 100,
    })
  }
  function onPointerUp() { dragging.current = false }

  function onDoubleClick(e) {
    if (!onEdit) return
    e.stopPropagation()
    setEditVal(text); setEditing(true)
  }
  function commitEdit() { onEdit(editVal); setEditing(false) }

  const x = defaultX + offset.x
  const y = defaultY + offset.y

  const inlineStyle = {
    position: 'absolute', left: `${x}%`,
    top: fixedOffsetPx ? `calc(${y}% + ${fixedOffsetPx}px)` : `${y}%`,
    transform: 'translate(-50%,-50%)',
    fontSize,
    cursor:       editing ? 'text' : (text ? 'grab' : 'default'),
    userSelect:   'none', zIndex: 10,
    opacity:      text ? 1 : 0,
    pointerEvents: text ? 'auto' : 'none',
    transition:   'opacity .15s',
    maxWidth:     '92%', textAlign: 'center',
    ...(customStyleObj || {}),
  }

  return (
    <div
      className={customStyleObj ? 'sub-overlay' : baseClass}
      style={inlineStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        <input
          className="sub-inline-input"
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
          onBlur={commitEdit}
          autoFocus
          style={{ fontSize }}
          onClick={e => e.stopPropagation()}
        />
      ) : text}
    </div>
  )
}

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

function SeekBar({ duration, currentTime, segments, onSeek, onEndFlag, onMoveFlag }) {
  const wrapRef     = useRef(null)
  const dragging    = useRef(false)
  const flagPending = useRef(null) // { idx, type, startX } — esperando umbral
  const flagDrag    = useRef(null) // { idx, type } — arrastre confirmado
  const [hover, setHover] = useState(null)

  function pct(t) { return duration ? Math.min(100, (t / duration) * 100) : 0 }
  function fmt(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}` }
  function timeAt(e) {
    if (!wrapRef.current || !duration) return 0
    const { left, width } = wrapRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((e.clientX - left) / width) * duration))
  }

  return (
    <div className="seekbar" ref={wrapRef}
      onPointerDown={e => {
        if (flagPending.current || flagDrag.current) return
        e.preventDefault()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        onSeek(timeAt(e))
      }}
      onPointerMove={e => {
        const t  = timeAt(e)
        const rx = e.clientX - wrapRef.current.getBoundingClientRect().left

        // Verificar si la bandera pendiente superó el umbral de arrastre
        if (flagPending.current && !flagDrag.current) {
          const moved = Math.abs(e.clientX - flagPending.current.startX)
          if (moved >= FLAG_DRAG_THRESHOLD) {
            flagDrag.current = { idx: flagPending.current.idx, type: flagPending.current.type }
          }
        }

        if (flagDrag.current) {
          onMoveFlag(flagDrag.current.idx, flagDrag.current.type, t)
          setHover({ x: rx, label: fmt(t) })
          return
        }
        const nearSeg = segments.find(s =>
          Math.abs(pct(s.start) - pct(t)) < 2 || Math.abs(pct(s.end) - pct(t)) < 2
        )
        setHover({ x: rx, label: nearSeg ? nearSeg.phrase : fmt(t) })
        if (dragging.current) onSeek(t)
      }}
      onPointerUp={e => {
        dragging.current = false
        if (flagDrag.current) {
          onMoveFlag(flagDrag.current.idx, flagDrag.current.type, timeAt(e), true)
          flagDrag.current = null
          flagPending.current = null
        } else if (flagPending.current) {
          // fue un clic simple sobre la bandera → seek normal
          const { idx, type } = flagPending.current
          if (type === 'start') onSeek(segments[idx].start)
          else onEndFlag(segments[idx].end)
          flagPending.current = null
        }
      }}
      onPointerLeave={() => { setHover(null) }}
    >
      {/* Track (fondo gris) */}
      <div className="sb-track" />
      {/* Fill de progreso (azul) */}
      <div className="sb-fill" style={{ width: `${pct(currentTime)}%` }} />
      {/* Cabeza de reproducción */}
      <div className="sb-head" style={{ left: `${pct(currentTime)}%` }} />

      {/* Banderas por fragmento */}
      {segments.map((seg, idx) => {
        const color = FLAG_COLORS[idx % FLAG_COLORS.length]
        return (
          <span key={seg.id ?? idx}>
            {/* Bandera de INICIO — arriba del track */}
            <div className="sb-flag sb-flag-start sb-flag-draggable"
              style={{ left: `${pct(seg.start)}%`, '--flag-color': color }}
              onPointerDown={e => {
                e.stopPropagation()
                e.preventDefault()
                flagPending.current = { idx, type: 'start', startX: e.clientX }
                wrapRef.current.setPointerCapture(e.pointerId)
              }}
              title={`⠿ Arrastrar inicio · ${seg.phrase}`}
            >
              <div className="sb-flag-label sb-flag-start-label" style={{ background: color }}>{idx + 1}▶</div>
              <div className="sb-flag-pole sb-flag-start-pole" style={{ background: color }} />
            </div>
            {/* Bandera de FIN — abajo del track */}
            <div className="sb-flag sb-flag-end sb-flag-draggable"
              style={{ left: `${pct(seg.end)}%` }}
              onPointerDown={e => {
                e.stopPropagation()
                e.preventDefault()
                flagPending.current = { idx, type: 'end', startX: e.clientX }
                wrapRef.current.setPointerCapture(e.pointerId)
              }}
              title={`⠿ Arrastrar fin · ${seg.phrase}`}
            >
              <div className="sb-flag-pole sb-flag-end-pole" />
              <div className="sb-flag-label sb-flag-end-label">■{idx + 1}</div>
            </div>
          </span>
        )
      })}

      {hover && (
        <div className="sb-tooltip" style={{
          left: Math.max(40, Math.min(hover.x, (wrapRef.current?.offsetWidth ?? 999) - 90))
        }}>{hover.label}</div>
      )}
    </div>
  )
}

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
export default function Player({ video, onBack }) {
  const videoRef   = useRef(null)
  const videoWrap  = useRef(null)
  const srtEnInput = useRef(null)
  const srtEsInput = useRef(null)

  const [segments,     setSegments]     = useState([])
  const [subsEn,       setSubsEn]       = useState([])
  const [subsEs,       setSubsEs]       = useState([])
  const [currentEn,    setCurrentEn]    = useState('')
  const [currentEs,    setCurrentEs]    = useState('')
  const [stickers,          setStickers]          = useState([])
  const [videoTime,         setVideoTime]         = useState(0)
  const [videoDuration,     setVideoDuration]     = useState(0)
  const [playing,           setPlaying]           = useState(false)
  const [muted,             setMuted]             = useState(false)
  const [selectedStickerId, setSelectedStickerId] = useState(null)
  const [currentRepDisplay, setCurrentRepDisplay] = useState(0)
  const [activeSubOverride, setActiveSubOverride] = useState(null) // { en, es }
  const [downloading,       setDownloading]       = useState(null)
  const currentRepRef  = useRef(0)
  const loopSeeking    = useRef(false)

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
  const [subSize,      setSubSize]      = useState(1.1)
  const [subOffset,    setSubOffset]    = useState({ x: 0, y: 0 })
  const [subShift,     setSubShift]     = useState(0)   // offset de timing en segundos
  const rewindRef = useRef(rewindSecs)

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

  const [editSubKey,   setEditSubKey]   = useState(null)
  const [editSubVal,   setEditSubVal]   = useState('')
  const [collapsed,    setCollapsed]    = useState(new Set())
  const [videoSize,    setVideoSize]    = useState(1)   // 0=chico 1=medio 2=grande
  const [clickFlash,   setClickFlash]   = useState(null) // 'play'|'pause'
  const VIDEO_SIZES = ['28vh', '42vh', '62vh']
  const VIDEO_SIZE_LABELS = ['Tamaño video: S', 'Tamaño video: M', 'Tamaño video: L']

  // ── Cargar datos ──
  useEffect(() => {
    fetch(`/api/segments/${encodeURIComponent(video.name)}`).then(r => r.json()).then(setSegments)
    fetch(`/api/subtitles/${encodeURIComponent(video.name)}?lang=en`).then(r => r.json()).then(d => setSubsEn(Array.isArray(d) ? d : []))
    fetch(`/api/subtitles/${encodeURIComponent(video.name)}?lang=es`).then(r => r.json()).then(d => setSubsEs(Array.isArray(d) ? d : []))
  }, [video.name])

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
      if (e.code === 'Space') {
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
      const seg = segments[active]
      // Reset guard cuando el video ya está antes del fin (seek completado)
      if (t < seg.end - 0.3) loopSeeking.current = false
      if (t >= seg.end && !loopSeeking.current) {
        loopSeeking.current = true
        const totalReps = seg.repeat ?? 1
        const nextRep   = currentRepRef.current + 1
        if (nextRep >= totalReps) {
          // Terminaron todas las repeticiones
          setLooping(false); setActive(null)
          currentRepRef.current = 0; setCurrentRepDisplay(0)
          setActiveSubOverride(null)
          if (videoRef.current) videoRef.current.playbackRate = 1
          loopSeeking.current = false
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
    setLooping(false); setActive(null)
    currentRepRef.current = 0; setCurrentRepDisplay(0)
    setActiveSubOverride(null)
    if (videoRef.current) videoRef.current.playbackRate = speed
  }
  function markIn()  { setMarkStart(videoRef.current?.currentTime ?? 0); setMarking(true); setNewPhrase('') }
  function markOut() {
    const t = videoRef.current?.currentTime ?? 0
    if (markStart === null || t <= markStart) return
    const sub    = subsEn.find(s => s.start >= markStart && s.end <= t)
    const phrase = newPhrase.trim() || sub?.phrase || `Fragmento ${segments.length + 1}`
    const newSeg = {
      id: Date.now(), start: markStart, end: t, phrase,
      repeat: template.length,
      repConfig: template.map(rc => ({ ...rc })),
      subStyle: subStyle
    }
    const updated = [...segments, newSeg].sort((a, b) => a.start - b.start)
    setSegments(updated); persistSegs(updated)
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
  async function downloadSegment(seg) {
    setDownloading(seg.id)
    try {
      const params = new URLSearchParams({
        start: seg.start, end: seg.end, repeat: seg.repeat ?? 1
      })
      const res = await fetch(`/api/download-segment/${encodeURIComponent(video.name)}?${params}`)
      if (!res.ok) { const d = await res.json(); alert('Error: ' + d.error); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `${seg.phrase}.mp4`; a.click()
      URL.revokeObjectURL(url)
    } catch(e) { alert('Error: ' + e.message) }
    finally { setDownloading(null) }
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

  
  // ── Transcripción ──
  function startTranscribe(lang) {
    const setTrans = lang === 'en' ? setTransEn   : () => {}
    const setMsg   = lang === 'en' ? setTransMsgEn : () => {}
    const setSubs  = lang === 'en' ? setSubsEn    : setSubsEs
    setTrans(true); setMsg('Iniciando...')
    fetch(`/api/transcribe/start/${encodeURIComponent(video.name)}?model=small&lang=${lang}`, { method: 'POST' })
    const poll = setInterval(async () => {
      try {
        const data = await fetch(`/api/transcribe/status/${encodeURIComponent(video.name)}?lang=${lang}`).then(r => r.json())
        if (data.status === 'done')        { clearInterval(poll); setSubs(data.subs); setTrans(false); setMsg(''); flashSaved() }
        else if (data.status === 'error')  { clearInterval(poll); setMsg('Error: ' + data.msg); setTrans(false) }
        else setMsg(data.msg || 'Procesando...')
      } catch { clearInterval(poll); setTrans(false) }
    }, 2000)
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
    setTranslating(true)
    try {
      const data = await fetch(`/api/translate/${encodeURIComponent(video.name)}`, { method: 'POST' }).then(r => r.json())
      if (data.error) { alert('Error: ' + data.error); return }
      setSubsEs(Array.isArray(data) ? data : [])
      flashSaved()
    } finally { setTranslating(false) }
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

  const builtinClass   = `sub-overlay sub-${subStyle}`
  const customStyleObj = null

  return (
    <div className="player-shell">

      {/* ── IZQUIERDA ── */}
      <div className="player-left">
        <div className="player-topbar">
          <button className="back-btn" onClick={onBack}>← Volver</button>
          <span className="player-title">{video.name.replace(/\.[^.]+$/, '')}</span>
          <button className="vcb-btn video-size-btn" title="Cambiar tamaño video"
            onClick={() => setVideoSize(s => (s + 1) % 3)}>
            {VIDEO_SIZE_LABELS[videoSize]}
          </button>
        </div>

        <div className="video-wrap" ref={videoWrap}
          style={{ '--video-max-h': VIDEO_SIZES[videoSize] }}
          onClick={e => {
            setSelectedStickerId(null)
            // solo clic directo sobre el wrap (no sobre stickers ni subs)
            if (e.target === videoWrap.current || e.target === videoRef.current) {
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
          <DraggableSub
            text={showEn ? currentEn : ''}
            baseClass={builtinClass}
            customStyleObj={customStyleObj}
            fontSize={`${subSize}rem`}
            defaultX={50} defaultY={74}
            offset={subOffset} onDrag={setSubOffset}
            onEdit={t => editSubOverlay('en', t)}
            containerRef={videoWrap}
          />
          <DraggableSub
            text={showEs ? currentEs : ''}
            baseClass={`${builtinClass} sub-es`}
            customStyleObj={customStyleObj}
            fontSize={`${subSize}rem`}
            defaultX={50} defaultY={74} fixedOffsetPx={46}
            offset={subOffset} onDrag={setSubOffset}
            onEdit={t => editSubOverlay('es', t)}
            containerRef={videoWrap}
          />
        </div>

        {/* ── Controles de video + barra con banderas ── */}
        <div className="vcb">
          <button className="vcb-btn vcb-play" onClick={togglePlay}>
            {playing ? '⏸' : '▶'}
          </button>
          <span className="vcb-time">{fmtT(videoTime)}</span>
          <SeekBar
            duration={videoDuration}
            currentTime={videoTime}
            segments={segments}
            onSeek={t => { if (videoRef.current) videoRef.current.currentTime = t; stopLoop() }}
            onEndFlag={t => {
              if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.pause() }
              stopLoop()
            }}
            onMoveFlag={moveFlag}
          />
          <span className="vcb-time">{fmtT(videoDuration)}</span>
          <button className="vcb-btn" onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
          <button className="vcb-btn" onClick={() => videoRef.current?.requestFullscreen()}>⛶</button>
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
          <button className={`sub-toggle ${showEn ? 'active' : ''}`} onClick={() => setShowEn(v => !v)}>EN {showEn ? 'ON' : 'OFF'}</button>
          <button className={`sub-toggle ${showEs ? 'active' : ''}`} onClick={() => setShowEs(v => !v)}>ES {showEs ? 'ON' : 'OFF'}</button>
          <div className="style-group">
            {BUILTIN_STYLES.map(st => (
              <button key={st.id} className={`style-btn style-${st.id} ${subStyle === st.id ? 'active' : ''}`} onClick={() => setSubStyle(st.id)}>
                {st.label}
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
            <button className={`mark-btn ${markStart !== null ? 'active' : ''}`} onClick={markIn}>
              {markStart !== null ? `▶ Inicio: ${fmt(markStart)}` : '[ Marcar inicio'}
            </button>
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
              <button className={`auto-btn ${transEn ? 'auto-busy' : ''}`} onClick={() => startTranscribe('en')} disabled={transEn}>
                {transEn ? '⏳' : '✨'} Auto
              </button>
              <button className="srt-btn" onClick={() => srtEnInput.current.click()}>📄 SRT</button>
              <input ref={srtEnInput} type="file" accept=".srt" style={{ display: 'none' }} onChange={e => importSrt(e, 'en')} />
              {subsEn.length > 0 && !transEn && <span className="subs-badge">{subsEn.length} subs</span>}
            </div>
            {transEn && transMsgEn && <div className="trans-status">⏳ {transMsgEn}</div>}
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
          </div>
        </div>
        </div>{/* end player-left-scroll */}
      </div>

      {/* ── DERECHA ── */}
      <div className="player-right">
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
              <div key={seg.id ?? idx} className={`fc ${isActive ? 'fc-active' : ''}`}>

                {/* Header: tiempo + nombre (si colapsado) + toggle */}
                <div className="fc-header">
                  <div className="fc-time">{fmt(seg.start)} → {fmt(seg.end)}</div>
                  {isCollapsed && (
                    <span className="fc-collapsed-name" title={seg.phrase}>{seg.phrase}</span>
                  )}
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
                        <span key={i} className={`fc-dot ${i < currentRepDisplay ? 'fc-dot-done' : i === currentRepDisplay ? 'fc-dot-current' : ''}`} />
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
                        {[0.5, 0.75, 1, 1.25, 1.5].map(v => (
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
                  <button className="fc-dl-btn" disabled={downloading === seg.id} onClick={() => downloadSegment(seg)}>
                    {downloading === seg.id ? '⏳' : '⬇️'} Bajar
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

    </div>
    
  )
}
