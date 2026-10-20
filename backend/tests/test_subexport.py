import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import subexport as sx  # noqa: E402

HAS_FFMPEG = bool(shutil.which('ffmpeg')) and bool(shutil.which('ffprobe'))
try:
    HAS_ASS = HAS_FFMPEG and sx.has_libass()
except Exception:
    HAS_ASS = False


def sub(a, b, text):
    return {'id': 0, 'start': a, 'end': b, 'phrase': text}


class PureTests(unittest.TestCase):
    def test_tiempo_y_colores_ass(self):
        self.assertEqual(sx.ass_time(0), '0:00:00.00')
        self.assertEqual(sx.ass_time(75.256), '0:01:15.26')
        self.assertEqual(sx.ass_time(3725.5), '1:02:05.50')
        self.assertEqual(sx.c_tag('1c', '#ff8800'), '\\1c&H0088FF&')          # ASS usa BGR
        self.assertEqual(sx.a_tag('3a', 1), '\\3a&H00&')                        # opaco
        self.assertEqual(sx.a_tag('3a', 0), '\\3a&HFF&')                        # invisible
        self.assertEqual(sx.a_tag('3a', .82), '\\3a&H2E&')

    def test_texto_se_limpia_para_ass(self):
        self.assertEqual(sx.clean_text('  hola \n  {mundo} \\N x '), 'hola (mundo) /N x')

    def test_timeline_une_ingles_y_espanol_aunque_no_coincidan(self):
        en = [sub(1, 4, 'Hello')]
        es = [sub(2, 6, 'Hola')]
        tl = sx.timeline(en, es)
        self.assertEqual(tl, [(1, 2, 'Hello', ''), (2, 4, 'Hello', 'Hola'), (4, 6, '', 'Hola')])

    def test_timeline_junta_tramos_iguales_y_aplica_delay(self):
        en = [sub(0, 2, 'A'), sub(2, 4, 'A')]
        self.assertEqual(sx.timeline(en, [], 0), [(0, 4, 'A', '')])
        self.assertEqual(sx.timeline([sub(1, 3, 'A')], [], shift=0.5), [(1.5, 3.5, 'A', '')])

    def test_timeline_recorta_a_la_ventana(self):
        en = [sub(0, 10, 'Largo')]
        self.assertEqual(sx.timeline(en, [], 0, t0=3, t1=5), [(3, 5, 'Largo', '')])
        self.assertEqual(sx.timeline(en, [], 0, t0=20, t1=30), [])

    def test_capas_por_estilo(self):
        geo = sx.Geometry(1280, 720, 400)
        entries = [(0, 2, 'Hello there', '')]
        n = lambda style: len(sx.build_events(entries, geo, style))
        self.assertEqual(n('default'), 2)     # caja + texto
        self.assertEqual(n('comic'), 3)       # borde + caja + texto
        self.assertEqual(n('gothic'), 4)      # borde + caja + brillo + texto
        self.assertEqual(n('shadow'), 2)      # brillo + texto (sin caja)
        self.assertEqual(n('outline'), 1)     # solo texto con contorno
        self.assertEqual(n('estilo-que-no-existe'), 2)   # cae en "default"

    def test_dos_idiomas_son_dos_bloques_apilados_sin_solaparse(self):
        import re
        geo = sx.Geometry(1280, 720, 400)
        ev = sx.build_events([(0, 2, 'Hello there', 'Hola a todos')], geo, 'comic')
        self.assertEqual(len(ev), 6)                                  # 3 capas x 2 idiomas
        texto = lambda lang: [l for l in ev if l.endswith('}' + lang)]
        en, es = texto('Hello there')[-1], texto('Hola a todos')[-1]
        rx = re.compile(r'\\pos\(([\d.]+),([\d.]+)\)\\fs([\d.]+)')
        (_, y_en, fs), (_, y_es, _) = [tuple(map(float, rx.search(l).groups())) for l in (en, es)]
        k = geo.k
        self.assertGreaterEqual(y_es, y_en + fs + 2 * 6 * k + sx.STACK_GAP * k - 0.5)   # el español empieza debajo del inglés + separación

    def test_cada_idioma_puede_ocultarse(self):
        geo = sx.Geometry(1280, 720, 400)
        e = sx.build_events([(0, 2, 'Hello', 'Hola')], geo, 'default', show_en=True, show_es=False)
        self.assertTrue(all('Hello' in l and 'Hola' not in l for l in e))
        e = sx.build_events([(0, 2, 'Hello', 'Hola')], geo, 'default', show_en=False, show_es=True)
        self.assertTrue(all('Hola' in l and 'Hello' not in l for l in e))
        self.assertEqual(sx.build_events([(0, 2, 'Hello', '')], geo, 'default', show_en=False, show_es=True), [])

    def _pos_y_fs(self, line):
        import re
        m = re.search(r'\\pos\(([\d.]+),([\d.]+)\)\\fs([\d.]+)', line)
        return float(m[1]), float(m[2]), float(m[3])

    def test_frase_larguisima_achica_la_letra_y_queda_dentro(self):
        geo = sx.Geometry(1280, 720, 400, size_rem=3)
        corto = sx.build_events([(0, 2, 'Hi', '')], geo, 'default')[-1]
        largo = sx.build_events([(0, 2, 'word ' * 60, 'palabra ' * 60)], geo, 'default')[-1]
        _, _, fs_corto = self._pos_y_fs(corto)
        x, y, fs_largo = self._pos_y_fs(largo)
        self.assertLess(fs_largo, fs_corto * 0.8)
        self.assertTrue(0 < x < 1280 and 0 <= y < 720)

    def test_arrastre_extremo_no_se_sale_del_video(self):
        for off in ({'x': 500, 'y': 500}, {'x': -500, 'y': -500}):
            geo = sx.Geometry(1280, 720, 400, x=off['x'], y=off['y'])
            x, y, _ = self._pos_y_fs(sx.build_events([(0, 2, 'Hello there', 'Hola')], geo, 'default')[-1])
            self.assertTrue(0 < x < 1280, x)
            self.assertTrue(0 <= y < 720, y)

    def test_cinema_pasa_a_mayusculas(self):
        geo = sx.Geometry(1280, 720, 400)
        self.assertIn('HELLO', sx.build_events([(0, 2, 'hello', '')], geo, 'cinema')[-1])

    def test_ass_completo_tiene_resolucion_y_estilos(self):
        geo = sx.Geometry(640, 360, 400)
        ass = sx.build_ass([(0, 1, 'Hi', '')], 640, 360, 'gothic', geo)
        self.assertIn('PlayResX: 640', ass)
        self.assertIn('Style: Txt,Cinzel', ass)
        self.assertIn('Dialogue: 3,0:00:00.00,0:00:01.00,Txt', ass)

    def test_nombres_de_archivo(self):
        self.assertEqual(sx.safe_filename('a/b:c*d?.mp4 '), 'a_b_c_d_.mp4')
        self.assertEqual(sx.safe_filename('...'), 'video')
        d = tempfile.mkdtemp()
        try:
            open(os.path.join(d, 'x.mp4'), 'w').close()
            self.assertTrue(sx.unique_path(d, 'x', '.mp4').endswith('x (2).mp4'))
            self.assertTrue(sx.unique_path(d, 'y', '.mp4').endswith('y.mp4'))
        finally:
            shutil.rmtree(d)

    def test_srt(self):
        t = sx.srt_text([sub(1.5, 3.25, 'Hola'), sub(4, 5, '  ')], shift=1)
        self.assertEqual(t, '1\n00:00:02,500 --> 00:00:04,250\nHola\n')

    def test_filtro_del_fragmento_con_vueltas(self):
        g = sx.build_segment_graph([{'speed': 1, 'ass': 'r0.ass'}, {'speed': 0.75, 'ass': None}], 30, True, 1280, 720, 1280, 720)
        self.assertIn('[0:v]ass=r0.ass:fontsdir=fonts,setpts=PTS/1.0000', g)
        self.assertIn('[1:v]setpts=PTS/0.7500', g)
        self.assertIn('[1:a]atempo=0.7500', g)
        self.assertIn('concat=n=2:v=1:a=1[v][a]', g)
        self.assertNotIn('[a]', sx.build_segment_graph([{'speed': 1, 'ass': None}], 30, False, 1280, 720, 1280, 720))
        self.assertIn('scale=1280:720', sx.build_segment_graph([{'speed': 1, 'ass': None}], 30, False, 1280, 720, 1920, 1080))

    def test_calidad_liviana_baja_a_720p(self):
        self.assertEqual(sx.output_size(1920, 1080, 'liviana'), (1280, 720))
        self.assertEqual(sx.output_size(1920, 1080, 'alta'), (1920, 1080))
        self.assertEqual(sx.output_size(640, 360, 'liviana'), (640, 360))


@unittest.skipUnless(HAS_ASS, 'hace falta ffmpeg con libass')
class FfmpegTests(unittest.TestCase):
    """Exportaciones reales sobre un video de prueba de 3 s generado con ffmpeg."""
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.video = os.path.join(cls.dir, 'prueba.mp4')
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', '-shortest', cls.video], check=True)
        cls.en = [sub(0.2, 1.4, 'Hello from the test'), sub(1.6, 2.8, 'Second line here')]
        cls.es = [sub(0.2, 1.4, 'Hola desde la prueba'), sub(1.6, 2.8, 'Segunda linea aqui')]
        cls.out = os.path.join(cls.dir, 'out')

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def dur(self, p):
        return sx.probe(p)['duration']

    def test_video_con_subtitulos_grabados(self):
        progress = []
        class J:
            def update(self, progress=None, **kw): self_.append(progress)
        self_ = progress
        p = sx.export_video(self.video, self.out, 'prueba.mp4', self.en, self.es,
                            dict(style='default', en=True, es=True, quality='media', ref_h=360), job=J())
        self.assertTrue(os.path.exists(p) and p.endswith('.mp4'))
        info = sx.probe(p)
        self.assertAlmostEqual(info['duration'], 3.0, delta=0.3)
        self.assertTrue(info['has_audio'])
        self.assertEqual((info['width'], info['height']), (640, 360))
        self.assertTrue(progress and max(progress) > 0.5)
        # El fotograma de 0.8 s tiene que ser distinto al del original (hay texto dibujado)
        a, b = os.path.join(self.dir, 'a.png'), os.path.join(self.dir, 'b.png')
        for src, dst in ((self.video, a), (p, b)):
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', '0.8', '-i', src, '-frames:v', '1', dst], check=True)
        from PIL import Image, ImageChops
        d = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB')).convert('L')
        box = d.point(lambda v: 255 if v > 90 else 0).getbbox()      # solo diferencias fuertes (no el ruido del recodificado)
        self.assertIsNotNone(box)
        self.assertGreater(box[1], 360 * 0.5)        # el texto está en la mitad de abajo

    def test_sin_subtitulos_en_los_idiomas_elegidos_avisa(self):
        with self.assertRaises(sx.ExportError):
            sx.export_video(self.video, self.out, 'prueba.mp4', [], self.es, dict(en=True, es=False))

    def test_cancelar_corta_y_no_deja_archivo(self):
        ev = threading.Event()
        ev.set()
        before = set(os.listdir(self.out)) if os.path.isdir(self.out) else set()
        with self.assertRaises(sx.Cancelled):
            sx.export_video(self.video, self.out, 'prueba.mp4', self.en, self.es, dict(en=True, es=True), cancel=ev)
        after = set(os.listdir(self.out)) if os.path.isdir(self.out) else set()
        self.assertEqual(before, after)

    def test_fragmento_con_vueltas_y_velocidades(self):
        reps = [{'speed': 1, 'en': True, 'es': False}, {'speed': 0.5, 'en': True, 'es': True}]
        p = sx.export_segment(self.video, self.out, 'prueba.mp4', 'frag', 0.2, 1.4, reps, self.en, self.es, dict(style='comic', ref_h=360))
        # 1.2 s a velocidad 1 + 1.2 s a 0.5x (= 2.4 s)
        self.assertAlmostEqual(self.dur(p), 1.2 + 2.4, delta=0.35)
        self.assertTrue(sx.probe(p)['has_audio'])

    def test_pistas_seleccionables(self):
        p = sx.export_soft(self.video, self.out, 'prueba.mp4', self.en, self.es, dict(en=True, es=True))
        r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 's', '-show_entries', 'stream=codec_name:stream_tags=language',
                            '-of', 'json', p], capture_output=True, text=True)
        streams = json.loads(r.stdout)['streams']
        self.assertEqual([s['tags']['language'] for s in streams], ['eng', 'spa'])

    def test_vista_previa_devuelve_un_jpeg(self):
        jpg = sx.render_preview(self.video, 0.8, self.en, self.es, dict(style='neon', en=True, es=True, ref_h=360))
        self.assertTrue(jpg[:3] == b'\xff\xd8\xff' and len(jpg) > 2000)


if __name__ == '__main__':
    unittest.main(verbosity=2)
