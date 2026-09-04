# CHANGELOG — Atlas del Perceptrón

Todas las versiones notables de este proyecto. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y versionado
[SemVer](https://semver.org/lang/es/).

## [2.3.0] — 2026-09-04

### Añadido
- Snapshot de integridad del contenido: cada build guarda un `sha256` del
  contenido normalizado en `contenido_versiones`.
- Endpoint `GET /api/versiones` para consultar los snapshots.

## [2.2.0] — 2026-09-04

### Añadido
- Notas personales del usuario, editables por concepto y con historial.
- Tablas `notas` y `notas_historial` en SQLite.
- Endpoints `GET/POST /api/notas`, `GET /api/notas/<id>/historial` y
  `POST /api/notas/<id>/restaurar`.
- Campo "📓 Mi nota" en la tarjeta con su panel de historial.

## [2.1.0] — 2026-09-04

### Añadido
- Historial de respuestas del usuario (versiones + restaurar).
- Tabla `respuestas_historial` en SQLite.
- Endpoints `GET /api/respuestas/<id>/historial` y
  `POST /api/respuestas/<id>/restaurar`.
- Botón "⏱ Historial" en la tarjeta con panel de versiones.

## [2.0.0] — 2026-09-03

### Añadido
- Línea base del proyecto v2.0 según la Especificación Consolidada.
- Grafo interactivo con **Cytoscape.js** (38 conceptos, 57 conexiones, 7 senderos).
- Capas "Rayos X" (Visual, Matemática, Pseudocódigo, Código, Historia, Nota).
- Tarjetas flotantes no bloqueantes con pestañas por capa.
- Senderos guiados con barra de progreso.
- Backend **Flask** con API REST (7 endpoints) y persistencia en **SQLite**.
- Respuestas del usuario guardadas y exportables.
- Render de fórmulas con **KaTeX** y fallback Unicode.
- Funcionamiento sin conexión a internet (librerías en `src/vendor/`).

### Cambiado
- `meta.version` en `atlas_data.json`: `1.0` → `2.0.0`.

### Corregido
- (N/A en esta línea base; ver ramas de trabajo posteriores.)