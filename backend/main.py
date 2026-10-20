from fastapi import FastAPI, UploadFile, File, Query, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
import json, os, re, threading, shutil, tempfile, subprocess, socket

# ── ffmpeg ────────────────────────────────────────────────────
def _setup_ffmpeg():
    if shutil.which('ffmpeg'):
        return
    try:
        import imageio_ffmpeg
        src = imageio_ffmpeg.get_ffmpeg_exe()
        tmp = os.path.join(tempfile.gettempdir(), 'whisper_ffmpeg')
        os.makedirs(tmp, exist_ok=True)
        dst = os.path.join(tmp, 'ffmpeg.exe')
        if not os.path.exists(dst):
            shutil.copy2(src, dst)
        os.environ['PATH'] = tmp + os.pathsep + os.environ.get('PATH', '')
        print(f'ffmpeg OK: {dst}')
    except Exception as e:
        print(f'ffmpeg error: {e}')

_setup_ffmpeg()

# ── Whisper ───────────────────────────────────────────────────
from jobs import JobState, snap, clock
import transcriber

_jobs = {}
_whisper_model = None
_whisper_model_name = None
_whisper_lock = threading.Lock()

def _use_faster_whisper():
    # LISTENING_WHISPER=openai|faster lo fuerza. Si no: con NVIDIA (torch con CUDA) openai-whisper
    # usa la placa y es lo más rápido; sin NVIDIA, faster-whisper rinde mucho más en el procesador.
    forced = os.environ.get('LISTENING_WHISPER', '').lower()
    if forced in ('openai', 'faster'):
        return forced == 'faster' and transcriber.available()
    if not transcriber.available():
        return False
    try:
        import torch
        return not torch.cuda.is_available()
    except ImportError:
        return True

def _load_whisper(model_name='small'):
    # Un solo modelo en memoria; si piden otro distinto, se reemplaza (antes se ignoraba el nombre)
    global _whisper_model, _whisper_model_name
    faster = _use_faster_whisper()
    key = ('faster' if faster else 'openai', model_name)
    with _whisper_lock:
        if _whisper_model is None or _whisper_model_name != key:
            _whisper_model = None
            if faster:
                _whisper_model = transcriber.load_model(model_name)
            else:
                import whisper
                _whisper_model = whisper.load_model(model_name)
            _whisper_model_name = key
        return faster, _whisper_model

_progress_cb = threading.local()   # cada transcripción corre en su hilo y deja acá su función de avance

def _hook_whisper_progress():
    # Whisper tiene una barra (tqdm) interna que avanza con cada ventana de ~30 s de audio.
    # Se la reemplaza, solo dentro de whisper.transcribe, por una que además avisa el avance.
    import sys, types, whisper  # noqa: F401  (al importar whisper queda registrado su submódulo)
    wt = sys.modules.get('whisper.transcribe')
    if wt is None or getattr(wt, '_listening_hooked', False):
        return
    base = wt.tqdm.tqdm

    class ProgressTqdm(base):
        def update(self, n=1):
            shown = super().update(n)
            cb = getattr(_progress_cb, 'fn', None)
            if cb and self.total:
                cb(self.n, self.total)
            return shown

    wt.tqdm = types.SimpleNamespace(tqdm=ProgressTqdm)
    wt._listening_hooked = True

_transcribe_gate = threading.Lock()   # de a una transcripción por vez (la GPU/CPU no rinde en paralelo)

def _run_transcription(video_name, video_path, model_name, lang, job):
    try:
        if not _transcribe_gate.acquire(blocking=False):
            job.update(msg='En cola: se está transcribiendo otro video…')
            _transcribe_gate.acquire()
        try:
            _transcribe_video(video_name, video_path, model_name, lang, job)
        finally:
            _transcribe_gate.release()
    except Exception as e:
        job.fail(str(e) or e.__class__.__name__)

def _transcribe_video(video_name, video_path, model_name, lang, job):
    try:
        job.update(msg='Cargando el modelo de IA…')
        faster, m = _load_whisper(model_name)
        job.begin_phase('Preparando el audio…')
        if faster:
            def on_seconds(done, total):
                job.update(progress=done / total, msg='Transcribiendo audio…',
                           detail=f'{clock(done)} de {clock(total)}')
            subs = transcriber.transcribe(m, video_path, lang, on_seconds)
            _save_subs(video_name, lang, subs)
            job.done(subs=subs)
            return
        _hook_whisper_progress()

        def on_progress(frames, total_frames):      # 1 cuadro = 10 ms de audio
            job.update(progress=frames / total_frames, msg='Transcribiendo audio…',
                       detail=f'{clock(frames / 100)} de {clock(total_frames / 100)}')
        _progress_cb.fn = on_progress
        try:
            result = m.transcribe(video_path, language=lang, task='transcribe',
                                  verbose=False, word_timestamps=True,
                                  condition_on_previous_text=False)
        finally:
            _progress_cb.fn = None
        subs = []
        for i, seg in enumerate(result['segments']):
            text = seg['text'].strip()
            if not text:
                continue
            words = seg.get('words', [])
            start = words[0]['start']  if words else seg['start']
            end   = words[-1]['end']   if words else seg['end']
            subs.append({'id': i, 'start': round(start, 2), 'end': round(end, 2), 'phrase': text})
        _save_subs(video_name, lang, subs)
        job.done(subs=subs)
    except Exception as e:
        job.fail(str(e) or e.__class__.__name__)

# ── Config ────────────────────────────────────────────────────
# Se pueden cambiar con variables de entorno (útil para probar sin tocar los videos reales)
def _default_videos_dir():
    # La carpeta de siempre si hay disco D:; si no (otra compu), "videos" al lado del programa
    if os.path.isdir('D:\\'):
        return r'D:\VideosIngles'
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'videos')

VIDEOS_DIR = os.environ.get('LISTENING_VIDEOS_DIR') or _default_videos_dir()
PORT       = int(os.environ.get('LISTENING_PORT', '8002'))
SEGS_DIR   = os.path.join(VIDEOS_DIR, '.segments')
SUBS_DIR   = os.path.join(VIDEOS_DIR, '.subtitles')

os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(SEGS_DIR,   exist_ok=True)
os.makedirs(SUBS_DIR,   exist_ok=True)

VIDEO_EXTS = {'.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'}

def _safe(name):
    return re.sub(r'[^\w\-.]', '_', name)

def _load_json(path):
    if os.path.exists(path):
        try:
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []

def _save_json(path, data):
    # Escritura atómica: si el programa se corta a mitad de guardado no queda un JSON a medias
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def _segs_path(name):
    return os.path.join(SEGS_DIR, _safe(name) + '.json')

def _subs_path(name, lang='en'):
    # 'en' mantiene compatibilidad con archivos viejos sin sufijo
    suffix = '' if lang == 'en' else f'_{lang}'
    return os.path.join(SUBS_DIR, _safe(name) + suffix + '.json')

def _load_segs(name):        return _load_json(_segs_path(name))
def _save_segs(name, data):  _save_json(_segs_path(name), data)
def _load_subs(name, lang):  return _load_json(_subs_path(name, lang))
def _save_subs(name, lang, data): _save_json(_subs_path(name, lang), data)

# ── App ───────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

# ── Endpoints ─────────────────────────────────────────────────

@app.get('/api/videos')
def list_videos():
    result = []
    try:
        for fname in sorted(os.listdir(VIDEOS_DIR)):
            if os.path.splitext(fname)[1].lower() in VIDEO_EXTS:
                segs   = _load_segs(fname)
                subs_en = _load_subs(fname, 'en')
                subs_es = _load_subs(fname, 'es')
                result.append({
                    'name': fname,
                    'segments': len(segs),
                    'has_subs_en': len(subs_en) > 0,
                    'has_subs_es': len(subs_es) > 0,
                })
    except Exception as e:
        print(f'list_videos error: {e}')
    return result


@app.post('/api/upload')
async def upload_video(file: UploadFile = File(...)):
    name = os.path.basename((file.filename or '').replace(chr(92), '/'))      # nunca una ruta: solo el nombre del archivo
    if os.path.splitext(name)[1].lower() not in VIDEO_EXTS:
        return {'error': 'Formato no admitido. Usá .mp4, .mkv, .avi, .mov, .webm o .m4v'}
    dest = os.path.join(VIDEOS_DIR, name)
    with open(dest, 'wb') as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    return {'ok': True, 'name': name}


@app.get('/api/segments/{video_name}')
def get_segments(video_name: str):
    return _load_segs(video_name)


class SegmentsBody(BaseModel):
    segments: list

@app.post('/api/segments/{video_name}')
def save_segments(video_name: str, body: SegmentsBody):
    _save_segs(video_name, body.segments)
    return {'ok': True}


@app.get('/api/subtitles/{video_name}')
def get_subtitles(video_name: str, lang: str = Query('en')):
    return _load_subs(video_name, lang)

class SubsBody(BaseModel):
    subs: list

@app.post('/api/subtitles/{video_name}')
def save_subtitles(video_name: str, body: SubsBody, lang: str = Query('en')):
    _save_subs(video_name, lang, body.subs)
    return {'ok': True}


@app.post('/api/parse-srt/{video_name}')
async def parse_srt(video_name: str, file: UploadFile = File(...), lang: str = Query('en')):
    content = await file.read()
    text = content.decode('utf-8', errors='replace')
    subs = _parse_srt(text)
    _save_subs(video_name, lang, subs)
    return subs


def _parse_srt(text):
    result = []
    for block in re.split(r'\n\n+', text.strip()):
        lines = block.strip().splitlines()
        ts_line = next((l for l in lines if '-->' in l), None)
        if not ts_line:
            continue
        m = re.match(r'(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)', ts_line)
        if not m:
            continue
        h1,m1,s1,ms1,h2,m2,s2,ms2 = [int(x) for x in m.groups()]
        start  = h1*3600 + m1*60 + s1 + ms1/1000
        end    = h2*3600 + m2*60 + s2 + ms2/1000
        idx    = lines.index(ts_line)
        phrase = re.sub(r'<[^>]+>', '', ' '.join(lines[idx+1:])).strip()
        if phrase:
            result.append({'id': len(result), 'start': start, 'end': end, 'phrase': phrase})
    return result


def _subs_to_srt(subs):
    def ts(s):
        h, r = divmod(s, 3600)
        m, r = divmod(r, 60)
        return f'{int(h):02d}:{int(m):02d}:{int(r):02d},{int((r%1)*1000):03d}'
    lines = []
    for i, s in enumerate(subs):
        lines += [str(i+1), f"{ts(s['start'])} --> {ts(s['end'])}", s['phrase'], '']
    return '\n'.join(lines)


@app.post('/api/autosync/{video_name}')
def autosync_subs(video_name: str, lang: str = Query('en')):
    subs = _load_subs(video_name, lang)
    if not subs:
        return {'error': 'No hay subtítulos para sincronizar. Generá o importá primero.'}
    video_path = os.path.join(VIDEOS_DIR, video_name)
    if os.path.basename(video_name) != video_name or not os.path.exists(video_path):
        return {'error': 'Video no encontrado'}
    import tempfile, subprocess
    srt_in  = os.path.join(tempfile.gettempdir(), f'sub_in_{lang}.srt')
    srt_out = os.path.join(tempfile.gettempdir(), f'sub_out_{lang}.srt')
    try:
        with open(srt_in, 'w', encoding='utf-8') as f:
            f.write(_subs_to_srt(subs))
        import sys
        scripts_dir = os.path.join(os.path.dirname(sys.executable), 'Scripts')
        ffs = os.path.join(scripts_dir, 'ffs.exe')
        if not os.path.exists(ffs):
            ffs = os.path.join(scripts_dir, 'ffs')
        result = subprocess.run(
            [ffs, video_path, '-i', srt_in, '-o', srt_out],
            capture_output=True, text=True, timeout=180
        )
        if result.returncode != 0:
            return {'error': 'ffsubsync error: ' + (result.stderr or result.stdout)[:300]}
        with open(srt_out, encoding='utf-8') as f:
            synced = _parse_srt(f.read())
        # Preservar frases originales (ffsubsync solo cambia tiempos)
        for i, s in enumerate(synced):
            if i < len(subs):
                s['phrase'] = subs[i]['phrase']
        _save_subs(video_name, lang, synced)
        return synced
    except subprocess.TimeoutExpired:
        return {'error': 'Timeout — video muy largo, intentá con un clip más corto'}
    except Exception as e:
        return {'error': str(e)}
    finally:
        for p in [srt_in, srt_out]:
            try: os.unlink(p)
            except: pass


# ── Traducción EN → ES ────────────────────────────────────────
# Se traduce por lotes (ver translator.py). Si algo no se puede traducir se avisa con un
# error y NO se guarda nada: antes se guardaba el texto en inglés como si fuera español.
_tjobs = {}

def _translate_subs(video_name, on_progress=None, on_status=None):
    import translator
    subs_en = _load_subs(video_name, 'en')
    if not subs_en:
        raise translator.TranslationError('Primero generá o importá subtítulos en inglés')
    translated = translator.translate_lines([s['phrase'] for s in subs_en],
                                            on_progress=on_progress, on_status=on_status)
    subs_es = [{**sub, 'phrase': t} for sub, t in zip(subs_en, translated)]
    _save_subs(video_name, 'es', subs_es)
    return subs_es

def _run_translation(video_name, job):
    def progress(done, total):
        job.update(progress=(done / total) if total else 1.0, msg='Traduciendo…',
                   detail=f'{done} de {total} frases' if total else '')
    def status(msg):       # None = se retomó después de esperar a Google
        job.update(msg=msg or 'Traduciendo…')
    try:
        job.begin_phase('Preparando la traducción…')
        subs_es = _translate_subs(video_name, progress, status)
        job.done(subs=subs_es)
    except Exception as e:
        job.fail(str(e) or e.__class__.__name__)


@app.post('/api/translate/start/{video_name}')
def translate_start(video_name: str):
    if not _load_subs(video_name, 'en'):
        return {'error': 'Primero generá o importá subtítulos en inglés'}
    current = _tjobs.get(video_name)
    if current and current.status == 'running':
        return {'status': 'running', 'msg': 'Ya traduciendo…'}
    job = _tjobs[video_name] = JobState('Iniciando…')
    threading.Thread(target=_run_translation, args=(video_name, job), daemon=True).start()
    return {'status': 'started'}


@app.get('/api/translate/status/{video_name}')
def translate_status(video_name: str):
    return snap(_tjobs.get(video_name))


@app.post('/api/translate/{video_name}')
def translate_to_es(video_name: str):
    # Versión que espera hasta terminar (se conserva por compatibilidad; la interfaz usa /start + /status)
    try:
        return _translate_subs(video_name)
    except Exception as e:
        return {'error': str(e) or e.__class__.__name__}


@app.post('/api/transcribe/start/{video_name}')
def transcribe_start(video_name: str, model: str = Query('small'), lang: str = Query('en'), force: bool = Query(False)):
    video_path = os.path.join(VIDEOS_DIR, video_name)
    if os.path.basename(video_name) != video_name or not os.path.exists(video_path):
        return {'error': 'Video no encontrado'}
    job_key = f'{video_name}_{lang}'
    current = _jobs.get(job_key)
    if current and current.status == 'running':
        return {'status': 'running', 'msg': 'Ya transcribiendo...'}
    # Si ya hay subtítulos no se vuelve a transcribir (pisaría las ediciones hechas a mano).
    # Para regenerarlos hay que borrarlos primero (o pasar force=true).
    if not force and _load_subs(video_name, lang):
        return {'status': 'exists', 'msg': 'Este video ya tiene subtítulos generados. Borralos primero si querés generarlos de nuevo.'}
    job = _jobs[job_key] = JobState('Iniciando…')
    t = threading.Thread(target=_run_transcription, args=(video_name, video_path, model, lang, job), daemon=True)
    t.start()
    return {'status': 'started'}


@app.get('/api/transcribe/status/{video_name}')
def transcribe_status(video_name: str, lang: str = Query('en')):
    job_key = f'{video_name}_{lang}'
    return snap(_jobs.get(job_key))


# (La descarga de fragmentos ahora es /api/export/segment: corte exacto, con vueltas, velocidades y subtítulos)


# ── WebSocket: control remoto ─────────────────────────────

class _WSManager:
    def __init__(self):
        self._clients: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self._clients:
            self._clients.remove(ws)

    async def broadcast(self, data: str, sender: WebSocket = None):
        dead = []
        for c in self._clients:
            if c is sender:
                continue
            try:
                await c.send_text(data)
            except Exception:
                dead.append(c)
        for c in dead:
            self.disconnect(c)

_ws_manager = _WSManager()


@app.websocket('/ws')
async def ws_endpoint(websocket: WebSocket):
    await _ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await _ws_manager.broadcast(data, sender=websocket)
    except WebSocketDisconnect:
        _ws_manager.disconnect(websocket)


def _local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return 'localhost'


@app.get('/api/server-info')
def server_info():
    return {'ip': _local_ip(), 'port': PORT}


@app.get('/remote', response_class=HTMLResponse)
def remote_page():
    _dir = os.path.dirname(os.path.abspath(__file__))
    html_path = os.path.join(_dir, 'remote.html')
    with open(html_path, encoding='utf-8') as f:
        return f.read()


# ── Exportar videos con subtítulos (ver export_routes.py y subexport.py) ──
import export_routes
EXPORTS_DIR = export_routes.register(app, dict(videos_dir=VIDEOS_DIR, video_exts=VIDEO_EXTS, load_subs=_load_subs))

import download_routes     # traer videos de YouTube (yt-dlp)
download_routes.register(app, dict(videos_dir=VIDEOS_DIR))
import vocab_routes        # Mis palabras: vocabulario guardado + repaso
vocab_routes.register(app, dict(videos_dir=VIDEOS_DIR))

app.mount('/videos', StaticFiles(directory=VIDEOS_DIR), name='videos')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=PORT)
