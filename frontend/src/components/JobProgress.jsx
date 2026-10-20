import './JobProgress.css'

// 75 → "1 min 15 s" · 8 → "8 s" · 3700 → "1 h 1 min"
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`
  if (m > 0) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
  return `${s} s`
}

// 75 → "1:15"
export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const R = 19
const CIRC = 2 * Math.PI * R

// Relojito + barra + porcentaje + tiempo que falta.
// job = { progress: 0..1 | null, msg, detail, elapsed, eta }  (lo que devuelve el backend)
export default function JobProgress({ job, label = 'Progreso' }) {
  const p = job?.progress
  const known = typeof p === 'number'
  const pct = known ? Math.round(Math.min(1, Math.max(0, p)) * 100) : null
  const eta = job?.eta
  const etaText = !known ? 'preparando…'
    : eta != null ? (eta < 4 ? 'faltan unos segundos' : `faltan ~${fmtDuration(eta)}`)
    : 'calculando…'

  return (
    <div className="jp" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
      <svg className="jp-clock" viewBox="0 0 44 44" aria-hidden="true">
        <circle className="jp-face" cx="22" cy="22" r={R} />
        {known && (
          <circle className="jp-arc" cx="22" cy="22" r={R} transform="rotate(-90 22 22)"
            strokeDasharray={`${(CIRC * pct) / 100} ${CIRC}`} />
        )}
        {[0, 90, 180, 270].map(a => (
          <line key={a} className="jp-tick" x1="22" y1="4.5" x2="22" y2="7" transform={`rotate(${a} 22 22)`} />
        ))}
        <g className={known ? 'jp-hand' : 'jp-hand jp-hand-spin'} style={known ? { transform: `rotate(${(pct / 100) * 360}deg)` } : undefined}>
          <line x1="22" y1="22" x2="22" y2="9.5" />
        </g>
        <circle className="jp-pin" cx="22" cy="22" r="2.2" />
      </svg>

      <div className="jp-body">
        <div className="jp-top">
          <span className="jp-pct">{known ? `${pct}%` : '…'}</span>
          <span className="jp-eta">⏱ {etaText}</span>
        </div>
        <div className={`jp-bar${known ? '' : ' jp-bar-wait'}`}>
          <div className="jp-fill" style={known ? { width: `${pct}%` } : undefined} />
        </div>
        <div className="jp-msg">
          {job?.msg || label}
          {job?.detail ? <span className="jp-detail"> · {job.detail}</span> : null}
          {job?.elapsed != null ? <span className="jp-detail"> · llevás {fmtClock(job.elapsed)}</span> : null}
        </div>
      </div>
    </div>
  )
}
