"""Exportar el video con los subtítulos puestos en la imagen (o como pistas) y exportar fragmentos.

Los subtítulos se dibujan con libass (filtro `ass` de ffmpeg) a partir de un archivo ASS que se
genera acá copiando el aspecto de los estilos del reproductor (.sub-<estilo> de App.css) y la
misma lógica de acomodo: el bloque va centrado, sin salirse del video, con el inglés arriba y el
español abajo, baja de renglón y achica la letra si no entra.
"""
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS_DIR = os.path.join(HERE, 'fonts')
WIN_FONTS = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')

MARGIN = 8           # px de aire contra los bordes del video (a escala del reproductor)
MAX_BLOCK_H = 0.4    # el bloque de subtítulos no ocupa más de esta fracción de la altura
MIN_FIT = 0.25       # lo máximo que se achica la letra para que entre
BORDER_MIN_ALPHA = 0.84   # el borde de la caja solo se dibuja si el fondo es (casi) opaco
STACK_GAP = 6            # px entre el bloque del inglés y el del español (igual que el reproductor)
APP_LINE_H = 1.25        # line-height de los subtítulos en el reproductor (SubtitleStack.css)


class ExportError(Exception):
    pass


class Cancelled(ExportError):
    pass


# ══════════════════════════════════════════════════════════════
#  Estilos: copian .sub-<id> de App.css (medidas en px del reproductor)
# ══════════════════════════════════════════════════════════════
# font/bold: tipografía · color: texto · bg: (color, opacidad) de la caja · pad: relleno (x, y)
# border: (color, grosor) del borde de la caja · box_shadow: (color, desplazamiento) de la caja
# outline: (color, grosor) del contorno del texto · tshadow: (color, desplazamiento) de la sombra del texto
# glow: (color, radio, opacidad) del brillo · sp: separación entre letras · upper: mayúsculas · mul: tamaño relativo
STYLES = {
    'default':   dict(font='Segoe UI', bold=True, color='#ffffff', bg=('#000000', .82)),
    'comic':     dict(font='Bangers', color='#1a0000', bg=('#fff200', 1), border=('#000000', 3),
                      box_shadow=('#000000', 3), tshadow=('#ff0000', 2), sp=1),
    'gothic':    dict(font='Cinzel', bold=True, color='#d4af37', bg=('#0a0014', .88), border=('#d4af37', 2),
                      glow=('#d4af37', 8, .67), sp=2),
    'console':   dict(font='Share Tech Mono', color='#00ff41', bg=('#001400', .92), border=('#00ff41', 1),
                      glow=('#00ff41', 6, .8), sp=1),
    'neon':      dict(font='Bangers', color='#ffffff', bg=('#000000', .65), glow=('#ff00cc', 10, .9), sp=1),
    'neonblue':  dict(font='Bangers', color='#00eeff', bg=('#000000', .65), glow=('#00eeff', 10, .9), sp=1),
    'fire':      dict(font='Impact', color='#ffaa00', bg=('#000000', .75), glow=('#ff4400', 8, .8),
                      tshadow=('#000000', 2), sp=1),
    'ice':       dict(font='Cinzel', bold=True, color='#c8f0ff', bg=('#001e46', .88), border=('#60c8ff', 1.5),
                      glow=('#60c8ff', 8, .8), sp=2),
    'gold':      dict(font='Cinzel', bold=True, color='#ffd700', bg=('#0a0500', .88), border=('#ffd700', 2),
                      glow=('#ffd700', 8, .67), tshadow=('#000000', 1), sp=2),
    'bubblegum': dict(font='Bangers', color='#ffffff', bg=('#dc0078', .85), border=('#ffffff', 3),
                      tshadow=('#880044', 2), sp=1),
    'cinema':    dict(font='Georgia', color='#f5f0e0', bg=('#000000', .92), sp=3, upper=True, mul=.9),
    'shadow':    dict(font='Segoe UI', bold=True, color='#ffffff', outline=('#000000', 2),
                      glow=('#000000', 10, .9)),
    'outline':   dict(font='Segoe UI', bold=True, color='#ffffff', outline=('#000000', 1.5), mul=1.05),
}
# Cambios del español respecto al inglés (.sub-es.sub-<id>)
ES_OVERRIDES = {
    'default':   dict(color='#bde0ff', bg=('#00003c', .82)),
    'comic':     dict(color='#00007a', bg=('#b0f0ff', 1), border=('#0000ff', 3), tshadow=('#0000ff', 2)),
    'gothic':    dict(color='#89d0ff', border=('#89d0ff', 2), glow=('#89d0ff', 8, .67)),
    'console':   dict(color='#41cfff', border=('#41cfff', 1), glow=('#41cfff', 6, .8)),
    'neon':      dict(glow=('#aa00ff', 10, .9)),
    'neonblue':  dict(color='#aaffee', glow=('#00ffaa', 10, .9)),
    'fire':      dict(color='#ffe0a0', glow=('#ff8800', 8, .8)),
    'ice':       dict(color='#d0f8ff', border=('#a0e8ff', 1.5)),
    'gold':      dict(color='#ffe080', border=('#ffe080', 2)),
    'bubblegum': dict(bg=('#3c00c8', .85)),
    'cinema':    dict(color='#c8e8ff'),
    'shadow':    dict(outline=('#000000', 2), glow=('#000080', 10, .9)),
    'outline':   dict(),
}
DEFAULT_PAD = (18, 6)


NOBG_OUTLINE = ('#000000', 2.5)   # 🔲 Fondo OFF en el Default: borde negro en las letras (como en el reproductor)


def style_spec(style_id, lang='en', bg=True):
    """bg=False (🔲 Fondo OFF): sin la caja del estilo; cada estilo conserva su color, borde y brillo."""
    base = dict(STYLES.get(style_id) or STYLES['default'])
    if lang == 'es':
        base.update(ES_OVERRIDES.get(style_id if style_id in STYLES else 'default', {}))
    if not bg:
        base.pop('bg', None)
        base.pop('box_shadow', None)
        if (style_id not in STYLES or style_id == 'default') and not base.get('outline'):
            base['outline'] = NOBG_OUTLINE
    base.setdefault('bold', False)
    base.setdefault('sp', 0)
    base.setdefault('mul', 1.0)
    base.setdefault('upper', False)
    base['pad'] = base.get('pad') or (DEFAULT_PAD if base.get('bg') else (0, 0))
    return base


# ══════════════════════════════════════════════════════════════
#  Tipografías y medidas de texto
# ══════════════════════════════════════════════════════════════
FONT_FILES = {
    ('Segoe UI', True): ['segoeuib.ttf'], ('Segoe UI', False): ['segoeui.ttf'],
    ('Impact', False): ['impact.ttf'], ('Impact', True): ['impact.ttf'],
    ('Georgia', False): ['georgia.ttf'], ('Georgia', True): ['georgiab.ttf'],
    ('Bangers', False): ['Bangers-Regular.ttf'], ('Bangers', True): ['Bangers-Regular.ttf'],
    ('Cinzel', True): ['Cinzel-Bold.ttf'], ('Cinzel', False): ['Cinzel-Bold.ttf'],
    ('Share Tech Mono', False): ['ShareTechMono-Regular.ttf'], ('Share Tech Mono', True): ['ShareTechMono-Regular.ttf'],
}


def font_path(family, bold):
    for name in FONT_FILES.get((family, bool(bold)), []):
        for d in (FONTS_DIR, WIN_FONTS):
            p = os.path.join(d, name)
            if os.path.exists(p):
                return p
    return None


try:
    from PIL import ImageFont
except Exception:     # sin Pillow se usan medidas aproximadas
    ImageFont = None

_font_cache = {}


def _pil_font(path, size):
    key = (path, round(size, 1))
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(path, max(4, int(round(size))))
    return _font_cache[key]


class Measure:
    """Mide texto con la misma tipografía que se va a dibujar."""
    def __init__(self, family, bold):
        self.path = font_path(family, bold) if ImageFont else None
        self._ratio = None

    def ratio(self):
        """Altura de la línea / tamaño de la letra (libass usa la altura completa como 'tamaño')."""
        if self._ratio is None:
            if self.path:
                asc, desc = _pil_font(self.path, 200).getmetrics()
                self._ratio = (asc + desc) / 200.0
            else:
                self._ratio = 1.25
        return self._ratio

    def width(self, text, size_px, spacing=0.0):
        if self.path:
            return _pil_font(self.path, size_px).getlength(text) * (size_px / max(4, int(round(size_px))))\
                + spacing * len(text)
        return 0.56 * size_px * len(text) + spacing * len(text)


def wrap_text(text, max_w, width_fn):
    """Parte el texto en renglones sin pasarse del ancho (una palabra sola más ancha queda en su renglón)."""
    words = text.split()
    if not words:
        return ['']
    lines, cur = [], words[0]
    for w in words[1:]:
        if width_fn(cur + ' ' + w) <= max_w:
            cur += ' ' + w
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


# ══════════════════════════════════════════════════════════════
#  Línea de tiempo: qué subtítulo (inglés / español) se ve en cada momento
# ══════════════════════════════════════════════════════════════
def clean_text(text):
    t = re.sub(r'\s+', ' ', str(text or '')).strip()
    return t.replace('\\', '/').replace('{', '(').replace('}', ')')


def timeline(subs_en, subs_es, shift=0.0, t0=0.0, t1=None):
    """[(inicio, fin, texto_en, texto_es)] en segundos del video, recortado a [t0, t1].
    Igual que el reproductor: en cada instante se muestra el primer subtítulo de cada idioma que lo cubre."""
    def prep(subs):
        out = []
        for s in subs or []:
            a, b = float(s['start']) + shift, float(s['end']) + shift
            txt = clean_text(s.get('phrase'))
            if txt and b > a:
                out.append((a, b, txt))
        return out
    en, es = prep(subs_en), prep(subs_es)
    hi = t1 if t1 is not None else float('inf')
    cuts = {t0}
    if t1 is not None:
        cuts.add(t1)
    for a, b, _ in en + es:
        for x in (a, b):
            if t0 < x < hi:
                cuts.add(x)
    cuts = sorted(cuts)
    out = []

    def active(items, t):
        return next((txt for a, b, txt in items if a <= t <= b), '')

    for a, b in zip(cuts, cuts[1:]):
        if b - a < 1e-3:
            continue
        mid = (a + b) / 2
        e, s = active(en, mid), active(es, mid)
        if not e and not s:
            continue
        if out and abs(out[-1][1] - a) < 1e-3 and out[-1][2] == e and out[-1][3] == s:
            out[-1] = (out[-1][0], b, e, s)
        else:
            out.append((a, b, e, s))
    return out


# ══════════════════════════════════════════════════════════════
#  Archivo ASS
# ══════════════════════════════════════════════════════════════
def ass_time(seconds):
    cs = max(0, int(round(seconds * 100)))
    h, r = divmod(cs, 360000)
    m, r = divmod(r, 6000)
    s, c = divmod(r, 100)
    return f'{h}:{m:02d}:{s:02d}.{c:02d}'


def _bgr(hex_rgb):
    h = hex_rgb.lstrip('#')
    return h[4:6] + h[2:4] + h[0:2]


def c_tag(tag, hex_rgb):          # \1c \3c \4c : color
    return f'\\{tag}&H{_bgr(hex_rgb).upper()}&'


def a_tag(tag, opacity):          # \1a \3a \4a : transparencia (00 = opaco, FF = invisible)
    return f'\\{tag}&H{255 - int(round(max(0, min(1, opacity)) * 255)):02X}&'


def _n(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.') if isinstance(v, float) else str(v)


class Geometry:
    """Tamaños (en px del video) a partir de la configuración del reproductor."""
    def __init__(self, width, height, ref_height, size_rem=1.1, x=0.0, y=0.0, base_x=50.0, base_y=70.0):
        self.W, self.H = width, height
        self.k = height / float(ref_height or 400)    # px del reproductor → px del video
        self.base_px = size_rem * 16 * self.k          # tamaño de letra pedido (px CSS escalados)
        self.cx_pct, self.top_pct = base_x + x, base_y + y


def build_events(entries, geo, style_id, show_en=True, show_es=True, bg=True):
    """Convierte la línea de tiempo en líneas 'Dialogue'. Cada idioma es un bloque (con varias capas:
    borde, caja, brillo y texto) y los bloques se apilan con una separación, como en el reproductor."""
    spec = {'en': style_spec(style_id, 'en', bg), 'es': style_spec(style_id, 'es', bg)}
    s_en = spec['en']
    meas = Measure(s_en['font'], s_en['bold'])
    ratio = meas.ratio()
    k = geo.k
    px, py = s_en['pad'][0] * k, s_en['pad'][1] * k
    margin = MARGIN * k
    gap = STACK_GAP * k
    sp = s_en['sp'] * k
    dialogues = []

    for (a, b, en, es) in entries:
        lines = []     # (idioma, texto)
        if show_en and en:
            lines.append(('en', en.upper() if s_en['upper'] else en))
        if show_es and es:
            lines.append(('es', es.upper() if s_en['upper'] else es))
        if not lines:
            continue
        # 1) que entre: se achica la letra de a poco si el bloque es muy alto o muy ancho
        size = geo.base_px * s_en['mul']
        fit = 1.0
        for _ in range(24):
            cur = size * fit
            inner = geo.W - 2 * (margin + px)
            wrapped = {}
            for lang, txt in lines:
                wrapped[lang] = wrap_text(txt, inner, lambda t: meas.width(t, cur, sp))
            n_lines = sum(len(v) for v in wrapped.values())
            block_h = n_lines * cur * ratio + 2 * py * len(wrapped) + gap * (len(wrapped) - 1)     # lo que dibuja libass
            # Para decidir si hay que achicar se usa el alto que tiene el bloque en el reproductor (line-height 1.25):
            # con el alto de libass (más alto) se achicaba la letra justo en tamaños donde el reproductor no la achica
            app_h = n_lines * cur * APP_LINE_H + 2 * py * len(wrapped) + gap * (len(wrapped) - 1)
            block_w = max(meas.width(ln, cur, sp) for v in wrapped.values() for ln in v) + 2 * px
            if (app_h <= geo.H * MAX_BLOCK_H and block_w <= geo.W - 2 * margin + 1) or fit <= MIN_FIT:
                break
            fit *= 0.92
        cur = size * fit
        fs = cur * ratio                      # tamaño ASS (altura de línea)
        # 2) que no se salga: se corre lo justo para quedar dentro del video
        cx = geo.W * geo.cx_pct / 100.0
        top = geo.H * geo.top_pct / 100.0
        cx = max(block_w / 2 + margin, min(geo.W - block_w / 2 - margin, cx))
        top = max(margin, min(geo.H - block_h - margin, top))

        start, end = ass_time(a), ass_time(b)
        y = top + py                          # el texto empieza py por debajo del borde de la caja
        for lang in ('en', 'es'):
            if lang not in wrapped:
                continue
            head = f'\\an8\\pos({cx:.1f},{y:.1f})\\fs{fs:.1f}\\fsp{_n(round(sp, 2))}\\blur0'
            text = '\\N'.join(wrapped[lang])
            for layer, kind, style in ((0, 'border', 'Box'), (1, 'bg', 'Box'), (2, 'glow', 'Txt'), (3, 'text', 'Txt')):
                tags = _line_tags(kind, spec[lang], k, px, py)
                if tags is not None:
                    dialogues.append(f'Dialogue: {layer},{start},{end},{style},,0,0,0,,{{{head}{tags}}}{text}')
            y += len(wrapped[lang]) * fs + 2 * py + gap
    return dialogues


def _line_tags(kind, s, k, px, py):
    """Etiquetas de una capa para una línea (idioma). None si ese estilo no usa esa capa."""
    bg = s.get('bg')
    invisible = '\\1a&HFF&'
    if kind == 'border':
        if not (bg and s.get('border') and bg[1] >= BORDER_MIN_ALPHA):
            return None
        col, w = s['border']
        sh = s.get('box_shadow')
        t = invisible + c_tag('3c', col) + a_tag('3a', 1) + f'\\xbord{_n(round(px + w * k, 2))}\\ybord{_n(round(py + w * k, 2))}'
        if sh:
            t += c_tag('4c', sh[0]) + a_tag('4a', 1) + f'\\shad{_n(round(sh[1] * k, 2))}'
        else:
            t += '\\shad0'
        return t
    if kind == 'bg':
        if not bg:
            return None
        return (invisible + c_tag('3c', bg[0]) + a_tag('3a', bg[1])
                + f'\\xbord{_n(round(px, 2))}\\ybord{_n(round(py, 2))}\\shad0')
    if kind == 'glow':
        g = s.get('glow')
        if not g:
            return None
        col, r, op = g
        r = r * k
        return invisible + f'\\bord{_n(round(r * 0.5, 2))}\\blur{_n(round(r * 0.8, 2))}' + c_tag('3c', col) + a_tag('3a', op) + '\\shad0'
    # text
    t = c_tag('1c', s['color']) + a_tag('1a', 1)
    ol, ts = s.get('outline'), s.get('tshadow')
    if ol:
        t += f'\\bord{_n(round(ol[1] * k, 2))}' + c_tag('3c', ol[0]) + a_tag('3a', 1)
    else:
        t += '\\bord0'
    if ts:
        d = _n(round(ts[1] * k, 2))
        t += f'\\xshad{d}\\yshad{d}' + c_tag('4c', ts[0]) + a_tag('4a', 1)
    else:
        t += '\\shad0'
    return t


def ass_header(width, height, style_id):
    s = style_spec(style_id, 'en')
    bold = -1 if s['bold'] else 0
    fam = s['font']
    return (
        '[Script Info]\nScriptType: v4.00+\n'
        f'PlayResX: {width}\nPlayResY: {height}\n'
        'WrapStyle: 2\nScaledBorderAndShadow: yes\nYCbCr Matrix: None\n\n'
        '[V4+ Styles]\n'
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, '
        'Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, '
        'MarginL, MarginR, MarginV, Encoding\n'
        f'Style: Box,{fam},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,{bold},0,0,0,100,100,0,0,3,0,0,8,0,0,0,1\n'
        f'Style: Txt,{fam},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,{bold},0,0,0,100,100,0,0,1,0,0,8,0,0,0,1\n\n'
        '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    )


def build_ass(entries, width, height, style_id, geo, show_en=True, show_es=True, bg=True):
    return ass_header(width, height, style_id) + '\n'.join(build_events(entries, geo, style_id, show_en, show_es, bg)) + '\n'


def cover_filter(cover, width, height):
    """▬ Franja negra del reproductor como filtro de ffmpeg (va antes de los subtítulos, que quedan encima).
    cover: {'x', 'y', 'w', 'h'} en % de la imagen, o None. Devuelve 'drawbox=…,' o ''."""
    if not cover:
        return ''
    try:
        x, y, w, h = (float(cover[k]) for k in ('x', 'y', 'w', 'h'))
    except (KeyError, TypeError, ValueError):
        return ''
    x0 = max(0, min(width, round(width * x / 100)))
    y0 = max(0, min(height, round(height * y / 100)))
    x1 = max(x0, min(width, round(width * (x + w) / 100)))
    y1 = max(y0, min(height, round(height * (y + h) / 100)))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return ''
    return f'drawbox=x={x0}:y={y0}:w={x1 - x0}:h={y1 - y0}:color=black:t=fill,'


def write_ass(path, text):
    with open(path, 'w', encoding='utf-8-sig', newline='\n') as f:
        f.write(text)


def prepare_fonts(workdir, style_id):
    """Copia a la carpeta de trabajo la tipografía del estilo (libass la busca con fontsdir)."""
    d = os.path.join(workdir, 'fonts')
    os.makedirs(d, exist_ok=True)
    s = style_spec(style_id, 'en')
    p = font_path(s['font'], s['bold'])
    if p:
        shutil.copy2(p, d)
    return p


# ══════════════════════════════════════════════════════════════
#  Información del video
# ══════════════════════════════════════════════════════════════
def _fraction(txt):
    try:
        a, _, b = str(txt).partition('/')
        v = float(a) / float(b) if b else float(a)
        return v if v > 0 else 0.0
    except Exception:
        return 0.0


def probe(path):
    exe = shutil.which('ffprobe')
    info = dict(duration=0.0, width=0, height=0, fps=30.0, has_audio=False, audio_codec='', video_codec='')
    if exe:
        r = subprocess.run([exe, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
                           capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
        if r.returncode != 0:
            raise ExportError('No se pudo leer el video: ' + (r.stderr or '')[:200])
        d = json.loads(r.stdout or '{}')
        v = next((s for s in d.get('streams', []) if s.get('codec_type') == 'video'), None)
        a = next((s for s in d.get('streams', []) if s.get('codec_type') == 'audio'), None)
        if not v:
            raise ExportError('El archivo no tiene video.')
        info.update(width=int(v.get('width') or 0), height=int(v.get('height') or 0), video_codec=v.get('codec_name', ''))
        info['fps'] = _fraction(v.get('avg_frame_rate')) or _fraction(v.get('r_frame_rate')) or 30.0
        info['duration'] = float((d.get('format') or {}).get('duration') or v.get('duration') or 0)
        info['has_audio'] = a is not None
        info['audio_codec'] = (a or {}).get('codec_name', '')
        rot = 0
        for sd in v.get('side_data_list', []) or []:
            if 'rotation' in sd:
                rot = int(round(float(sd['rotation'])))
        rot = rot or int(round(float((v.get('tags') or {}).get('rotate', 0) or 0)))
        if abs(rot) % 180 == 90:
            info['width'], info['height'] = info['height'], info['width']
        return info
    # Sin ffprobe: se lee lo básico de la salida de `ffmpeg -i`
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path], capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = r.stderr
    m = re.search(r'Duration:\s*(\d+):(\d+):([\d.]+)', out)
    if m:
        info['duration'] = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    m = re.search(r'Video:\s*(\w+).*?,\s*(\d{2,5})x(\d{2,5})', out)
    if not m:
        raise ExportError('No se pudo leer el video.')
    info.update(video_codec=m[1], width=int(m[2]), height=int(m[3]))
    m = re.search(r'([\d.]+)\s*fps', out)
    if m:
        info['fps'] = float(m[1])
    m = re.search(r'Audio:\s*(\w+)', out)
    info['has_audio'] = bool(m)
    info['audio_codec'] = m[1] if m else ''
    return info


# ══════════════════════════════════════════════════════════════
#  ffmpeg
# ══════════════════════════════════════════════════════════════
# crf de x264 · cq de NVENC · alto máximo. Medido con un video de YouTube de 1080p: NVENC pesa más que x264 con el
# mismo número, por eso "media" usa cq 29 (≈ el peso del original) y crf 22.
QUALITY = {
    'alta':    dict(crf=19, cq=26, max_h=None),
    'media':   dict(crf=22, cq=29, max_h=None),
    'liviana': dict(crf=25, cq=31, max_h=720),
}
_encoder_cache = {}


def has_libass():
    if 'ass' not in _encoder_cache:
        r = subprocess.run(['ffmpeg', '-hide_banner', '-filters'], capture_output=True, text=True, encoding='utf-8', errors='replace')
        _encoder_cache['ass'] = bool(re.search(r'\bass\b', r.stdout))
    return _encoder_cache['ass']


def pick_encoder():
    """NVENC (placa NVIDIA) si anda de verdad; si no, x264 en CPU."""
    if 'video' not in _encoder_cache:
        ok = False
        try:
            r = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2',
                                '-c:v', 'h264_nvenc', '-f', 'null', '-'], capture_output=True, timeout=30)
            ok = r.returncode == 0
        except Exception:
            ok = False
        _encoder_cache['video'] = 'h264_nvenc' if ok else 'libx264'
    return _encoder_cache['video']


def video_codec_args(quality, encoder=None):
    q = QUALITY.get(quality, QUALITY['media'])
    enc = encoder or pick_encoder()
    if enc == 'h264_nvenc':
        return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', str(q['cq']), '-b:v', '0', '-pix_fmt', 'yuv420p']
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', str(q['crf']), '-pix_fmt', 'yuv420p']


def output_size(width, height, quality):
    """Tamaño final del video (solo 'liviana' lo reduce a 720p)."""
    mh = QUALITY.get(quality, QUALITY['media'])['max_h']
    if mh and height > mh:
        w = int(round(width * mh / height / 2) * 2)
        return w, mh
    return width, height


def run_ffmpeg(cmd, cwd, total_seconds, on_progress=None, cancel=None):
    """Ejecuta ffmpeg leyendo su avance (-progress). Devuelve (código, texto de error)."""
    full = [cmd[0], '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'] + cmd[1:]
    proc = subprocess.Popen(full, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding='utf-8', errors='replace')
    err_lines = []
    reader = threading.Thread(target=lambda: [err_lines.append(l) for l in proc.stderr], daemon=True)
    reader.start()
    try:
        for line in proc.stdout:
            if cancel is not None and cancel.is_set():
                proc.terminate()
                break
            if line.startswith('out_time_us=') or line.startswith('out_time_ms='):
                try:
                    secs = int(line.split('=')[1]) / 1_000_000.0
                except ValueError:
                    continue
                if on_progress and total_seconds:
                    on_progress(min(1.0, max(0.0, secs / total_seconds)))
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
        reader.join(2)
        proc.stdout.close()
        proc.stderr.close()
    if cancel is not None and cancel.is_set():
        raise Cancelled('Exportación cancelada.')
    return proc.returncode, ''.join(err_lines)[-600:]


def ensure_ffmpeg_ready():
    if not shutil.which('ffmpeg'):
        raise ExportError('No se encontró ffmpeg.')
    if not has_libass():
        raise ExportError('Tu ffmpeg no incluye libass (el filtro «ass»), necesario para grabar los subtítulos.')


# ══════════════════════════════════════════════════════════════
#  Nombres de archivo
# ══════════════════════════════════════════════════════════════
def safe_filename(name, limit=140):
    n = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(name or '')).strip(' .')
    return (n[:limit].rstrip(' .')) or 'video'


def unique_path(folder, base, ext):
    p = os.path.join(folder, f'{base}{ext}')
    i = 2
    while os.path.exists(p):
        p = os.path.join(folder, f'{base} ({i}){ext}')
        i += 1
    return p


def langs_label(show_en, show_es):
    return 'EN+ES' if show_en and show_es else ('EN' if show_en else 'ES')


# ══════════════════════════════════════════════════════════════
#  Exportaciones
# ══════════════════════════════════════════════════════════════
def _opt_bg(opts):
    return opts.get('sub_bg', True) is not False


def _opts_geometry(info, out_w, out_h, opts):
    return Geometry(out_w, out_h, opts.get('ref_h') or 400, opts.get('size_rem') or 1.1,
                    (opts.get('offset') or {}).get('x', 0.0), (opts.get('offset') or {}).get('y', 0.0))


def render_preview(video_path, t, subs_en, subs_es, opts):
    """Un fotograma (JPEG) con los subtítulos puestos, como saldría en la exportación."""
    ensure_ffmpeg_ready()
    info = probe(video_path)
    quality = opts.get('quality', 'media')
    out_w, out_h = output_size(info['width'], info['height'], quality)
    style = opts.get('style') or 'default'
    show_en, show_es = bool(opts.get('en', True)), bool(opts.get('es', False))
    t = max(0.0, min(float(t), max(0.0, info['duration'] - 0.05)))
    entries = timeline(subs_en if show_en else [], subs_es if show_es else [], float(opts.get('shift') or 0), t, t + 0.5)
    entries = [(a - t, b - t, e, s) for a, b, e, s in entries]
    geo = _opts_geometry(info, out_w, out_h, opts)
    work = tempfile.mkdtemp(prefix='prev_')
    try:
        write_ass(os.path.join(work, 's.ass'), build_ass(entries, out_w, out_h, style, geo, show_en, show_es, _opt_bg(opts)))
        prepare_fonts(work, style)
        vf = ((f'scale={out_w}:{out_h},' if (out_w, out_h) != (info['width'], info['height']) else '')
              + cover_filter(opts.get('cover'), out_w, out_h) + 'ass=s.ass:fontsdir=fonts')
        out = os.path.join(work, 'p.jpg')
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{t:.3f}', '-i', video_path, '-frames:v', '1',
                            '-vf', vf, '-q:v', '3', out], cwd=work, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
        if r.returncode != 0 or not os.path.exists(out):
            raise ExportError('No se pudo generar la vista previa: ' + (r.stderr or '')[-300:])
        with open(out, 'rb') as f:
            return f.read()
    finally:
        shutil.rmtree(work, ignore_errors=True)


def export_video(video_path, out_dir, video_name, subs_en, subs_es, opts, job=None, cancel=None):
    """Video completo con los subtítulos grabados en la imagen. Devuelve la ruta del archivo."""
    ensure_ffmpeg_ready()
    info = probe(video_path)
    quality = opts.get('quality', 'media')
    out_w, out_h = output_size(info['width'], info['height'], quality)
    style = opts.get('style') or 'default'
    show_en, show_es = bool(opts.get('en', True)), bool(opts.get('es', False))
    entries = timeline(subs_en if show_en else [], subs_es if show_es else [], float(opts.get('shift') or 0), 0.0, info['duration'] or None)
    if not entries:
        raise ExportError('No hay subtítulos para grabar en los idiomas elegidos.')
    geo = _opts_geometry(info, out_w, out_h, opts)
    work = tempfile.mkdtemp(prefix='exp_')
    try:
        write_ass(os.path.join(work, 's.ass'), build_ass(entries, out_w, out_h, style, geo, show_en, show_es, _opt_bg(opts)))
        prepare_fonts(work, style)
        vf = ((f'scale={out_w}:{out_h},' if (out_w, out_h) != (info['width'], info['height']) else '')
              + cover_filter(opts.get('cover'), out_w, out_h) + 'ass=s.ass:fontsdir=fonts')
        tmp_out = os.path.join(work, 'out.mp4')
        audio = ['-c:a', 'copy'] if info['audio_codec'] in ('aac', 'mp3') else ['-c:a', 'aac', '-b:a', '192k']

        def attempt(encoder):
            cmd = ['ffmpeg', '-y', '-i', video_path, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf,
                   *video_codec_args(quality, encoder), *audio, '-movflags', '+faststart', tmp_out]
            return run_ffmpeg(cmd, work, info['duration'], job.update if job else None, cancel)

        enc = pick_encoder()
        rc, err = attempt(enc)
        if rc != 0 and enc != 'libx264':
            rc, err = attempt('libx264')
        if rc != 0:
            raise ExportError('ffmpeg falló: ' + err.strip()[-300:])
        stem = os.path.splitext(os.path.basename(video_name))[0]
        os.makedirs(out_dir, exist_ok=True)
        dest = unique_path(out_dir, safe_filename(f'{stem} [{langs_label(show_en, show_es)}]'), '.mp4')
        shutil.move(tmp_out, dest)
        return dest
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _srt_text(subs, shift):
    def ts(s):
        ms = max(0, int(round(s * 1000)))
        h, r = divmod(ms, 3600000)
        m, r = divmod(r, 60000)
        sec, ms = divmod(r, 1000)
        return f'{h:02d}:{m:02d}:{sec:02d},{ms:03d}'
    out, n = [], 0
    for s in subs or []:
        txt = str(s.get('phrase') or '').strip()
        if not txt:
            continue
        n += 1
        out += [str(n), f"{ts(float(s['start']) + shift)} --> {ts(float(s['end']) + shift)}", txt, '']
    return '\n'.join(out)


def srt_text(subs, shift=0.0):
    return _srt_text(subs, shift)


def export_soft(video_path, out_dir, video_name, subs_en, subs_es, opts, job=None, cancel=None):
    """Video con los subtítulos como pistas seleccionables (sin recodificar: es muy rápido)."""
    ensure_ffmpeg = shutil.which('ffmpeg')
    if not ensure_ffmpeg:
        raise ExportError('No se encontró ffmpeg.')
    info = probe(video_path)
    show_en, show_es = bool(opts.get('en', True)), bool(opts.get('es', False))
    tracks = []
    if show_en and subs_en:
        tracks.append(('en', 'eng', 'English', subs_en))
    if show_es and subs_es:
        tracks.append(('es', 'spa', 'Español', subs_es))
    if not tracks:
        raise ExportError('No hay subtítulos para agregar en los idiomas elegidos.')
    mp4_ok = info['video_codec'] in ('h264', 'hevc', 'mpeg4') and (not info['has_audio'] or info['audio_codec'] in ('aac', 'mp3'))
    ext, sub_codec = ('.mp4', 'mov_text') if mp4_ok else ('.mkv', 'srt')
    work = tempfile.mkdtemp(prefix='soft_')
    try:
        cmd = ['ffmpeg', '-y', '-i', video_path]
        for code, _, _, subs in tracks:
            p = os.path.join(work, f'{code}.srt')
            with open(p, 'w', encoding='utf-8') as f:
                f.write(_srt_text(subs, float(opts.get('shift') or 0)))
            cmd += ['-i', p]
        cmd += ['-map', '0:v', '-map', '0:a?']
        for i in range(len(tracks)):
            cmd += ['-map', str(i + 1)]
        cmd += ['-c:v', 'copy', '-c:a', 'copy', '-c:s', sub_codec]
        for i, (_, iso, title, _) in enumerate(tracks):
            cmd += [f'-metadata:s:s:{i}', f'language={iso}', f'-metadata:s:s:{i}', f'title={title}']
        cmd += ['-disposition:s:0', 'default']
        tmp_out = os.path.join(work, 'out' + ext)
        cmd.append(tmp_out)
        rc, err = run_ffmpeg(cmd, work, info['duration'], job.update if job else None, cancel)
        if rc != 0:
            raise ExportError('ffmpeg falló: ' + err.strip()[-300:])
        stem = os.path.splitext(os.path.basename(video_name))[0]
        os.makedirs(out_dir, exist_ok=True)
        dest = unique_path(out_dir, safe_filename(f'{stem} [pistas {langs_label(show_en, show_es)}]'), ext)
        shutil.move(tmp_out, dest)
        return dest
    finally:
        shutil.rmtree(work, ignore_errors=True)


def build_segment_graph(reps, fps, has_audio, out_w, out_h, src_w, src_h, cover=None):
    """Filtro de ffmpeg para unir las vueltas de un fragmento. reps: [{'speed', 'ass': 'r0.ass' | None}].
    cover: la franja negra (en todas las vueltas, aunque alguna vaya sin subtítulos)."""
    parts, labels = [], []
    scale = (f'scale={out_w}:{out_h},' if (out_w, out_h) != (src_w, src_h) else '') + cover_filter(cover, out_w, out_h)
    for i, rp in enumerate(reps):
        sp = max(0.5, min(2.0, float(rp['speed'])))
        vchain = scale + (f"ass={rp['ass']}:fontsdir=fonts," if rp.get('ass') else '') + f'setpts=PTS/{sp:.4f},fps={fps:.3f},setsar=1'
        parts.append(f'[{i}:v]{vchain}[v{i}]')
        if has_audio:
            parts.append(f'[{i}:a]atempo={sp:.4f},aresample=48000,aformat=channel_layouts=stereo[a{i}]')
            labels.append(f'[v{i}][a{i}]')
        else:
            labels.append(f'[v{i}]')
    n = len(reps)
    parts.append(''.join(labels) + f'concat=n={n}:v=1:a={1 if has_audio else 0}[v]' + ('[a]' if has_audio else ''))
    return ';'.join(parts)


def export_segment(video_path, out_dir, video_name, phrase, start, end, reps, subs_en, subs_es, opts, job=None, cancel=None):
    """Un fragmento con sus vueltas: cada una con su velocidad y sus idiomas de subtítulos."""
    ensure_ffmpeg_ready()
    info = probe(video_path)
    quality = opts.get('quality', 'media')
    out_w, out_h = output_size(info['width'], info['height'], quality)
    style = opts.get('style') or 'default'
    shift = float(opts.get('shift') or 0)
    start, end = max(0.0, float(start)), float(end)
    if info['duration']:
        end = min(end, info['duration'])
    if end - start < 0.2:
        raise ExportError('El fragmento es demasiado corto.')
    dur = end - start
    burn = bool(opts.get('subs', True))
    geo = _opts_geometry(info, out_w, out_h, opts)
    work = tempfile.mkdtemp(prefix='seg_')
    try:
        prepare_fonts(work, style)
        graph_reps, ass_cache = [], {}
        for i, rp in enumerate(reps or [{'speed': 1, 'en': True, 'es': False}]):
            en, es = bool(rp.get('en')) and burn, bool(rp.get('es')) and burn
            key = (en, es)
            ass_name = None
            if en or es:
                if key not in ass_cache:
                    entries = timeline(subs_en if en else [], subs_es if es else [], shift, start, end)
                    entries = [(a - start, b - start, e, s) for a, b, e, s in entries]
                    if entries:
                        name = f'r{len(ass_cache)}.ass'
                        write_ass(os.path.join(work, name), build_ass(entries, out_w, out_h, style, geo, en, es, _opt_bg(opts)))
                        ass_cache[key] = name
                    else:
                        ass_cache[key] = None
                ass_name = ass_cache[key]
            graph_reps.append({'speed': rp.get('speed') or 1, 'ass': ass_name})
        total = sum(dur / max(0.5, min(2.0, float(r['speed']))) for r in graph_reps)
        graph = build_segment_graph(graph_reps, info['fps'], info['has_audio'], out_w, out_h, info['width'], info['height'],
                                    opts.get('cover'))
        tmp_out = os.path.join(work, 'out.mp4')

        def attempt(encoder):
            cmd = ['ffmpeg', '-y']
            for _ in graph_reps:
                cmd += ['-ss', f'{start:.3f}', '-t', f'{dur:.3f}', '-i', video_path]
            cmd += ['-filter_complex', graph, '-map', '[v]'] + (['-map', '[a]'] if info['has_audio'] else [])
            cmd += [*video_codec_args(quality, encoder)] + (['-c:a', 'aac', '-b:a', '192k'] if info['has_audio'] else [])
            cmd += ['-movflags', '+faststart', tmp_out]
            return run_ffmpeg(cmd, work, total, job.update if job else None, cancel)

        enc = pick_encoder()
        rc, err = attempt(enc)
        if rc != 0 and enc != 'libx264':
            rc, err = attempt('libx264')
        if rc != 0:
            raise ExportError('ffmpeg falló: ' + err.strip()[-300:])
        stem = os.path.splitext(os.path.basename(video_name))[0]
        os.makedirs(out_dir, exist_ok=True)
        label = safe_filename(f'{stem} · {phrase or "fragmento"} (x{len(graph_reps)})')
        dest = unique_path(out_dir, label, '.mp4')
        shutil.move(tmp_out, dest)
        return dest
    finally:
        shutil.rmtree(work, ignore_errors=True)
