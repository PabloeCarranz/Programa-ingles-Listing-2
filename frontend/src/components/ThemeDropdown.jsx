import { useState } from 'react'
import { THEMES } from '../themes/themes'

export function ThemeDropdown({ theme, onChange }) {
  const [open, setOpen] = useState(false)
  const current = THEMES.find(t => t.id === theme) ?? THEMES[0]

  return (
    <div className="theme-dropdown" tabIndex={-1} onBlur={e => {
      // cerrar solo si el foco sale completamente del componente
      if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
    }}>
      <button className="theme-dd-btn" onClick={() => setOpen(o => !o)}>
        {current.icon} {current.label} <span className="theme-dd-arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="theme-dd-menu">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-dd-item ${t.id === theme ? 'theme-dd-active' : ''}`}
              onMouseDown={() => { onChange(t.id); setOpen(false) }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
