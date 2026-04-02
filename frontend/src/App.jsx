import { useState } from 'react'
import VideoList from './components/VideoList'
import Player from './components/Player'

export default function App() {
  const [video, setVideo] = useState(null)

  return (
    <div className="app-shell">
      {!video ? (
        <VideoList onSelect={setVideo} />
      ) : (
        <Player video={video} onBack={() => setVideo(null)} />
      )}
    </div>
  )
}
