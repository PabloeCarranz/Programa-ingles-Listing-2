import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import transcriber as tc  # noqa: E402


def w(start, end, word):
    return {'start': start, 'end': end, 'word': word}


class SplitOnPauses(unittest.TestCase):
    def test_sin_pausas_queda_un_grupo(self):
        words = [w(0.0, 0.4, ' Hello'), w(0.5, 0.9, ' there'), w(1.2, 1.6, ' friend.')]
        self.assertEqual(tc.split_on_pauses(words), [words])

    def test_corta_donde_hay_silencio_largo(self):
        a, b, c = w(0.0, 0.5, ' Rusty'), w(0.6, 1.0, ' stove.'), w(3.0, 3.4, ' Notice')
        self.assertEqual(tc.split_on_pauses([a, b, c]), [[a, b], [c]])

    def test_pausa_justo_en_el_limite_no_corta(self):
        a, b = w(0.0, 0.5, ' One'), w(0.5 + tc.PAUSE_SPLIT, 2.0, ' two')
        self.assertEqual(tc.split_on_pauses([a, b]), [[a, b]])

    def test_lista_vacia(self):
        self.assertEqual(tc.split_on_pauses([]), [])


class SegmentsToSubs(unittest.TestCase):
    def test_arma_frases_con_los_tiempos_de_las_palabras(self):
        seg = {'start': 0.0, 'end': 5.0, 'text': ' So contained, it has a stove.',
               'words': [w(0.12, 0.4, ' So'), w(0.5, 1.0, ' contained,'), w(3.0, 3.3, ' it'), w(3.4, 4.567, ' has')]}
        self.assertEqual(tc.segments_to_subs([seg]), [
            {'id': 0, 'start': 0.12, 'end': 1.0, 'phrase': 'So contained,'},
            {'id': 1, 'start': 3.0, 'end': 4.57, 'phrase': 'it has'},
        ])

    def test_segmento_sin_palabras_usa_el_texto_entero(self):
        seg = {'start': 1.0, 'end': 2.5, 'text': ' Hi. ', 'words': []}
        self.assertEqual(tc.segments_to_subs([seg]), [{'id': 0, 'start': 1.0, 'end': 2.5, 'phrase': 'Hi.'}])

    def test_saltea_vacios_y_numera_seguido(self):
        segs = [{'start': 0, 'end': 1, 'text': '  ', 'words': []},
                {'start': 1, 'end': 2, 'text': ' A', 'words': []},
                {'start': 2, 'end': 3, 'text': ' B', 'words': []}]
        self.assertEqual([s['id'] for s in tc.segments_to_subs(segs)], [0, 1])


if __name__ == '__main__':
    unittest.main()
