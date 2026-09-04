#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Modelos de datos — Atlas del Perceptrón
========================================
Capa de acceso a SQLite. Aísla todo el SQL para que `app.py` solo
se ocupe de las rutas HTTP.

Tabla `respuestas` (según especificación §8.5):
    id            INTEGER PRIMARY KEY AUTOINCREMENT
    concepto_id   TEXT      -- id del concepto en atlas_data.json
    respuesta     TEXT      -- texto escrito por el usuario
    creado_en     TIMESTAMP
    actualizado_en TIMESTAMP

Regla conceptual (§11.5): **una respuesta por `concepto_id`**, por eso
`concepto_id` lleva un índice UNIQUE.

Historial de respuestas (repo de datos "más allá de Git"):
    La tabla `respuestas_historial` guarda cada cambio de una respuesta.
    El usuario puede restaurar una versión anterior vía la API. Solo se
    registra una fila cuando el texto realmente cambia.
"""
import os
import sqlite3
from datetime import datetime, timezone

# La base vive junto a este módulo: src/backend/respuestas.db
DIR_BACKEND = os.path.dirname(os.path.abspath(__file__))
RUTA_DB = os.path.join(DIR_BACKEND, "respuestas.db")

ESQUEMA = """
CREATE TABLE IF NOT EXISTS respuestas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    concepto_id    TEXT NOT NULL,
    respuesta      TEXT NOT NULL DEFAULT '',
    creado_en      TIMESTAMP NOT NULL,
    actualizado_en TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_respuestas_concepto
    ON respuestas (concepto_id);

CREATE TABLE IF NOT EXISTS respuestas_historial (
    historial_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    respuesta_id       INTEGER NOT NULL REFERENCES respuestas(id) ON DELETE CASCADE,
    concepto_id        TEXT NOT NULL,
    version            INTEGER NOT NULL,
    respuesta_anterior TEXT NOT NULL DEFAULT '',
    respuesta_nueva    TEXT NOT NULL DEFAULT '',
    cambiado_en        TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_historial_respuesta
    ON respuestas_historial (respuesta_id);
"""


def ahora():
    """Marca de tiempo ISO-8601 en UTC (sin microsegundos)."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def conectar():
    """Abre una conexión con filas accesibles por nombre de columna."""
    con = sqlite3.connect(RUTA_DB)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def inicializar():
    """Crea la tabla y el índice si aún no existen (idempotente)."""
    with conectar() as con:
        con.executescript(ESQUEMA)
    return RUTA_DB


def _fila_a_dict(fila):
    """Convierte una fila sqlite3.Row en un diccionario JSON-serializable."""
    if fila is None:
        return None
    return {
        "id": fila["id"],
        "concepto_id": fila["concepto_id"],
        "respuesta": fila["respuesta"],
        "creado_en": fila["creado_en"],
        "actualizado_en": fila["actualizado_en"],
    }


def listar_respuestas():
    """Devuelve todas las respuestas ordenadas por concepto."""
    with conectar() as con:
        filas = con.execute(
            "SELECT * FROM respuestas ORDER BY concepto_id"
        ).fetchall()
    return [_fila_a_dict(f) for f in filas]


def obtener_por_id(respuesta_id):
    """Devuelve una respuesta por su clave primaria, o None."""
    with conectar() as con:
        fila = con.execute(
            "SELECT * FROM respuestas WHERE id = ?", (respuesta_id,)
        ).fetchone()
    return _fila_a_dict(fila)


def obtener_por_concepto(concepto_id):
    """Devuelve la respuesta asociada a un concepto, o None."""
    with conectar() as con:
        fila = con.execute(
            "SELECT * FROM respuestas WHERE concepto_id = ?", (concepto_id,)
        ).fetchone()
    return _fila_a_dict(fila)


def _registrar_historial(con, respuesta_id, concepto_id, texto_anterior, texto_nuevo, momento):
    """Escribe una fila de historial con la siguiente versión disponible."""
    fila = con.execute(
        "SELECT COALESCE(MAX(version), 0) AS ultima FROM respuestas_historial "
        "WHERE respuesta_id = ?",
        (respuesta_id,),
    ).fetchone()
    siguiente = int(fila["ultima"]) + 1
    con.execute(
        "INSERT INTO respuestas_historial "
        "(respuesta_id, concepto_id, version, respuesta_anterior, respuesta_nueva, cambiado_en) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (respuesta_id, concepto_id, siguiente, texto_anterior, texto_nuevo, momento),
    )


def guardar_respuesta(concepto_id, texto):
    """
    Inserta o actualiza la respuesta de un concepto (upsert).

    Devuelve la tupla (registro, fue_creado) donde `fue_creado` indica si
    hubo un INSERT (para que la API pueda responder 201 vs 200).

    Registra una fila en `respuestas_historial` SOLO cuando el texto
    cambia con respecto al actual (evita ruido en el historial).
    """
    momento = ahora()
    with conectar() as con:
        existente = con.execute(
            "SELECT id, respuesta FROM respuestas WHERE concepto_id = ?", (concepto_id,)
        ).fetchone()

        if existente is None:
            cur = con.execute(
                "INSERT INTO respuestas (concepto_id, respuesta, creado_en, actualizado_en) "
                "VALUES (?, ?, ?, ?)",
                (concepto_id, texto, momento, momento),
            )
            nuevo_id = cur.lastrowid
            _registrar_historial(con, nuevo_id, concepto_id, "", texto, momento)
            fue_creado = True
        else:
            nuevo_id = existente["id"]
            if existente["respuesta"] != texto:
                con.execute(
                    "UPDATE respuestas SET respuesta = ?, actualizado_en = ? WHERE id = ?",
                    (texto, momento, nuevo_id),
                )
                _registrar_historial(
                    con, nuevo_id, concepto_id, existente["respuesta"], texto, momento
                )
            fue_creado = False

    return obtener_por_id(nuevo_id), fue_creado


def actualizar_respuesta(respuesta_id, texto):
    """Actualiza el texto de una respuesta existente. None si no existe."""
    with conectar() as con:
        existente = con.execute(
            "SELECT id, concepto_id, respuesta FROM respuestas WHERE id = ?", (respuesta_id,)
        ).fetchone()
        if existente is None:
            return None
        if existente["respuesta"] != texto:
            con.execute(
                "UPDATE respuestas SET respuesta = ?, actualizado_en = ? WHERE id = ?",
                (texto, ahora(), respuesta_id),
            )
            _registrar_historial(
                con, respuesta_id, existente["concepto_id"],
                existente["respuesta"], texto, ahora(),
            )
    return obtener_por_id(respuesta_id)


def eliminar_respuesta(respuesta_id):
    """Borra una respuesta. Devuelve True si existía."""
    with conectar() as con:
        cur = con.execute("DELETE FROM respuestas WHERE id = ?", (respuesta_id,))
        return cur.rowcount > 0


# ------------------------------------------------------------------
# Historial de respuestas
# ------------------------------------------------------------------
def historial_de_respuesta(respuesta_id):
    """Devuelve el historial de cambios de una respuesta, más reciente primero."""
    with conectar() as con:
        filas = con.execute(
            "SELECT historial_id, respuesta_id, concepto_id, version, "
            "respuesta_anterior, respuesta_nueva, cambiado_en "
            "FROM respuestas_historial WHERE respuesta_id = ? "
            "ORDER BY version DESC",
            (respuesta_id,),
        ).fetchall()
    return [
        {
            "historial_id": f["historial_id"],
            "respuesta_id": f["respuesta_id"],
            "concepto_id": f["concepto_id"],
            "version": f["version"],
            "respuesta_anterior": f["respuesta_anterior"],
            "respuesta_nueva": f["respuesta_nueva"],
            "cambiado_en": f["cambiado_en"],
        }
        for f in filas
    ]


def restaurar_respuesta(respuesta_id, version):
    """
    Restaura una versión concreta de una respuesta.

    Copia el texto de esa versión a la respuesta actual y deja esa
    restauración registrada en el historial como una nueva versión.
    Devuelve None si la respuesta no existe o si la versión no existe.
    """
    with conectar() as con:
        actual = con.execute(
            "SELECT id, concepto_id, respuesta FROM respuestas WHERE id = ?", (respuesta_id,)
        ).fetchone()
        if actual is None:
            return None

        version_fila = con.execute(
            "SELECT respuesta_nueva FROM respuestas_historial "
            "WHERE respuesta_id = ? AND version = ?",
            (respuesta_id, version),
        ).fetchone()
        if version_fila is None:
            return None

        texto_restaurado = version_fila["respuesta_nueva"]

        if actual["respuesta"] != texto_restaurado:
            con.execute(
                "UPDATE respuestas SET respuesta = ?, actualizado_en = ? WHERE id = ?",
                (texto_restaurado, ahora(), respuesta_id),
            )
            _registrar_historial(
                con, respuesta_id, actual["concepto_id"],
                actual["respuesta"], texto_restaurado, ahora(),
            )

    return obtener_por_id(respuesta_id)


if __name__ == "__main__":
    print("Base inicializada en: " + inicializar())
