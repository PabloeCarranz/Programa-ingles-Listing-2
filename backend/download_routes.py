"""Rutas de la API para traer videos de YouTube a la carpeta de videos.

Se registran desde main.py con `register(app, ctx)`; ctx trae la carpeta de videos.
"""
import os
import shutil
import threading
import uuid

from fastapi import HTTPException, Request
from pydantic import BaseModel

import ytdownload
from jobs import JobState, snap
from localonly import local_only

MAX_PARALLEL = 2           # descargas a la vez (las demás esperan turno)


class StartBody(BaseModel):
    url: str


def register(app, ctx):
    videos_dir = ctx['videos_dir']
    jobs = {}                                  # id -> {'job', 'cancel', 'vid', 'url'}
    gate = threading.BoundedSemaphore(MAX_PARALLEL)
    # Lo que quedó a medias de una vez anterior (se cerró el programa bajando) no sirve para nada
    shutil.rmtree(os.path.join(videos_dir, ytdownload.TMP_DIRNAME), ignore_errors=True)

    def prune():
        done = [k for k, v in jobs.items() if v['job'].status != 'running']
        for k in sorted(done, key=lambda k: jobs[k]['job'].started)[:-10]:
            jobs.pop(k, None)

    @app.post('/api/download/start')
    def download_start(body: StartBody, request: Request):
        local_only(request)
        try:
            url, vid = ytdownload.clean_url(body.url)
        except ytdownload.DownloadError as e:
            raise HTTPException(400, str(e))
        # ¿ya se está bajando?
        for jid, e in jobs.items():
            if e['vid'] == vid and e['job'].status == 'running':
                return {'job': jid, 'already': True}
        # ¿ya lo tenías?
        have = ytdownload.known_file(videos_dir, vid)
        if have:
            return {'exists': have}

        jid = uuid.uuid4().hex[:12]
        running = sum(1 for e in jobs.values() if e['job'].status == 'running')
        job = JobState('Esperando turno…' if running >= MAX_PARALLEL else 'Preparando…')
        entry = jobs[jid] = {'job': job, 'cancel': threading.Event(), 'vid': vid, 'url': url}

        def work():
            try:
                with gate:
                    if entry['cancel'].is_set():
                        raise ytdownload.Cancelled('Descarga cancelada.')
                    res = ytdownload.download_video(job, entry['cancel'], url, vid, videos_dir)
                job.done(**res)
            except ytdownload.Cancelled as e:
                job.fail(str(e))
                job.extra['cancelled'] = True
            except Exception as e:      # noqa: BLE001
                job.fail(str(e) or e.__class__.__name__)

        prune()
        threading.Thread(target=work, daemon=True).start()
        return {'job': jid}

    @app.get('/api/download/status/{job_id}')
    def download_status(job_id: str):
        entry = jobs.get(job_id)
        return snap(entry['job'] if entry else None)

    @app.post('/api/download/cancel/{job_id}')
    def download_cancel(job_id: str, request: Request):
        local_only(request)
        entry = jobs.get(job_id)
        if entry:
            entry['cancel'].set()
        return {'ok': bool(entry)}

    @app.get('/api/download/active')
    def download_active():
        """Descargas en curso (para que la pantalla las muestre de nuevo si se recarga la página)."""
        return [{'job': k, 'url': v['url'], **snap(v['job'])} for k, v in jobs.items() if v['job'].status == 'running']
