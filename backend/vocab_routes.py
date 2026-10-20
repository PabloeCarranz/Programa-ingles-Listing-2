"""Rutas de la API de "Mis palabras" (vocabulario guardado + repaso).

Se registran desde main.py con `register(app, ctx)`; ctx trae la carpeta de videos.
"""
from typing import Optional

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel

import translator
import vocab
from localonly import local_only


class AddBody(BaseModel):
    word: str
    translation: str
    example: dict
    meanings: Optional[list] = None


class EditBody(BaseModel):
    translation: str


class ReviewBody(BaseModel):
    grade: str


def register(app, ctx):
    store = vocab.VocabStore(ctx['videos_dir'])

    def guarded(fn, *args):
        try:
            return fn(*args)
        except vocab.VocabError as e:
            raise HTTPException(400, str(e))
        except KeyError:
            raise HTTPException(404, 'Esa palabra ya no está guardada.')

    @app.get('/api/vocab')
    def vocab_list(request: Request):
        local_only(request)
        return {'now': store.clock(), 'words': store.all()}

    @app.get('/api/vocab/lookup')
    def vocab_lookup(request: Request, word: str = Query(..., max_length=200)):
        local_only(request)
        try:
            return translator.lookup_word(word)
        except translator.RateLimited as e:
            raise HTTPException(429, str(e))
        except translator.TranslationError as e:
            raise HTTPException(502, str(e))

    @app.post('/api/vocab')
    def vocab_add(body: AddBody, request: Request):
        local_only(request)
        card, created = guarded(store.add, body.word, body.translation, body.example, body.meanings)
        return {'card': card, 'created': created}

    @app.put('/api/vocab/{card_id}')
    def vocab_edit(card_id: str, body: EditBody, request: Request):
        local_only(request)
        return guarded(store.update, card_id, body.translation)

    @app.delete('/api/vocab/{card_id}')
    def vocab_delete(card_id: str, request: Request):
        local_only(request)
        guarded(store.remove, card_id)
        return {'ok': True}

    @app.post('/api/vocab/{card_id}/review')
    def vocab_review(card_id: str, body: ReviewBody, request: Request):
        local_only(request)
        return guarded(store.review, card_id, body.grade)

    return store
