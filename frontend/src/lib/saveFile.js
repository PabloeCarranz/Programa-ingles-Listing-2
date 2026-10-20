// Guardar un archivo del programa en la PC.
// En Chrome/Edge abre el cuadro "Guardar como…" y escribe el archivo directamente (sin cargarlo entero en memoria);
// en otros navegadores hace una descarga normal.
export async function saveFileAs(url, suggestedName) {
  if (window.showSaveFilePicker) {
    try {
      const ext = (suggestedName.match(/\.[^.]+$/) || ['.mp4'])[0].toLowerCase()
      const mime = ext === '.mkv' ? 'video/x-matroska' : ext === '.srt' ? 'application/x-subrip' : 'video/mp4'
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: ext === '.srt' ? 'Subtítulos' : 'Video', accept: { [mime]: [ext] } }],
      })
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error('descarga')
      const out = await handle.createWritable()
      await res.body.pipeTo(out)
      return 'saved'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'     // el usuario cerró el cuadro
      // cualquier otro problema: se cae a la descarga normal
    }
  }
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  a.remove()
  return 'downloaded'
}

export function fmtBytes(n) {
  if (n == null) return ''
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export async function errorText(res) {
  try {
    const d = await res.json()
    // Ruta que no existe = el programa (backend) todavía es una versión anterior
    if (res.status === 404 && d.detail === 'Not Found') return 'Falta reiniciar el programa (iniciar.bat) para activar esta función.'
    return typeof d.detail === 'string' ? d.detail : d.error || `Error ${res.status}`
  } catch {
    return `Error ${res.status}`
  }
}
