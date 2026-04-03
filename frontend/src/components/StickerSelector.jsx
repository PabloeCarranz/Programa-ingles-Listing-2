import { useState, useRef } from 'react'

const BASE = 'https://fonts.gstatic.com/s/e/notoemoji/latest/'

// Solo emojis confirmados con GIF animado en Noto Emoji
const STICKER_CATS = [
  { label: '😂 Caras', items: [
    { e: '😂', u: '1f602' }, { e: '🤣', u: '1f923' }, { e: '😍', u: '1f60d' },
    { e: '🥰', u: '1f970' }, { e: '🤩', u: '1f929' }, { e: '😎', u: '1f60e' },
    { e: '🥳', u: '1f973' }, { e: '😱', u: '1f631' }, { e: '😭', u: '1f62d' },
    { e: '😅', u: '1f605' }, { e: '🤔', u: '1f914' }, { e: '🥺', u: '1f97a' },
    { e: '🤑', u: '1f911' }, { e: '😤', u: '1f624' }, { e: '🤯', u: '1f92f' },
    { e: '🥵', u: '1f975' }, { e: '😴', u: '1f634' }, { e: '🤗', u: '1f917' },
    { e: '🤓', u: '1f913' }, { e: '😈', u: '1f608' }, { e: '🙄', u: '1f644' },
    { e: '😡', u: '1f621' }, { e: '😇', u: '1f607' }, { e: '🥲', u: '1f972' },
  ]},
  { label: '✋ Gestos', items: [
    { e: '👋', u: '1f44b' }, { e: '🤙', u: '1f919' }, { e: '👍', u: '1f44d' },
    { e: '👎', u: '1f44e' }, { e: '👊', u: '1f44a' }, { e: '🤜', u: '1f91c' },
    { e: '🤞', u: '1f91e' }, { e: '🤟', u: '1f91f' }, { e: '🖖', u: '1f596' },
    { e: '💪', u: '1f4aa' }, { e: '🙌', u: '1f64c' }, { e: '👏', u: '1f44f' },
    { e: '🤸', u: '1f938' }, { e: '🙏', u: '1f64f' }, { e: '🤦', u: '1f926' },
    { e: '🤷', u: '1f937' },
  ]},
  { label: '🎉 Celebración', items: [
    { e: '🎉', u: '1f389' }, { e: '🎊', u: '1f38a' }, { e: '🏆', u: '1f3c6' },
    { e: '👑', u: '1f451' }, { e: '💎', u: '1f48e' }, { e: '🌟', u: '1f31f' },
    { e: '⭐', u: '2b50' },  { e: '💯', u: '1f4af' }, { e: '🥇', u: '1f947' },
    { e: '🎖', u: '1f396' }, { e: '🎗', u: '1f397' }, { e: '🎀', u: '1f380' },
  ]},
  { label: '🔥 Energía', items: [
    { e: '🔥', u: '1f525' }, { e: '✨', u: '2728' },  { e: '💥', u: '1f4a5' },
    { e: '⚡', u: '26a1' },  { e: '🌊', u: '1f30a' }, { e: '🌈', u: '1f308' },
    { e: '💫', u: '1f4ab' }, { e: '💨', u: '1f4a8' }, { e: '🌋', u: '1f30b' },
    { e: '🌩', u: '1f329' }, { e: '🌝', u: '1f31d' }, { e: '🌚', u: '1f31a' },
  ]},
  { label: '❤️ Amor', items: [
    { e: '❤️', u: '2764_fe0f' }, { e: '💔', u: '1f494' }, { e: '💘', u: '1f498' },
    { e: '💖', u: '1f496' },     { e: '💝', u: '1f49d' }, { e: '💞', u: '1f49e' },
    { e: '🦋', u: '1f98b' },     { e: '🌺', u: '1f33a' }, { e: '🍀', u: '1f340' },
    { e: '🌸', u: '1f338' },     { e: '🌻', u: '1f33b' }, { e: '🌹', u: '1f339' },
  ]},
  { label: '🐾 Animales', items: [
    { e: '🐸', u: '1f438' }, { e: '🦊', u: '1f98a' }, { e: '🐶', u: '1f436' },
    { e: '🐱', u: '1f431' }, { e: '🦁', u: '1f981' }, { e: '🐯', u: '1f42f' },
    { e: '🦄', u: '1f984' }, { e: '🐼', u: '1f43c' }, { e: '🐻', u: '1f43b' },
    { e: '🐙', u: '1f419' }, { e: '🦈', u: '1f988' }, { e: '🦅', u: '1f985' },
  ]},
  { label: '🚀 Fantasía', items: [
    { e: '🚀', u: '1f680' }, { e: '🔮', u: '1f52e' }, { e: '🌙', u: '1f319' },
    { e: '☀️', u: '2600_fe0f' }, { e: '🌍', u: '1f30d' }, { e: '👾', u: '1f47e' },
    { e: '👽', u: '1f47d' }, { e: '🤖', u: '1f916' }, { e: '🧙', u: '1f9d9' },
    { e: '🧚', u: '1f9da' }, { e: '🧜', u: '1f9dc' }, { e: '🐲', u: '1f432' },
  ]},
  { label: '🎮 Entretenimiento', items: [
    { e: '🎯', u: '1f3af' }, { e: '🎮', u: '1f3ae' }, { e: '🎸', u: '1f3b8' },
    { e: '🎤', u: '1f3a4' }, { e: '🎧', u: '1f3a7' }, { e: '🎬', u: '1f3ac' },
    { e: '🎪', u: '1f3aa' }, { e: '🎭', u: '1f3ad' }, { e: '🎵', u: '1f3b5' },
    { e: '🎶', u: '1f3b6' }, { e: '💣', u: '1f4a3' }, { e: '👀', u: '1f440' },
  ]},
  { label: '💀 Oscuro / Addams', items: [
    { e: '💀', u: '1f480' }, { e: '👻', u: '1f47b' }, { e: '🧛', u: '1f9db' },
    { e: '🧟', u: '1f9df' }, { e: '🦇', u: '1f987' }, { e: '🕷️', u: '1f577_fe0f' },
    { e: '🕸️', u: '1f578_fe0f' }, { e: '⚰️', u: '26b0_fe0f' }, { e: '🪄', u: '1fa84' },
    { e: '🕯️', u: '1f56f_fe0f' }, { e: '🌑', u: '1f311' }, { e: '😈', u: '1f608' },
    { e: '🧌', u: '1f9cc' }, { e: '🧿', u: '1f9ff' }, { e: '☠️', u: '2620_fe0f' },
    { e: '🩸', u: '1fa78' },
  ]},
  { label: '🐉 Dragon Ball / Batalla', items: [
    { e: '🐉', u: '1f409' }, { e: '⚔️', u: '2694_fe0f' }, { e: '🗡️', u: '1f5e1_fe0f' },
    { e: '🏹', u: '1f3f9' }, { e: '🛡️', u: '1f6e1_fe0f' }, { e: '🌀', u: '1f300' },
    { e: '🌪️', u: '1f32a_fe0f' }, { e: '✊', u: '270a' }, { e: '🥊', u: '1f94a' },
    { e: '💢', u: '1f4a2' }, { e: '🔱', u: '1f531' }, { e: '⚡', u: '26a1' },
    { e: '💥', u: '1f4a5' }, { e: '🔥', u: '1f525' }, { e: '🌊', u: '1f30a' },
    { e: '🏆', u: '1f3c6' },
  ]},
  { label: '🌸 Japón / Anime', items: [
    { e: '⛩️', u: '26e9_fe0f' }, { e: '🗻', u: '1f5fb' }, { e: '🏯', u: '1f3ef' },
    { e: '👺', u: '1f47a' }, { e: '👹', u: '1f479' }, { e: '🥷', u: '1f977' },
    { e: '🎎', u: '1f38e' }, { e: '🎐', u: '1f390' }, { e: '🎋', u: '1f38b' },
    { e: '🍣', u: '1f363' }, { e: '🍜', u: '1f35c' }, { e: '🍱', u: '1f371' },
    { e: '🌸', u: '1f338' }, { e: '🎌', u: '1f38c' }, { e: '🀄', u: '1f004' },
    { e: '🐲', u: '1f432' },
  ]},
]

export function StickerSelector({ onSelect }) {
  const [open, setOpen]  = useState(false)
  const [pos, setPos]    = useState({ top: 0, left: 0 })
  const btnRef   = useRef(null)
  const fileRef  = useRef(null)
  const dragging = useRef(false)
  const origin   = useRef(null)

  function handleOpen() {
    if (!open) {
      // Abre en el panel de fragmentos (esquina superior derecha)
      setPos({ top: 70, left: Math.max(0, window.innerWidth - 360) })
    }
    setOpen(o => !o)
  }

  function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    onSelect(URL.createObjectURL(file))
    setOpen(false)
    e.target.value = ''
  }

  function onHeaderPointerDown(e) {
    if (e.target.tagName === 'BUTTON') return
    e.preventDefault()
    dragging.current = true
    origin.current = { mx: e.clientX, my: e.clientY, ox: pos.left, oy: pos.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onHeaderPointerMove(e) {
    if (!dragging.current) return
    setPos({
      left: origin.current.ox + (e.clientX - origin.current.mx),
      top:  origin.current.oy + (e.clientY - origin.current.my),
    })
  }
  function onHeaderPointerUp() { dragging.current = false }

  return (
    <div className="sticker-wrap">
      <button ref={btnRef} className="sticker-open-btn" onClick={handleOpen}>
        🎭 Stickers
      </button>
      {open && (
        <div className="sticker-panel" style={{ top: pos.top, left: pos.left }}>
          <div
            className="sticker-panel-head"
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={onHeaderPointerUp}
          >
            <span className="sticker-panel-title">🎭 Stickers</span>
            <button className="sticker-upload-btn" onClick={() => fileRef.current.click()}>
              📎 Subir GIF/PNG
            </button>
            <input
              ref={fileRef} type="file"
              accept="image/gif,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleUpload}
            />
            <button className="sticker-close-x" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="sticker-panel-body">
            {STICKER_CATS.map(cat => (
              <div key={cat.label}>
                <div className="sticker-cat-label">{cat.label}</div>
                <div className="sticker-grid">
                  {cat.items.map(item => (
                    <img
                      key={item.u}
                      src={`${BASE}${item.u}/512.gif`}
                      title={item.e}
                      className="sticker-item"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                      onClick={() => { onSelect(`${BASE}${item.u}/512.gif`); setOpen(false) }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
