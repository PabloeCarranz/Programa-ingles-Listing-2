import { useState } from 'react'
import VideoList from './components/VideoList'
import Player from './components/Player'
import { applyTheme, loadSavedTheme } from './themes/themes'

export default function App() {
  const [video, setVideo] = useState(null)
  const [theme, setTheme] = useState(() => loadSavedTheme())

  function handleTheme(id) {
    applyTheme(id)
    setTheme(id)
  }

  return (
    <div className="app-shell">
      {!video ? (
        <VideoList onSelect={setVideo} theme={theme} onThemeChange={handleTheme} />
      ) : (
        <Player video={video} onBack={() => setVideo(null)} theme={theme} onThemeChange={handleTheme} />
      )}
    </div>
  )
}
