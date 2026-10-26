import { useEffect, useState } from 'react'
import { errorText } from '../lib/saveFile'
import './VideoLink.css'

// Muestra la carpeta donde viven los videos y deja cambiarla. Al cambiarla el programa se reinicia solo.
export default function FolderPicker() {
  const [info, setInfo] = useState(null)       // { folder, default, locked }
  const [busy, setBusy] = useState('')         // '' | 'pick' | 'restart'
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/folder').then(r => r.json()).then(setInfo).catch(() => {})
  }, [])

  async function change() {
    setBusy('pick'); setError('')
    try {
      const pick = await fetch('/api/folder/pick', { method: 'POST' })
      if (!pick.ok) { setError(await errorText(pick)); setBusy(''); return }
      const { path } = await pick.json()
      if (!path) { setBusy(''); return }                      // cerró la ventana sin elegir
      if (!window.confirm(`¿Usar esta carpeta para los videos?\n\n${path}\n\nEl programa se reinicia (tarda unos segundos). Los videos de la carpeta anterior no se mueven.`)) { setBusy(''); return }
      const res = await fetch('/api/folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
      })
      if (!res.ok) { setError(await errorText(res)); setBusy(''); return }
      const d = await res.json()
      if (!d.restarting) { setBusy(''); return }
      setBusy('restart')
      // Esperar a que el programa vuelva con la carpeta nueva y recargar
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 1000))
        try {
          const cur = await fetch('/api/folder').then(r => r.json())
          if (cur.folder && cur.folder !== info?.folder) { window.location.reload(); return }
        } catch { /* todavía reiniciando */ }
      }
      setError('El programa tarda en volver. Cerrá y abrí iniciar.bat.')
      setBusy('')
    } catch {
      setError('No se pudo contactar con el programa.')
      setBusy('')
    }
  }

  if (!info) return null
  return (
    <div className="vl-box">
      <div className="vl-title">📁 Carpeta de videos</div>
      <div className="vl-form">
        <code className="vl-input" style={{ wordBreak: 'break-all' }}>{info.folder}</code>
        {!info.locked && (
          <button type="button" className="vl-btn vl-btn-main" onClick={change} disabled={!!busy}>
            {busy === 'pick' ? 'Elegí en la ventana…' : busy === 'restart' ? 'Reiniciando…' : 'Cambiar carpeta'}
          </button>
        )}
      </div>
      {error && <div className="vl-error" role="alert">⚠ {error}</div>}
      <div className="vl-hint">Acá se guardan los videos, los subtítulos, lo que exportás y tus palabras.</div>
    </div>
  )
}
