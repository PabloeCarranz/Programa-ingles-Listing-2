import glob
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import translator  # noqa: E402
import vocab  # noqa: E402

DAY = 86400


def example(video='Wednesday.mp4', start=12.5, end=15.0, en='I was running late.', es='Yo llegaba tarde.'):
    return {'video': video, 'start': start, 'end': end, 'en': en, 'es': es}


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.clock = Clock()
        self.store = vocab.VocabStore(self.tmp.name, clock=self.clock)

    # ── guardar ──
    def test_guarda_una_palabra_nueva_normalizada(self):
        card, created = self.store.add('  Don’t! ', ' no  hagas ', example())
        self.assertTrue(created)
        self.assertEqual(card['word'], "don't")
        self.assertEqual(card['translation'], 'no hagas')
        self.assertEqual((card['box'], card['due'], card['reps']), (0, 0, 0))
        self.assertEqual(len(card['examples']), 1)
        self.assertEqual(set(card['preview']), set(vocab.GRADES))
        self.assertEqual([c['word'] for c in self.store.all()], ["don't"])

    def test_la_misma_palabra_suma_ejemplos_y_no_cambia_la_traduccion(self):
        self.store.add('running', 'correr', example(start=1, end=2))
        card, created = self.store.add('Running', 'corriendo', example(start=30, end=33, en='Keep running.'))
        self.assertFalse(created)
        self.assertEqual(card['translation'], 'correr')          # lo que el usuario ya había elegido
        self.assertEqual([e['start'] for e in card['examples']], [1.0, 30.0])
        self.assertEqual(len(self.store.all()), 1)

    def test_el_mismo_ejemplo_no_se_duplica(self):
        self.store.add('run', 'correr', example())
        card, _ = self.store.add('run', 'correr', example(en='otro texto'))
        self.assertEqual(len(card['examples']), 1)
        self.assertEqual(card['examples'][0]['en'], 'otro texto')

    def test_se_conservan_los_ejemplos_mas_nuevos(self):
        for i in range(vocab.MAX_EXAMPLES + 3):
            card, _ = self.store.add('run', 'correr', example(start=i, end=i + 1))
        starts = [e['start'] for e in card['examples']]
        self.assertEqual(len(starts), vocab.MAX_EXAMPLES)
        self.assertEqual(starts[-1], float(vocab.MAX_EXAMPLES + 2))
        self.assertNotIn(0.0, starts)

    def test_los_significados_se_limpian(self):
        card, _ = self.store.add('set', 'poner', example(),
                                 [{'pos': 'sustantivo', 'words': ['conjunto', '', 5, 'juego']}, 'basura', {'words': []}])
        self.assertEqual(card['meanings'], [{'pos': 'sustantivo', 'words': ['conjunto', 'juego']}])

    # ── datos inválidos ──
    def test_rechaza_palabras_que_no_son_palabras(self):
        for bad in ['', '   ', '123', '!!!', '_', 'a' * (vocab.MAX_WORD + 1), None, 5]:
            with self.assertRaises(vocab.VocabError, msg=repr(bad)):
                self.store.add(bad, 'x', example())

    def test_rechaza_traduccion_vacia_o_enorme(self):
        for bad in ['', '   ', None, 'x' * (vocab.MAX_TRANSLATION + 1)]:
            with self.assertRaises(vocab.VocabError, msg=repr(bad)):
                self.store.add('run', bad, example())

    def test_rechaza_ejemplos_invalidos(self):
        bad_examples = [
            None, 'texto', {},
            example(video='../secreto.mp4'), example(video='a/b.mp4'), example(video='a\\b.mp4'), example(video='.subtitles'),
            example(video=''), example(start=5, end=5), example(start=6, end=5), example(start=-1, end=2),
            example(start=float('nan'), end=2), example(start=0, end=float('inf')), example(start='abc'),
            example(en='x' * (vocab.MAX_SENTENCE + 1)),
        ]
        for ex in bad_examples:
            with self.assertRaises(vocab.VocabError, msg=repr(ex)):
                self.store.add('run', 'correr', ex)
        self.assertEqual(self.store.all(), [])

    # ── archivo ──
    def test_queda_guardado_y_sin_archivos_temporales(self):
        self.store.add('run', 'correr', example())
        again = vocab.VocabStore(self.tmp.name, clock=self.clock)
        self.assertEqual([c['word'] for c in again.all()], ['run'])
        self.assertEqual(glob.glob(os.path.join(self.tmp.name, '*.tmp')), [])

    def test_un_archivo_danado_se_aparta_y_no_se_pisa(self):
        path = os.path.join(self.tmp.name, vocab.FILE_NAME)
        with open(path, 'w', encoding='utf-8') as f:
            f.write('{ esto no es json')
        self.assertEqual(self.store.all(), [])
        kept = glob.glob(path + '.corrupto-*')
        self.assertEqual(len(kept), 1)
        with open(kept[0], encoding='utf-8') as f:
            self.assertEqual(f.read(), '{ esto no es json')
        self.store.add('run', 'correr', example())            # y se puede seguir usando
        self.assertEqual(len(self.store.all()), 1)

    def test_el_archivo_tiene_la_forma_esperada(self):
        self.store.add('run', 'correr', example())
        with open(os.path.join(self.tmp.name, vocab.FILE_NAME), encoding='utf-8') as f:
            data = json.load(f)
        self.assertEqual(data[0]['word'], 'run')
        self.assertNotIn('preview', data[0])                   # lo calculado no se guarda

    def test_la_lista_viene_con_lo_mas_nuevo_primero(self):
        for w in ['uno', 'dos', 'tres']:
            self.clock.t += 10
            self.store.add(w, w, example())
        self.assertEqual([c['word'] for c in self.store.all()], ['tres', 'dos', 'uno'])

    def test_varios_hilos_guardando_a_la_vez_no_pierden_palabras(self):
        words = [f'palabra{chr(97 + i)}' for i in range(20)]
        threads = [threading.Thread(target=lambda w=w: self.store.add(w, 'x', example())) for w in words]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(c['word'] for c in self.store.all()), sorted(words))

    # ── editar / borrar ──
    def test_editar_y_borrar(self):
        card, _ = self.store.add('set', 'poner', example())
        self.assertEqual(self.store.update(card['id'], '  conjunto ')['translation'], 'conjunto')
        with self.assertRaises(vocab.VocabError):
            self.store.update(card['id'], '  ')
        self.store.remove(card['id'])
        self.assertEqual(self.store.all(), [])
        with self.assertRaises(KeyError):
            self.store.remove(card['id'])
        with self.assertRaises(KeyError):
            self.store.update('nope', 'x')

    # ── repaso ──
    def test_tarjeta_nueva_esta_para_repasar_ya(self):
        card, _ = self.store.add('run', 'correr', example())
        self.assertLessEqual(card['due'], self.clock.t)

    def test_cada_respuesta_programa_distinto(self):
        card, _ = self.store.add('run', 'correr', example())
        cid = card['id']
        c = self.store.review(cid, 'again')
        self.assertEqual((c['box'], c['due'], c['lapses'], c['reps']), (0, self.clock.t + 600, 1, 1))
        c = self.store.review(cid, 'hard')
        self.assertEqual((c['box'], c['due']), (0, self.clock.t + 3600))
        c = self.store.review(cid, 'good')
        self.assertEqual((c['box'], c['due']), (1, self.clock.t + DAY))
        c = self.store.review(cid, 'good')
        self.assertEqual((c['box'], c['due']), (2, self.clock.t + 3 * DAY))
        c = self.store.review(cid, 'hard')
        self.assertEqual((c['box'], c['due']), (2, self.clock.t + int(1.5 * DAY)))
        c = self.store.review(cid, 'easy')
        self.assertEqual((c['box'], c['due']), (4, self.clock.t + 14 * DAY))
        self.assertEqual((c['reps'], c['lapses'], c['last']), (6, 1, self.clock.t))

    def test_olvidar_manda_la_tarjeta_al_principio(self):
        card, _ = self.store.add('run', 'correr', example())
        for _ in range(3):
            self.store.review(card['id'], 'good')
        self.assertEqual(self.store.review(card['id'], 'again')['box'], 0)

    def test_la_caja_tiene_tope(self):
        card, _ = self.store.add('run', 'correr', example())
        for _ in range(20):
            c = self.store.review(card['id'], 'easy')
        self.assertEqual(c['box'], vocab.MAX_BOX)
        self.assertEqual(c['due'], self.clock.t + vocab.INTERVALS[-1] * DAY)

    def test_los_tiempos_de_los_botones_son_los_que_despues_se_aplican(self):
        for box in range(vocab.MAX_BOX + 1):
            for grade in vocab.GRADES:
                card = {'box': box}
                shown = vocab.previews(card)[grade]
                vocab.apply_review(card, grade, 1000)
                self.assertEqual(card['due'] - 1000, shown, (box, grade))

    def test_respuesta_inexistente(self):
        card, _ = self.store.add('run', 'correr', example())
        with self.assertRaises(vocab.VocabError):
            self.store.review(card['id'], 'perfect')
        with self.assertRaises(KeyError):
            self.store.review('nope', 'good')


class RoutesTests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import vocab_routes
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        app = FastAPI()
        self.peer = {'host': '127.0.0.1'}

        @app.middleware('http')
        async def fake_peer(request, call_next):         # TestClient se presenta como "testclient": acá se elige quién llama
            request.scope['client'] = (self.peer['host'], 50000)
            return await call_next(request)

        self.store = vocab_routes.register(app, {'videos_dir': self.tmp.name})
        self.c = TestClient(app)
        translator._lookup_memory.clear()

    def add(self, **over):
        body = {'word': 'running', 'translation': 'correr', 'example': example(), 'meanings': None}
        body.update(over)
        return self.c.post('/api/vocab', json=body)

    def test_flujo_completo(self):
        r = self.c.get('/api/vocab').json()
        self.assertEqual(r['words'], [])
        self.assertIn('now', r)
        r = self.add()
        self.assertEqual(r.status_code, 200)
        card = r.json()['card']
        self.assertTrue(r.json()['created'])
        self.assertFalse(self.add().json()['created'])
        r = self.c.put(f"/api/vocab/{card['id']}", json={'translation': 'corriendo'})
        self.assertEqual(r.json()['translation'], 'corriendo')
        r = self.c.post(f"/api/vocab/{card['id']}/review", json={'grade': 'good'})
        self.assertEqual((r.json()['box'], r.status_code), (1, 200))
        self.assertEqual(len(self.c.get('/api/vocab').json()['words']), 1)
        self.assertEqual(self.c.delete(f"/api/vocab/{card['id']}").json(), {'ok': True})
        self.assertEqual(self.c.get('/api/vocab').json()['words'], [])

    def test_errores_claros(self):
        r = self.add(word='123')
        self.assertEqual(r.status_code, 400)
        self.assertIn('no se puede guardar', r.json()['detail'])
        self.assertEqual(self.add(example={'video': '../x.mp4', 'start': 0, 'end': 1}).status_code, 400)
        self.assertEqual(self.c.put('/api/vocab/nope', json={'translation': 'x'}).status_code, 404)
        self.assertEqual(self.c.delete('/api/vocab/nope').status_code, 404)
        self.assertEqual(self.c.post('/api/vocab/nope/review', json={'grade': 'good'}).status_code, 404)
        cid = self.add().json()['card']['id']
        self.assertEqual(self.c.post(f'/api/vocab/{cid}/review', json={'grade': 'xx'}).status_code, 400)
        self.assertEqual(self.c.put(f'/api/vocab/{cid}', json={'translation': ' '}).status_code, 400)

    def test_solo_se_puede_usar_desde_esta_compu(self):
        cid = self.store.add('run', 'correr', example())[0]['id']
        self.peer['host'] = '192.168.1.50'               # otro dispositivo de la red
        calls = [
            self.c.get('/api/vocab'), self.c.get('/api/vocab/lookup', params={'word': 'x'}), self.add(),
            self.c.put(f'/api/vocab/{cid}', json={'translation': 'x'}), self.c.delete(f'/api/vocab/{cid}'),
            self.c.post(f'/api/vocab/{cid}/review', json={'grade': 'good'}),
        ]
        self.assertEqual([r.status_code for r in calls], [403] * 6)
        card = self.store.all()[0]
        self.assertEqual((len(self.store.all()), card['translation'], card['reps']), (1, 'correr', 0))   # no se tocó nada
        for host in ('127.0.0.1', '::1'):
            self.peer['host'] = host
            self.assertEqual(self.c.get('/api/vocab').status_code, 200, host)

    def test_buscar_una_palabra(self):
        data = [[['correr', 'running', None, None, 10]], [['sustantivo', ['marcha'], []]], 'en']
        with mock.patch.object(translator, '_http_lookup', return_value=data):
            r = self.c.get('/api/vocab/lookup', params={'word': 'running'})
        self.assertEqual(r.json(), {'translation': 'correr', 'meanings': [{'pos': 'sustantivo', 'words': ['marcha']}]})

    def test_buscar_cuando_google_falla(self):
        with mock.patch.object(translator, 'lookup_word', side_effect=translator.RateLimited('Google limita')):
            self.assertEqual(self.c.get('/api/vocab/lookup', params={'word': 'x'}).status_code, 429)
        with mock.patch.object(translator, 'lookup_word', side_effect=translator.TranslationError('sin internet')):
            r = self.c.get('/api/vocab/lookup', params={'word': 'x'})
        self.assertEqual((r.status_code, r.json()['detail']), (502, 'sin internet'))


if __name__ == '__main__':
    unittest.main()
