from fastapi import FastAPI, UploadFile, File, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import json, os, re, threading, shutil, tempfile, subprocess

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
_jobs = {}
_whisper_model = None

def _load_whisper(model_name='small'):
    global _whisper_model
    if _whisper_model is None:
        import whisper
        _whisper_model = whisper.load_model(model_name)
    return _whisper_model

def _run_transcription(video_name, video_path, model_name, lang):
    job_key = f'{video_name}_{lang}'
    _jobs[job_key] = {'status': 'running', 'msg': 'Cargando modelo...', 'subs': []}
    try:
        m = _load_whisper(model_name)
        _jobs[job_key]['msg'] = 'Transcribiendo...'
        result = m.transcribe(video_path, language=lang, task='transcribe',
                              verbose=False, word_timestamps=True,
                              condition_on_previous_text=False)
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
        _jobs[job_key] = {'status': 'done', 'subs': subs, 'msg': ''}
    except Exception as e:
        _jobs[job_key] = {'status': 'error', 'msg': str(e), 'subs': []}

# ── Config ────────────────────────────────────────────────────
VIDEOS_DIR = r'D:\VideosIngles'
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
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

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
    dest = os.path.join(VIDEOS_DIR, file.filename)
    with open(dest, 'wb') as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    return {'ok': True, 'name': file.filename}


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
    if not os.path.exists(video_path):
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


@app.post('/api/translate/{video_name}')
def translate_to_es(video_name: str):
    subs_en = _load_subs(video_name, 'en')
    if not subs_en:
        return {'error': 'Primero generá o importá subtítulos en inglés'}
    try:
        from deep_translator import GoogleTranslator
        translator = GoogleTranslator(source='en', target='es')
        subs_es = []
        for sub in subs_en:
            try:
                translated = translator.translate(sub['phrase']) or sub['phrase']
            except Exception:
                translated = sub['phrase']
            subs_es.append({**sub, 'phrase': translated})
        _save_subs(video_name, 'es', subs_es)
        return subs_es
    except ImportError:
        return {'error': 'Instalá deep-translator: pip install deep-translator'}
    except Exception as e:
        return {'error': str(e)}


@app.post('/api/transcribe/start/{video_name}')
def transcribe_start(video_name: str, model: str = Query('small'), lang: str = Query('en')):
    video_path = os.path.join(VIDEOS_DIR, video_name)
    if not os.path.exists(video_path):
        return {'error': 'Video no encontrado'}
    job_key = f'{video_name}_{lang}'
    if _jobs.get(job_key, {}).get('status') == 'running':
        return {'status': 'running', 'msg': 'Ya transcribiendo...'}
    t = threading.Thread(target=_run_transcription, args=(video_name, video_path, model, lang), daemon=True)
    t.start()
    return {'status': 'started'}


@app.get('/api/transcribe/status/{video_name}')
def transcribe_status(video_name: str, lang: str = Query('en')):
    job_key = f'{video_name}_{lang}'
    return _jobs.get(job_key, {'status': 'idle'})


@app.get('/api/download-segment/{video_name}')
def download_segment(
    video_name: str,
    start:  float = Query(0),
    end:    float = Query(0),
    repeat: int   = Query(1),
    bg: BackgroundTasks = None
):
    video_path = os.path.join(VIDEOS_DIR, video_name)
    if not os.path.exists(video_path):
        return {'error': 'Video no encontrado'}
    repeat = max(1, min(repeat, 30))
    tmp = tempfile.mkdtemp()
    try:
        seg = os.path.join(tmp, 'seg.mp4')
        subprocess.run([
            'ffmpeg', '-y',
            '-ss', str(start), '-to', str(end),
            '-i', video_path,
            '-c', 'copy', seg
        ], capture_output=True, timeout=120, check=True)

        if repeat > 1:
            lst = os.path.join(tmp, 'list.txt')
            with open(lst, 'w') as f:
                for _ in range(repeat):
                    f.write(f"file '{seg}'\n")
            out = os.path.join(tmp, 'out.mp4')
            subprocess.run([
                'ffmpeg', '-y',
                '-f', 'concat', '-safe', '0',
                '-i', lst, '-c', 'copy', out
            ], capture_output=True, timeout=180, check=True)
        else:
            out = seg

        stem  = os.path.splitext(video_name)[0]
        fname = f'{stem}_{int(start)}-{int(end)}x{repeat}.mp4'

        from starlette.background import BackgroundTask
        return FileResponse(out, filename=fname, media_type='video/mp4',
                            background=BackgroundTask(lambda: shutil.rmtree(tmp, ignore_errors=True)))
    except subprocess.CalledProcessError as e:
        shutil.rmtree(tmp, ignore_errors=True)
        return {'error': 'FFmpeg: ' + (e.stderr or b'').decode()[:300]}
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        return {'error': str(e)}


app.mount('/videos', StaticFiles(directory=VIDEOS_DIR), name='videos')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8002)
