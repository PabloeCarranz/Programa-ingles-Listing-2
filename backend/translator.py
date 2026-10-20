"""Traducción de subtítulos EN→ES en lotes.

Por qué existe: traducir frase por frase (una solicitud por subtítulo) hace que Google
corte con "TooManyRequests" y, si el error se ignora, el archivo queda con frases en
inglés. Acá se manda un lote de líneas por solicitud (unas pocas solicitudes por video),
se reintenta con espera creciente y, si no se puede traducir, se avisa con un error en
vez de guardar texto sin traducir.
"""
import copy
import json
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

GTX_URL = 'https://translate.googleapis.com/translate_a/single'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

MAX_CHARS = 3500      # tope de texto por solicitud (Google admite ~5000)
MAX_LINES = 60        # tope de líneas por solicitud
RETRIES   = 5         # intentos por solicitud, con espera 1s, 2s, 4s, 8s…
PAUSE     = 0.3       # pausa cortés entre lotes (segundos)


class TranslationError(Exception):
    pass


class RateLimited(TranslationError):
    pass


class Cancelled(TranslationError):
    pass


# Memoria de traducciones del proceso: si una corrida se corta a la mitad, al reintentar
# solo se piden las frases que faltan (y las frases repetidas se traducen una sola vez).
_memory = {}
_memory_lock = threading.Lock()
_MEMORY_MAX = 50000


def _norm(text):
    return re.sub(r'\s+', ' ', text or '').strip()


# ── Transporte ────────────────────────────────────────────────
def _http_post(text, src, dst, timeout):
    """POST al endpoint gtx. Devuelve el JSON ya decodificado. Se separa para poder probarlo."""
    query = urllib.parse.urlencode({'client': 'gtx', 'sl': src, 'tl': dst, 'dt': 't'})
    body = urllib.parse.urlencode({'q': text}).encode('utf-8')
    req = urllib.request.Request(
        f'{GTX_URL}?{query}', data=body,
        headers={'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _pairs(data):
    """[(traducción, original), …] a partir de la respuesta de Google."""
    out = []
    for ch in (data[0] or []):
        if ch and ch[0] is not None:
            out.append((ch[0], ch[1] or ''))
    return out


def _request(text, src, dst, post, sleep, notify=None, timeout=20, retries=RETRIES, parse=_pairs):
    last = None
    for attempt in range(retries):
        try:
            return parse(post(text, src, dst, timeout))
        except urllib.error.HTTPError as e:
            if e.code in (429, 403, 503):
                last = RateLimited('Google está limitando las solicitudes de traducción (demasiadas en poco tiempo).')
            else:
                last = TranslationError(f'Google respondió con error HTTP {e.code}.')
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = TranslationError(f'No se pudo conectar con el traductor ({getattr(e, "reason", e)}). ¿Hay internet?')
        except (ValueError, IndexError, TypeError):
            last = TranslationError('Respuesta inesperada del traductor.')
        if attempt < retries - 1:
            wait = min(30.0, (2 ** attempt) * (1 + random.random() * 0.3))
            if notify:
                notify(f'Google pidió esperar · reintentando en {int(wait + 0.99)} s (intento {attempt + 2}/{retries})…')
            sleep(wait)
            if notify:
                notify(None)
    raise last


# ── Lotes ─────────────────────────────────────────────────────
def _split_lines(pairs, expected):
    """Reparte los trozos de la respuesta entre las líneas originales.

    Cada línea original termina en '\\n' dentro del texto de origen que devuelve Google
    (una línea con varias oraciones llega en varios trozos). Devuelve None si no encaja
    (por ejemplo si Google unió dos líneas en un mismo trozo)."""
    lines, cur = [], []
    for tr, src in pairs:
        n = src.count('\n')
        if n > 1 or (n == 1 and not src.endswith('\n')):
            return None
        cur.append(tr)
        if n == 1:
            lines.append(_norm(''.join(cur)))
            cur = []
    if cur:
        lines.append(_norm(''.join(cur)))
    if len(lines) != expected or any(not l for l in lines):
        return None
    return lines


def _translate_batch(texts, src, dst, post, sleep, notify=None):
    if len(texts) == 1:
        pairs = _request(texts[0], src, dst, post, sleep, notify)
        return [_norm(''.join(tr for tr, _ in pairs)) or texts[0]]
    pairs = _request('\n'.join(texts), src, dst, post, sleep, notify)
    lines = _split_lines(pairs, len(texts))
    if lines is not None:
        return lines
    # No se pudo repartir con seguridad: se parte el lote a la mitad y se reintenta.
    mid = len(texts) // 2
    return (_translate_batch(texts[:mid], src, dst, post, sleep, notify)
            + _translate_batch(texts[mid:], src, dst, post, sleep, notify))


def _batches(texts):
    batch, chars = [], 0
    for t in texts:
        if batch and (len(batch) >= MAX_LINES or chars + len(t) + 1 > MAX_CHARS):
            yield batch
            batch, chars = [], 0
        batch.append(t)
        chars += len(t) + 1
    if batch:
        yield batch


# ── API pública ───────────────────────────────────────────────
def translate_lines(lines, src='en', dst='es', on_progress=None, on_status=None, cancel=None, _post=None, _sleep=None):
    """Traduce una lista de frases. Devuelve otra lista del mismo largo (las vacías quedan vacías).

    on_progress(hechas, total): se llama después de cada lote.
    on_status(texto | None): avisa cuando hay que esperar a Google (None = se retomó).
    cancel: threading.Event; si se activa se corta con Cancelled.
    Lanza TranslationError/RateLimited si no se pudo traducir algo: nunca devuelve texto sin traducir
    haciéndolo pasar por traducción."""
    post = _post or _http_post

    def sleep(seconds):
        if cancel is not None:
            if cancel.wait(seconds):
                raise Cancelled('Traducción cancelada.')
        else:
            (_sleep or time.sleep)(seconds)

    norm = [_norm(l) for l in lines]
    with _memory_lock:
        pending = []
        seen = set()
        for t in norm:
            if t and t not in seen and (src, dst, t) not in _memory:
                seen.add(t)
                pending.append(t)
    total, done = len(pending), 0
    if on_progress:
        on_progress(0, total)

    for batch in _batches(pending):
        if cancel is not None and cancel.is_set():
            raise Cancelled('Traducción cancelada.')
        result = _translate_batch(batch, src, dst, post, sleep, on_status)
        with _memory_lock:
            if len(_memory) > _MEMORY_MAX:
                _memory.clear()
            for t, r in zip(batch, result):
                _memory[(src, dst, t)] = r
        done += len(batch)
        if on_progress:
            on_progress(done, total)
        if done < total:
            sleep(PAUSE)

    with _memory_lock:
        return [_memory[(src, dst, t)] if t else '' for t in norm]


# ── Una sola palabra (para "Mis palabras") ────────────────────
LOOKUP_RETRIES = 2        # tocar una palabra es interactivo: no se esperan 15 s de reintentos
MAX_WORD_CHARS = 60
MAX_MEANING_GROUPS = 3    # categorías gramaticales que se muestran (sustantivo, verbo…)
MAX_MEANING_WORDS = 6     # significados por categoría
_lookup_memory = {}


def _http_lookup(text, src, dst, timeout):
    """Como _http_post, pero además pide el diccionario (significados por categoría gramatical)."""
    query = urllib.parse.urlencode([('client', 'gtx'), ('sl', src), ('tl', dst), ('hl', dst), ('dt', 't'), ('dt', 'bd')])
    body = urllib.parse.urlencode({'q': text}).encode('utf-8')
    req = urllib.request.Request(
        f'{GTX_URL}?{query}', data=body,
        headers={'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _parse_lookup(data):
    main = _norm(''.join(ch[0] for ch in (data[0] or []) if ch and ch[0]))
    groups = []
    for entry in (data[1] if len(data) > 1 and data[1] else []):
        words = []
        for w in entry[1] or []:
            w = _norm(w)
            if w and w.lower() not in (x.lower() for x in words):
                words.append(w)
        if words:
            groups.append({'pos': _norm(entry[0]), 'words': words[:MAX_MEANING_WORDS]})
    return {'translation': main, 'meanings': groups[:MAX_MEANING_GROUPS]}


def lookup_word(word, src='en', dst='es', _post=None, _sleep=None):
    """Traducción de UNA palabra: {'translation': 'correr', 'meanings': [{'pos': 'verbo', 'words': [...]}, ...]}.

    Lanza TranslationError/RateLimited si no se pudo (nunca devuelve la palabra sin traducir como si fuera
    una traducción). Lo ya consultado queda en memoria."""
    text = _norm(word)
    if not text or len(text) > MAX_WORD_CHARS:
        raise TranslationError('Esa palabra no se puede buscar.')
    key = (src, dst, text)
    with _memory_lock:
        hit = _lookup_memory.get(key)
    if hit is not None:
        return copy.deepcopy(hit)
    result = _request(text, src, dst, _post or _http_lookup, _sleep or time.sleep,
                      retries=LOOKUP_RETRIES, parse=_parse_lookup)
    if not result['translation']:
        raise TranslationError('Google no devolvió una traducción para esa palabra.')
    with _memory_lock:
        if len(_lookup_memory) > _MEMORY_MAX:
            _lookup_memory.clear()
        _lookup_memory[key] = result
    return copy.deepcopy(result)
