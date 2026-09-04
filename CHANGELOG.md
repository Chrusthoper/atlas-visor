# CHANGELOG — Atlas del Perceptrón

Todas las versiones notables de este proyecto. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y versionado
[SemVer](https://semver.org/lang/es/).

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