"""Acciones que solo se pueden pedir desde la computadora donde corre el programa.

El servidor escucha en toda la red (lo necesita el control remoto desde el celular) y acepta cualquier origen,
así que lo que baja archivos, gasta tu conexión o toca tus datos personales no debe estar abierto a los demás.
"""
from fastapi import HTTPException, Request

LOCAL_HOSTS = ('127.0.0.1', '::1', 'localhost')


def local_only(request: Request):
    host = request.client.host if request.client else ''
    if host not in LOCAL_HOSTS:
        raise HTTPException(403, 'Esta acción solo se puede hacer desde la computadora donde corre el programa.')
