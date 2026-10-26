"""Ajustes del programa que elige la persona (hoy: la carpeta de videos).

Se guardan en `config.json` al lado del programa. Cambiar la carpeta reinicia el backend: todo el resto
(lista de videos, exportados, vocabulario) se arma al arrancar con esa carpeta.
"""
import json
import os
import subprocess
import sys
import threading

from fastapi import HTTPException, Request
from pydantic import BaseModel

from localonly import local_only

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config.json')


def saved_videos_dir():
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            path = json.load(f).get('videos_dir')
    except Exception:
        return None
    return path if isinstance(path, str) and path else None


def _save_videos_dir(path):
    tmp = CONFIG_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'videos_dir': path}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_PATH)


# Ventana de Windows para elegir carpeta. Va en otro proceso: tkinter no se lleva bien con los hilos del servidor.
_PICKER = (
    "import tkinter as tk\n"
    "from tkinter import filedialog\n"
    "r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
    "print(filedialog.askdirectory(title='Elegí la carpeta de videos', initialdir=%r, mustexist=False) or '')\n"
)


class FolderBody(BaseModel):
    path: str


def register(app, ctx):
    videos_dir = ctx['videos_dir']
    default_dir = ctx['default_dir']
    locked = ctx['locked']          # LISTENING_VIDEOS_DIR manda: no se puede cambiar desde la pantalla

    @app.get('/api/folder')
    def folder_get():
        return {'folder': videos_dir, 'default': default_dir, 'locked': locked}

    @app.post('/api/folder/pick')
    def folder_pick(request: Request):
        local_only(request)
        try:
            out = subprocess.run([sys.executable, '-c', _PICKER % videos_dir], capture_output=True, text=True, timeout=600)
        except Exception:
            raise HTTPException(500, 'No se pudo abrir la ventana para elegir carpeta.')
        path = out.stdout.strip().splitlines()[-1].strip() if out.stdout.strip() else ''
        return {'path': os.path.normpath(path) if path else ''}

    @app.post('/api/folder')
    def folder_set(body: FolderBody, request: Request):
        local_only(request)
        if locked:
            raise HTTPException(400, 'La carpeta está fijada por una variable de entorno (LISTENING_VIDEOS_DIR).')
        path = os.path.abspath(body.path.strip().strip('"'))
        if not body.path.strip():
            raise HTTPException(400, 'Elegí una carpeta.')
        try:
            os.makedirs(path, exist_ok=True)
            probe = os.path.join(path, '.listening_write_test')
            with open(probe, 'w') as f:
                f.write('ok')
            os.remove(probe)
        except OSError:
            raise HTTPException(400, 'No se puede guardar en esa carpeta. Probá con otra.')
        if os.path.normcase(path) == os.path.normcase(os.path.abspath(videos_dir)):
            return {'folder': videos_dir, 'restarting': False}
        _save_videos_dir(path)
        threading.Timer(0.6, restart).start()
        return {'folder': path, 'restarting': True}


def restart():
    """Vuelve a arrancar el programa (ya con la carpeta nueva)."""
    os.execv(sys.executable, [sys.executable] + sys.argv)
