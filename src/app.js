/* ============================================================
   Atlas del Perceptrón v2.0 — app.js
   ------------------------------------------------------------
   Interacción: grafo (Cytoscape.js), tarjetas flotantes, capas
   "Rayos X", senderos guiados y persistencia vía API REST.

   El contenido NO vive aquí: llega de `GET /api/conceptos` y, si la
   API no responde, del respaldo embebido en index.html.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   Estado global
   ------------------------------------------------------------ */
let cy = null;                 // instancia de Cytoscape
let ATLAS = null;              // contenido completo del atlas
let capaActual = 'visual';     // capa global activa (Rayos X)
let nodoAbierto = null;        // id del concepto con tarjeta abierta
let senderoActivo = null;      // objeto sendero en curso
let pasoActual = 0;            // índice dentro de senderoActivo.secuencia
let apiViva = true;            // false si la API no responde

/** Respuestas en memoria: concepto_id -> { id, respuesta } */
const respuestas = new Map();

/** Temporizadores de guardado diferido por concepto (debounce). */
const temporizadores = new Map();

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const CLAVE_LOCAL = 'atlas_perceptron_respuestas_v2';

/* Atajos a los elementos del DOM */
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------
   Utilidades
   ------------------------------------------------------------ */

/** Escapa texto para insertarlo como HTML sin riesgo de inyección. */
function esc(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Busca un concepto por su id. */
function getConcepto(id) {
  return (ATLAS.conceptos || []).find((c) => c.id === id) || null;
}

/** Busca un sendero por su id. */
function getSendero(id) {
  return (ATLAS.senderos || []).find((s) => s.id === id) || null;
}

/** Muestra un aviso flotante temporal (p. ej. API caída). */
function avisar(mensaje, milisegundos) {
  let caja = $('aviso');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'aviso';
    caja.className = 'aviso';
    $('canvas').appendChild(caja);
  }
  caja.textContent = mensaje;
  caja.hidden = false;
  clearTimeout(caja._t);
  caja._t = setTimeout(() => { caja.hidden = true; }, milisegundos || 4000);
}

/**
 * Convierte una fórmula LaTeX en texto Unicode legible.
 * Es el plan B cuando KaTeX no está disponible (§8.4).
 */
function latexAUnicode(formula) {
  return String(formula)
    .replace(/\\times/g, '×').replace(/\\cdot/g, '·')
    .replace(/\\leftarrow/g, '←').replace(/\\rightarrow/g, '→')
    .replace(/\\Rightarrow/g, '⇒').replace(/\\geq/g, '≥')
    .replace(/\\leq/g, '≤').replace(/\\neq/g, '≠')
    .replace(/\\sum/g, '∑').replace(/\\eta/g, 'η')
    .replace(/\\alpha/g, 'α').replace(/\\theta/g, 'θ')
    .replace(/\\hat\{([^}]*)\}/g, '$1̂')
    .replace(/\\dots|\\ldots/g, '…')
    .replace(/\\begin\{cases\}|\\end\{cases\}/g, '')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\mathbb\{([^}]*)\}/g, '$1')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\left|\\right/g, '')
    .replace(/[_^]\{([^}]*)\}/g, '$1')
    .replace(/[\\{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Renderiza una fórmula dentro de un contenedor.
 * Usa KaTeX si cargó; si no, cae al texto Unicode.
 */
function renderFormula(contenedor, formula) {
  if (typeof katex !== 'undefined' && katex.render) {
    try {
      katex.render(formula, contenedor, { throwOnError: false, displayMode: true });
      return;
    } catch (e) {
      /* si KaTeX falla, seguimos al fallback */
    }
  }
  contenedor.classList.add('formula--fallback');
  contenedor.textContent = latexAUnicode(formula);
}

/**
 * Mini-renderizador de markdown para las notas del usuario.
 * Cubre lo que se usa en `src/notas/*.md`: títulos, listas, citas,
 * bloques de código, negrita/cursiva e `inline code`.
 */
function markdownAHtml(texto) {
  const lineas = String(texto).split('\n');
  const salida = [];
  let enCodigo = false;
  let enLista = false;

  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  for (const linea of lineas) {
    if (/^```/.test(linea)) {
      if (enCodigo) { salida.push('</pre>'); enCodigo = false; }
      else { salida.push('<pre class="nota__code">'); enCodigo = true; }
      continue;
    }
    if (enCodigo) { salida.push(esc(linea)); continue; }

    const esItem = /^\s*[-*]\s+/.test(linea);
    if (esItem && !enLista) { salida.push('<ul>'); enLista = true; }
    if (!esItem && enLista) { salida.push('</ul>'); enLista = false; }

    if (/^###\s+/.test(linea)) salida.push('<h3>' + inline(linea.replace(/^###\s+/, '')) + '</h3>');
    else if (/^##\s+/.test(linea)) salida.push('<h2>' + inline(linea.replace(/^##\s+/, '')) + '</h2>');
    else if (/^#\s+/.test(linea)) salida.push('<h1>' + inline(linea.replace(/^#\s+/, '')) + '</h1>');
    else if (/^>\s?/.test(linea)) salida.push('<blockquote>' + inline(linea.replace(/^>\s?/, '')) + '</blockquote>');
    else if (esItem) salida.push('<li>' + inline(linea.replace(/^\s*[-*]\s+/, '')) + '</li>');
    else if (linea.trim() === '') salida.push('');
    else salida.push('<p>' + inline(linea) + '</p>');
  }
  if (enLista) salida.push('</ul>');
  if (enCodigo) salida.push('</pre>');
  return salida.join('\n');
}

/* ------------------------------------------------------------
   Capa de datos (API REST con respaldo local)
   ------------------------------------------------------------ */

/** Lee el respaldo embebido por el generador en index.html. */
function datosEmbebidos() {
  const etiqueta = $('atlas-datos');
  if (!etiqueta) return null;
  try {
    return JSON.parse(etiqueta.textContent);
  } catch (e) {
    return null;
  }
}

/**
 * Carga el contenido del atlas.
 * Intenta `GET /api/conceptos`; si falla, usa el respaldo embebido
 * para que el atlas siga siendo navegable (solo sin persistencia).
 */
async function cargarAtlas() {
  try {
    const r = await fetch('/api/conceptos');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    apiViva = true;
    return await r.json();
  } catch (e) {
    apiViva = false;
    const respaldo = datosEmbebidos();
    if (!respaldo) throw new Error('No hay datos: ni API ni respaldo embebido.');
    avisar('⚠ API no disponible: las respuestas se guardan solo en este navegador.', 6000);
    return respaldo;
  }
}

/** Carga todas las respuestas guardadas (API o localStorage). */
async function cargarRespuestas() {
  respuestas.clear();

  if (apiViva) {
    try {
      const r = await fetch('/api/respuestas');
      if (r.ok) {
        const datos = await r.json();
        (datos.respuestas || []).forEach((fila) => {
          respuestas.set(fila.concepto_id, { id: fila.id, respuesta: fila.respuesta });
        });
        return;
      }
    } catch (e) {
      apiViva = false;
    }
  }

  // Modo degradado: localStorage
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_LOCAL) || '{}');
    Object.keys(guardado).forEach((id) => {
      respuestas.set(id, { id: null, respuesta: guardado[id] });
    });
  } catch (e) {
    /* sin respuestas previas */
  }
}

/** Vuelca las respuestas a localStorage (respaldo del modo degradado). */
function volcarLocal() {
  const plano = {};
  respuestas.forEach((valor, clave) => { plano[clave] = valor.respuesta; });
  try {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(plano));
  } catch (e) {
    /* almacenamiento lleno o deshabilitado */
  }
}

/**
 * Guarda la respuesta de un concepto (§8.2).
 * POST hace upsert en el backend, así que sirve para crear y actualizar.
 */
async function saveAnswer(conceptoId, texto) {
  respuestas.set(conceptoId, {
    id: (respuestas.get(conceptoId) || {}).id || null,
    respuesta: texto,
  });
  volcarLocal();
  marcarRespondidos();

  if (!apiViva) return null;

  try {
    const r = await fetch('/api/respuestas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concepto_id: conceptoId, respuesta: texto }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const fila = await r.json();
    respuestas.set(conceptoId, { id: fila.id, respuesta: fila.respuesta });
    return fila;
  } catch (e) {
    apiViva = false;
    avisar('⚠ No se pudo guardar en el servidor; queda en este navegador.');
    return null;
  }
}

/** Devuelve la respuesta guardada de un concepto (cadena vacía si no hay). */
function loadAnswer(conceptoId) {
  const fila = respuestas.get(conceptoId);
  return fila ? fila.respuesta : '';
}

/** Programa un guardado diferido para no llamar a la API en cada tecla. */
function guardarConRetraso(conceptoId, texto) {
  clearTimeout(temporizadores.get(conceptoId));
  temporizadores.set(conceptoId, setTimeout(() => {
    saveAnswer(conceptoId, texto);
  }, 700));
}

/* ------------------------------------------------------------
   Construcción del grafo (Cytoscape.js)
   ------------------------------------------------------------ */

/**
 * Etiqueta corta que muestra el nodo para una capa concreta.
 * Cambiar la capa global reescribe estas etiquetas en todos los nodos.
 */
function getLayerLabel(conceptoId, capaId) {
  const concepto = getConcepto(conceptoId);
  if (!concepto) return '';
  const capa = (concepto.capas || {})[capaId];
  if (!capa) return concepto.nombre;

  switch (capaId) {
    case 'visual':
      return capa.etiqueta || concepto.nombre;
    case 'matematica':
      return latexAUnicode(capa.formula || concepto.nombre);
    case 'pseudocodigo':
      return capa.linea || concepto.nombre;
    case 'codigo':
      return (capa.python || concepto.nombre).split('\n')[0];
    case 'historia':
      return capa.referencia || concepto.nombre;
    case 'nota':
      return concepto.nombre + ' 📓';
    default:
      return concepto.nombre;
  }
}

/** Recorta una etiqueta para que no desborde el nodo. */
function recortar(texto, maximo) {
  const t = String(texto);
  return t.length > maximo ? t.slice(0, maximo - 1) + '…' : t;
}

/** Convierte el contenido del atlas a elementos de Cytoscape. */
function construirElementos() {
  const elementos = [];

  (ATLAS.conceptos || []).forEach((concepto) => {
    elementos.push({
      group: 'nodes',
      data: {
        id: concepto.id,
        nombre: concepto.nombre,
        categoria: concepto.categoria,
        color: concepto.color,
        diametro: (concepto.radio || 50) * 2,
        etiqueta: recortar(getLayerLabel(concepto.id, capaActual), 22),
      },
      // `preset layout`: se respetan las coordenadas del JSON (§5.3)
      position: { x: concepto.posicion.x, y: concepto.posicion.y },
    });
  });

  (ATLAS.conexiones || []).forEach((conexion) => {
    elementos.push({
      group: 'edges',
      data: {
        id: conexion.id,
        source: conexion.desde,
        target: conexion.hasta,
        etiqueta: conexion.etiqueta || '',
        tipo: conexion.tipo || 'flujo',
      },
    });
  });

  return elementos;
}

/** Hoja de estilos del grafo (equivalente a las clases §8.2). */
function estilosCytoscape() {
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        'width': 'data(diametro)',
        'height': 'data(diametro)',
        'border-width': 2,
        'border-color': '#101418',
        'label': 'data(etiqueta)',
        'color': '#101418',
        'font-size': 12,
        'font-weight': 600,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': 'data(diametro)',
        'transition-property': 'opacity, border-color, border-width',
        'transition-duration': '200ms',
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 1.8,
        'line-color': '#8a9bb0',
        'target-arrow-color': '#8a9bb0',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        'curve-style': 'bezier',
        'opacity': 0.75,
        'label': 'data(etiqueta)',
        'font-size': 10,
        'color': '#c3ccd8',
        'text-background-color': '#1e1e1e',
        'text-background-opacity': 0.85,
        'text-background-padding': 2,
        'text-rotation': 'autorotate',
      },
    },
    { selector: 'edge[tipo = "evolucion"]',  style: { 'line-color': '#C9A0FF', 'target-arrow-color': '#C9A0FF' } },
    { selector: 'edge[tipo = "limitacion"]', style: { 'line-color': '#ff6b6b', 'target-arrow-color': '#ff6b6b', 'line-style': 'dashed' } },
    { selector: 'edge[tipo = "dependencia"]', style: { 'line-color': '#7d8ca3', 'target-arrow-color': '#7d8ca3', 'line-style': 'dotted' } },

    // Nodo con la tarjeta abierta
    {
      selector: 'node.resaltado',
      style: { 'border-color': '#ffffff', 'border-width': 4 },
    },
    // Nodo actual de un sendero
    {
      selector: 'node.actual',
      style: { 'border-color': '#ffffff', 'border-width': 5 },
    },
    // Concepto con respuesta guardada
    {
      selector: 'node.respondida',
      style: { 'border-color': '#7CFC00', 'border-width': 4 },
    },
    // Fuera del sendero activo (§5.5)
    { selector: '.dimmed', style: { 'opacity': 0.3 } },
    // Arista del paso que se está recorriendo
    {
      selector: 'edge.paso-activo',
      style: { 'width': 3.4, 'opacity': 1, 'line-color': '#ffffff', 'target-arrow-color': '#ffffff' },
    },
  ];
}

/** Crea la instancia de Cytoscape sobre #cy. */
function iniciarGrafo() {
  cy = cytoscape({
    container: $('cy'),
    elements: construirElementos(),
    style: estilosCytoscape(),
    layout: { name: 'preset' },       // usa `posicion` del JSON
    minZoom: ZOOM_MIN,
    maxZoom: ZOOM_MAX,
    wheelSensitivity: 0.25,
    boxSelectionEnabled: false,
    autounselectify: true,
  });

  cy.fit(undefined, 60);
}

/* ------------------------------------------------------------
   Tarjeta flotante (§5.4)
   ------------------------------------------------------------ */

/** Capas que ese concepto realmente tiene, en el orden global. */
function capasDelConcepto(concepto) {
  const disponibles = concepto.capas || {};
  return (ATLAS.capas_globales || []).filter((capa) => disponibles[capa.id]);
}

/** Devuelve el contenido crudo de una capa concreta (§8.2). */
function getNodeLayerContent(conceptoId, capaId) {
  const concepto = getConcepto(conceptoId);
  if (!concepto) return null;
  return (concepto.capas || {})[capaId] || null;
}

/** HTML del cuerpo de la tarjeta para la capa indicada. */
function cuerpoDeCapa(concepto, capaId) {
  const capa = getNodeLayerContent(concepto.id, capaId);
  if (!capa) return '<p class="card__desc">Esta capa no está disponible.</p>';

  if (capaId === 'visual') {
    return '<div class="card__visual">' + esc(capa.etiqueta || concepto.nombre) + '</div>'
      + '<p class="card__desc">' + esc(capa.descripcion_corta || '') + '</p>';
  }
  if (capaId === 'matematica') {
    // El <div> se rellena con KaTeX después de insertar el HTML
    return '<div class="formula" data-formula="' + esc(capa.formula || '') + '"></div>'
      + '<p class="card__desc">' + esc(capa.explicacion || '') + '</p>';
  }
  if (capaId === 'pseudocodigo') {
    return (capa.contexto ? '<p class="card__ctx">' + esc(capa.contexto) + '</p>' : '')
      + '<pre class="codigo">' + esc(capa.linea || '') + '</pre>';
  }
  if (capaId === 'codigo') {
    return '<pre class="codigo">' + esc(capa.python || '') + '</pre>';
  }
  if (capaId === 'historia') {
    return '<p class="card__desc">' + esc(capa.texto || '') + '</p>'
      + (capa.referencia ? '<p class="card__ref">📚 ' + esc(capa.referencia) + '</p>' : '');
  }
  if (capaId === 'nota') {
    return '<div class="nota">' + markdownAHtml(capa.markdown || '') + '</div>';
  }
  return '<p class="card__desc">' + esc(JSON.stringify(capa)) + '</p>';
}

/** HTML del ejercicio numérico, si el concepto tiene uno. */
function bloqueEjercicio(concepto) {
  const ej = concepto.ejercicio;
  if (!ej) return '';
  return '<div class="ejercicio">'
    + '<div class="ejercicio__titulo">🧮 ' + esc(ej.titulo || 'Ejercicio') + '</div>'
    + (ej.datos ? '<div class="ejercicio__datos">' + esc(ej.datos) + '</div>' : '')
    + (ej.solucion ? '<div class="ejercicio__sol">' + esc(ej.solucion) + '</div>' : '')
    + '</div>';
}

/** HTML de las preguntas de la actividad con su campo de respuesta. */
function bloquePreguntas(concepto) {
  const preguntas = concepto.preguntas || [];
  if (!preguntas.length) return '';

  const guardada = loadAnswer(concepto.id);
  const items = preguntas.map((pregunta, indice) => {
    const fuente = [pregunta.pdf, pregunta.parte ? 'Parte ' + pregunta.parte : '',
      pregunta.numero ? 'P' + pregunta.numero : ''].filter(Boolean).join(' · ');
    return '<div class="pregunta">'
      + '<div class="pregunta__cab">'
      + '<span class="pregunta__fuente">' + esc(fuente) + '</span>'
      + (indice === 0
        ? '<span class="pregunta__estado">' + (guardada ? '✓' : '○') + '</span>'
        : '')
      + '</div>'
      + '<div class="pregunta__texto">' + esc(pregunta.enunciado || '') + '</div>'
      + '</div>';
  }).join('');

  return '<div class="preguntas">'
    + '<div class="preguntas__titulo">📝 Preguntas de la actividad</div>'
    + items
    + '<textarea class="pregunta__resp" id="resp-' + esc(concepto.id) + '" '
    + 'aria-label="Tu respuesta para ' + esc(concepto.nombre) + '" '
    + 'placeholder="Escribe tu respuesta…">' + esc(guardada) + '</textarea>'
    + '</div>';
}

/** HTML de los backlinks (chips clicables). */
function bloqueEnlaces(concepto) {
  const enlaces = (concepto.enlaces || []).filter(getConcepto);
  if (!enlaces.length) return '';
  const chips = enlaces.map((id) =>
    '<button class="chip" data-ir="' + esc(id) + '">→ ' + esc(getConcepto(id).nombre) + '</button>'
  ).join('');
  return '<div class="card__links">'
    + '<span class="card__links-lab">🔗 Relacionado:</span>' + chips
    + '</div>';
}

/** Cambia la pestaña activa de la tarjeta abierta (§8.2). */
function setCardTab(capaId) {
  const concepto = getConcepto(nodoAbierto);
  if (!concepto) return;

  const card = $('card');
  card.querySelectorAll('.card__tab').forEach((boton) => {
    const activa = boton.dataset.capa === capaId;
    boton.classList.toggle('card__tab--active', activa);
    boton.setAttribute('aria-selected', activa ? 'true' : 'false');
  });

  const cuerpo = card.querySelector('.card__body');
  cuerpo.innerHTML = cuerpoDeCapa(concepto, capaId)
    + bloqueEjercicio(concepto)
    + bloquePreguntas(concepto);

  // KaTeX sobre el hueco reservado
  const hueco = cuerpo.querySelector('.formula[data-formula]');
  if (hueco) renderFormula(hueco, hueco.dataset.formula);

  conectarCamposRespuesta(cuerpo, concepto);
}

/** Enlaza el textarea de respuesta con el guardado diferido. */
function conectarCamposRespuesta(contenedor, concepto) {
  const campo = contenedor.querySelector('.pregunta__resp');
  if (!campo) return;
  campo.addEventListener('input', () => {
    guardarConRetraso(concepto.id, campo.value);
    const estado = contenedor.querySelector('.pregunta__estado');
    if (estado) estado.textContent = campo.value.trim() ? '✓' : '○';
  });
  // Al salir del campo se fuerza el guardado inmediato
  campo.addEventListener('blur', () => {
    clearTimeout(temporizadores.get(concepto.id));
    saveAnswer(concepto.id, campo.value);
  });
}


/**
 * Coloca la tarjeta junto al nodo, en el lado opuesto a su posición,
 * y la mantiene siempre dentro del viewport (§5.4).
 */
function positionCard(conceptoId) {
  const card = $('card');
  const nodo = cy.getElementById(conceptoId);
  if (!nodo || nodo.empty() || card.hidden) return;

  const zona = $('canvas').getBoundingClientRect();
  const punto = nodo.renderedPosition();          // px relativos al contenedor
  const radio = (nodo.renderedWidth() || 40) / 2;
  const ancho = card.offsetWidth || 330;
  const alto = card.offsetHeight || 260;
  const margen = 14;

  // Si el nodo está en la mitad izquierda, la tarjeta va a su derecha
  let x = punto.x < zona.width / 2
    ? punto.x + radio + margen
    : punto.x - radio - margen - ancho;
  let y = punto.y - alto / 2;

  // Clamp: nunca fuera del viewport
  x = Math.max(margen, Math.min(x, zona.width - ancho - margen));
  y = Math.max(margen, Math.min(y, zona.height - alto - margen));

  card.style.left = Math.round(x) + 'px';
  card.style.top = Math.round(y) + 'px';
}

/** Abre la tarjeta flotante de un concepto (§6.1). */
function openCard(conceptoId) {
  const concepto = getConcepto(conceptoId);
  if (!concepto) return;

  nodoAbierto = conceptoId;
  const card = $('card');
  const capas = capasDelConcepto(concepto);

  // La pestaña activa es la capa global actual; si no existe, la primera
  const idsDisponibles = capas.map((c) => c.id);
  const capaInicial = idsDisponibles.includes(capaActual)
    ? capaActual
    : (idsDisponibles[0] || 'visual');

  const pestanas = capas.map((capa) =>
    '<button class="card__tab" role="tab" data-capa="' + esc(capa.id) + '">'
    + esc(capa.icono || '') + ' ' + esc(capa.nombre) + '</button>'
  ).join('');

  card.innerHTML =
    '<div class="card__header">'
    + '<div class="card__titulo">'
    + '<span class="card__nombre">' + esc(concepto.nombre) + '</span>'
    + '<span class="badge ' + esc(concepto.categoria) + '">' + esc(concepto.categoria) + '</span>'
    + '</div>'
    + '<button class="card__cerrar" id="card-cerrar" aria-label="Cerrar tarjeta">✕</button>'
    + '</div>'
    + '<div class="card__tabs" role="tablist">' + pestanas + '</div>'
    + '<div class="card__body"></div>'
    + bloqueEnlaces(concepto);

  card.hidden = false;
  // Un frame de espera para que la transición de opacidad se aprecie
  requestAnimationFrame(() => card.classList.add('card--abrir'));

  setCardTab(capaInicial);
  positionCard(conceptoId);

  // Resaltado del nodo abierto
  cy.nodes().removeClass('resaltado');
  cy.getElementById(conceptoId).addClass('resaltado');

  // Eventos internos de la tarjeta
  $('card-cerrar').addEventListener('click', closeCard);
  card.querySelectorAll('.card__tab').forEach((boton) => {
    boton.addEventListener('click', () => setCardTab(boton.dataset.capa));
  });
  card.querySelectorAll('[data-ir]').forEach((chip) => {
    chip.addEventListener('click', () => navigateToNode(chip.dataset.ir));
  });
}

/** Cierra la tarjeta flotante. */
function closeCard() {
  const card = $('card');
  card.classList.remove('card--abrir');
  card.hidden = true;
  card.innerHTML = '';
  nodoAbierto = null;
  cy.nodes().removeClass('resaltado');
}

/* ------------------------------------------------------------
   Viewport y navegación (§8.2)
   ------------------------------------------------------------ */

/** Centra la cámara en un nodo, con animación. */
function centerOnNode(nodeId, animate) {
  const nodo = cy.getElementById(nodeId);
  if (!nodo || nodo.empty()) return;
  if (animate === false) {
    cy.center(nodo);
    return;
  }
  cy.animate({ center: { eles: nodo } }, { duration: 400 });
}

/** Vuelve a la vista general (§6.5). */
function resetViewport() {
  cy.animate({ fit: { eles: cy.elements(), padding: 60 } }, { duration: 300 });
}

/** Navega a otro concepto: centra la cámara y abre su tarjeta (§6.3). */
function navigateToNode(nodeId) {
  if (!getConcepto(nodeId)) return;
  centerOnNode(nodeId, true);
  openCard(nodeId);
  // Reposiciona al terminar la animación de la cámara
  setTimeout(() => positionCard(nodeId), 420);
}

/** Cambia la capa global: reetiqueta todos los nodos (§6.2). */
function setGlobalLayer(layerId) {
  capaActual = layerId;

  cy.batch(() => {
    cy.nodes().forEach((nodo) => {
      nodo.data('etiqueta', recortar(getLayerLabel(nodo.id(), layerId), 22));
    });
  });

  document.querySelectorAll('.toolbar__layer-btn').forEach((boton) => {
    const activo = boton.dataset.capa === layerId;
    boton.classList.toggle('toolbar__layer-btn--active', activo);
    boton.setAttribute('aria-pressed', activo ? 'true' : 'false');
  });

  // Si hay una tarjeta abierta, sincroniza su pestaña
  if (nodoAbierto) {
    const concepto = getConcepto(nodoAbierto);
    const disponibles = capasDelConcepto(concepto).map((c) => c.id);
    if (disponibles.includes(layerId)) setCardTab(layerId);
  }
}

/** Pinta el borde verde de los conceptos que ya tienen respuesta. */
function marcarRespondidos() {
  if (!cy) return;
  cy.batch(() => {
    cy.nodes().forEach((nodo) => {
      const texto = loadAnswer(nodo.id());
      nodo.toggleClass('respondida', Boolean(texto && texto.trim()));
    });
  });
}


/* ------------------------------------------------------------
   Senderos guiados (§5.5 y §6.4)
   ------------------------------------------------------------ */

/** Atenúa todo lo que no pertenece al sendero y arranca en el paso 0. */
function activateTrail(trailId) {
  const sendero = getSendero(trailId);
  if (!sendero) return;

  senderoActivo = sendero;
  pasoActual = 0;

  const enRuta = new Set(sendero.secuencia);

  cy.batch(() => {
    cy.elements().addClass('dimmed');
    sendero.secuencia.forEach((id) => cy.getElementById(id).removeClass('dimmed'));
    // Las aristas entre pasos consecutivos también quedan visibles
    cy.edges().forEach((arista) => {
      if (enRuta.has(arista.source().id()) && enRuta.has(arista.target().id())) {
        arista.removeClass('dimmed');
      }
    });
  });

  $('trail-bar').hidden = false;
  $('btn-senderos').classList.add('btn--activo');
  $('menu-senderos').hidden = true;
  $('btn-senderos').setAttribute('aria-expanded', 'false');

  irAPaso(0);
}

/** Restaura la vista normal. */
function deactivateTrail() {
  senderoActivo = null;
  pasoActual = 0;
  cy.elements().removeClass('dimmed actual paso-activo');
  $('trail-bar').hidden = true;
  $('btn-senderos').classList.remove('btn--activo');
}

/** Coloca el recorrido en un paso concreto y actualiza la barra. */
function irAPaso(indice) {
  if (!senderoActivo) return;

  const secuencia = senderoActivo.secuencia;
  pasoActual = Math.max(0, Math.min(indice, secuencia.length - 1));
  const idActual = secuencia[pasoActual];

  cy.nodes().removeClass('actual');
  cy.edges().removeClass('paso-activo');
  cy.getElementById(idActual).addClass('actual');

  // Destaca la arista que une el paso anterior con el actual
  if (pasoActual > 0) {
    const anterior = secuencia[pasoActual - 1];
    cy.edges().forEach((arista) => {
      const a = arista.source().id();
      const b = arista.target().id();
      if ((a === anterior && b === idActual) || (a === idActual && b === anterior)) {
        arista.addClass('paso-activo');
      }
    });
  }

  centerOnNode(idActual, true);
  openCard(idActual);
  setTimeout(() => positionCard(idActual), 420);

  // Barra de progreso: "Paso 3 de 7: bias"
  const concepto = getConcepto(idActual);
  $('trail-nombre').textContent = senderoActivo.nombre;
  $('trail-pos').textContent = 'Paso ' + (pasoActual + 1) + ' de ' + secuencia.length
    + ': ' + (concepto ? concepto.nombre : idActual);
  $('trail-fill').style.width = (((pasoActual + 1) / secuencia.length) * 100) + '%';
  $('trail-prev').disabled = pasoActual === 0;
  $('trail-next').disabled = pasoActual === secuencia.length - 1;
}

/** Avanza un paso en el sendero. */
function nextStep() { irAPaso(pasoActual + 1); }

/** Retrocede un paso en el sendero. */
function prevStep() { irAPaso(pasoActual - 1); }

/** Construye el menú desplegable de senderos. */
function pintarMenuSenderos() {
  const menu = $('menu-senderos');
  menu.innerHTML = (ATLAS.senderos || []).map((sendero) => {
    const partes = (sendero.partes || []).join(', ');
    return '<button class="menu-trail" role="menuitem" data-sendero="' + esc(sendero.id) + '">'
      + '<strong>' + esc(sendero.nombre) + '</strong><br/>'
      + '<small>' + esc(sendero.descripcion || '')
      + (partes ? ' · Partes ' + esc(partes) : '')
      + ' · ' + sendero.secuencia.length + ' pasos</small>'
      + '</button>';
  }).join('');

  menu.querySelectorAll('[data-sendero]').forEach((boton) => {
    boton.addEventListener('click', () => activateTrail(boton.dataset.sendero));
  });
}

/* ------------------------------------------------------------
   Exportación de respuestas (§6.6)
   ------------------------------------------------------------ */

/** Genera y descarga un markdown con todas las respuestas escritas. */
function exportAnswers() {
  const lineas = ['# Respuestas — Atlas del Perceptrón', ''];
  let total = 0;

  (ATLAS.conceptos || []).forEach((concepto) => {
    const texto = loadAnswer(concepto.id);
    if (!texto || !texto.trim()) return;
    total += 1;

    lineas.push('## ' + concepto.nombre + '  (`' + concepto.id + '`)');
    (concepto.preguntas || []).forEach((pregunta) => {
      const fuente = [pregunta.pdf, pregunta.parte ? 'Parte ' + pregunta.parte : '',
        pregunta.numero ? 'P' + pregunta.numero : ''].filter(Boolean).join(' · ');
      lineas.push('');
      lineas.push('**' + fuente + '** — ' + (pregunta.enunciado || ''));
    });
    lineas.push('');
    lineas.push(texto.trim());
    lineas.push('');
  });

  if (!total) {
    avisar('Aún no has escrito ninguna respuesta.');
    return;
  }

  lineas.push('---');
  lineas.push('Conceptos respondidos: ' + total + ' de ' + (ATLAS.conceptos || []).length);

  const blob = new Blob([lineas.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = 'respuestas_atlas_perceptron.md';
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}


/* ------------------------------------------------------------
   Selector "Rayos X" y tooltip
   ------------------------------------------------------------ */

/** Crea los botones-píldora de las capas globales (§5.2). */
function pintarSelectorCapas() {
  const barra = $('rayosx');
  barra.innerHTML = (ATLAS.capas_globales || []).map((capa) =>
    '<button class="toolbar__layer-btn" data-capa="' + esc(capa.id) + '" '
    + 'aria-pressed="false" title="Ver la capa ' + esc(capa.nombre) + '">'
    + esc(capa.icono || '') + ' ' + esc(capa.nombre) + '</button>'
  ).join('');

  barra.querySelectorAll('[data-capa]').forEach((boton) => {
    boton.addEventListener('click', () => setGlobalLayer(boton.dataset.capa));
  });
}

/** Muestra el tooltip con el nombre del concepto bajo el cursor. */
function mostrarTooltip(evento, concepto) {
  const tooltip = $('tooltip');
  const corta = (concepto.capas.visual || {}).descripcion_corta || '';
  tooltip.innerHTML = '<strong>' + esc(concepto.nombre) + '</strong>'
    + (corta ? '<br/><span>' + esc(corta) + '</span>' : '');
  tooltip.hidden = false;
  const x = evento.originalEvent ? evento.originalEvent.clientX : 0;
  const y = evento.originalEvent ? evento.originalEvent.clientY : 0;
  tooltip.style.left = Math.min(x + 14, window.innerWidth - 260) + 'px';
  tooltip.style.top = (y + 16) + 'px';
}

function ocultarTooltip() { $('tooltip').hidden = true; }

/* ------------------------------------------------------------
   Cableado de eventos
   ------------------------------------------------------------ */
function conectarEventos() {
  // --- Grafo ---
  cy.on('tap', 'node', (evento) => {
    openCard(evento.target.id());
  });

  // Clic en el fondo cierra la tarjeta (§5.3)
  cy.on('tap', (evento) => {
    if (evento.target === cy) closeCard();
  });

  // Doble clic en el fondo: vista general (§6.5)
  let ultimoTap = 0;
  cy.on('tap', (evento) => {
    if (evento.target !== cy) return;
    const ahora = Date.now();
    if (ahora - ultimoTap < 300) resetViewport();
    ultimoTap = ahora;
  });

  cy.on('mouseover', 'node', (evento) => {
    const concepto = getConcepto(evento.target.id());
    if (concepto) mostrarTooltip(evento, concepto);
  });
  cy.on('mouseout', 'node', ocultarTooltip);
  cy.on('mousemove', 'node', (evento) => {
    const concepto = getConcepto(evento.target.id());
    if (concepto) mostrarTooltip(evento, concepto);
  });

  // La tarjeta sigue al nodo cuando se hace pan o zoom
  cy.on('pan zoom', () => {
    if (nodoAbierto) positionCard(nodoAbierto);
    ocultarTooltip();
  });

  // --- Controles de zoom ---
  $('zoom-in').addEventListener('click', () => {
    cy.zoom({ level: Math.min(cy.zoom() * 1.25, ZOOM_MAX), renderedPosition: centroRender() });
  });
  $('zoom-out').addEventListener('click', () => {
    cy.zoom({ level: Math.max(cy.zoom() / 1.25, ZOOM_MIN), renderedPosition: centroRender() });
  });
  $('zoom-reset').addEventListener('click', resetViewport);

  // --- Senderos ---
  $('btn-senderos').addEventListener('click', () => {
    const menu = $('menu-senderos');
    menu.hidden = !menu.hidden;
    $('btn-senderos').setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  });
  $('trail-next').addEventListener('click', nextStep);
  $('trail-prev').addEventListener('click', prevStep);
  $('trail-cerrar').addEventListener('click', deactivateTrail);

  // --- Exportar ---
  $('btn-exportar').addEventListener('click', exportAnswers);

  // --- Teclado (accesibilidad, §11.3) ---
  document.addEventListener('keydown', (evento) => {
    // No interferir mientras se escribe una respuesta
    if (evento.target && evento.target.tagName === 'TEXTAREA') return;

    if (evento.key === 'Escape') {
      if (!$('menu-senderos').hidden) {
        $('menu-senderos').hidden = true;
        $('btn-senderos').setAttribute('aria-expanded', 'false');
      } else if (nodoAbierto) {
        closeCard();
      } else if (senderoActivo) {
        deactivateTrail();
      }
    }
    if (senderoActivo && (evento.key === 'ArrowRight' || evento.key === 'n')) nextStep();
    if (senderoActivo && (evento.key === 'ArrowLeft' || evento.key === 'p')) prevStep();
    if (evento.key === 'r') resetViewport();
  });

  // Reposiciona la tarjeta al cambiar el tamaño de la ventana
  window.addEventListener('resize', () => {
    if (nodoAbierto) positionCard(nodoAbierto);
  });
}

/** Centro del contenedor, en píxeles renderizados (para el zoom con botones). */
function centroRender() {
  const zona = $('canvas').getBoundingClientRect();
  return { x: zona.width / 2, y: zona.height / 2 };
}

/* ------------------------------------------------------------
   Arranque
   ------------------------------------------------------------ */
async function iniciar() {
  try {
    ATLAS = await cargarAtlas();
  } catch (e) {
    document.body.innerHTML = '<p style="padding:20px">No se pudo cargar el atlas: '
      + esc(e.message) + '</p>';
    return;
  }

  await cargarRespuestas();

  // La capa inicial es la primera declarada en el JSON
  const primera = (ATLAS.capas_globales || [])[0];
  capaActual = primera ? primera.id : 'visual';

  iniciarGrafo();
  pintarSelectorCapas();
  pintarMenuSenderos();
  conectarEventos();
  setGlobalLayer(capaActual);
  marcarRespondidos();

  console.log('Atlas listo: ' + (ATLAS.conceptos || []).length + ' conceptos, '
    + (ATLAS.conexiones || []).length + ' conexiones, '
    + (ATLAS.senderos || []).length + ' senderos'
    + (apiViva ? ' (API activa)' : ' (modo local)'));
}

document.addEventListener('DOMContentLoaded', iniciar);

/* ------------------------------------------------------------
   Interfaz pública (depuración y pruebas)
   ------------------------------------------------------------
   Las variables declaradas con `let` no son accesibles desde fuera del
   script, así que se expone un único objeto `window.Atlas`. Útil desde
   la consola del navegador:  Atlas.navigateToNode('xor')
   ------------------------------------------------------------ */
window.Atlas = {
  // Estado (lectura)
  get cy() { return cy; },
  get datos() { return ATLAS; },
  get capaActual() { return capaActual; },
  get nodoAbierto() { return nodoAbierto; },
  get senderoActivo() { return senderoActivo; },
  get pasoActual() { return pasoActual; },
  get apiViva() { return apiViva; },
  get respuestas() { return respuestas; },
  // Acciones
  openCard: openCard,
  closeCard: closeCard,
  setCardTab: setCardTab,
  positionCard: positionCard,
  setGlobalLayer: setGlobalLayer,
  navigateToNode: navigateToNode,
  centerOnNode: centerOnNode,
  resetViewport: resetViewport,
  activateTrail: activateTrail,
  deactivateTrail: deactivateTrail,
  nextStep: nextStep,
  prevStep: prevStep,
  saveAnswer: saveAnswer,
  loadAnswer: loadAnswer,
  exportAnswers: exportAnswers,
};


