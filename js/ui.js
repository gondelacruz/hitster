// ============================================================
//  INTERFAZ — funciones que construyen HTML (sin lógica de juego)
// ============================================================
import { COLORES_CARTA, AJUSTES } from "./config.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Color estable para una carta, derivado de su texto. */
export function colorCarta(carta) {
  const s = (carta.titulo || "") + (carta.artista || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORES_CARTA[h % COLORES_CARTA.length];
}

export function htmlCarta(carta) {
  return `
    <div class="carta" style="background:${colorCarta(carta)}">
      <div class="titulo">${esc(carta.titulo)}</div>
      <div class="anio">${esc(carta.anio)}</div>
      <div class="artista">${esc(carta.artista)}</div>
    </div>`;
}

export const htmlDorso = () =>
  `<div class="carta dorso"><div class="interrogante">?</div></div>`;

export function htmlFichas(n) {
  let out = '<span class="fichas">';
  for (let i = 0; i < AJUSTES.fichasMaximas; i++) {
    out += `<span class="ficha ${i < n ? "" : "vacia"}"></span>`;
  }
  return out + `</span>`;
}

/**
 * Línea temporal con huecos entre cartas.
 * opciones: { elegibles:Set|null, elegido:int|null, marcas:{slot:{texto,clase}},
 *             cartaDestacada:(carta)=>boolean }
 *
 * `cartaDestacada` resalta una carta YA puesta en la línea (con un borde
 * discontinuo), en vez de un hueco: se usa justo cuando el equipo acierta y
 * su carta recién ganada ya forma parte de esta misma línea, para señalarla
 * sin un marcador de hueco aparte que quedaría descolocado (ver
 * `faseRevelado`).
 */
export function htmlLinea(cartas, opciones = {}) {
  const { elegibles = null, elegido = null, marcas = {}, cartaDestacada = null } = opciones;
  const lista = cartas || [];
  let out = '<div class="linea">';

  // Entre dos cartas del MISMO año, el hueco de en medio nunca hace falta:
  // por la regla de empates (ver R.slotValido, "si hay empate de años, valen
  // las dos posiciones adyacentes"), cualquier año que valga justo en medio
  // vale exactamente igual justo antes de la primera carta o justo después
  // de la segunda — así que ofrecerlo como una opción más para colocar o
  // robar solo confunde sin dar ninguna opción nueva de verdad.
  const huecoRedundante = (i) => i > 0 && i < lista.length && lista[i - 1].anio === lista[i].anio;

  const hueco = (i) => {
    const redundante = huecoRedundante(i);
    // Si de verdad hay algo que mostrar ahí (una marca de la ronda, o es tu
    // propia selección ya hecha), lo dejamos igual aunque sea redundante —
    // solo dejamos de OFRECERLO como opción nueva.
    if (redundante && !marcas[i] && elegido !== i) return "";
    const esElegible = !!(elegibles && elegibles.has(i) && !redundante);
    const clases = ["hueco"];
    if (esElegible) clases.push("elegible");
    if (elegido === i) clases.push("elegido");
    const m = marcas[i];
    if (m?.clase) clases.push(m.clase);
    const etiqueta = m?.texto
      ? `<span class="marca">${esc(m.texto)}</span>`
      : (esElegible ? "+" : "");
    const sub = m?.sub ? `<span>${esc(m.sub)}</span>` : "";
    const attr = esElegible ? ` data-accion="hueco" data-slot="${i}" role="button" tabindex="0"` : "";
    return `<div class="${clases.join(" ")}"${attr}>${etiqueta}${sub}</div>`;
  };

  out += hueco(0);
  lista.forEach((c, i) => {
    const clase = cartaDestacada && cartaDestacada(c) ? "celda-carta destacada" : "celda-carta";
    out += `<div class="${clase}">${htmlCarta(c)}</div>`;
    out += hueco(i + 1);
  });
  return out + "</div>";
}

export function htmlEquipoFila(eq, extra = "") {
  return `
    <div class="equipo-fila">
      <span class="punto" style="background:${esc(eq.color?.hex || "#888")}"></span>
      <span class="nombre">${esc(eq.nombre)}</span>
      ${htmlFichas(eq.fichas || 0)}
      <span class="pastilla">${(eq.cartas || []).length} / ${AJUSTES.cartasParaGanar}</span>
      ${extra}
    </div>`;
}

export function reloj(segundos) {
  const s = Math.max(0, Math.ceil(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function aviso(tipo, texto) {
  return `<div class="aviso ${tipo}">${texto}</div>`;
}
