"""Mis palabras: vocabulario guardado desde los subtítulos y repaso espaciado.

Cada palabra guarda su traducción y los "ejemplos" donde se escuchó (video + momento + frase), así el repaso
puede volver a reproducir esa parte del video. El repaso usa cajas (método Leitner): cuanto mejor se la
sabe, más tarde vuelve a aparecer.

Todo vive en un solo archivo, `.vocabulario.json`, dentro de la carpeta de videos. Se guarda de forma atómica
y, si el archivo estuviera dañado, se aparta con otro nombre en vez de pisarlo.
"""
import json
import math
import os
import re
import threading
import time
import uuid

FILE_NAME = '.vocabulario.json'

MAX_WORDS = 20000
MAX_EXAMPLES = 8          # frases distintas por palabra (se conservan las más nuevas)
MAX_WORD = 60
MAX_TRANSLATION = 200
MAX_SENTENCE = 500

DAY = 86400
INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120]     # días hasta el próximo repaso según la caja (la 0 es "nueva u olvidada")
MAX_BOX = len(INTERVALS) - 1
AGAIN_DELAY = 10 * 60                         # lo que no salió vuelve en 10 minutos
HARD_MIN = 60 * 60
GRADES = ('again', 'hard', 'good', 'easy')


class VocabError(ValueError):
    """Dato inválido (el mensaje está en castellano y se le puede mostrar al usuario)."""


# ── Limpieza de datos ─────────────────────────────────────────
def _text(value, limit, what):
    if not isinstance(value, str):
        raise VocabError(f'Falta {what}.')
    value = re.sub(r'\s+', ' ', value).strip()
    if len(value) > limit:
        raise VocabError(f'{what[0].upper() + what[1:]} es demasiado largo (máximo {limit} letras).')
    return value


def norm_word(word):
    """La palabra tal como se guarda: minúsculas, comilla recta y sin signos en los bordes ("Don’t!" → "don't")."""
    w = re.sub(r'\s+', ' ', str(word or '')).replace('’', "'").strip().casefold()
    return re.sub(r"^[^\w]+|[^\w]+$", '', w)


def clean_word(word):
    w = norm_word(_text(word, MAX_WORD * 2, 'la palabra'))
    if not w or not re.search(r'[^\W\d_]', w):
        raise VocabError('Esa palabra no se puede guardar.')
    if len(w) > MAX_WORD:
        raise VocabError('La palabra es demasiado larga.')
    return w


def _number(value, what):
    try:
        x = float(value)
    except (TypeError, ValueError):
        raise VocabError(f'{what} no es válido.')
    if not math.isfinite(x) or x < 0 or x > 24 * 3600 * 2:
        raise VocabError(f'{what} no es válido.')
    return round(x, 2)


def clean_example(ex):
    if not isinstance(ex, dict):
        raise VocabError('Falta la frase del video donde escuchaste la palabra.')
    video = _text(ex.get('video'), 255, 'el nombre del video')
    if not video or video != os.path.basename(video.replace('\\', '/')) or video.startswith('.'):
        raise VocabError('El nombre del video no es válido.')
    start, end = _number(ex.get('start'), 'El inicio de la frase'), _number(ex.get('end'), 'El final de la frase')
    if end <= start:
        raise VocabError('El final de la frase tiene que ser después del inicio.')
    return {
        'video': video, 'start': start, 'end': end,
        'en': _text(ex.get('en') or '', MAX_SENTENCE, 'la frase en inglés'),
        'es': _text(ex.get('es') or '', MAX_SENTENCE, 'la frase en español'),
    }


def clean_translation(value):
    t = _text(value, MAX_TRANSLATION, 'la traducción')
    if not t:
        raise VocabError('Escribí la traducción.')
    return t


def clean_meanings(value):
    out = []
    for g in (value if isinstance(value, list) else [])[:4]:
        if not isinstance(g, dict):
            continue
        words = [re.sub(r'\s+', ' ', w).strip()[:60] for w in (g.get('words') or []) if isinstance(w, str)]
        words = [w for w in words if w][:8]
        if words:
            out.append({'pos': re.sub(r'\s+', ' ', str(g.get('pos') or '')).strip()[:30], 'words': words})
    return out


# ── Repaso espaciado ──────────────────────────────────────────
def next_state(card, grade):
    """(caja nueva, segundos hasta el próximo repaso) según cómo salió."""
    if grade not in GRADES:
        raise VocabError('Esa respuesta no existe.')
    box = min(max(int(card.get('box') or 0), 0), MAX_BOX)
    if grade == 'again':
        return 0, AGAIN_DELAY
    if grade == 'hard':                      # misma caja, pero antes de lo previsto
        return box, max(HARD_MIN, INTERVALS[box] * DAY // 2)
    nb = min(box + (1 if grade == 'good' else 2), MAX_BOX)
    return nb, INTERVALS[nb] * DAY


def previews(card):
    """Segundos que faltarían para volver a ver la tarjeta según cada respuesta (para mostrar en los botones)."""
    return {g: next_state(card, g)[1] for g in GRADES}


def apply_review(card, grade, now):
    box, delay = next_state(card, grade)
    card['box'] = box
    card['due'] = now + delay
    card['reps'] = int(card.get('reps') or 0) + 1
    card['last'] = now
    if grade == 'again':
        card['lapses'] = int(card.get('lapses') or 0) + 1
    return card


# ── Archivo ───────────────────────────────────────────────────
class VocabStore:
    def __init__(self, folder, clock=time.time):
        self.path = os.path.join(folder, FILE_NAME)
        self.clock = clock
        self.lock = threading.RLock()

    # lectura / escritura
    def _load(self):
        if not os.path.exists(self.path):
            return []
        try:
            with open(self.path, encoding='utf-8') as f:
                data = json.load(f)
            if not isinstance(data, list):
                raise ValueError('no es una lista')
            return [c for c in data if isinstance(c, dict) and c.get('id') and c.get('word')]
        except (OSError, ValueError):
            # No se pisa lo que haya: se aparta para poder recuperarlo a mano
            try:
                os.replace(self.path, f'{self.path}.corrupto-{int(self.clock())}')
            except OSError:
                pass
            return []

    def _save(self, cards):
        tmp = f'{self.path}.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(cards, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    @staticmethod
    def _view(card):
        out = dict(card)
        out['preview'] = previews(card)
        return out

    # consultas
    def all(self):
        with self.lock:
            cards = self._load()
        cards.sort(key=lambda c: c.get('added', 0), reverse=True)
        return [self._view(c) for c in cards]

    # cambios
    def add(self, word, translation, example, meanings=None):
        """Guarda la palabra (o suma un ejemplo si ya estaba). Devuelve (tarjeta, creada)."""
        w = clean_word(word)
        ex = clean_example(example)
        tr = clean_translation(translation)
        meanings = clean_meanings(meanings)
        with self.lock:
            cards = self._load()
            card = next((c for c in cards if c['word'] == w), None)
            created = card is None
            if created:
                if len(cards) >= MAX_WORDS:
                    raise VocabError('Llegaste al máximo de palabras guardadas.')
                card = {'id': uuid.uuid4().hex[:12], 'word': w, 'translation': tr, 'meanings': meanings,
                        'examples': [], 'added': self.clock(), 'box': 0, 'due': 0, 'reps': 0, 'lapses': 0, 'last': None}
                cards.append(card)
            key = (ex['video'], ex['start'])
            card['examples'] = [e for e in card['examples'] if (e['video'], e['start']) != key] + [ex]
            card['examples'] = card['examples'][-MAX_EXAMPLES:]
            if not created and meanings and not card.get('meanings'):
                card['meanings'] = meanings
            self._save(cards)
            return self._view(card), created

    def update(self, card_id, translation):
        tr = clean_translation(translation)
        with self.lock:
            cards = self._load()
            card = self._find(cards, card_id)
            card['translation'] = tr
            self._save(cards)
            return self._view(card)

    def remove(self, card_id):
        with self.lock:
            cards = self._load()
            self._find(cards, card_id)
            self._save([c for c in cards if c['id'] != card_id])

    def review(self, card_id, grade):
        with self.lock:
            cards = self._load()
            card = self._find(cards, card_id)
            apply_review(card, grade, self.clock())
            self._save(cards)
            return self._view(card)

    @staticmethod
    def _find(cards, card_id):
        card = next((c for c in cards if c['id'] == card_id), None)
        if card is None:
            raise KeyError(card_id)
        return card
