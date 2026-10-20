import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import jobs  # noqa: E402


class JobStateTests(unittest.TestCase):
    def test_clock(self):
        self.assertEqual(jobs.clock(75), '1:15')
        self.assertEqual(jobs.clock(3700), '1:01:40')
        self.assertEqual(jobs.clock(-3), '0:00')

    def test_estado_idle_si_no_existe(self):
        self.assertEqual(jobs.snap(None), {'status': 'idle'})

    def test_eta_baja_con_el_tiempo_entre_actualizaciones(self):
        with mock.patch('time.time') as t:
            t.return_value = 1000.0
            job = jobs.JobState('x')
            job.begin_phase('Transcribiendo')
            t.return_value = 1010.0            # 10 s después ya va el 25 %
            job.update(progress=0.25)
            eta0 = job.eta()
            t.return_value = 1015.0            # 5 s más sin avance nuevo
            eta5 = job.eta()
            self.assertAlmostEqual(eta0, 30.0, places=1)    # 10 s hicieron 25 % → faltan 30 s
            self.assertAlmostEqual(eta5, 25.0, places=1)    # cuenta hacia atrás
            t.return_value = 1100.0
            self.assertEqual(job.eta(), 0.0)                # nunca negativo

    def test_sin_estimacion_hasta_tener_datos_confiables(self):
        job = jobs.JobState('x')
        self.assertIsNone(job.snapshot()['eta'])
        job.update(progress=0.01)
        self.assertIsNone(job.snapshot()['eta'])

    def test_snapshot_incluye_resultado_al_terminar(self):
        job = jobs.JobState('x')
        job.done(subs=[{'id': 0}])
        s = job.snapshot()
        self.assertEqual((s['status'], s['progress'], s['subs']), ('done', 1.0, [{'id': 0}]))
        self.assertIsNone(s['eta'])

    def test_error(self):
        job = jobs.JobState('x')
        job.fail('boom')
        s = job.snapshot()
        self.assertEqual((s['status'], s['msg']), ('error', 'boom'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
