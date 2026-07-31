// ============================================================
//  REGLAS DEL JUEGO (lógica pura, sin interfaz ni red)
//  Todo lo de este archivo se puede probar con tests.
// ============================================================
import { AJUSTES } from "./config.js";

/** Ordena una línea temporal por año (ascendente). */
export function ordenar(cartas) {
  return [...cartas].sort((a, b) => a.anio - b.anio);
}

/**
 * ¿Es correcto colocar una canción de año `anio` en la posición `slot`?
 * `slot` = 0 significa "antes de la primera carta",
 * `slot` = cartas.length significa "después de la última".
 * Si hay empate de años, valen las dos posiciones adyacentes (regla Hitster).
 */
export function slotValido(cartas, anio, slot) {
  if (slot == null || slot < 0 || slot > cartas.length) return false;
  const izq = slot > 0 ? cartas[slot - 1].anio : null;
  const der = slot < cartas.length ? cartas[slot].anio : null;
  return (izq === null || izq <= anio) && (der === null || anio <= der);
}

/** Devuelve todos los slots correctos (puede haber más de uno si hay años repetidos). */
export function slotsValidos(cartas, anio) {
  const res = [];
  for (let i = 0; i <= cartas.length; i++) if (slotValido(cartas, anio, i)) res.push(i);
  return res;
}

/** Inserta una carta en su sitio correcto dentro de una línea temporal. */
export function insertarOrdenada(cartas, carta) {
  return ordenar([...cartas, carta]);
}

/** Lista de equipos ordenada por su orden de juego. */
export function equiposEnOrden(equipos) {
  return Object.values(equipos || {}).sort((a, b) => a.orden - b.orden);
}

/** Siguiente equipo al que le toca jugar. */
export function siguienteEquipo(equipos, equipoActualId) {
  const lista = equiposEnOrden(equipos);
  const i = lista.findIndex((e) => e.id === equipoActualId);
  return lista[(i + 1) % lista.length].id;
}

/** Equipos que pueden robar, en orden de juego a partir del equipo activo. */
export function ordenDeRobo(equipos, equipoActivoId) {
  const lista = equiposEnOrden(equipos);
  const i = lista.findIndex((e) => e.id === equipoActivoId);
  const res = [];
  for (let k = 1; k < lista.length; k++) res.push(lista[(i + k) % lista.length].id);
  return res;
}

/** Slots que un equipo NO puede elegir al robar (el del equipo activo y los ya pedidos). */
export function slotsOcupados(ronda) {
  const ocupados = new Set();
  if (ronda.colocacion != null) ocupados.add(ronda.colocacion);
  for (const v of Object.values(ronda.robos || {})) {
    if (typeof v === "number") ocupados.add(v);
  }
  return ocupados;
}

/**
 * Resuelve la ronda. Función pura: recibe el estado y devuelve el nuevo estado
 * de los equipos + una descripción de lo que ha pasado.
 */
export function resolverRonda({ equipos, ronda, anioCarta }) {
  const eqs = JSON.parse(JSON.stringify(equipos));
  const activo = eqs[ronda.equipoActivo];
  const timeline = ordenar(activo.cartas || []);

  const aciertoActivo = slotValido(timeline, anioCarta, ronda.colocacion);

  // Los intentos de robo cuestan 1 ficha, se acierte o no.
  const intentos = [];
  for (const [eqId, slot] of Object.entries(ronda.robos || {})) {
    if (typeof slot !== "number") continue;
    intentos.push({ equipo: eqId, slot, correcto: slotValido(timeline, anioCarta, slot) });
    eqs[eqId].fichas = Math.max(0, (eqs[eqId].fichas || 0) - 1);
  }

  let ganadorCarta = null;   // id del equipo que se queda la carta (o null = se descarta)
  if (aciertoActivo) {
    ganadorCarta = ronda.equipoActivo;
  } else {
    // En orden de juego, el primer ladrón que acertó se lleva la carta.
    const orden = ordenDeRobo(eqs, ronda.equipoActivo);
    for (const eqId of orden) {
      const intento = intentos.find((i) => i.equipo === eqId && i.correcto);
      if (intento) { ganadorCarta = eqId; break; }
    }
  }

  return { equipos: eqs, aciertoActivo, intentos, ganadorCarta };
}

/** Añade la carta al equipo que la ha ganado. */
export function entregarCarta(equipos, equipoId, carta) {
  const eqs = JSON.parse(JSON.stringify(equipos));
  if (!equipoId) return eqs;
  eqs[equipoId].cartas = insertarOrdenada(eqs[equipoId].cartas || [], carta);
  return eqs;
}

/** Suma una ficha respetando el máximo. */
export function sumarFicha(equipo, n = 1) {
  return Math.min(AJUSTES.fichasMaximas, (equipo.fichas || 0) + n);
}

/** ¿Alguien ha ganado? Devuelve el id del equipo o null. */
export function comprobarVictoria(equipos) {
  for (const e of equiposEnOrden(equipos)) {
    if ((e.cartas || []).length >= AJUSTES.cartasParaGanar) return e.id;
  }
  return null;
}

/** Código de sala de 4 dígitos. */
export function generarCodigo() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
