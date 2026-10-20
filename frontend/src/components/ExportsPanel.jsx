import { useCallback, useEffect, useState } from 'react'
import { saveFileAs, fmtBytes } from '../lib/saveFile'
import './ExportsPanel.css'

// Lista de videos que ya se exportaron con subtítulos (pantalla inicial)
export default function ExportsPanel({ refreshKey = 0 }) {
  const [data, setData] = useState({ folder: '', files: [] })
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(() => {
    fetch('/api/exports').then(r => r.json()).then(d => setData({ folder: d.folder || '', files: d.files || [] })).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  if (!data.files.length) return null

  const enc = encodeURIComponent
  async function remove(f) {
    if (!window.confirm(`¿Borrar "${f.name}" de la carpeta de exportados?\n\nEl video original no se toca.`)) return
    const res = await fetch(`/api/exports?name=${enc(f.name)}`, { method: 'DELETE' })
    setMsg(res.ok ? '' : 'No se pudo borrar.')
    load()
  }
  const openFolder = () => fetch('/api/exports/open-folder', { method: 'POST' }).catch(() => {})
  const reveal = f => fetch(`/api/exports/reveal?name=${enc(f.name)}`, { method: 'POST' }).catch(() => {})
  const fmtDate = ts => new Date(ts * 1000).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="xp-wrap">
      <button className="xp-toggle" onClick={() => setOpen(o => !o)}>
        <span>💾 Videos exportados con subtítulos ({data.files.length})</span>
        <span className="xp-arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="xp-body">
          <div className="xp-top">
            <code className="xp-folder">{data.folder}</code>
            <button className="xp-btn" onClick={openFolder}>📂 Abrir carpeta</button>
          </div>
          {msg && <div className="xp-err">{msg}</div>}
          {data.files.map(f => (
            <div className="xp-row" key={f.name}>
              <div className="xp-info">
                <div className="xp-name" title={f.name}>{f.name.replace(/\.[^.]+$/, '')}</div>
                <div className="xp-meta">{fmtBytes(f.size)} · {fmtDate(f.mtime)}</div>
              </div>
              <button className="xp-btn" title="Ver" onClick={() => setPlaying(f)}>▶</button>
              <button className="xp-btn" title="Guardar como…" onClick={() => saveFileAs(`/api/exports/download?name=${enc(f.name)}`, f.name)}>💾</button>
              <button className="xp-btn" title="Mostrar en la carpeta" onClick={() => reveal(f)}>📂</button>
              <button className="xp-btn xp-del" title="Borrar" onClick={() => remove(f)}>🗑</button>
            </div>
          ))}
        </div>
      )}
      {playing && (
        <div className="xp-modal" onMouseDown={e => { if (e.target === e.currentTarget) setPlaying(null) }}>
          <div className="xp-player">
            <div className="xp-player-head"><span>{playing.name}</span><button className="xp-btn" onClick={() => setPlaying(null)}>✕</button></div>
            <video src={`/videos/Exportados/${enc(playing.name)}`} controls autoPlay />
          </div>
        </div>
      )}
    </div>
  )
}
