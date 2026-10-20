import { useState } from 'react'
import VideoList from './components/VideoList'
import Player from './components/Player'
import Vocabulary from './components/Vocabulary'
import { applyTheme, loadSavedTheme } from './themes/themes'

export default function App() {
  const [video, setVideo] = useState(null)
  const [screen, setScreen] = useState(null)      // 'vocab' → pantalla de Mis palabras (si no hay un video abierto)
  const [theme, setTheme] = useState(() => loadSavedTheme())

  function handleTheme(id) {
    applyTheme(id)
    setTheme(id)
  }

  return (
    <div className="app-shell">
      {!video && screen === 'vocab' ? (
        <Vocabulary onBack={() => setScreen(null)} theme={theme} onThemeChange={handleTheme} />
      ) : !video ? (
        <VideoList onSelect={setVideo} onVocab={() => setScreen('vocab')} theme={theme} onThemeChange={handleTheme} />
      ) : (
        <Player video={video} onBack={() => setVideo(null)} theme={theme} onThemeChange={handleTheme} />
      )}
    </div>
  )
}
