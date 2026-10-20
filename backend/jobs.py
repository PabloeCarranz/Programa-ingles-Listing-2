"""Estado de los trabajos largos (transcripción, traducción, exportación de video).

La interfaz consulta el estado cada segundo y dibuja el relojito con:
  progress  0..1 (None = todavía no se sabe → barra animada)
  msg       qué está haciendo ("Transcribiendo audio…")
  detail    dato extra ("3:20 de 16:28", "120 de 304 frases")
  elapsed   segundos desde que empezó
  eta       segundos que faltan (None hasta tener una estimación confiable)
"""
import time


def clock(seconds):
    """75 → '1:15' · 3700 → '1:01:40'"""
    s = max(0, int(seconds))
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


class JobState:
    def __init__(self, msg=''):
        self.status = 'running'          # running | done | error
        self.msg = msg
        self.detail = ''
        self.progress = None
        self.extra = {}                  # resultado (subs, archivo…) que se entrega al terminar
        self.started = time.time()
        self.finished = None
        self._t0 = self.started          # inicio de la fase medible (para estimar lo que falta)
        self._eta_base = None            # (segundos que faltaban, instante) en la última actualización
        self.cancelled = False

    # ── lo llaman los hilos de trabajo ──
    def begin_phase(self, msg=None):
        """Empieza la fase de la que se puede medir el avance (el tiempo restante se calcula desde acá)."""
        self._t0 = time.time()
        self.progress = None
        self._eta_base = None
        if msg is not None:
            self.msg = msg

    def update(self, progress=None, msg=None, detail=None):
        if progress is not None:
            self.progress = max(0.0, min(1.0, float(progress)))
            self._estimate()
        if msg is not None:
            self.msg = msg
        if detail is not None:
            self.detail = detail

    def done(self, **extra):
        self.status = 'done'
        self.progress = 1.0
        self.msg = ''
        self.detail = ''
        self.extra = extra
        self.finished = time.time()

    def fail(self, message):
        self.status = 'error'
        self.msg = message
        self.finished = time.time()

    # ── lo lee la interfaz ──
    def _estimate(self):
        """Recalcula cuánto falta cada vez que cambia el avance (promedio desde que empezó la fase)."""
        now = time.time()
        p, spent = self.progress, now - self._t0
        if not p or p < 0.02 or spent < 1.5:
            return
        self._eta_base = (spent * (1 - p) / p, now)

    def eta(self, now=None):
        """Segundos que faltan. Entre una actualización y otra va bajando (no se queda congelado ni sube)."""
        if self.status != 'running' or self._eta_base is None:
            return None
        base, t = self._eta_base
        return max(0.0, base - ((now or time.time()) - t))

    def snapshot(self):
        now = time.time()
        eta = self.eta(now)
        out = {
            'status': self.status,
            'msg': self.msg,
            'detail': self.detail,
            'progress': self.progress,
            'elapsed': round((self.finished or now) - self.started, 1),
            'eta': None if eta is None else round(eta, 1),
        }
        out.update(self.extra)
        return out


def snap(job):
    """Estado de un trabajo, o 'idle' si no existe."""
    return job.snapshot() if job is not None else {'status': 'idle'}
