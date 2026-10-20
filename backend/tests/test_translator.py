import os
import sys
import threading
import unittest
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import translator as tr  # noqa: E402


def fake_google(merge_when_over=None, fail_first=0, fail_always=False, code=429):
    """Imita la respuesta de Google. Cuenta las solicitudes en .calls y los textos en .texts."""
    state = {'calls': 0, 'texts': []}

    def post(text, src, dst, timeout):
        state['calls'] += 1
        state['texts'].append(text)
        if fail_always or state['calls'] <= fail_first:
            raise urllib.error.HTTPError('http://x', code, 'Too Many Requests', None, None)
        lines = text.split('\n')
        chunks = []
        for li, line in enumerate(lines):
            last_line = li == len(lines) - 1
            # Una oración por trozo, como hace Google ("Ah, perfect. Let's go." → 2 trozos)
            parts = [p for p in line.replace('. ', '.\x00').split('\x00')]
            for pi, part in enumerate(parts):
                closes = pi == len(parts) - 1 and not last_line
                src_chunk = part + ('\n' if closes else (' ' if pi < len(parts) - 1 and not part.endswith(' ') else ''))
                tr_chunk = '«' + part + '»' + ('\n' if closes else ' ' if pi < len(parts) - 1 else '')
                chunks.append([tr_chunk, src_chunk, None, None, 1])
        if merge_when_over and len(lines) > merge_when_over:
            # Google une las dos primeras líneas en un mismo trozo (caso problemático)
            a, b = chunks[0], chunks[1]
            chunks = [[a[0] + b[0], a[1] + b[1], None, None, 1]] + chunks[2:]
        return [chunks, None, 'en']

    post.state = state
    return post


class TranslatorTests(unittest.TestCase):
    def setUp(self):
        tr._memory.clear()
        self.sleeps = []
        self.sleep = self.sleeps.append

    def run_tr(self, lines, post, **kw):
        return tr.translate_lines(lines, _post=post, _sleep=self.sleep, **kw)

    def test_alineacion_basica_una_sola_solicitud(self):
        post = fake_google()
        out = self.run_tr(['Are you good, Dina?', 'Ah, perfect.', 'Good luck.'], post)
        self.assertEqual(out, ['«Are you good, Dina?»', '«Ah, perfect.»', '«Good luck.»'])
        self.assertEqual(post.state['calls'], 1)

    def test_linea_con_varias_oraciones_queda_en_una_sola_linea(self):
        out = self.run_tr(['Wow. That was fast.', 'Okay.'], fake_google())
        self.assertEqual(out, ['«Wow.» «That was fast.»', '«Okay.»'])

    def test_muchas_lineas_se_agrupan_en_pocas_solicitudes(self):
        lines = [f'Frase numero {i}.' for i in range(337)]
        post = fake_google()
        out = self.run_tr(lines, post)
        self.assertEqual(len(out), 337)
        self.assertEqual(out[0], '«Frase numero 0.»')
        self.assertEqual(out[-1], '«Frase numero 336.»')
        self.assertLessEqual(post.state['calls'], 12)   # antes eran 337

    def test_si_google_une_lineas_se_parte_el_lote_y_sale_bien(self):
        lines = ['uno', 'dos', 'tres', 'cuatro']
        post = fake_google(merge_when_over=1)
        out = self.run_tr(lines, post)
        self.assertEqual(out, ['«uno»', '«dos»', '«tres»', '«cuatro»'])
        self.assertGreater(post.state['calls'], 1)

    def test_reintenta_con_espera_creciente_si_google_limita(self):
        post = fake_google(fail_first=2)
        out = self.run_tr(['Hello there.'], post)
        self.assertEqual(out, ['«Hello there.»'])
        self.assertEqual(post.state['calls'], 3)
        self.assertEqual(len(self.sleeps), 2)
        self.assertLess(self.sleeps[0], self.sleeps[1])

    def test_avisa_cuando_google_hace_esperar_y_cuando_se_retoma(self):
        avisos = []
        out = self.run_tr(['Hello there.'], fake_google(fail_first=2), on_status=avisos.append)
        self.assertEqual(out, ['«Hello there.»'])
        self.assertEqual(len(avisos), 4)                       # (esperar, retomar) x 2 reintentos
        self.assertIn('reintentando en', avisos[0])
        self.assertIn('intento 2/5', avisos[0])
        self.assertIsNone(avisos[1])
        self.assertIn('intento 3/5', avisos[2])

    def test_nunca_devuelve_ingles_como_si_fuera_traduccion(self):
        post = fake_google(fail_always=True)
        with self.assertRaises(tr.RateLimited):
            self.run_tr(['Are you good, Dina?'], post)

    def test_error_de_red_es_un_error_claro(self):
        def post(text, src, dst, timeout):
            raise urllib.error.URLError('sin internet')
        with self.assertRaises(tr.TranslationError) as cm:
            self.run_tr(['Hello'], post)
        self.assertIn('conectar', str(cm.exception))

    def test_al_reintentar_solo_pide_lo_que_falta(self):
        lines = [f'Linea {i}.' for i in range(130)]            # 3 lotes de 60/60/10
        calls = {'n': 0}
        ok = fake_google()

        def flaky(text, src, dst, timeout):
            calls['n'] += 1
            if calls['n'] > 1:                                  # el 1er lote sale, el resto falla
                raise urllib.error.HTTPError('http://x', 429, 'Too Many Requests', None, None)
            return ok(text, src, dst, timeout)

        with self.assertRaises(tr.RateLimited):
            self.run_tr(lines, flaky)
        self.assertEqual(len(tr._memory), 60)                   # el progreso quedó guardado

        retry = fake_google()
        out = self.run_tr(lines, retry)
        self.assertEqual(len(out), 130)
        self.assertEqual(out[0], '«Linea 0.»')
        pedidas = sum(t.count('\n') + 1 for t in retry.state['texts'])
        self.assertEqual(pedidas, 70)                           # solo las 70 que faltaban

    def test_repetidas_se_traducen_una_vez_y_las_vacias_quedan_vacias(self):
        post = fake_google()
        out = self.run_tr(['Okay.', '', 'Okay.', '   ', 'Yes.'], post)
        self.assertEqual(out, ['«Okay.»', '', '«Okay.»', '', '«Yes.»'])
        self.assertEqual(post.state['texts'], ['Okay.\nYes.'])

    def test_progreso_y_cancelacion(self):
        progreso = []
        lines = [f'Linea {i}.' for i in range(130)]
        self.run_tr(lines, fake_google(), on_progress=lambda d, t: progreso.append((d, t)))
        self.assertEqual(progreso[0], (0, 130))
        self.assertEqual(progreso[-1], (130, 130))

        tr._memory.clear()
        ev = threading.Event()
        ev.set()
        with self.assertRaises(tr.Cancelled):
            tr.translate_lines(lines, _post=fake_google(), cancel=ev)

    def test_espacios_y_saltos_internos_se_normalizan(self):
        out = self.run_tr(['  Hello \n  world  '], fake_google())
        self.assertEqual(out, ['«Hello world»'])


def fake_lookup(translation='correr', groups=None, fail_always=False, code=429):
    """Respuesta de Google para UNA palabra, con diccionario (dt=bd). Cuenta las solicitudes en .state['calls']."""
    state = {'calls': 0}

    def post(text, src, dst, timeout):
        state['calls'] += 1
        if fail_always:
            raise urllib.error.HTTPError('http://x', code, 'Too Many Requests', None, None)
        chunks = [[translation, text, None, None, 10]] if translation else []
        entries = [[pos, words, []] for pos, words in (groups or [])] or None
        return [chunks, entries, 'en']

    post.state = state
    return post


class LookupWordTests(unittest.TestCase):
    def setUp(self):
        tr._lookup_memory.clear()
        self.slept = []

    def look(self, word, post):
        return tr.lookup_word(word, _post=post, _sleep=self.slept.append)

    def test_devuelve_la_traduccion_y_los_significados_por_categoria(self):
        post = fake_lookup('correr', [('sustantivo', ['marcha', 'Marcha', 'manejo']), ('adjetivo', ['corriente'])])
        out = self.look('running', post)
        self.assertEqual(out['translation'], 'correr')
        self.assertEqual(out['meanings'], [{'pos': 'sustantivo', 'words': ['marcha', 'manejo']},
                                           {'pos': 'adjetivo', 'words': ['corriente']}])

    def test_sin_diccionario_igual_hay_traduccion(self):
        out = self.look("gonna", fake_lookup('ir a'))
        self.assertEqual(out, {'translation': 'ir a', 'meanings': []})

    def test_se_limita_lo_que_se_muestra(self):
        groups = [(f'cat{i}', [f'palabra{j}' for j in range(20)]) for i in range(6)]
        out = self.look('set', fake_lookup('poner', groups))
        self.assertEqual(len(out['meanings']), tr.MAX_MEANING_GROUPS)
        self.assertTrue(all(len(g['words']) == tr.MAX_MEANING_WORDS for g in out['meanings']))

    def test_lo_ya_consultado_no_se_vuelve_a_pedir_y_no_se_comparte_la_copia(self):
        post = fake_lookup('correr')
        first = self.look('run', post)
        first['translation'] = 'CAMBIADO'
        self.assertEqual(self.look('run', post)['translation'], 'correr')
        self.assertEqual(post.state['calls'], 1)

    def test_limitado_por_google_reintenta_poco_y_avisa(self):
        post = fake_lookup(fail_always=True)
        with self.assertRaises(tr.RateLimited):
            self.look('run', post)
        self.assertEqual(post.state['calls'], tr.LOOKUP_RETRIES)      # es interactivo: no se insiste 5 veces
        self.assertEqual(len(self.slept), tr.LOOKUP_RETRIES - 1)
        self.assertLess(self.slept[0], 3)

    def test_sin_traduccion_es_un_error_y_no_se_guarda_en_memoria(self):
        post = fake_lookup(translation='')
        with self.assertRaises(tr.TranslationError):
            self.look('zzz', post)
        with self.assertRaises(tr.TranslationError):
            self.look('zzz', post)
        self.assertEqual(post.state['calls'], 2)

    def test_palabras_que_no_se_pueden_buscar(self):
        for bad in ['', '   ', None, 'x' * 100]:
            with self.assertRaises(tr.TranslationError, msg=repr(bad)):
                self.look(bad, fake_lookup())


if __name__ == '__main__':
    unittest.main(verbosity=2)
