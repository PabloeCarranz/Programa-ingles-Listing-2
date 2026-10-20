import { useCallback, useEffect, useMemo, useState } from 'react'
import { ThemeDropdown } from './ThemeDropdown'
import VocabReview from './VocabReview'
import { splitByWord, fmtInterval, fmtClock, videoTitle, apiError, OFFLINE } from '../lib/vocab'
import './Vocabulary.css'

export const SESSION_MAX = 20          // tarjetas por tanda de repaso

const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function status(card, now) {
  if (!card.reps) return { kind: 'new', label: 'Nueva' }
  if (card.due <= now) return { kind: 'due', label: 'Para repasar' }
  return { kind: 'later', label: `en ${fmtInterval(card.due - now)}` }
}

// Pantalla "Mis palabras": lista de lo guardado + botón para repasar
export default function Vocabulary({ onBack, theme, onThemeChange }) {
  const [data, setData] = useState({ now: 0, words: [] })
  const [phase, setPhase] = useState('loading')       // loading | ok | error
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)               // palabra desplegada
  const [edit, setEdit] = useState('')                 // traducción que se está escribiendo
  const [askDelete, setAskDelete] = useState(null)
  const [msg, setMsg] = useState('')
  const [session, setSession] = useState(null)         // repaso en curso: { n, cards } (n distinto = tanda nueva)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/vocab')
      if (!r.ok) throw new Error(await apiError(r))
      const j = await r.json()
      if (!Array.isArray(j?.words)) throw new Error('El programa respondió algo inesperado. Cerrá y abrí iniciar.bat.')
      setData(j)
      setPhase('ok')
    } catch (e) {
      setError(e instanceof TypeError ? OFFLINE : e.message)
      setPhase('error')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const due = useMemo(
    () => data.words.filter(c => c.due <= data.now).sort((a, b) => a.due - b.due),
    [data],
  )
  const shown = useMemo(() => {
    const k = plain(q.trim())
    return k ? data.words.filter(c => plain(c.word).includes(k) || plain(c.translation).includes(k)) : data.words
  }, [data, q])

  function startReview(cards) { setMsg(''); setSession(s => ({ n: (s?.n ?? 0) + 1, cards: cards.slice(0, SESSION_MAX) })) }
  function endReview() { setSession(null); load() }
  // "Seguir con las que faltan": se vuelve a pedir la lista (lo repasado ya cambió de fecha) y arranca otra tanda
  async function moreReview() {
    try {
      const r = await fetch('/api/vocab')
      const d = r.ok ? await r.json() : null
      if (!Array.isArray(d?.words)) throw new Error()
      setData(d)
      const next = d.words.filter(c => c.due <= d.now).sort((a, b) => a.due - b.due)
      if (next.length) startReview(next); else setSession(null)
    } catch { setSession(null); load() }
  }

  function toggle(c) {
    setAskDelete(null); setMsg('')
    if (open === c.id) { setOpen(null); return }
    setOpen(c.id); setEdit(c.translation)
  }

  async function saveTranslation(c) {
    setMsg('')
    try {
      const r = await fetch(`/api/vocab/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ translation: edit }) })
      if (!r.ok) throw new Error(await apiError(r))
      const card = await r.json()
      setData(d => ({ ...d, words: d.words.map(w => (w.id === card.id ? card : w)) }))
      setMsg('✓ Traducción guardada')
    } catch (e) { setMsg(e instanceof TypeError ? OFFLINE : e.message) }
  }

  async function remove(c) {
    setMsg('')
    try {
      const r = await fetch(`/api/vocab/${c.id}`, { method: 'DELETE' })
      if (!r.ok && r.status !== 404) throw new Error(await apiError(r))
      setData(d => ({ ...d, words: d.words.filter(w => w.id !== c.id) }))
      setOpen(null); setAskDelete(null)
    } catch (e) { setMsg(e instanceof TypeError ? OFFLINE : e.message) }
  }

  if (session) {
    return <VocabReview key={session.n} cards={session.cards} onExit={endReview} onMore={moreReview} moreCount={Math.max(0, due.length - session.cards.length)} />
  }

  const total = data.words.length
  return (
    <div className="vlist-wrap vb-page">
      <div className="vb-top">
        <button className="back-btn" onClick={onBack}>← Volver</button>
        <ThemeDropdown theme={theme} onChange={onThemeChange} />
      </div>

      <div className="vlist-header vb-header">
        <h1>📚 Mis palabras</h1>
        <p>Las que guardaste mientras mirabas videos</p>
      </div>

      {phase === 'loading' && <div className="vlist-loading">Cargando...</div>}
      {phase === 'error' && <div className="vb-box vb-error">{error}</div>}

      {phase === 'ok' && total === 0 && (
        <div className="vb-box vb-empty">
          <div className="vb-empty-icon">💡</div>
          <p><b>Todavía no guardaste ninguna palabra.</b></p>
          <p>Abrí un video y <b>tocá cualquier palabra del subtítulo en inglés</b>: ves cómo se traduce y la guardás con un clic.
            Después acá la repasás escuchando otra vez la frase del video donde la oíste.</p>
        </div>
      )}

      {phase === 'ok' && total > 0 && (
        <>
          <div className="vb-box vb-review">
            <div className="vb-stats">
              <span><b>{total}</b> {total === 1 ? 'palabra' : 'palabras'}</span>
              <span className={due.length ? 'vb-stat-due' : ''}><b>{due.length}</b> para repasar</span>
            </div>
            {due.length > 0 ? (
              <button className="vb-btn vb-btn-main" onClick={() => startReview(due)}>
                ▶ Repasar ahora{due.length > SESSION_MAX ? ` (${SESSION_MAX} de ${due.length})` : ` (${due.length})`}
              </button>
            ) : (
              <div className="vb-caught">
                <span>🎉 Estás al día. Lo próximo toca en {fmtInterval(Math.max(0, Math.min(...data.words.map(c => c.due)) - data.now))}.</span>
                <button className="vb-btn" onClick={() => startReview([...data.words].sort((a, b) => a.due - b.due))}>Repasar igual</button>
              </div>
            )}
          </div>

          <input className="vb-search" placeholder="🔍 Buscar una palabra o su traducción" value={q} onChange={e => setQ(e.target.value)} />

          <div className="vb-list">
            {shown.length === 0 && <div className="vb-none">Ninguna palabra coincide con «{q}».</div>}
            {shown.map(c => {
              const st = status(c, data.now), isOpen = open === c.id
              return (
                <div className={`vb-row${isOpen ? ' vb-row-open' : ''}`} key={c.id}>
                  <button className="vb-row-main" onClick={() => toggle(c)} aria-expanded={isOpen}>
                    <span className="vb-word">{c.word}</span>
                    <span className="vb-tr">{c.translation}</span>
                    <span className={`vb-tag vb-tag-${st.kind}`}>{st.label}</span>
                    <span className="vb-caret">{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && (
                    <div className="vb-detail">
                      <div className="vb-edit">
                        <input className="vb-input" value={edit} maxLength={200} onChange={e => setEdit(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveTranslation(c) }} aria-label="Traducción" />
                        <button className="vb-btn" disabled={!edit.trim() || edit.trim() === c.translation} onClick={() => saveTranslation(c)}>Guardar</button>
                      </div>
                      {c.meanings?.length > 0 && (
                        <div className="vb-meanings">
                          {c.meanings.map(g => <div key={g.pos}><span className="vb-pos">{g.pos}</span> {g.words.join(', ')}</div>)}
                        </div>
                      )}
                      <div className="vb-exs">
                        {c.examples.map(ex => (
                          <div className="vb-ex" key={`${ex.video}@${ex.start}`}>
                            <div className="vb-ex-src">🎬 {videoTitle(ex.video)} · {fmtClock(ex.start)}</div>
                            <div className="vb-ex-en">
                              {splitByWord(ex.en, c.word).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
                            </div>
                            {ex.es && <div className="vb-ex-es">{ex.es}</div>}
                          </div>
                        ))}
                      </div>
                      <div className="vb-foot">
                        <span className="vb-msg">{msg}</span>
                        {askDelete === c.id ? (
                          <span className="vb-ask">¿Borrar «{c.word}»?
                            <button className="vb-btn vb-btn-danger" onClick={() => remove(c)}>Sí, borrar</button>
                            <button className="vb-btn" onClick={() => setAskDelete(null)}>No</button>
                          </span>
                        ) : (
                          <button className="vb-btn" onClick={() => setAskDelete(c.id)}>🗑 Borrar</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
