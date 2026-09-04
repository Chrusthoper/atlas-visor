#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
API REST — Atlas del Perceptrón
================================
Flask sirve dos cosas a la vez:
  1) La API bajo `/api/` (conceptos, senderos, respuestas).
  2) Los archivos estáticos de `build/` en la raíz `/`.

Uso:
    python3 src/backend/app.py            # http://127.0.0.1:5000
    ATLAS_PUERTO=5050 python3 src/backend/app.py

Endpoints (especificación §8.5):
    GET    /api/conceptos          -> 200
    GET    /api/conceptos/<id>     -> 200 | 404
    GET    /api/senderos           -> 200
    GET    /api/respuestas         -> 200
    POST   /api/respuestas         -> 201 | 400
    PUT    /api/respuestas/<id>    -> 200 | 404
    DELETE /api/respuestas/<id>    -> 204 | 404
"""
import json
import os
import sys

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# Permite importar `modelos` tanto si se ejecuta directo como si se importa
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelos  # noqa: E402

# El generador es la única fuente de la lógica de normalización y de las
# notas: la API reutiliza sus funciones para que el frontend reciba
# exactamente los mismos datos que el build embebido (color, preguntas…).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import generador  # noqa: E402

# ------------------------------------------------------------------
# Rutas del proyecto: este archivo vive en <proyecto>/src/backend/
# ------------------------------------------------------------------
DIR_BACKEND = os.path.dirname(os.path.abspath(__file__))
DIR_SRC = os.path.dirname(DIR_BACKEND)
DIR_PROYECTO = os.path.dirname(DIR_SRC)
DIR_BUILD = os.path.join(DIR_PROYECTO, "build")
RUTA_JSON = os.path.join(DIR_SRC, "atlas_data.json")

app = Flask(__name__, static_folder=DIR_BUILD, static_url_path="")
CORS(app)  # CORS abierto para desarrollo (§8.5)


# ------------------------------------------------------------------
# Carga del contenido
# ------------------------------------------------------------------
def cargar_atlas():
    """
    Lee `atlas_data.json` en cada petición.

    Se relee a propósito: así editar el JSON no obliga a reiniciar Flask
    durante el desarrollo (el archivo es pequeño, ~90 KB).

    Se aplica la misma normalización que el generador (color derivado de
    la categoría, `preguntas` como lista, capa `nota` desde los .md) para
    que el frontend reciba una estructura idéntica venga de donde venga.
    """
    with open(RUTA_JSON, "r", encoding="utf-8") as f:
        datos = json.load(f)
    generador.adjuntar_notas(datos)
    return generador.normalizar(datos)


def ids_de_conceptos():
    """Conjunto de IDs válidos, para validar `concepto_id` antes de insertar."""
    return {c["id"] for c in cargar_atlas().get("conceptos", [])}


# ------------------------------------------------------------------
# API: conceptos y senderos
# ------------------------------------------------------------------
@app.get("/api/conceptos")
def api_conceptos():
    """Devuelve conceptos + conexiones + senderos (§8.5)."""
    datos = cargar_atlas()
    return jsonify({
        "meta": datos.get("meta", {}),
        "capas_globales": datos.get("capas_globales", []),
        "conceptos": datos.get("conceptos", []),
        "conexiones": datos.get("conexiones", []),
        "senderos": datos.get("senderos", []),
    }), 200


@app.get("/api/conceptos/<concepto_id>")
def api_concepto(concepto_id):
    """Devuelve un concepto concreto; 404 si el ID no existe."""
    for concepto in cargar_atlas().get("conceptos", []):
        if concepto["id"] == concepto_id:
            return jsonify(concepto), 200
    return jsonify({"error": "Concepto no encontrado: " + concepto_id}), 404


@app.get("/api/senderos")
def api_senderos():
    """Lista de rutas guiadas."""
    return jsonify({"senderos": cargar_atlas().get("senderos", [])}), 200


# ------------------------------------------------------------------
# API: respuestas del usuario (SQLite)
# ------------------------------------------------------------------
@app.get("/api/respuestas")
def api_listar_respuestas():
    """Todas las respuestas guardadas."""
    return jsonify({"respuestas": modelos.listar_respuestas()}), 200


@app.post("/api/respuestas")
def api_crear_respuesta():
    """
    Guarda la respuesta de un concepto.

    Es un upsert: si el concepto ya tenía respuesta, la actualiza y
    devuelve 200; si es nueva, devuelve 201.
    Errores 400: cuerpo no-JSON, falta `concepto_id`, o el ID no existe.
    """
    cuerpo = request.get_json(silent=True)
    if not isinstance(cuerpo, dict):
        return jsonify({"error": "Se esperaba un cuerpo JSON"}), 400

    concepto_id = cuerpo.get("concepto_id")
    if not concepto_id or not isinstance(concepto_id, str):
        return jsonify({"error": "Falta el campo 'concepto_id'"}), 400

    if concepto_id not in ids_de_conceptos():
        return jsonify({
            "error": "El concepto '" + concepto_id + "' no existe en atlas_data.json"
        }), 400

    texto = cuerpo.get("respuesta", "")
    if not isinstance(texto, str):
        return jsonify({"error": "El campo 'respuesta' debe ser texto"}), 400

    registro, fue_creado = modelos.guardar_respuesta(concepto_id, texto)
    return jsonify(registro), (201 if fue_creado else 200)


@app.put("/api/respuestas/<int:respuesta_id>")
def api_actualizar_respuesta(respuesta_id):
    """Actualiza una respuesta por su id numérico; 404 si no existe."""
    cuerpo = request.get_json(silent=True)
    if not isinstance(cuerpo, dict):
        return jsonify({"error": "Se esperaba un cuerpo JSON"}), 400

    texto = cuerpo.get("respuesta")
    if not isinstance(texto, str):
        return jsonify({"error": "El campo 'respuesta' debe ser texto"}), 400

    registro = modelos.actualizar_respuesta(respuesta_id, texto)
    if registro is None:
        return jsonify({"error": "Respuesta no encontrada"}), 404
    return jsonify(registro), 200


@app.delete("/api/respuestas/<int:respuesta_id>")
def api_eliminar_respuesta(respuesta_id):
    """Elimina una respuesta; 204 sin cuerpo si tuvo éxito, 404 si no existe."""
    if modelos.eliminar_respuesta(respuesta_id):
        return "", 204
    return jsonify({"error": "Respuesta no encontrada"}), 404


@app.get("/api/respuestas/<int:respuesta_id>/historial")
def api_historial_respuesta(respuesta_id):
    """
    Historial de cambios de una respuesta.

    Devuelve 404 si la respuesta no existe; 200 con la lista (posiblemente
    vacía) si existe pero aún no tiene cambios registrados.
    """
    if modelos.obtener_por_id(respuesta_id) is None:
        return jsonify({"error": "Respuesta no encontrada"}), 404
    return jsonify({"historial": modelos.historial_de_respuesta(respuesta_id)}), 200


@app.post("/api/respuestas/<int:respuesta_id>/restaurar")
def api_restaurar_respuesta(respuesta_id):
    """
    Restaura una versión anterior de una respuesta.

    Cuerpo: { "version": n }
    404 si la respuesta o la versión no existen; 400 si falta/erróneo version.
    """
    cuerpo = request.get_json(silent=True)
    version = (cuerpo or {}).get("version") if isinstance(cuerpo, dict) else None
    if not isinstance(version, int) or isinstance(version, bool):
        return jsonify({"error": "El campo 'version' debe ser un entero"}), 400

    registro = modelos.restaurar_respuesta(respuesta_id, version)
    if registro is None:
        return jsonify({"error": "Respuesta o versión no encontrada"}), 404
    return jsonify(registro), 200


# ------------------------------------------------------------------
# API: notas personales del usuario
# ------------------------------------------------------------------
@app.get("/api/notas")
def api_listar_notas():
    """Lista todas las notas personales."""
    return jsonify({"notas": modelos.listar_notas()}), 200


@app.get("/api/notas/<concepto_id>")
def api_obtener_nota(concepto_id):
    """Devuelve la nota de un concepto; 404 si no existe."""
    nota = modelos.obtener_nota_por_concepto(concepto_id)
    if nota is None:
        return jsonify({"error": "Nota no encontrada: " + concepto_id}), 404
    return jsonify(nota), 200


@app.post("/api/notas")
def api_guardar_nota():
    """Crea o actualiza la nota de un concepto (upsert). 201/200."""
    cuerpo = request.get_json(silent=True)
    if not isinstance(cuerpo, dict):
        return jsonify({"error": "Se esperaba un cuerpo JSON"}), 400
    concepto_id = cuerpo.get("concepto_id")
    if not concepto_id or not isinstance(concepto_id, str):
        return jsonify({"error": "Falta el campo 'concepto_id'"}), 400
    if concepto_id not in ids_de_conceptos():
        return jsonify({"error": "El concepto '" + concepto_id + "' no existe"}), 400
    contenido = cuerpo.get("contenido", "")
    if not isinstance(contenido, str):
        return jsonify({"error": "El campo 'contenido' debe ser texto"}), 400

    nota, fue_creado = modelos.guardar_nota(concepto_id, contenido)
    return jsonify(nota), (201 if fue_creado else 200)


@app.get("/api/notas/<int:nota_id>/historial")
def api_historial_nota(nota_id):
    """Historial de cambios de una nota; 404 si la nota no existe."""
    if modelos.obtener_nota(nota_id) is None:
        return jsonify({"error": "Nota no encontrada"}), 404
    return jsonify({"historial": modelos.historial_de_nota(nota_id)}), 200


@app.get("/api/versiones")
def api_versiones_contenido():
    """Snapshots de contenido registrados por el generador en cada build."""
    return jsonify({"versiones": modelos.listar_versiones_contenido()}), 200


@app.post("/api/notas/<int:nota_id>/restaurar")
def api_restaurar_nota(nota_id):
    """Restaura una versión de una nota. 404/400 según el fallo."""
    cuerpo = request.get_json(silent=True)
    version = (cuerpo or {}).get("version") if isinstance(cuerpo, dict) else None
    if not isinstance(version, int) or isinstance(version, bool):
        return jsonify({"error": "El campo 'version' debe ser un entero"}), 400
    nota = modelos.restaurar_nota(nota_id, version)
    if nota is None:
        return jsonify({"error": "Nota o versión no encontrada"}), 404
    return jsonify(nota), 200


# ------------------------------------------------------------------
# Estáticos: sirve build/ en la raíz
# ------------------------------------------------------------------
@app.get("/")
def raiz():
    """Entrega build/index.html; avisa si aún no se ha generado."""
    indice = os.path.join(DIR_BUILD, "index.html")
    if not os.path.exists(indice):
        return (
            "<h1>Falta el build</h1>"
            "<p>Ejecuta <code>python3 src/generador.py</code> y recarga.</p>"
        ), 503
    return send_from_directory(DIR_BUILD, "index.html")


@app.errorhandler(404)
def no_encontrado(_error):
    """Responde en JSON para que el frontend pueda interpretar el error."""
    return jsonify({"error": "Recurso no encontrado: " + request.path}), 404


def main():
    """Inicializa la base y arranca el servidor de desarrollo."""
    ruta_db = modelos.inicializar()
    puerto = int(os.environ.get("ATLAS_PUERTO", "5000"))

    if not os.path.exists(os.path.join(DIR_BUILD, "index.html")):
        print("[i] Aviso: no existe build/index.html. Ejecuta: python3 src/generador.py")

    print("Atlas del Perceptrón — API REST")
    print("  build:     " + DIR_BUILD)
    print("  contenido: " + RUTA_JSON)
    print("  base:      " + ruta_db)
    print("  abre:      http://127.0.0.1:" + str(puerto))
    app.run(host="0.0.0.0", port=puerto, debug=False)


if __name__ == "__main__":
    main()
