import { useEffect, useState } from 'react'
import './Vocabulary.css'

// Entrada a "Mis palabras" desde la pantalla de inicio: cuántas hay guardadas y cuántas toca repasar
export default function VocabEntry({ onOpen }) {
  const [info, setInfo] = useState(null)      // { total, due }

  useEffect(() => {
    let alive = true
    fetch('/api/vocab')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && Array.isArray(d?.words)) setInfo({ total: d.words.length, due: d.words.filter(c => c.due <= d.now).length }) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const hint = info == null ? 'Guardá palabras de los subtítulos y repasalas'
    : info.total === 0 ? 'Tocá una palabra del subtítulo mientras mirás un video para guardarla'
    : `${info.total} ${info.total === 1 ? 'guardada' : 'guardadas'} · ${info.due ? `${info.due} para repasar hoy` : 'estás al día 🎉'}`

  return (
    <button className="vb-entry" onClick={onOpen}>
      <span className="vb-entry-icon">📚</span>
      <span className="vb-entry-text"><b>Mis palabras</b><small>{hint}</small></span>
      {info?.due > 0 && <span className="vb-entry-badge" title="Para repasar">{info.due}</span>}
      <span className="vb-entry-arrow">›</span>
    </button>
  )
}
