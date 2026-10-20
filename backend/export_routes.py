"""Rutas de la API para guardar videos con subtítulos (exportar).

Se registran desde main.py con `register(app, ctx)`; ctx trae las carpetas y las funciones de
subtítulos de main.py para no importar main desde acá.
"""
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid

from fastapi import HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

import subexport
from jobs import JobState, snap

EXPORT_DIRNAME = 'Exportados'
EXPORT_EXTS = {'.mp4', '.mkv'}


class ExportOpts(BaseModel):
    video: str
    style: str = 'default'
    en: bool = True
    es: bool = False
    size_rem: float = 1.1                 # tamaño de letra del reproductor (rem)
    ref_h: float = 400                    # alto del video en el reproductor (px): para escalar igual
    offset: dict = Field(default_factory=lambda: {'x': 0, 'y': 0})   # posición arrastrada (% del video)
    shift: float = 0                      # delay de los subtítulos (s)
    quality: str = 'media'                # alta | media | liviana
    mode: str = 'hard'                    # hard (grabados) | soft (pistas)


class PreviewBody(ExportOpts):
    t: float = 0


class SegmentBody(ExportOpts):
    start: float
    end: float
    phrase: str = ''
    reps: list = Field(default_factory=list)   # [{speed, en, es}]
    subs: bool = True


def register(app, ctx):
    videos_dir = ctx['videos_dir']
    exports_dir = os.path.join(videos_dir, EXPORT_DIRNAME)
    video_exts = ctx['video_exts']
    load_subs = ctx['load_subs']
    jobs = {}                      # id -> {'job', 'cancel', 'video', 'kind'}
    gate = threading.Lock()        # una exportación a la vez

    # ── utilidades ──
    def local_only(request: Request):
        host = request.client.host if request.client else ''
        if host not in ('127.0.0.1', '::1', 'localhost'):
            raise HTTPException(403, 'Esta acción solo se puede hacer desde la computadora donde corre el programa.')

    def video_path(name):
        if not name or os.path.basename(name) != name or os.path.splitext(name)[1].lower() not in video_exts:
            raise HTTPException(400, 'Nombre de video inválido.')
        p = os.path.join(videos_dir, name)
        if not os.path.isfile(p):
            raise HTTPException(404, 'Video no encontrado.')
        return p

    def export_file(name):
        if not name or os.path.basename(name) != name or os.path.splitext(name)[1].lower() not in EXPORT_EXTS:
            raise HTTPException(400, 'Nombre de archivo inválido.')
        p = os.path.join(exports_dir, name)
        if not os.path.isfile(p):
            raise HTTPException(404, 'Archivo no encontrado.')
        return p

    def opts_of(b):
        return dict(style=b.style, en=b.en, es=b.es, size_rem=b.size_rem, ref_h=b.ref_h,
                    offset=b.offset, shift=b.shift, quality=b.quality)

    def disposition(filename):
        ascii_name = filename.encode('ascii', 'replace').decode('ascii').replace('"', '_').replace('?', '_')
        return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{urllib.parse.quote(filename)}'

    def prune():
        done = [k for k, v in jobs.items() if v['job'].status != 'running']
        for k in sorted(done, key=lambda k: jobs[k]['job'].started)[:-15]:
            jobs.pop(k, None)

    def launch(kind, video, fn):
        jid = uuid.uuid4().hex[:12]
        job = JobState('Esperando turno…' if gate.locked() else 'Preparando…')
        entry = jobs[jid] = {'job': job, 'cancel': threading.Event(), 'video': video, 'kind': kind}

        def work():
            try:
                with gate:
                    if entry['cancel'].is_set():
                        raise subexport.Cancelled('Exportación cancelada.')
                    job.begin_phase('Grabando los subtítulos en el video…' if kind != 'soft' else 'Agregando las pistas de subtítulos…')
                    path = fn(job, entry['cancel'])
                job.done(file=os.path.basename(path), size=os.path.getsize(path))
            except subexport.Cancelled as e:
                job.fail(str(e))
                job.extra['cancelled'] = True
            except Exception as e:      # noqa: BLE001
                job.fail(str(e) or e.__class__.__name__)

        prune()
        threading.Thread(target=work, daemon=True).start()
        return {'job': jid}

    # ── vista previa ──
    @app.post('/api/export/preview')
    def export_preview(body: PreviewBody):
        path = video_path(body.video)
        try:
            jpg = subexport.render_preview(path, body.t, load_subs(body.video, 'en'), load_subs(body.video, 'es'), opts_of(body))
        except subexport.ExportError as e:
            raise HTTPException(400, str(e))
        return Response(jpg, media_type='image/jpeg', headers={'Cache-Control': 'no-store'})

    # ── video completo ──
    @app.post('/api/export/start')
    def export_start(body: ExportOpts):
        path = video_path(body.video)
        en, es = load_subs(body.video, 'en'), load_subs(body.video, 'es')
        if not ((body.en and en) or (body.es and es)):
            raise HTTPException(400, 'No hay subtítulos en los idiomas elegidos.')
        opts = opts_of(body)
        fn = subexport.export_soft if body.mode == 'soft' else subexport.export_video
        return launch('soft' if body.mode == 'soft' else 'video', body.video,
                      lambda job, cancel: fn(path, exports_dir, body.video, en, es, opts, job, cancel))

    # ── fragmento con sus vueltas ──
    @app.post('/api/export/segment')
    def export_segment(body: SegmentBody):
        path = video_path(body.video)
        en, es = load_subs(body.video, 'en'), load_subs(body.video, 'es')
        opts = opts_of(body)
        opts['subs'] = body.subs
        reps = [{'speed': float(r.get('speed') or 1), 'en': bool(r.get('en')), 'es': bool(r.get('es'))} for r in body.reps] \
            or [{'speed': 1, 'en': body.en, 'es': body.es}]
        return launch('segment', body.video,
                      lambda job, cancel: subexport.export_segment(path, exports_dir, body.video, body.phrase, body.start,
                                                                   body.end, reps, en, es, opts, job, cancel))

    @app.get('/api/export/status/{job_id}')
    def export_status(job_id: str):
        entry = jobs.get(job_id)
        return snap(entry['job'] if entry else None)

    @app.post('/api/export/cancel/{job_id}')
    def export_cancel(job_id: str):
        entry = jobs.get(job_id)
        if entry:
            entry['cancel'].set()
        return {'ok': bool(entry)}

    # ── archivos exportados ──
    @app.get('/api/exports')
    def exports_list():
        out = []
        if os.path.isdir(exports_dir):
            for f in os.listdir(exports_dir):
                p = os.path.join(exports_dir, f)
                if os.path.isfile(p) and os.path.splitext(f)[1].lower() in EXPORT_EXTS:
                    st = os.stat(p)
                    out.append({'name': f, 'size': st.st_size, 'mtime': st.st_mtime})
        return {'folder': exports_dir, 'files': sorted(out, key=lambda x: -x['mtime'])}

    @app.get('/api/exports/download')
    def exports_download(name: str = Query(...)):
        p = export_file(name)
        return FileResponse(p, filename=name, media_type='video/mp4' if name.lower().endswith('.mp4') else 'video/x-matroska')

    @app.delete('/api/exports')
    def exports_delete(request: Request, name: str = Query(...)):
        local_only(request)
        os.remove(export_file(name))
        return {'ok': True}

    @app.post('/api/exports/open-folder')
    def exports_open_folder(request: Request):
        local_only(request)
        os.makedirs(exports_dir, exist_ok=True)
        try:
            if sys.platform.startswith('win'):
                os.startfile(exports_dir)       # noqa: S606
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', exports_dir])
            else:
                subprocess.Popen(['xdg-open', exports_dir])
        except Exception as e:                  # noqa: BLE001
            raise HTTPException(500, f'No se pudo abrir la carpeta: {e}')
        return {'ok': True, 'folder': exports_dir}

    @app.post('/api/exports/reveal')
    def exports_reveal(request: Request, name: str = Query(...)):
        """Abre el Explorador con el archivo seleccionado (solo Windows; en otros sistemas abre la carpeta)."""
        local_only(request)
        p = export_file(name)
        if sys.platform.startswith('win'):
            subprocess.Popen(['explorer', '/select,', os.path.normpath(p)])
        else:
            return exports_open_folder(request)
        return {'ok': True}

    # ── subtítulos como archivo .srt ──
    @app.get('/api/subtitles/{video_name}/srt')
    def subtitles_srt(video_name: str, lang: str = Query('en'), shift: float = Query(0)):
        subs = load_subs(video_name, lang)
        if not subs:
            raise HTTPException(404, 'No hay subtítulos en ese idioma.')
        stem = os.path.splitext(os.path.basename(video_name))[0]
        fname = f'{stem}.{lang}.srt'
        return Response(subexport.srt_text(subs, shift).encode('utf-8-sig'), media_type='application/x-subrip',
                        headers={'Content-Disposition': disposition(fname)})

    return exports_dir
