// ── Registro de temas ──────────────────────────────────────────
// Para agregar un tema nuevo:
//   1. Crear src/themes/mi_tema.css
//   2. Importarlo acá abajo
//   3. Agregar una entrada al array THEMES

import './harry.css'
// import './futuro_tema.css'   ← así de fácil agregar más

export const THEMES = [
  { id: 'classic', label: 'Clásico',      icon: '🌑' },
  { id: 'harry',   label: 'Harry Potter', icon: '⚡' },
  // { id: 'futuro', label: 'Mi Tema', icon: '🚀' },
]

export function applyTheme(id) {
  document.documentElement.dataset.theme = id === 'classic' ? '' : id
  localStorage.setItem('app_theme', id)
}

export function loadSavedTheme() {
  const saved = localStorage.getItem('app_theme') ?? 'classic'
  applyTheme(saved)
  return saved
}
