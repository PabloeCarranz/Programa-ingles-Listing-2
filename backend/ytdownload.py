"""Traer videos de YouTube a la carpeta de videos (con yt-dlp).

El video se baja a una carpeta temporal (.descargas/<trabajo>) y recién cuando está completo y unido
(imagen + audio) se mueve a la carpeta de videos: así la lista nunca muestra un archivo a medias.
"""
import json
import os
import re
import shutil
import unicodedata
import urllib.parse
import uuid

MAX_HEIGHT = 1080                 # no se baja más que 1080p (pesa mucho más y no ayuda a practicar)
MAX_SECONDS = 4 * 3600            # videos más largos que esto se rechazan (ocupan demasiado disco)
TMP_DIRNAME = '.descargas'
INDEX_NAME = '.youtube_ids.json'  # id de YouTube -> archivo ya traído (para no bajarlo dos veces)
VIDEO_EXTS = {'.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'}
YT_HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
            'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'}
FORMAT = (f'bv*[height<={MAX_HEIGHT}][vcodec^=avc1]+ba[acodec^=mp4a]'     # H.264 + AAC: se ve en cualquier navegador
          f'/bv*[height<={MAX_HEIGHT}]+ba/b[height<={MAX_HEIGHT}]/b')
WIN_RESERVED = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}


class DownloadError(Exception):
    pass


class Cancelled(DownloadError):
    pass


# ══════════════════════════════════════════════════════════════
#  Link → id del video
# ══════════════════════════════════════════════════════════════
def _video_id(parsed):
    host = (parsed.hostname or '').lower()
    if host.endswith('youtu.be'):
        vid = parsed.path.strip('/').split('/')[0]
    else:
        v = urllib.parse.parse_qs(parsed.query).get('v')
        if v:
            vid = v[0]
        else:
            m = re.match(r'^/(?:shorts|live|embed|v)/([A-Za-z0-9_-]+)', parsed.path)
            vid = m.group(1) if m else ''
    return vid if re.fullmatch(r'[A-Za-z0-9_-]{11}', vid or '') else None


def clean_url(text):
    """Texto pegado → (link limpio del video, id). Acepta que venga con texto alrededor o sin 'https://'."""
    t = (text or '').strip()
    m = re.search(r'https?://[^\s<>"\']+', t, re.I)
    if m:
        t = m.group(0)
    elif re.match(r'^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)/', t, re.I):
        t = 'https://' + t.split()[0]
    else:
        raise DownloadError('Pegá un link de YouTube (por ejemplo https://www.youtube.com/watch?v=…).')
    parsed = urllib.parse.urlparse(t)
    if (parsed.hostname or '').lower() not in YT_HOSTS:
        raise DownloadError('Por ahora solo se pueden traer videos de YouTube.')
    vid = _video_id(parsed)
    if not vid:
        if 'list=' in parsed.query or parsed.path.startswith('/playlist'):
            raise DownloadError('Ese link es una lista de reproducción. Abrí un video y copiá su link.')
        raise DownloadError('Ese link no parece ser de un video de YouTube.')
    return f'https://www.youtube.com/watch?v={vid}', vid


# ══════════════════════════════════════════════════════════════
#  Nombres de archivo
# ══════════════════════════════════════════════════════════════
def safe_title(title, vid=''):
    """Título del video → nombre de archivo cómodo para Windows y para el link (sin emojis ni # % ? : …)."""
    t = unicodedata.normalize('NFC', title or '')
    t = ''.join(ch if (ch.isalnum() or ch in " -_.()[]',!&’") else ' ' for ch in t)
    t = re.sub(r'\s+', ' ', t).strip(' .')[:100].strip(' .')
    if not t:
        t = f'YouTube {vid}'.strip()
    if t.upper() in WIN_RESERVED:
        t += ' video'
    return t


def unique_name(folder, base, ext):
    name, n = base + ext, 2
    while os.path.exists(os.path.join(folder, name)):
        name = f'{base} ({n}){ext}'
        n += 1
    return name


# ══════════════════════════════════════════════════════════════
#  Registro de lo ya traído
# ══════════════════════════════════════════════════════════════
def _index_path(videos_dir):
    return os.path.join(videos_dir, INDEX_NAME)


def _load_index(videos_dir):
    try:
        with open(_index_path(videos_dir), encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:       # noqa: BLE001
        return {}


def known_file(videos_dir, vid):
    """Nombre del archivo si ese video ya fue traído y sigue en la carpeta; si no, None."""
    name = _load_index(videos_dir).get(vid)
    return name if name and os.path.isfile(os.path.join(videos_dir, name)) else None


def remember(videos_dir, vid, name):
    idx = _load_index(videos_dir)
    idx[vid] = name
    tmp = _index_path(videos_dir) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(idx, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _index_path(videos_dir))


# ══════════════════════════════════════════════════════════════
#  Mensajes de error entendibles
# ══════════════════════════════════════════════════════════════
_ANSI = re.compile(r'\x1b\[[0-9;]*m')


def friendly_error(err):
    raw = _ANSI.sub('', str(err) or err.__class__.__name__).strip()
    low = raw.lower()
    rules = (
        (('private video',), 'El video es privado.'),
        (('video unavailable', 'this video is not available', 'has been removed', 'no longer available'),
         'El video no está disponible (lo borraron o está bloqueado en tu país).'),
        (('confirm your age', 'age-restricted', 'age restricted'),      # antes que "robot": los dos empiezan con "Sign in to confirm"
         'El video tiene restricción de edad y YouTube pide iniciar sesión.'),
        (('not a bot', 'sign in to confirm'),
         'YouTube pidió comprobar que no sos un robot. Probá de nuevo en un rato o actualizá yt-dlp (pip install -U yt-dlp).'),
        (('http error 429', 'too many requests'), 'YouTube está limitando las solicitudes. Esperá unos minutos y reintentá.'),
        (('members-only', 'members only', 'join this channel'), 'El video es solo para miembros del canal.'),
        (('premieres in', 'live event will begin'), 'El video todavía no se estrenó.'),
        (('getaddrinfo failed', 'unable to download webpage', 'urlopen error', 'timed out', 'connection reset', 'network is unreachable'),
         'No se pudo conectar con YouTube. ¿Hay internet?'),
        (('ffmpeg', 'ffprobe'), 'No se pudo unir el audio con la imagen: falta ffmpeg o no anda.'),
        (('no space left', 'disk full'), 'No hay espacio en el disco.'),
    )
    for needles, msg in rules:
        if any(n in low for n in needles):
            return msg
    raw = re.sub(r'^ERROR:\s*(\[[^\]]+\]\s*[\w-]*:?\s*)?', '', raw).splitlines()[0][:200]
    return f'No se pudo traer el video: {raw}'


def _mb(n):
    return f'{n / 1_048_576:.0f} MB' if n >= 10 * 1_048_576 else f'{n / 1_048_576:.1f} MB'


# ══════════════════════════════════════════════════════════════
#  La descarga
# ══════════════════════════════════════════════════════════════
def download_video(job, cancel, url, vid, videos_dir, ydl_cls=None, node_path=None):
    """Baja `url` a `videos_dir`. `job` es un jobs.JobState (progreso), `cancel` un threading.Event.
    Devuelve {'file', 'title', 'size'}. `ydl_cls` solo se cambia en las pruebas."""
    if ydl_cls is None:
        try:
            import yt_dlp
        except ImportError:
            raise DownloadError('Falta instalar yt-dlp. Abrí una consola y escribí: pip install yt-dlp')
        ydl_cls = yt_dlp.YoutubeDL

    tmp_dir = os.path.join(videos_dir, TMP_DIRNAME, uuid.uuid4().hex[:8])
    os.makedirs(tmp_dir, exist_ok=True)
    got, frac, sizes = {}, {}, {}
    expected = [0]
    n_streams = [1]

    def check_cancel():
        if cancel.is_set():
            raise Cancelled('Descarga cancelada.')

    def progress(d):
        check_cancel()
        fn = d.get('filename') or d.get('tmpfilename') or ''
        if d.get('status') not in ('downloading', 'finished'):
            return
        done = d.get('downloaded_bytes') or d.get('total_bytes') or 0
        stream_total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
        got[fn] = done
        sizes[fn] = max(sizes.get(fn, 0), stream_total)
        frac[fn] = 1.0 if d.get('status') == 'finished' else (min(1.0, done / stream_total) if stream_total else 0.0)
        if expected[0]:
            p, total = sum(got.values()) / expected[0], expected[0]
        else:
            p, total = sum(frac.values()) / max(1, n_streams[0]), sum(sizes.values())
        detail = f'{_mb(sum(got.values()))} de {_mb(max(total, sum(got.values())))}' if total else ''
        if d.get('speed'):
            detail += f' · {_mb(d["speed"])}/s'
        job.update(progress=min(0.97, p), msg='Descargando…', detail=detail)

    def post_progress(d):
        check_cancel()
        if d.get('status') == 'started':
            job.update(progress=0.98, msg='Uniendo imagen y audio…', detail='')

    opts = {
        'format': FORMAT, 'merge_output_format': 'mp4', 'noplaylist': True,
        'outtmpl': os.path.join(tmp_dir, 'video.%(ext)s'), 'windowsfilenames': True,
        'quiet': True, 'no_warnings': True, 'noprogress': True,
        'socket_timeout': 30, 'retries': 5, 'fragment_retries': 5, 'concurrent_fragment_downloads': 4,
        'progress_hooks': [progress], 'postprocessor_hooks': [post_progress],
    }
    if node_path:
        opts['js_runtimes'] = {'node': {'path': node_path}}
    elif shutil.which('node'):
        opts['js_runtimes'] = {'node': {}}

    try:
        job.update(msg='Consultando el video…')
        with ydl_cls(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info or info.get('_type') == 'playlist':
                raise DownloadError('Ese link es una lista de reproducción. Abrí un video y copiá su link.')
            if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming'):
                raise DownloadError('Es una transmisión en vivo: esperá a que termine para traerla.')
            if (info.get('duration') or 0) > MAX_SECONDS:
                raise DownloadError(f'El video dura más de {MAX_SECONDS // 3600} horas: es demasiado largo para traerlo.')
            title = safe_title(info.get('title'), vid)
            streams = info.get('requested_formats') or [info]
            n_streams[0] = len(streams)
            sizes_known = [s.get('filesize') or s.get('filesize_approx') or 0 for s in streams]
            expected[0] = sum(sizes_known) if all(sizes_known) else 0
            job.extra.update(title=title, duration=info.get('duration'))
            check_cancel()
            job.begin_phase('Descargando…')
            ydl.process_ie_result(info, download=True)      # baja lo ya consultado (no vuelve a pedir los datos)
        check_cancel()

        files = [os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir)
                 if os.path.splitext(f)[1].lower() in VIDEO_EXTS and os.path.isfile(os.path.join(tmp_dir, f))]
        if not files:
            raise DownloadError('YouTube no entregó el archivo del video. Probá de nuevo.')
        src = max(files, key=os.path.getsize)
        name = unique_name(videos_dir, title, os.path.splitext(src)[1].lower())
        os.replace(src, os.path.join(videos_dir, name))
        remember(videos_dir, vid, name)
        return {'file': name, 'title': title, 'size': os.path.getsize(os.path.join(videos_dir, name))}
    except Cancelled:
        raise
    except DownloadError:
        raise
    except Exception as e:      # noqa: BLE001
        if cancel.is_set():
            raise Cancelled('Descarga cancelada.')
        raise DownloadError(friendly_error(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        try:
            os.rmdir(os.path.join(videos_dir, TMP_DIRNAME))      # solo si quedó vacía
        except OSError:
            pass
