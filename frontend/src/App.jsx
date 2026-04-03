import { useState, useEffect } from 'react'
import VideoList from './components/VideoList'
import Player from './components/Player'
import { THEMES, applyTheme, loadSavedTheme } from './themes/themes'

export default function App() {
  const [video, setVideo] = useState(null)
  const [theme, setTheme] = useState(() => loadSavedTheme())

  function handleTheme(id) {
    applyTheme(id)
    setTheme(id)
  }

  return (
    <div className="app-shell">
      {/* Selector de tema — siempre visible arriba a la derecha */}
      <div className="theme-bar">
        {THEMES.map(t => (
          <button
            key={t.id}
            className={`theme-btn ${theme === t.id ? 'theme-btn-active' : ''}`}
            onClick={() => handleTheme(t.id)}
            title={t.label}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {!video ? (
        <VideoList onSelect={setVideo} />
      ) : (
        <Player video={video} onBack={() => setVideo(null)} />
      )}
    </div>
  )
}
