# 🧠 Atlas del Perceptrón — v2.0

Una **experiencia de aprendizaje navegable** sobre el perceptrón: cada concepto es un
**nodo clicable** de un grafo interactivo, con múltiples capas de profundidad
(visual → matemática → pseudocódigo → código → historia → nota) y rutas guiadas.

Construido con **Cytoscape.js** (grafo), **KaTeX** (fórmulas) y **Flask** (API REST +
SQLite), sin frameworks de UI ni bundlers. El contenido vive 100 % en `atlas_data.json`.

---

## ▶️ Cómo usarlo

```bash
# 1) Generar el build (lee src/atlas_data.json)
python3 src/generador.py

# 2) Arrancar la API + servidor de estáticos
python3 src/backend/app.py

# 3) Abrir en el navegador
#    http://127.0.0.1:5000
```

Para usar otro puerto: `ATLAS_PUERTO=5050 python3 src/backend/app.py`

> **Requisitos:** Python 3, `flask` y `flask-cors`
> (`pip3 install flask flask-cors`).

---

## 📁 Estructura

```
atlas-visor/
├── src/
│   ├── atlas_data.json      # ⭐ FUENTE DE VERDAD del contenido
│   ├── generador.py         # Valida + normaliza + genera build/
│   ├── app.js               # Interacción (Cytoscape, tarjetas, capas, senderos)
│   ├── styles.css           # Tema oscuro (BEM)
│   ├── backend/
│   │   ├── app.py           # API REST (Flask) + sirve build/
│   │   ├── modelos.py       # Acceso a SQLite
│   │   └── respuestas.db    # SQLite (se crea al arrancar)
│   ├── notas/               # Notas markdown: <id-concepto>.md
│   └── vendor/              # Librerías locales (Cytoscape.js + KaTeX)
├── build/                   # Salida generada (la sirve Flask)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── vendor/
└── README.md
```

---

## ✨ Funcionalidades

| Función | Cómo |
|---|---|
| **Pan / Zoom** | Arrastrar el fondo · rueda del ratón · botones `+ − ⌂` · doble clic en el fondo restablece · pinch táctil. Rango 0.3x–3x |
| **Tarjeta flotante** | Clic en un nodo. Sin velo oscuro (no bloqueante), anclada al lado opuesto del nodo y siempre dentro del viewport |
| **Capas (Rayos X)** | Selector superior: Visual 👁️ · Matemática 📐 · Pseudocódigo 📝 · Código 💻 · Historia 📜 · Nota 📓. Reetiqueta **todos** los nodos |
| **Backlinks** | Chips "🔗 Relacionado" → centran el nodo destino y abren su tarjeta |
| **Senderos guiados** | 🧭 Menú con 7 rutas, barra de progreso "Paso 3 de 7", nodos externos atenuados |
| **Respuestas** | Cada nodo muestra su pregunta del PDF con campo editable; se guardan vía `POST /api/respuestas` en SQLite |
| **Exportar** | 📤 Descarga `respuestas_atlas_perceptron.md` con enunciados y respuestas |
| **Teclado** | `Esc` cierra · `←`/`→` (o `p`/`n`) avanzan por el sendero · `r` vista general |
| **Sin internet** | Cytoscape y KaTeX se sirven desde `build/vendor/`; si KaTeX falla, las fórmulas caen a texto Unicode |

---

## 🔌 API REST

| Método | Endpoint | Descripción | Éxito | Error |
|--------|----------|-------------|-------|-------|
| GET | `/api/conceptos` | Conceptos + conexiones + senderos | 200 | — |
| GET | `/api/conceptos/{id}` | Un concepto concreto | 200 | 404 |
| GET | `/api/senderos` | Rutas guiadas | 200 | — |
| GET | `/api/respuestas` | Todas las respuestas | 200 | — |
| POST | `/api/respuestas` | Guardar respuesta (upsert) | 201 nueva / 200 actualizada | 400 |
| PUT | `/api/respuestas/{id}` | Actualizar por id | 200 | 404 |
| DELETE | `/api/respuestas/{id}` | Eliminar | 204 | 404 |

```bash
curl -X POST http://127.0.0.1:5000/api/respuestas \
  -H 'Content-Type: application/json' \
  -d '{"concepto_id":"pesos","respuesta":"Ponderan cada entrada."}'
```

`POST` valida que `concepto_id` exista en `atlas_data.json` (si no, **400**).
Rige una respuesta por concepto (índice `UNIQUE` en `concepto_id`).

**Tabla SQLite:**
`respuestas(id INTEGER PK AUTOINCREMENT, concepto_id TEXT, respuesta TEXT, creado_en TIMESTAMP, actualizado_en TIMESTAMP)`

### Modo degradado
Si la API no responde, el frontend usa el respaldo embebido en `index.html` y
guarda en `localStorage`. El atlas sigue navegable y avisa en pantalla.

---

## 🗃️ Modelo de datos

`src/atlas_data.json`:

```json
{
  "meta": { "titulo": "Atlas del Perceptrón", "version": "2.0" },
  "capas_globales": [ { "id": "visual", "nombre": "Visual", "icono": "👁️" } ],
  "conceptos": [
    {
      "id": "pesos",
      "nombre": "Pesos (w)",
      "categoria": "componente|operacion|proceso|limitacion|evolucion",
      "posicion": { "x": 150, "y": 610 },
      "radio": 54,
      "capas": {
        "visual": { "etiqueta": "...", "descripcion_corta": "..." },
        "matematica": { "formula": "w_i \\leftarrow w_i + \\eta e x_i", "explicacion": "..." },
        "pseudocodigo": { "linea": "...", "contexto": "..." },
        "codigo": { "python": "..." },
        "historia": { "texto": "...", "referencia": "..." }
      },
      "pregunta_asociada": [ { "pdf": "actividad_percep", "parte": "I", "numero": 4, "enunciado": "..." } ],
      "enlaces": ["z", "regla_aprendizaje"]
    }
  ],
  "conexiones": [ { "id": "c_pesos_z", "desde": "pesos", "hasta": "z", "etiqueta": "w", "tipo": "flujo" } ],
  "senderos": [ { "id": "s1", "nombre": "...", "secuencia": ["perceptron", "..."], "partes": ["I"] } ]
}
```

Tipos de conexión: `flujo`, `dependencia`, `evolucion`, `limitacion`
(cada uno con su color y estilo de línea).

### Campos derivados por el generador
No hace falta escribirlos a mano; se calculan al construir (y la API aplica la
misma normalización, así el frontend recibe siempre la misma forma):

- **`color`** → se deriva de `categoria` con la paleta oficial.
- **`radio`** → 50 px si no se indica.
- **`preguntas`** → `pregunta_asociada` se unifica como lista (hay conceptos con
  varias preguntas, p. ej. `pesos` → P4 y P5).
- **capa `nota`** → se adjunta `src/notas/<id>.md` si el archivo existe.

### Paleta por categoría

| Categoría | Color | Ejemplos |
|---|---|---|
| `componente` | Naranja `#FFB84D` | entradas, pesos, bias |
| `operacion` | Azul `#61dafb` | z, activación, error |
| `proceso` | Verde `#69b3a2` | aprendizaje, epoch |
| `limitacion` | Rojo `#ff6b6b` | XOR, linealidad |
| `evolucion` | Violeta `#C9A0FF` | MLP, backpropagation |

---

## 🔧 Cómo añadir contenido

1. Edita `src/atlas_data.json`.
2. (Opcional) Añade `src/notas/<id>.md` para la pestaña de nota.
3. Re-ejecuta `python3 src/generador.py`.

El generador **valida** que todos los `enlaces`, `conexiones.desde/hasta` y
`sendero.secuencia` apunten a IDs existentes, que no haya IDs duplicados y que
cada concepto tenga `capas.visual` y `posicion`. Un fallo aborta el build.

> No hace falta reiniciar Flask para ver cambios de contenido en la API:
> `atlas_data.json` se relee en cada petición. Sí hace falta re-generar el build
> para actualizar el respaldo embebido.

---

## 🌐 Sin internet

Las librerías están versionadas en `src/vendor/`. Si alguna vez faltan, se
descargan una única vez:

```bash
cd src/vendor
curl -o cytoscape.min.js https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.min.js
mkdir -p katex/fonts && cd katex
curl -o katex.min.js  https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js
curl -o katex.min.css https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css
# Fuentes referenciadas por el CSS (20 archivos .woff2)
for f in $(grep -o 'fonts/KaTeX_[A-Za-z0-9-]*\.woff2' katex.min.css | sort -u | sed 's|fonts/||'); do
  curl -o "fonts/$f" "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/$f"
done
```

`build/index.html` no referencia **ningún** CDN.

---

## 🗺️ Contenido incluido (desde los PDFs)

- **actividad_percep.pdf** (Partes I–VIII): componentes básicos, aprendizaje,
  parámetros/hiperparámetros, epoch, ejercicios numéricos, dataset, el problema
  XOR y la transición a MLP/backpropagation.
- **pseudo_codigo.pdf** (Partes I–XVI): algoritmo, predicción, entrenamiento,
  ciclos (epochs → ejemplos → características), pseudocódigo, prueba manual y
  mapeo hacia Python.

**38 conceptos · 57 conexiones · 7 senderos · 6 capas · 5 notas.**

---

## 🧪 Depuración

Desde la consola del navegador se expone `window.Atlas`:

```js
Atlas.navigateToNode('xor');     // centra y abre un concepto
Atlas.setGlobalLayer('codigo');  // cambia la capa global
Atlas.activateTrail('s1');       // lanza un sendero
Atlas.cy.nodes().length;         // instancia de Cytoscape
```

---

## ✅ Criterios de aceptación cumplidos

- [x] Todos los conceptos de ambos PDFs como nodos (38)
- [x] Cada nodo tiene al menos `visual` y `matematica`
- [x] Tarjetas flotantes no bloqueantes, ancladas y dentro del viewport
- [x] Selector Rayos X cambia la capa en todos los nodos
- [x] Backlinks navegan entre nodos con animación
- [x] Pan/zoom fluido con Cytoscape (rueda, arrastre, táctil, botones, reset)
- [x] 7 senderos guiados con barra de progreso
- [x] Respuestas en SQLite vía API REST y exportables
- [x] La API responde con los códigos HTTP correctos (200/201/204/400/404)
- [x] Fórmulas con KaTeX y fallback Unicode
- [x] Tema oscuro, colores por categoría, animaciones 150–250 ms
- [x] Contenido 100 % separado en `atlas_data.json`
- [x] Funciona sin conexión a internet
- [x] Navegable por teclado con `aria-label`


