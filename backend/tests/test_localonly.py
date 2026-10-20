import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class LocalOnlyTests(unittest.TestCase):
    """Lo que baja archivos o toca datos personales no debe poder pedirse desde otro dispositivo de la red."""

    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import download_routes
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        app = FastAPI()
        self.peer = {'host': '127.0.0.1'}

        @app.middleware('http')
        async def fake_peer(request, call_next):
            request.scope['client'] = (self.peer['host'], 50000)
            return await call_next(request)

        download_routes.register(app, {'videos_dir': self.tmp.name})
        self.c = TestClient(app)

    def test_descargar_y_cancelar_estan_cerrados_a_la_red(self):
        self.peer['host'] = '192.168.1.50'
        self.assertEqual(self.c.post('/api/download/start', json={'url': 'https://youtu.be/jNQXAC9IVRw'}).status_code, 403)
        self.assertEqual(self.c.post('/api/download/cancel/abc').status_code, 403)

    def test_desde_esta_compu_la_orden_llega_a_validarse(self):
        for host in ('127.0.0.1', '::1', 'localhost'):
            self.peer['host'] = host
            r = self.c.post('/api/download/start', json={'url': 'https://vimeo.com/123456'})
            self.assertEqual(r.status_code, 400, host)       # pasó la guarda: el link no es de YouTube
            self.assertIn('YouTube', r.json()['detail'])


if __name__ == '__main__':
    unittest.main()
