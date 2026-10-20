"""Pruebas de ytdownload.py (traer videos de YouTube). No usan internet: yt-dlp se reemplaza por uno falso."""
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ytdownload as yd
from jobs import JobState

VID = 'jNQXAC9IVRw'


class CleanUrl(unittest.TestCase):
    def ok(self, text):
        url, vid = yd.clean_url(text)
        self.assertEqual((url, vid), (f'https://www.youtube.com/watch?v={VID}', VID), text)

    def test_formas_validas(self):
        for t in (f'https://www.youtube.com/watch?v={VID}', f'https://youtube.com/watch?v={VID}&t=30s',
                  f'https://youtu.be/{VID}?si=AbC123', f'https://m.youtube.com/watch?v={VID}',
                  f'https://www.youtube.com/shorts/{VID}', f'https://www.youtube.com/embed/{VID}',
                  f'https://music.youtube.com/watch?v={VID}&list=RDAMVM{VID}',
                  f'  https://www.youtube.com/watch?v={VID}  ', f'mirá esto https://youtu.be/{VID} está bueno',
                  f'youtube.com/watch?v={VID}', f'www.youtube.com/watch?v={VID}', f'HTTPS://WWW.YOUTUBE.COM/watch?v={VID}'):
            self.ok(t)

    def test_se_normaliza_y_no_arrastra_parametros_raros(self):
        url, _ = yd.clean_url(f'https://www.youtube.com/watch?v={VID}&list=PLxxxxxxxx&index=3&x=;rm -rf /')
        self.assertEqual(url, f'https://www.youtube.com/watch?v={VID}')

    def test_rechaza_otros_sitios_y_engaños(self):
        for t in ('https://vimeo.com/123456', 'https://evil.com/watch?v=' + VID,
                  f'https://youtube.com.evil.com/watch?v={VID}', f'https://evil.com/?u=youtube.com/watch?v={VID}',
                  f'https://notyoutube.com/watch?v={VID}', f'file:///C:/Windows/{VID}', f'ftp://youtu.be/{VID}'):
            with self.assertRaises(yd.DownloadError, msg=t):
                yd.clean_url(t)

    def test_rechaza_lo_que_no_es_un_video(self):
        for t in ('', '   ', 'hola', 'https://www.youtube.com/', 'https://www.youtube.com/@canal',
                  'https://www.youtube.com/watch?v=corto', 'https://www.youtube.com/playlist?list=PLabc123'):
            with self.assertRaises(yd.DownloadError, msg=t):
                yd.clean_url(t)

    def test_lista_de_reproduccion_tiene_mensaje_propio(self):
        with self.assertRaises(yd.DownloadError) as c:
            yd.clean_url('https://www.youtube.com/playlist?list=PLabc123')
        self.assertIn('lista de reproducción', str(c.exception))


class Nombres(unittest.TestCase):
    def test_safe_title(self):
        self.assertEqual(yd.safe_title('I Played Magnus Carlsen!'), 'I Played Magnus Carlsen!')
        self.assertEqual(yd.safe_title('¿Cómo estás? Año 2024 #shorts 100%'), 'Cómo estás Año 2024 shorts 100')
        self.assertEqual(yd.safe_title('Chess 🔥🔥 vs "AI": a/b\\c|d*e<f>g'), 'Chess vs AI a b c d e f g')
        self.assertEqual(yd.safe_title('..  nombre con puntos ..'), 'nombre con puntos')
        self.assertEqual(yd.safe_title('🔥🔥🔥', VID), f'YouTube {VID}')
        self.assertEqual(yd.safe_title('', VID), f'YouTube {VID}')
        self.assertEqual(yd.safe_title(None, VID), f'YouTube {VID}')
        self.assertEqual(yd.safe_title('con'), 'con video')
        self.assertLessEqual(len(yd.safe_title('a' * 500)), 100)
        for bad in '#%?:*"<>|/\\':
            self.assertNotIn(bad, yd.safe_title(f'x{bad}y'))

    def test_unique_name(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(yd.unique_name(d, 'Video', '.mp4'), 'Video.mp4')
            open(os.path.join(d, 'Video.mp4'), 'w').close()
            self.assertEqual(yd.unique_name(d, 'Video', '.mp4'), 'Video (2).mp4')
            open(os.path.join(d, 'Video (2).mp4'), 'w').close()
            self.assertEqual(yd.unique_name(d, 'Video', '.mp4'), 'Video (3).mp4')
            self.assertEqual(yd.unique_name(d, 'video', '.mp4'), 'video (3).mp4')    # Windows no distingue mayúsculas


class Errores(unittest.TestCase):
    def test_mensajes_en_castellano(self):
        cases = {
            'ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access': 'privado',
            'ERROR: [youtube] abc: Video unavailable': 'no está disponible',
            "ERROR: [youtube] abc: Sign in to confirm you’re not a bot": 'robot',
            'ERROR: [youtube] abc: Sign in to confirm your age': 'edad',
            'HTTP Error 429: Too Many Requests': 'limitando',
            '<urlopen error [Errno 11001] getaddrinfo failed>': 'conectar',
            'ERROR: ffmpeg not found': 'ffmpeg',
            '\x1b[0;31mERROR:\x1b[0m [youtube] abc: Video unavailable': 'no está disponible',     # con colores de consola
        }
        for raw, expect in cases.items():
            self.assertIn(expect, yd.friendly_error(Exception(raw)), raw)

    def test_error_desconocido_conserva_el_motivo(self):
        m = yd.friendly_error(Exception('ERROR: [youtube] abc: Algo muy raro pasó\nsegunda línea'))
        self.assertTrue(m.startswith('No se pudo traer el video'))
        self.assertIn('Algo muy raro pasó', m)
        self.assertNotIn('segunda línea', m)


# ── yt-dlp falso ──
def fake_ydl(info=None, files=('video.mp4',), steps=(), fail_extract=None, fail_download=None, on_download=None):
    base = {'title': 'Un video de prueba', 'duration': 60, 'requested_formats': [{'filesize': 1000}, {'filesize': 100}]}
    base.update(info or {})

    class FakeYDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download=False):
            if fail_extract:
                raise fail_extract
            return base

        def process_ie_result(self, info, download=True):
            tmpl = self.opts['outtmpl']
            for st in steps:
                for h in self.opts['progress_hooks']:
                    h(st)
            if on_download:
                on_download(self.opts)
            if fail_download:
                raise fail_download
            for f in files:
                with open(tmpl.replace('%(ext)s', 'mp4').replace('video.mp4', f), 'wb') as fh:
                    fh.write(b'x' * 1100)
            for h in self.opts['postprocessor_hooks']:
                h({'status': 'started', 'postprocessor': 'Merger'})
    return FakeYDL


class Descarga(unittest.TestCase):
    def setUp(self):
        self._d = tempfile.TemporaryDirectory()
        self.dir = self._d.name
        self.job, self.cancel = JobState('Preparando…'), threading.Event()

    def tearDown(self):
        self._d.cleanup()

    def run_dl(self, ydl, vid=VID):
        return yd.download_video(self.job, self.cancel, f'https://www.youtube.com/watch?v={vid}', vid, self.dir, ydl_cls=ydl, node_path=None)

    def visibles(self):
        return sorted(f for f in os.listdir(self.dir) if not f.startswith('.'))

    def test_camino_feliz(self):
        steps = [{'status': 'downloading', 'filename': 'a.f1.mp4', 'downloaded_bytes': 500, 'total_bytes': 1000, 'speed': 2_000_000},
                 {'status': 'finished', 'filename': 'a.f1.mp4', 'downloaded_bytes': 1000, 'total_bytes': 1000},
                 {'status': 'downloading', 'filename': 'a.f2.m4a', 'downloaded_bytes': 100, 'total_bytes': 100}]
        res = self.run_dl(fake_ydl(steps=steps))
        self.assertEqual(res['file'], 'Un video de prueba.mp4')
        self.assertEqual(res['size'], 1100)
        self.assertEqual(self.visibles(), ['Un video de prueba.mp4'])
        self.assertEqual(yd.known_file(self.dir, VID), 'Un video de prueba.mp4')
        self.assertFalse(os.path.exists(os.path.join(self.dir, yd.TMP_DIRNAME)), 'no debe quedar la carpeta temporal')
        self.assertEqual(self.job.extra['title'], 'Un video de prueba')
        self.assertLessEqual(self.job.progress, 0.98)       # el 100 % lo pone job.done() recién cuando está todo guardado

    def test_el_progreso_sube_y_nunca_pasa_de_97_mientras_baja(self):
        seen = []
        steps = [{'status': 'downloading', 'filename': 'a', 'downloaded_bytes': n, 'total_bytes': 1000} for n in (100, 400, 900, 1000)]

        def spy(opts):
            seen.append(self.job.progress)
        self.run_dl(fake_ydl(steps=steps, on_download=spy))
        self.assertEqual(len(seen), 1)
        self.assertAlmostEqual(seen[0], 1000 / 1100, places=3)      # bajó 1000 de los 1100 bytes esperados (imagen + audio)
        self.assertLessEqual(seen[0], 0.97)
        self.assertAlmostEqual(self.job.progress, 0.98)             # al unir imagen y audio

    def test_sin_tamanos_conocidos_usa_la_cantidad_de_streams(self):
        info = {'requested_formats': [{}, {}]}
        steps = [{'status': 'finished', 'filename': 'a', 'downloaded_bytes': 800, 'total_bytes': 800},
                 {'status': 'downloading', 'filename': 'b', 'downloaded_bytes': 50, 'total_bytes': 100}]
        seen = []
        self.run_dl(fake_ydl(info=info, steps=steps, on_download=lambda o: seen.append(self.job.progress)))
        self.assertAlmostEqual(seen[0], 0.75)           # un stream completo + la mitad del otro, sobre 2

    def test_nombre_repetido_agrega_numero(self):
        self.run_dl(fake_ydl())
        res = self.run_dl(fake_ydl(), vid='abcdefghijk')
        self.assertEqual(res['file'], 'Un video de prueba (2).mp4')
        self.assertEqual(self.visibles(), ['Un video de prueba (2).mp4', 'Un video de prueba.mp4'])

    def test_cancelar_a_mitad_no_deja_nada(self):
        def cancelar(opts):
            self.cancel.set()
            opts['progress_hooks'][0]({'status': 'downloading', 'filename': 'a', 'downloaded_bytes': 1, 'total_bytes': 10})
        with self.assertRaises(yd.Cancelled):
            self.run_dl(fake_ydl(on_download=cancelar))
        self.assertEqual(self.visibles(), [])
        self.assertFalse(os.path.exists(os.path.join(self.dir, yd.TMP_DIRNAME)))
        self.assertIsNone(yd.known_file(self.dir, VID))

    def test_cancelar_aunque_yt_dlp_envuelva_el_error(self):
        def cancelar(opts):
            self.cancel.set()
            raise RuntimeError('ERROR: algo envuelto')
        with self.assertRaises(yd.Cancelled):
            self.run_dl(fake_ydl(on_download=cancelar))
        self.assertEqual(self.visibles(), [])

    def test_errores_de_youtube_se_traducen(self):
        with self.assertRaises(yd.DownloadError) as c:
            self.run_dl(fake_ydl(fail_extract=Exception('ERROR: [youtube] x: Private video')))
        self.assertIn('privado', str(c.exception))
        self.assertEqual(self.visibles(), [])
        with self.assertRaises(yd.DownloadError) as c:
            self.run_dl(fake_ydl(fail_download=Exception('<urlopen error getaddrinfo failed>')))
        self.assertIn('conectar', str(c.exception))
        self.assertEqual(self.visibles(), [])
        self.assertFalse(os.path.exists(os.path.join(self.dir, yd.TMP_DIRNAME)))

    def test_rechazos_antes_de_bajar(self):
        for info, texto in (({'_type': 'playlist'}, 'lista de reproducción'), ({'is_live': True}, 'en vivo'),
                            ({'live_status': 'is_upcoming'}, 'en vivo'), ({'duration': 5 * 3600}, 'demasiado largo')):
            llamado = []
            with self.assertRaises(yd.DownloadError, msg=str(info)) as c:
                self.run_dl(fake_ydl(info=info, on_download=lambda o: llamado.append(1)))
            self.assertIn(texto, str(c.exception))
            self.assertEqual(llamado, [], 'no debe empezar a bajar')
            self.assertEqual(self.visibles(), [])

    def test_si_yt_dlp_no_entrega_archivo(self):
        with self.assertRaises(yd.DownloadError):
            self.run_dl(fake_ydl(files=()))
        self.assertEqual(self.visibles(), [])

    def test_elige_el_archivo_de_video_mas_grande(self):
        res = self.run_dl(fake_ydl(files=('video.mp4', 'video.f137.mp4')))
        self.assertEqual(len(self.visibles()), 1)
        self.assertTrue(res['file'].endswith('.mp4'))

    def test_conocido_solo_si_el_archivo_sigue_existiendo(self):
        res = self.run_dl(fake_ydl())
        self.assertEqual(yd.known_file(self.dir, VID), res['file'])
        os.remove(os.path.join(self.dir, res['file']))
        self.assertIsNone(yd.known_file(self.dir, VID))

    def test_indice_roto_no_rompe_nada(self):
        with open(os.path.join(self.dir, yd.INDEX_NAME), 'w') as f:
            f.write('{no es json')
        self.assertIsNone(yd.known_file(self.dir, VID))
        self.run_dl(fake_ydl())
        self.assertEqual(yd.known_file(self.dir, VID), 'Un video de prueba.mp4')


if __name__ == '__main__':
    unittest.main()
