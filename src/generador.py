#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generador del Atlas del Perceptrón v2.0
========================================
Lee `src/atlas_data.json`, lo valida, lo normaliza y produce `build/`.

A diferencia de la v1 (que dibujaba un SVG estático), aquí el grafo lo
construye **Cytoscape.js** en el navegador: este script solo emite el
esqueleto HTML e inyecta los datos como respaldo (`ATLAS_DATA`) para
cuando la API no esté disponible.

Uso:
    python3 src/generador.py

Salida:
    build/index.html   (layout + ATLAS_DATA embebido)
    build/styles.css   (copia de src/styles.css)
    build/app.js       (copia de src/app.js)
    build/vendor/      (Cytoscape.js + KaTeX locales, sin internet)
"""
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone

# Rutas: el script vive en <proyecto>/src/generador.py
DIR_SRC = os.path.dirname(os.path.abspath(__file__))
DIR_PROYECTO = os.path.dirname(DIR_SRC)
DIR_BUILD = os.path.join(DIR_PROYECTO, "build")
RUTA_JSON = os.path.join(DIR_SRC, "atlas_data.json")
DIR_NOTAS = os.path.join(DIR_SRC, "notas")
DIR_VENDOR_SRC = os.path.join(DIR_SRC, "vendor")
DIR_VENDOR_BUILD = os.path.join(DIR_BUILD, "vendor")
RUTA_DB = os.path.join(DIR_SRC, "backend", "respuestas.db")

# Paleta por categoría (§5.6). Sirve para derivar `color` si falta.
PALETA_CATEGORIA = {
    "componente": "#FFB84D",
    "operacion": "#61dafb",
    "proceso": "#69b3a2",
    "limitacion": "#ff6b6b",
    "evolucion": "#C9A0FF",
}

CATEGORIAS_VALIDAS = set(PALETA_CATEGORIA.keys())

# Recursos que deben existir en src/vendor/ para funcionar sin internet
VENDOR_REQUERIDO = [
    "cytoscape.min.js",
    os.path.join("katex", "katex.min.js"),
    os.path.join("katex", "katex.min.css"),
]


# ------------------------------------------------------------------
# Carga
# ------------------------------------------------------------------
def cargar_datos():
    """Lee y decodifica atlas_data.json."""
    if not os.path.exists(RUTA_JSON):
        sys.exit("[ERROR] No existe " + RUTA_JSON)
    try:
        with open(RUTA_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        sys.exit("[ERROR] JSON inválido en atlas_data.json: " + str(e))


def adjuntar_notas(datos):
    """
    Añade la capa `nota` a cada concepto que tenga `src/notas/<id>.md`.

    Es una extensión sobre el esquema de la especificación: permite al
    usuario escribir apuntes propios en markdown (§Fase 6).
    """
    if not os.path.isdir(DIR_NOTAS):
        return 0
    adjuntadas = 0
    for concepto in datos.get("conceptos", []):
        ruta = os.path.join(DIR_NOTAS, concepto["id"] + ".md")
        if os.path.exists(ruta):
            with open(ruta, "r", encoding="utf-8") as f:
                concepto.setdefault("capas", {})["nota"] = {"markdown": f.read()}
            adjuntadas += 1
    return adjuntadas


# ------------------------------------------------------------------
# Normalización
# ------------------------------------------------------------------
def normalizar(datos):
    """
    Rellena los campos derivables para que el frontend no tenga que
    hacer suposiciones:

    - `color`: se deriva de `categoria` con la paleta §5.6 si no viene.
    - `radio`: 50 px por defecto (§4.2).
    - `preguntas`: se unifica siempre como lista, porque hay conceptos
      con varias preguntas (p. ej. `pesos` -> P4 y P5).
    """
    for concepto in datos.get("conceptos", []):
        categoria = concepto.get("categoria", "componente")
        if not concepto.get("color"):
            concepto["color"] = PALETA_CATEGORIA.get(categoria, "#8a9bb0")
        if not concepto.get("radio"):
            concepto["radio"] = 50
        concepto.setdefault("enlaces", [])

        preguntas = concepto.get("pregunta_asociada")
        if preguntas is None:
            concepto["preguntas"] = []
        elif isinstance(preguntas, dict):
            concepto["preguntas"] = [preguntas]
        else:
            concepto["preguntas"] = list(preguntas)

    # Si no hay capas globales declaradas, se usan las cinco de la especificación
    if not datos.get("capas_globales"):
        datos["capas_globales"] = [
            {"id": "visual", "nombre": "Visual", "icono": "👁️"},
            {"id": "matematica", "nombre": "Matemática", "icono": "📐"},
            {"id": "pseudocodigo", "nombre": "Pseudocódigo", "icono": "📝"},
            {"id": "codigo", "nombre": "Código", "icono": "💻"},
            {"id": "historia", "nombre": "Historia", "icono": "📜"},
        ]

    # La capa `nota` se ofrece en el selector solo si algún concepto la tiene
    hay_notas = any("nota" in c.get("capas", {}) for c in datos.get("conceptos", []))
    ids_capas = {c["id"] for c in datos["capas_globales"]}
    if hay_notas and "nota" not in ids_capas:
        datos["capas_globales"].append({"id": "nota", "nombre": "Nota", "icono": "📓"})

    return datos


# ------------------------------------------------------------------
# Validación (§8.1)
# ------------------------------------------------------------------
def validar(datos):
    """
    Comprueba la integridad referencial del contenido.

    Errores (abortan el build):
      - IDs duplicados o ausentes.
      - `enlaces`, `conexiones.desde/hasta` o `sendero.secuencia` que
        apunten a conceptos inexistentes.
      - Conceptos sin `capas.visual` o sin posición.
    Avisos (no abortan): falta `matematica`, categoría desconocida.
    """
    conceptos = datos.get("conceptos", [])
    if not conceptos:
        sys.exit("[ERROR] atlas_data.json no contiene conceptos.")

    errores = []
    avisos = []

    ids = []
    for concepto in conceptos:
        cid = concepto.get("id")
        if not cid:
            errores.append("Hay un concepto sin 'id'")
            continue
        ids.append(cid)

    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errores.append("ID duplicado: '" + dup + "'")

    conjunto_ids = set(ids)

    for concepto in conceptos:
        cid = str(concepto.get("id"))
        capas = concepto.get("capas", {})

        if "visual" not in capas:
            errores.append("Concepto '" + cid + "' sin capas.visual (obligatoria)")
        if "matematica" not in capas:
            avisos.append("Concepto '" + cid + "' sin capas.matematica")

        if concepto.get("categoria") not in CATEGORIAS_VALIDAS:
            avisos.append(
                "Concepto '" + cid + "' con categoría no estándar: "
                + str(concepto.get("categoria"))
            )

        posicion = concepto.get("posicion") or {}
        if "x" not in posicion or "y" not in posicion:
            errores.append("Concepto '" + cid + "' sin posicion.x/posicion.y")

        for enlace in concepto.get("enlaces", []):
            if enlace not in conjunto_ids:
                errores.append(
                    "Concepto '" + cid + "' enlaza a un ID inexistente: '"
                    + str(enlace) + "'"
                )

    for conexion in datos.get("conexiones", []):
        for campo in ("desde", "hasta"):
            if conexion.get(campo) not in conjunto_ids:
                errores.append(
                    "Conexión '" + str(conexion.get("id")) + "' apunta a '"
                    + str(conexion.get(campo)) + "' que no existe"
                )

    for sendero in datos.get("senderos", []):
        if not sendero.get("secuencia"):
            errores.append("Sendero '" + str(sendero.get("id")) + "' sin secuencia")
        for paso in sendero.get("secuencia", []):
            if paso not in conjunto_ids:
                errores.append(
                    "Sendero '" + str(sendero.get("id"))
                    + "' incluye un paso inexistente: '" + str(paso) + "'"
                )

    for aviso in avisos:
        print("  [i] " + aviso)

    if errores:
        for error in errores:
            print("  [!] " + error)
        sys.exit(
            "[ERROR] Validación fallida (" + str(len(errores))
            + " problemas). Corrige atlas_data.json."
        )

    print("Validación: OK — " + str(len(conceptos)) + " conceptos, "
          + str(len(datos.get("conexiones", []))) + " conexiones, "
          + str(len(datos.get("senderos", []))) + " senderos")


# ------------------------------------------------------------------
# Librerías locales (sin dependencia de internet, §11.7)
# ------------------------------------------------------------------
def copiar_vendor():
    """
    Copia `src/vendor/` a `build/vendor/`.

    Las librerías se descargan **una sola vez** a mano (ver README) y
    quedan versionadas en el proyecto; así el atlas funciona sin red.
    """
    faltantes = [
        recurso for recurso in VENDOR_REQUERIDO
        if not os.path.exists(os.path.join(DIR_VENDOR_SRC, recurso))
    ]
    if faltantes:
        print("  [i] Aviso: faltan librerías en src/vendor/: " + ", ".join(faltantes))
        print("      Descárgalas con el bloque 'Sin internet' del README.")

    if os.path.isdir(DIR_VENDOR_SRC):
        if os.path.isdir(DIR_VENDOR_BUILD):
            shutil.rmtree(DIR_VENDOR_BUILD)
        shutil.copytree(DIR_VENDOR_SRC, DIR_VENDOR_BUILD)

    return not faltantes


def copiar_estaticos():
    """Copia styles.css y app.js de src/ a build/."""
    for recurso in ("styles.css", "app.js"):
        origen = os.path.join(DIR_SRC, recurso)
        if os.path.exists(origen):
            shutil.copyfile(origen, os.path.join(DIR_BUILD, recurso))
        else:
            print("  [i] Aviso: falta src/" + recurso + "; el build quedará sin él.")


# ------------------------------------------------------------------
# Plantilla HTML (§5.1)
# ------------------------------------------------------------------
PLANTILLA_HTML = """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Atlas del Perceptrón</title>
  <link rel="stylesheet" href="styles.css"/>
  <link rel="stylesheet" href="vendor/katex/katex.min.css"/>
</head>
<body>
  <!-- Barra superior: título · Rayos X · senderos -->
  <header class="toolbar">
    <div class="toolbar__left">
      <h1 class="toolbar__titulo">🧠 Atlas del Perceptrón</h1>
      <span class="toolbar__subtitulo">explora · navega · comprende</span>
    </div>
    <div class="toolbar__rayosx" id="rayosx" role="group" aria-label="Capas globales (Rayos X)"></div>
    <div class="toolbar__right">
      <button class="btn" id="btn-senderos" aria-haspopup="true" aria-expanded="false">🧭 Senderos</button>
      <button class="btn" id="btn-exportar">📤 Exportar respuestas</button>
    </div>
  </header>

  <main class="main">
    <!-- Contenedor del grafo: Cytoscape.js lo monta aquí -->
    <div class="canvas" id="canvas">
      <div class="canvas__content" id="cy" aria-label="Grafo de conceptos del perceptrón"></div>

      <div class="zoom-controls">
        <button class="zoom-controls__btn" id="zoom-in" title="Acercar" aria-label="Acercar">+</button>
        <button class="zoom-controls__btn" id="zoom-out" title="Alejar" aria-label="Alejar">−</button>
        <button class="zoom-controls__btn" id="zoom-reset" title="Vista general" aria-label="Restablecer vista">⌂</button>
      </div>
    </div>

    <!-- Tarjeta flotante: no bloqueante, anclada al nodo -->
    <aside id="card" class="card" hidden aria-live="polite"></aside>

    <!-- Barra de progreso del sendero activo -->
    <div id="trail-bar" class="trail-progress" hidden>
      <button class="trail-progress__btn" id="trail-prev" aria-label="Paso anterior">◀</button>
      <div class="trail-progress__info">
        <span class="trail-progress__step" id="trail-nombre"></span>
        <span id="trail-pos"></span>
      </div>
      <div class="trail-progress__track">
        <div id="trail-fill" class="trail-progress__fill"></div>
      </div>
      <button class="trail-progress__btn" id="trail-next" aria-label="Paso siguiente">▶</button>
      <button class="trail-progress__btn" id="trail-cerrar" aria-label="Cerrar sendero">✕</button>
    </div>
  </main>

  <div id="menu-senderos" class="menu-trails" hidden role="menu" aria-label="Senderos guiados"></div>
  <div id="tooltip" class="tooltip" hidden></div>

  <!-- Librerías locales -->
  <script src="vendor/cytoscape.min.js"></script>
  <script src="vendor/katex/katex.min.js"></script>

  <!-- Respaldo de datos: se usa si /api/conceptos no responde -->
  <script id="atlas-datos" type="application/json">/*__DATOS__*/</script>
  <script src="app.js"></script>
</body>
</html>
"""


# ------------------------------------------------------------------
# Build
# ------------------------------------------------------------------
def registrar_snapshot(datos):
    """
    Guarda una huella de integridad del contenido en `contenido_versiones`.

    El hash cubre los datos ya normalizados (con color, preguntas y notas
    adjuntas), de modo que cada build deja un rastro verificable de QUÉ
    contenido produjo, incluso si el atlas se sirve por API sin Git.
    """
    payload = json.dumps(datos, ensure_ascii=False, sort_keys=True)
    digesto = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    version = str(datos.get("meta", {}).get("version", "?"))
    resumen = (
        str(len(datos.get("conceptos", []))) + " conceptos, "
        + str(len(datos.get("conexiones", []))) + " conexiones, "
        + str(len(datos.get("senderos", []))) + " senderos"
    )
    momento = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    os.makedirs(os.path.dirname(RUTA_DB), exist_ok=True)
    con = sqlite3.connect(RUTA_DB)
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS contenido_versiones ("
            "    id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "    version TEXT NOT NULL,"
            "    sha256_contenido TEXT NOT NULL,"
            "    resumen TEXT NOT NULL,"
            "    creado_en TIMESTAMP NOT NULL"
            ")"
        )
        con.execute(
            "INSERT INTO contenido_versiones (version, sha256_contenido, resumen, creado_en) "
            "VALUES (?, ?, ?, ?)",
            (version, digesto, resumen, momento),
        )
        con.commit()
    finally:
        con.close()

    print("  snapshot:   v" + version + " sha256:" + digesto[:12] + "… (" + resumen + ")")


def generar():
    """Orquesta el proceso completo: cargar, validar, normalizar y escribir."""
    print("Generando el Atlas del Perceptrón v2.0")
    print("-" * 46)

    datos = cargar_datos()
    n_notas = adjuntar_notas(datos)
    datos = normalizar(datos)
    validar(datos)

    os.makedirs(DIR_BUILD, exist_ok=True)

    registrar_snapshot(datos)

    # Los datos van en un <script type="application/json">: no hace falta
    # escapar comillas, solo evitar que aparezca la secuencia </script>.
    json_datos = json.dumps(datos, ensure_ascii=False, separators=(",", ":"))
    json_datos = json_datos.replace("</", "<\\/")

    html = PLANTILLA_HTML.replace("/*__DATOS__*/", json_datos)
    with open(os.path.join(DIR_BUILD, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    copiar_estaticos()
    vendor_ok = copiar_vendor()

    print()
    print("Build completado en build/")
    print("  conceptos:  " + str(len(datos["conceptos"])))
    print("  conexiones: " + str(len(datos.get("conexiones", []))))
    print("  senderos:   " + str(len(datos.get("senderos", []))))
    print("  capas:      " + str(len(datos.get("capas_globales", []))))
    print("  notas:      " + str(n_notas))
    print("  offline:    " + ("sí" if vendor_ok else "NO (faltan librerías)"))
    print()
    print("Arranca el servidor con:  python3 src/backend/app.py")


if __name__ == "__main__":
    generar()
