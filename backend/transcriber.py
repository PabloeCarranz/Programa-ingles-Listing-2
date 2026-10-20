"""Subtítulos automáticos con faster-whisper (el mismo modelo de Whisper, más rápido en CPU).

Por qué existe: openai-whisper solo acelera con placas NVIDIA; en una compu sin NVIDIA (por
ejemplo con una Radeon) transcribe con el procesador y es lento. faster-whisper usa el mismo
modelo cuantizado a int8 y en CPU tarda bastante menos (~1.7x en las pruebas), con la misma
calidad y mejor puntuación.

Además corta las frases donde hay una pausa larga: Whisper a veces junta en un solo segmento
varias frases separadas por silencios, y el subtítulo queda largo y en pantalla de más.
"""
import os
import subprocess

SAMPLE_RATE = 16000
PAUSE_SPLIT = 1.0     # segundos de silencio entre dos palabras a partir de los cuales se corta la frase


def available():
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def load_model(model_name):
    from faster_whisper import WhisperModel
    return WhisperModel(model_name, device='cpu', compute_type='int8', cpu_threads=os.cpu_count() or 4)


def load_audio(path):
    """Audio mono a 16 kHz como float32, decodificado con ffmpeg (igual que openai-whisper).
    No se usa el decodificador propio de faster-whisper (PyAV) porque falla con versiones nuevas."""
    import numpy as np
    cmd = ['ffmpeg', '-nostdin', '-threads', '0', '-i', path,
           '-f', 's16le', '-ac', '1', '-acodec', 'pcm_s16le', '-ar', str(SAMPLE_RATE), '-']
    try:
        out = subprocess.run(cmd, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError as e:
        raise RuntimeError('No se pudo leer el audio del video: ' + (e.stderr or b'').decode(errors='replace')[-300:])
    return np.frombuffer(out, np.int16).astype(np.float32) / 32768.0


def split_on_pauses(words, gap=PAUSE_SPLIT):
    """Parte una lista de palabras [{'start', 'end', 'word'}] en grupos donde hay un silencio > gap."""
    groups, cur = [], []
    for w in words:
        if cur and w['start'] - cur[-1]['end'] > gap:
            groups.append(cur)
            cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    return groups


def segments_to_subs(segments):
    """segments: [{'start', 'end', 'text', 'words': [...]}] → subtítulos de la app [{'id', 'start', 'end', 'phrase'}]."""
    subs = []

    def add(start, end, text):
        text = text.strip()
        if text:
            # float(): faster-whisper devuelve tiempos de numpy
            subs.append({'id': len(subs), 'start': round(float(start), 2), 'end': round(float(end), 2), 'phrase': text})

    for seg in segments:
        words = seg.get('words') or []
        if not words:
            add(seg['start'], seg['end'], seg['text'])
            continue
        for group in split_on_pauses(words):
            add(group[0]['start'], group[-1]['end'], ''.join(w['word'] for w in group))
    return subs


def transcribe(model, path, lang, on_progress=None):
    """Transcribe `path` y devuelve los subtítulos. on_progress(segundos_hechos, segundos_totales)."""
    audio = load_audio(path)
    total = len(audio) / SAMPLE_RATE
    segments, _ = model.transcribe(audio, language=lang, task='transcribe',
                                   word_timestamps=True, condition_on_previous_text=False)
    raw = []
    for s in segments:                     # es un generador: transcribe a medida que se recorre
        raw.append({'start': s.start, 'end': s.end, 'text': s.text,
                    'words': [{'start': w.start, 'end': w.end, 'word': w.word} for w in (s.words or [])]})
        if on_progress and total:
            on_progress(min(s.end, total), total)
    return segments_to_subs(raw)
