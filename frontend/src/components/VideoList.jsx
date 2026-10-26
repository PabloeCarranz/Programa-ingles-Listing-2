import { useEffect, useState, useRef } from 'react'
import { ThemeDropdown } from './ThemeDropdown'
import escobaImg from '../themes/escoba.png'
import ExportsPanel from './ExportsPanel'
import VideoLink from './VideoLink'
import FolderPicker from './FolderPicker'
import VocabEntry from './VocabEntry'

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']

export default function VideoList({ onSelect, onVocab, theme, onThemeChange }) {
  const [videos,     setVideos]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [dragging,   setDragging]   = useState(false)
  const [uploads,    setUploads]    = useState([])
  const [escobaAnim, setEscobaAnim] = useState('idle')

  function handleEscobaClick() {
    if (escobaAnim !== 'idle') return
    setEscobaAnim('flyaway')
    setTimeout(() => setEscobaAnim('return'), 900)
    setTimeout(() => setEscobaAnim('idle'),  1700)
  }
  const fileInput = useRef(null)

  function loadVideos() {
    setLoading(true)
    fetch('/api/videos')
      .then(r => r.json())
      .then(data => { setVideos(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { loadVideos() }, [])

  function uploadFile(file) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!VIDEO_EXTS.includes(ext)) return

    setUploads(u => [...u, { name: file.name, pct: 0 }])

    const form = new FormData()
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return
      const pct = Math.round(e.loaded / e.total * 100)
      setUploads(u => u.map(x => x.name === file.name ? { ...x, pct } : x))
    }
    xhr.onload = () => {
      setUploads(u => u.filter(x => x.name !== file.name))
      loadVideos()
    }
    xhr.onerror = () => setUploads(u => u.filter(x => x.name !== file.name))
    xhr.open('POST', 'http://localhost:8002/api/upload')
    xhr.send(form)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    Array.from(e.dataTransfer.files).forEach(uploadFile)
  }

  return (
    <div className="vlist-wrap">
      <div className="vlist-header">
        {theme === 'harry' && (
          <img
            src={escobaImg}
            className={`escoba-deco escoba-${escobaAnim}`}
            onClick={handleEscobaClick}
            alt=""
          />
        )}
        <h1>🎧 Listening</h1>
        <p>Seleccioná un video para practicar</p>
        <div className="vlist-theme-row">
          <ThemeDropdown theme={theme} onChange={onThemeChange} />
        </div>
      </div>

      {/* Palabras guardadas de los subtítulos y su repaso */}
      {onVocab && <VocabEntry onOpen={onVocab} />}

      {/* Carpeta donde se guardan los videos (se puede cambiar) */}
      <FolderPicker />

      {/* Traer un video de YouTube pegando el link */}
      <VideoLink onDone={loadVideos} onOpen={onSelect} />

      {/* Drop zone */}
      <div
        className={`drop-zone ${dragging ? 'drop-active' : ''}`}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileInput.current.click()}
      >
        <div className="drop-icon">🎬</div>
        <div className="drop-text">Arrastrá un video acá · o hacé clic para elegir</div>
        <div className="drop-hint">.mp4 · .mkv · .avi · .mov</div>
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => { Array.from(e.target.files).forEach(uploadFile); e.target.value = '' }}
        />
      </div>

      {/* Uploads en progreso */}
      {uploads.map(u => (
        <div key={u.name} className="upload-row">
          <span className="upload-name">{u.name}</span>
          <div className="upload-bar-bg">
            <div className="upload-bar-fill" style={{ width: `${u.pct}%` }} />
          </div>
          <span className="upload-pct">{u.pct}%</span>
        </div>
      ))}

      {loading && <div className="vlist-loading">Cargando...</div>}

      <div className="vlist-grid">
        {videos.map(v => (
          <div className="vcard" key={v.name} onClick={() => onSelect(v)}>
            <div className="vcard-icon">🎬</div>
            <div className="vcard-info">
              <div className="vcard-name">{v.name.replace(/\.[^.]+$/, '')}</div>
              <div className="vcard-meta">
                {v.segments > 0 ? `${v.segments} fragmentos guardados` : 'Sin fragmentos aún'}
                {v.has_subs_en ? ' · 🇺🇸 EN ✓' : ''}
                {v.has_subs_es ? ' · 🇪🇸 ES ✓' : ''}
              </div>
            </div>
            <div className="vcard-arrow">›</div>
          </div>
        ))}
      </div>

      <ExportsPanel />

      {!loading && videos.length === 0 && uploads.length === 0 && (
        <div className="vlist-empty">
          No hay videos todavía.<br />
          Arrastrá un .mp4 o .mkv en la zona de arriba.
        </div>
      )}
    </div>
  )
}
