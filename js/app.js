// ============================================================
//  HITSTER FAMILIA — aplicación principal
// ============================================================
import { AJUSTES, COLORES_EQUIPO, SPOTIFY_CLIENT_IDS_SEMILLA, FIREBASE_CONFIG } from "./config.js";
import { CANCIONES } from "./canciones.js";
import * as R from "./reglas.js";
import * as Net from "./net.js";
import * as Sp from "./spotify.js";
import {
  esc, htmlCarta, htmlDorso, htmlFichas, htmlLinea, htmlEquipoFila, aviso,
} from "./ui.js";

const app = document.getElementById("app");

// ---------- sesión local ----------
const S = {
  vista: "inicio",
  codigo: null,
  equipoId: null,
  clienteId: null,
  error: null,
  info: null,
  ocupado: false,
  modal: null,          // 'otros' | 'reglas' | 'equipo' | 'ayuda' | 'corregirAnio'
  modalEquipo: null,
  slot: null,           // hueco seleccionado (aún sin confirmar)
  spotifyOk: false,
  previa: null,         // estado de la sala mientras eliges equipo (antes de unirte)
  aportando: false,
};
let E = null;           // estado de la sala (compartido)
let desuscribir = null;
let motorOcupado = false;
// Evita que el motor haga dos veces lo mismo mientras Firebase confirma el cambio.
const hecho = { resuelta: null, lanzada: null };

const guardar = () => localStorage.setItem("hitster_sesion",
  JSON.stringify({ codigo: S.codigo, equipoId: S.equipoId, clienteId: S.clienteId }));

function cargarSesion() {
  try { return JSON.parse(localStorage.getItem("hitster_sesion")) || {}; } catch { return {}; }
}

const soyHost = () => !!E && E.hostCliente === S.clienteId;
const miEquipo = () => (E?.equipos || {})[S.equipoId] || null;
const equipoActivo = () => (E?.equipos || {})[E?.ronda?.equipoActivo] || null;

// Dentro de un equipo con varios dispositivos, solo quien lo creó (el líder)
// puede jugar los turnos: colocar cartas, robar, responder al bonus, avanzar
// de ronda o corregir un año. El resto de dispositivos del equipo solo
// pueden aportar sus canciones de Spotify. Si el equipo no tiene campo
// `lider` (partidas creadas antes de esta función), lo dejamos abierto a
// todos para no romper nada a medio jugar.
const soyLiderEquipo = (eq) => !!eq && (!eq.lider || eq.lider === S.clienteId);
const soyLiderDeMiEquipo = () => soyLiderEquipo(miEquipo());

/** ¿Puedo abrir/guardar la corrección de año ahora mismo? */
function puedeCorregirAnio() {
  const r = E?.ronda;
  if (!r || r.subfase !== "revelado" || !r.carta || r.siguientePedida) return false;
  return soyHost() || (r.equipoActivo === S.equipoId && soyLiderDeMiEquipo());
}

/** ¿Puedo saltar la canción actual gratis (problema técnico/canción errónea)? */
function puedeSaltarGratis() {
  const r = E?.ronda;
  if (!r || r.subfase !== "colocando" || r.saltar) return false;
  return soyHost() || (r.equipoActivo === S.equipoId && soyLiderDeMiEquipo());
}

// ============================================================
//  ARRANQUE
// ============================================================
async function init() {
  const sesion = cargarSesion();
  S.clienteId = sesion.clienteId || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

  if (String(FIREBASE_CONFIG.databaseURL).includes("PEGA_AQUI")) {
    return pintarConfigPendiente();
  }

  try {
    await Net.conectar();
    Net.vigilarReloj();
    // Las apps de Spotify ya no viven en config.js: se guardan en Firebase,
    // para que cualquiera pueda registrar la suya desde el botón "¿Nunca has
    // jugado con tus canciones?" sin tocar código. La primera vez (base de
    // datos recién creada), sembramos lo que hubiera en config.js como
    // semilla, para no perder una configuración que ya funcionaba.
    await Net.sembrarAppsSpotifySiHaceFalta(SPOTIFY_CLIENT_IDS_SEMILLA);
    Sp.fijarAppsSpotify(await Net.leerAppsSpotify());
    Net.escucharAppsSpotify((lista) => { Sp.fijarAppsSpotify(lista); render(); });
  } catch (e) {
    S.error = "No se pudo conectar con la base de datos. Revisa la configuración de Firebase.";
    return render();
  }

  try {
    await Sp.procesarVuelta();
  } catch (e) { S.error = e.message; }
  // Si acabamos de volver del login y hay más de una app de Spotify
  // configurada, esto puede disparar solo un segundo intento con la
  // siguiente app (sin preguntar nada), en cuyo caso `iniciarLogin` ya nos
  // manda otra vez a Spotify y lo de abajo no llega a ejecutarse.
  const seguimosAqui = await comprobarAccesoSpotify();
  if (!seguimosAqui) return;
  S.spotifyOk = Sp.haySesion();

  // ¿Estábamos en una partida? Volvemos a entrar.
  const volverA = sessionStorage.getItem("hitster_volver_a");
  if (sesion.codigo && sesion.equipoId && await Net.existeSala(sesion.codigo)) {
    S.codigo = sesion.codigo;
    S.equipoId = sesion.equipoId;
    entrarEnSala();
    // Al volver del login de Spotify a mitad de partida, aportamos solos.
    if (volverA === "aportar" && S.spotifyOk) {
      sessionStorage.removeItem("hitster_volver_a");
      acciones.aportarSpotify();
    }
  } else if (volverA === "crear" && S.spotifyOk) {
    sessionStorage.removeItem("hitster_volver_a");
    S.vista = "crear";
  } else {
    // ¿Alguien ha abierto un enlace directo a una partida (compartido por
    // otro jugador, o guardado como marcador de esta)? Saltamos derecho a
    // elegir equipo con ese código ya puesto, sin que haga falta teclearlo.
    const codigoUrl = new URLSearchParams(location.search).get("codigo");
    if (codigoUrl && /^\d{4}$/.test(codigoUrl)) await entrarPorCodigo(codigoUrl);
  }
  guardar();
  render();
  setInterval(tic, 300);
}

/**
 * Refleja el código de la partida en la URL (?codigo=1234), sin recargar la
 * página. Así cada partida tiene una dirección propia: se puede compartir o
 * guardar como marcador, y da una forma de "escapar" de una pantalla rara
 * sin tener que borrar todo el historial del navegador — basta con volver
 * a la URL base. No usamos una ruta tipo /1234 porque GitHub Pages no sabe
 * servir esa URL si alguien la abre directamente (daría 404).
 */
function sincronizarUrl(codigo) {
  const url = new URL(location.href);
  if (codigo) url.searchParams.set("codigo", codigo);
  else url.searchParams.delete("codigo");
  history.replaceState(null, "", url.pathname + url.search);
}

/** Comprueba un código de sala y, si existe y sigue en el lobby, prepara la pantalla de elegir equipo. */
async function entrarPorCodigo(codigo) {
  if (!/^\d{4}$/.test(codigo)) { S.error = "El código son 4 dígitos."; return; }
  const estado = await Net.leerSala(codigo);
  if (!estado) { S.error = "No existe ninguna partida con ese código."; return; }
  if (estado.fase !== "lobby") { S.error = "Esa partida ya ha empezado."; return; }
  S.codigo = codigo; S.previa = estado; S.vista = "unirseEquipo";
}

function entrarEnSala() {
  S.vista = "sala";
  sincronizarUrl(S.codigo);
  desuscribir?.();
  desuscribir = Net.escuchar(S.codigo, (estado) => {
    if (!estado) {                       // la sala ha desaparecido
      desuscribir?.(); desuscribir = null;   // no dejar la suscripción colgada
      E = null; S.codigo = null; S.equipoId = null; S.vista = "inicio";
      S.error = "La partida se ha cerrado.";
      sincronizarUrl(null);
      guardar(); return render();
    }
    E = estado;
    if (soyHost()) motor();
    render();
  });
  Net.marcarPresencia(S.codigo, S.equipoId, S.clienteId);
}

/**
 * Latido: deja que el anfitrión avance la partida por tiempo. Ya no hay
 * cronómetro visible en pantalla (lo importante es la línea del tiempo, no
 * meter prisa) — pero el tope de tiempo se sigue cumpliendo igual por
 * detrás, así una ronda nunca se queda colgada si nadie pulsa nada.
 */
function tic() {
  if (!E) return;
  if (soyHost()) motor();
}

// ============================================================
//  MAZO
// ============================================================
export const clave = (c) => `${c.titulo}|${c.artista}`.toLowerCase().replace(/[.#$/[\]]/g, "");

/**
 * Junta los aportes de Spotify de todos los dispositivos de la sala en un
 * solo pool. Normalizamos el peso de cada persona (dividimos entre su propio
 * total) para que quien haya aportado muchas más canciones —más playlists,
 * más historial— no acapare el mazo: cada persona "pesa" lo mismo en total,
 * y dentro de su lista se respeta qué canciones le gustan más. Las canciones
 * que varias personas tienen en común (misma canción en playlists o tops de
 * gente distinta) suman sus pesos normalizados y además cuentan cuánta gente
 * las aportó, para priorizarlas después. Guardamos también quién exactamente
 * aportó cada canción (`aportantes`), para poder repartir turnos entre
 * personas a lo largo de la partida (ver `usosPorAportante`), y la
 * `popularidad` que le da Spotify (0-100), para poder preferir canciones
 * medio conocidas frente a rarezas que solo ha escuchado quien la aportó
 * (ver `elegirPonderado`). Las canciones que el grupo haya marcado como
 * "tontería" desde la lista del botón «?» (`estado.bloqueadas`, por clave)
 * se excluyen aquí directamente, así que no vuelven a salir en ninguna
 * partida siguiente sin tocar nada más.
 */
export function poolComunitario(estado) {
  const aportes = Object.entries(estado.aportes || {});
  const bloqueadas = estado.bloqueadas || {};
  const mapa = new Map();
  for (const [clienteId, aporte] of aportes) {
    const canciones = aporte.canciones || [];
    const totalPersona = canciones.reduce((s, c) => s + Math.max(1, c.peso || 1), 0) || 1;
    for (const c of canciones) {
      const k = clave(c);
      if (bloqueadas[k]) continue;
      const pesoNorm = Math.max(1, c.peso || 1) / totalPersona;
      const actual = mapa.get(k);
      if (actual) { actual.peso += pesoNorm; actual.personas += 1; actual.aportantes.add(clienteId); }
      else mapa.set(k, { ...c, mazo: "top", peso: pesoNorm, personas: 1, aportantes: new Set([clienteId]) });
    }
  }
  return [...mapa.values()];
}

/**
 * Cuántas canciones del pool comunitario ya usadas en la partida vino de
 * cada persona (por `clienteId`). Ya no se usa para elegir (ver
 * `elegirDeSpotifyPorPersona`), pero se deja aquí, con su prueba, por si
 * hiciera falta en el futuro.
 */
export function usosPorAportante(pool, usadas) {
  const usos = new Map();
  for (const c of pool) {
    if (!usadas[clave(c)] || !c.aportantes) continue;
    for (const id of c.aportantes) usos.set(id, (usos.get(id) || 0) + 1);
  }
  return usos;
}

/**
 * Elige una canción del pool de Spotify siendo justos entre aportantes: en
 * vez de sortear directamente entre TODAS las canciones (lo que deja que
 * quien tenga cargadas 40 canciones de un solo artista acapare el mazo solo
 * por tener muchas más guardadas que los demás — el caso real fue alguien
 * con medio Spotify de Roger Waters), primero se sortea, con las mismas
 * probabilidades, a qué PERSONA le toca sonar, y solo después se elige al
 * azar una canción suya. Así cada aportante tiene la misma probabilidad de
 * que le toque, cante lo que cante y tenga las que tenga. Una canción que
 * varias personas compartan cuenta en el "cajón" de cada una de ellas, así
 * que sigue teniendo, de forma natural, algo más de probabilidad — pero sin
 * ningún multiplicador aparte.
 */
export function elegirDeSpotifyPorPersona(lista) {
  const porPersona = new Map(); // clienteId -> canciones libres suyas
  for (const c of lista) {
    const aportantes = c.aportantes && c.aportantes.size ? [...c.aportantes] : ["__sin_aportante__"];
    for (const id of aportantes) {
      if (!porPersona.has(id)) porPersona.set(id, []);
      porPersona.get(id).push(c);
    }
  }
  const personas = [...porPersona.keys()];
  const persona = personas[Math.floor(Math.random() * personas.length)];
  const suyas = porPersona.get(persona);
  return suyas[Math.floor(Math.random() * suyas.length)];
}

/** Resumen para mostrar en el lobby: cuánta gente ha aportado y cuántas coinciden. */
export function resumenAportes(estado) {
  const gente = Object.keys(estado.aportes || {}).length;
  const comunes = poolComunitario(estado).filter((c) => c.personas > 1).length;
  return { gente, comunes };
}

const TODAS_CURADAS = () => CANCIONES.map(([titulo, artista, anio, m]) => ({ titulo, artista, anio, mazo: m }));

/**
 * Seis mazos posibles:
 *  - "famosas": el mazo curado entero (español + inglés + algún otro idioma).
 *  - "es": solo español y latino.
 *  - "en": solo canciones en inglés (aprox.: el mazo internacional).
 *  - "spotify": solo lo que aporten los jugadores con su Spotify.
 *  - "todo": lo que aporten los jugadores + el mazo curado entero, mezclado.
 *  - "mixto": lo mismo que "todo", pero la parte curada se reparte a
 *    propósito ~50/50 entre español e inglés en vez de salir como caiga (el
 *    catálogo curado tiene casi el doble de canciones en inglés que en
 *    español, así que sin esto tiende a notarse) — ver
 *    `elegirBalanceadoPorIdioma`.
 */
export function baraja(config, estado) {
  const todas = TODAS_CURADAS();
  switch (config.mazo) {
    case "es": return { propias: [], curadas: todas.filter((c) => c.mazo === "es") };
    case "en": return { propias: [], curadas: todas.filter((c) => c.mazo === "int") };
    case "spotify": return { propias: poolComunitario(estado), curadas: [] };
    case "todo": return { propias: poolComunitario(estado), curadas: todas };
    case "mixto": return { propias: poolComunitario(estado), curadas: todas };
    default: return { propias: [], curadas: todas }; // "famosas"
  }
}

/**
 * Elige un elemento al azar dando más peso a los que tienen `peso` más alto.
 * Ojo: los pesos del pool de Spotify ya vienen normalizados por persona
 * (fracciones pequeñas), así que aquí no forzamos un mínimo de 1 — eso
 * borraría esa normalización. Las canciones del mazo curado no traen `peso`
 * y valen 1 cada una, como siempre.
 *
 * Ya NO hay un bonus extra por "varias personas la tienen" (`personas`):
 * con grupos pequeños (3-4 aportando) y pocas canciones realmente en común,
 * cualquier empujón extra —por pequeño que fuera— bastaba para que esas
 * 1-2 canciones compartidas salieran prácticamente siempre, partida tras
 * partida (el bug que reportó el usuario). El pool ya suma los pesos
 * normalizados de cada persona que comparte una canción (ver
 * `poolComunitario`), así que una canción en común sigue teniendo algo más
 * de peso de forma natural, sin un multiplicador aparte que la vuelva casi
 * obligatoria.
 *
 * `usos` (opcional, Map clienteId -> nº de canciones suyas ya sonadas) se
 * usa para bajar el peso de quien ya ha tenido varias canciones en la
 * partida y subir el de quien todavía no ha tenido ninguna, para que los
 * aportantes de Spotify se turnen en vez de que unos pocos acaparen todo.
 */
export function elegirPonderado(lista, usos = null) {
  const pesos = lista.map((c) => {
    let p = Math.max(0.0001, c.peso ?? 1);
    // Preferimos canciones medio conocidas: si tenemos la popularidad que le
    // da Spotify (0-100), la usamos para no sacar rarezas que solo conoce
    // quien la aportó. No la descartamos del todo —sigue siendo su
    // favorita—, solo la hacemos bastante menos probable cuanto más
    // desconocida sea.
    if (typeof c.popularidad === "number") {
      p *= Math.max(0.15, c.popularidad / 100);
    }
    if (usos && c.aportantes && c.aportantes.size) {
      const usadoMin = Math.min(...[...c.aportantes].map((id) => usos.get(id) || 0));
      p /= (1 + usadoMin);
    }
    return p;
  });
  const total = pesos.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < lista.length; i++) { r -= pesos[i]; if (r <= 0) return lista[i]; }
  return lista[lista.length - 1];
}

// El pool de Spotify de los jugadores suele estar cargado de música moderna
// (es lo que más se escucha hoy). Para que la partida siga teniendo mezcla
// de épocas, primero sorteamos la década —con el mismo criterio que el mazo
// curado: poco peso antes de 1964, peso normal después— y solo luego, dentro
// de esa década, priorizamos lo que varios jugadores tengan en común.
const PESO_DECADA = { 1950: 1, 1960: 2 };
const PESO_DECADA_NORMAL = 4;
const decadaDe = (anio) => Math.floor(anio / 10) * 10;

export function elegirPonderadoPorDecada(lista, usos = null) {
  if (!lista.length) return null;
  const porDecada = new Map();
  for (const c of lista) {
    const d = decadaDe(c.anio);
    if (!porDecada.has(d)) porDecada.set(d, []);
    porDecada.get(d).push(c);
  }
  const decadas = [...porDecada.keys()];
  const pesos = decadas.map((d) => PESO_DECADA[d] ?? PESO_DECADA_NORMAL);
  const total = pesos.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let elegida = decadas[decadas.length - 1];
  for (let i = 0; i < decadas.length; i++) { r -= pesos[i]; if (r <= 0) { elegida = decadas[i]; break; } }
  return elegirPonderado(porDecada.get(elegida), usos);
}

/**
 * Para el mazo "mixto": reparte lo curado ~50/50 entre español e inglés,
 * pero sin alternancia estricta (que con dos equipos se nota muchísimo:
 * ES-EN-ES-EN según a quién le toque jugar, muy cantado). En vez de eso, en
 * cada tirada se mira cuánto llevamos de cada idioma en lo ya usado en la
 * partida y se sube la probabilidad del que va más flojo — corrigiendo el
 * desequilibrio poco a poco, dejando siempre un margen real de azar, para
 * que sea variado de verdad y no un metrónomo previsible.
 *
 * `catalogoCompleto` es el mazo curado entero (para poder mirar el idioma de
 * lo ya usado, aunque ya no esté disponible); `disponibles` son las que
 * todavía se pueden sacar.
 */
export function elegirBalanceadoPorIdioma(catalogoCompleto, usadas, disponibles) {
  const esDisp = disponibles.filter((c) => c.mazo === "es");
  const enDisp = disponibles.filter((c) => c.mazo !== "es");
  if (!esDisp.length) return enDisp[Math.floor(Math.random() * enDisp.length)];
  if (!enDisp.length) return esDisp[Math.floor(Math.random() * esDisp.length)];

  let usadasEs = 0, usadasEn = 0;
  for (const c of catalogoCompleto) {
    if (!usadas[clave(c)]) continue;
    if (c.mazo === "es") usadasEs++; else usadasEn++;
  }
  const total = usadasEs + usadasEn;
  let probEs = 0.5;
  if (total > 0) {
    const fraccionEs = usadasEs / total;
    probEs = Math.min(0.85, Math.max(0.15, 0.5 + (0.5 - fraccionEs) * 0.9));
  }
  const lista = Math.random() < probEs ? esDisp : enDisp;
  return lista[Math.floor(Math.random() * lista.length)];
}

export function sacarCancion(estado) {
  const { propias, curadas } = baraja(estado.config, estado);
  const usadas = estado.usadas || {};
  const libres = (l) => l.filter((c) => !usadas[clave(c)]);
  const a = libres(propias), b = libres(curadas);
  let fuente = b;
  if (a.length && (!b.length || Math.random() < 0.6)) fuente = a;
  if (!fuente.length) fuente = a.length ? a : b;
  if (!fuente.length) return null;
  // El pool de Spotify siempre se elige repartiendo primero entre personas
  // (ver `elegirDeSpotifyPorPersona`), para que nadie acapare el mazo solo
  // por tener muchas más canciones guardadas que el resto.
  if (fuente === a) return elegirDeSpotifyPorPersona(fuente);
  // El mazo curado, en el mazo "mixto", se reparte ~50/50 entre idiomas.
  // En el resto de mazos (famosas/es/en/todo) sigue siendo del todo
  // uniforme, como hasta ahora.
  if (estado.config?.mazo === "mixto") return elegirBalanceadoPorIdioma(curadas, usadas, fuente);
  return fuente[Math.floor(Math.random() * fuente.length)];
}

/** Elige una canción y encuentra su URI en Spotify (reintenta si no la encuentra). */
async function siguienteCancion(estado) {
  const usadas = { ...(estado.usadas || {}) };
  for (let intento = 0; intento < 8; intento++) {
    const c = sacarCancion({ ...estado, usadas });
    if (!c) return null;
    usadas[clave(c)] = true;
    if (c.uri) return { carta: c, usadas };
    try {
      const hit = await Sp.buscarTrack(c.titulo, c.artista);
      if (hit) return { carta: { ...c, uri: hit.uri }, usadas };
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw e;
    }
  }
  return null;
}

// ============================================================
//  MOTOR (solo lo ejecuta el anfitrión)
// ============================================================
async function motor() {
  if (motorOcupado || !E || E.fase !== "jugando" || !E.ronda) return;
  motorOcupado = true;
  try { await motorPaso(); }
  catch (e) { console.error(e); S.error = e.message; render(); }
  finally { motorOcupado = false; }
}

/**
 * Ejecuta un paso del motor que solo debe hacerse una vez por ronda (marcado
 * en `hecho[clave]`), reintentándolo solo en el siguiente tick si falla.
 *
 * Antes, la marca de "hecho" se ponía ANTES de lanzar la escritura en
 * Firebase; si esa escritura fallaba (red inestable, `revelar()` sin poder
 * descifrar la carta, lo que sea), la marca se quedaba puesta para siempre
 * y el motor nunca volvía a intentar ese paso — la partida se quedaba
 * congelada de por vida para todo el mundo, sin ningún botón que pudiera
 * desatascarlo (el bug de "le he dado a pasar y se ha quedado todo
 * parado"). Ahora la marca solo se confirma si la operación termina bien;
 * si falla, se quita, así el siguiente tick (300ms) lo reintenta solo.
 */
async function pasoUnaVez(clave, valor, fn) {
  if (hecho[clave] === valor) return;
  hecho[clave] = valor;
  try {
    await fn();
  } catch (e) {
    hecho[clave] = null;
    throw e;
  }
}

async function motorPaso() {
  const r = E.ronda;
  const t = Net.ahora();

  // --- fase 1: el equipo activo coloca su carta ---
  if (r.subfase === "colocando") {
    if (r.saltar) {
      return void (await pasoUnaVez("saltada", r.limite, empezarRevelacionSalto));
    }
    if (r.confirmada || t > r.limite) {
      await Net.actualizar(S.codigo, {
        "ronda/confirmada": true,
        "ronda/subfase": "robando",
        "ronda/turnoRobo": null,
        "ronda/limiteRobo": 0,
      });
    }
    return;
  }

  // --- fase 1b: se decidió saltar; enseñamos la carta 5s antes de cambiarla ---
  if (r.subfase === "saltando") {
    if (t > r.limiteSalto) {
      return void (await pasoUnaVez("saltoResuelto", r.n + ":" + r.limiteSalto, terminarSalto));
    }
    return;
  }

  // --- fase 2: los demás equipos deciden si roban, por orden de juego ---
  if (r.subfase === "robando") {
    const orden = R.ordenDeRobo(E.equipos, r.equipoActivo);
    const robos = r.robos || {};
    const pendiente = orden.find((id) => robos[id] === undefined);

    if (!pendiente) {
      return void (await pasoUnaVez("resuelta", r.n, resolver));
    }

    if (r.turnoRobo !== pendiente) {
      return void (await Net.actualizar(S.codigo, {
        "ronda/turnoRobo": pendiente,
        "ronda/limiteRobo": Net.ahora() + AJUSTES.segundosRobo * 1000,
      }));
    }
    if (t > r.limiteRobo) {
      return void (await Net.escribir(S.codigo, `ronda/robos/${pendiente}`, "pasa"));
    }
    return;
  }

  // --- fase 3: revelado; esperamos a que pulsen "siguiente" ---
  if (r.subfase === "revelado" && r.siguientePedida) {
    return void (await pasoUnaVez("lanzada", r.n, async () => {
      const ganador = R.comprobarVictoria(E.equipos, E.primerEquipo, {
        ganadorCarta: r.resultado?.ganadorCarta ?? null,
        equipoActivo: r.equipoActivo,
      });
      if (ganador) {
        await Sp.pausar().catch(() => {});
        await Net.actualizar(S.codigo, { fase: "fin", ganador, ronda: null });
        return;
      }
      await nuevaRonda(R.siguienteEquipo(E.equipos, r.equipoActivo));
    }));
  }
}

/** Calcula el resultado de la ronda y lo aplica. */
async function resolver() {
  const r = E.ronda;
  const secreto = Net.revelar(r.secreto, S.codigo);
  if (!secreto) throw new Error("No se pudo leer la carta de esta ronda.");

  const res = R.resolverRonda({ equipos: E.equipos, ronda: r, anioCarta: secreto.anio });
  const carta = { titulo: secreto.titulo, artista: secreto.artista, anio: secreto.anio };
  const equipos = R.entregarCarta(res.equipos, res.ganadorCarta, carta);

  await Sp.pausar().catch(() => {});
  await Net.actualizar(S.codigo, {
    equipos,
    "ronda/subfase": "revelado",
    "ronda/carta": carta,
    "ronda/resultado": {
      aciertoActivo: res.aciertoActivo,
      ganadorCarta: res.ganadorCarta || null,
      intentos: res.intentos,
      slotsValidos: R.slotsValidos(R.ordenar(E.equipos[r.equipoActivo].cartas || []), secreto.anio),
    },
    "ronda/esperandoBonus": res.aciertoActivo,
    "ronda/secreto": null,
  });
}

/** Empieza una ronda nueva para `equipoId`. */
async function nuevaRonda(equipoId) {
  const elegida = await siguienteCancion(E);
  if (!elegida) {
    return void (await Net.actualizar(S.codigo, { fase: "fin", ganador: null, motivo: "sincanciones" }));
  }
  const { carta, usadas } = elegida;
  await Net.actualizar(S.codigo, {
    usadas,
    ronda: {
      n: (E.ronda?.n || 0) + 1,
      equipoActivo: equipoId,
      subfase: "colocando",
      limite: Net.ahora() + AJUSTES.segundosTurno * 1000,
      colocacion: null,
      confirmada: false,
      robos: {},
      turnoRobo: null,
      limiteRobo: 0,
      secreto: Net.ocultar(carta, S.codigo),
      carta: null,
      resultado: null,
      esperandoBonus: false,
      siguientePedida: false,
      saltar: false,
      limiteSalto: 0,
    },
  });
  sonar(carta.uri);
}

/**
 * Al saltar una canción (con o sin fichas), primero la enseñamos boca arriba
 * 5 segundos —para que se sepa cuál era— y solo después pasamos a la
 * siguiente. Se hace en dos pasos: aquí revelamos y paramos la música;
 * `terminarSalto` (llamado por el motor cuando pasan los 5s) es quien saca
 * la carta nueva de verdad.
 */
async function empezarRevelacionSalto() {
  const secreto = Net.revelar(E.ronda.secreto, S.codigo);
  await Sp.pausar().catch(() => {});
  await Net.actualizar(S.codigo, {
    "ronda/subfase": "saltando",
    "ronda/carta": secreto ? { titulo: secreto.titulo, artista: secreto.artista, anio: secreto.anio } : null,
    "ronda/limiteSalto": Net.ahora() + 5000,
  });
}

/** Segundo paso del salto: pasados los 5s de ver la carta, sacamos una nueva. */
async function terminarSalto() {
  const elegida = await siguienteCancion(E);
  if (!elegida) {
    return void (await Net.actualizar(S.codigo, { fase: "fin", ganador: null, motivo: "sincanciones" }));
  }
  const { carta, usadas } = elegida;
  await Net.actualizar(S.codigo, {
    usadas,
    "ronda/secreto": Net.ocultar(carta, S.codigo),
    "ronda/carta": null,
    "ronda/subfase": "colocando",
    "ronda/limite": Net.ahora() + AJUSTES.segundosTurno * 1000,
    "ronda/colocacion": null,
    "ronda/saltar": false,
    "ronda/limiteSalto": 0,
  });
  sonar(carta.uri);
}

async function sonar(uri) {
  try {
    await Sp.reproducir(uri);
    S.error = null;
  } catch (e) {
    S.error = e.status === 404
      ? "Spotify no encuentra ningún dispositivo activo. Abre Spotify en el móvil o el altavoz, dale a "
        + "reproducir algo un segundo para que quede activo, y pulsa \"Reintentar reproducir\" en el botón «?»."
      : "Spotify: " + e.message;
    render();
  }
}

/** URI de la canción de la ronda actual (esté ya revelada o siga boca abajo). */
function uriRondaActual() {
  const r = E?.ronda;
  if (!r) return null;
  if (r.secreto) {
    const secreto = Net.revelar(r.secreto, S.codigo);
    if (secreto?.uri) return secreto.uri;
  }
  return r.carta?.uri || null;
}

/**
 * Empieza el login con Spotify. Si hay más de una app configurada — porque
 * sois muchos aportando canciones y os hizo falta crear una segunda app para
 * no toparos con el límite de 5 usuarios de Spotify — no hace falta preguntar
 * nada: `Sp.iniciarLogin()` ya prueba sola la primera app sin probar todavía
 * en este intento, y si luego resulta que la cuenta no está autorizada ahí,
 * `comprobarAccesoSpotify` (ver más abajo, en `init`) reintenta sola con la
 * siguiente en cuanto vuelve del login.
 */
function irALoginSpotify(volverA) {
  sessionStorage.setItem("hitster_volver_a", volverA);
  return Sp.iniciarLogin();
}

/**
 * Se llama justo después de procesar la vuelta del login de Spotify. Si hay
 * más de una app configurada y la cuenta no está autorizada en la que
 * acabamos de usar (Spotify deja completar el login igualmente, y el bloqueo
 * solo aparece al llamar a la API — por eso hace falta esta comprobación),
 * reintenta sola con la siguiente app sin preguntar nada a la persona; si ya
 * no queda ninguna más por probar, avisa de que hace falta que quien organiza
 * la partida añada esa cuenta en el panel de Spotify Developer.
 */
async function comprobarAccesoSpotify() {
  if (!Sp.haySesion()) return true;
  const acceso = await Sp.verificarAcceso();
  if (acceso) { Sp.limpiarIntentados(); return true; }
  const siguiente = Sp.siguienteAppSinProbar();
  Sp.cerrarSesion();
  if (siguiente) { await Sp.iniciarLogin(siguiente); return false; }
  S.error = "No hemos podido acceder a Spotify con ninguna de las apps configuradas. Pide a quien organiza "
    + "la partida que añada tu cuenta de Spotify en el panel de Spotify Developer.";
  return true;
}

// ============================================================
//  ACCIONES DEL JUGADOR
// ============================================================
const acciones = {
  // ----- pantallas iniciales -----
  irCrear: () => { S.vista = "crear"; S.error = null; },
  irUnirse: () => { S.vista = "unirse"; S.error = null; },
  volverInicio: () => { S.vista = "inicio"; S.previa = null; S.error = null; sincronizarUrl(null); },
  verReglas: () => { S.modal = "reglas"; },
  cerrarModal: () => { S.modal = null; S.modalEquipo = null; },

  conectarSpotify: () => irALoginSpotify("crear"),

  desconectarSpotify: () => { Sp.cerrarSesion(); S.spotifyOk = false; },

  /** Abre las instrucciones para registrar una app de Spotify propia (ver LEEME). */
  abrirAnadirSpotifyApp: () => { S.modal = "anadirSpotifyApp"; S.error = null; },

  /** Guarda en Firebase la app de Spotify que alguien acaba de crearse. */
  async guardarAppSpotify() {
    const clientId = (document.getElementById("in-spotify-clientid")?.value || "").trim();
    const nombre = (document.getElementById("in-spotify-nombre")?.value || "").trim();
    if (!/^[a-f0-9]{32}$/i.test(clientId)) {
      S.error = "Ese Client ID no tiene la pinta de uno de Spotify: debería ser una cadena de 32 "
        + "letras y números, sin espacios ni comillas. Cópialo tal cual de la pantalla Settings de "
        + "tu app, en el panel de Spotify Developer.";
      return;
    }
    if (!nombre) { S.error = "Ponle un nombre a tu app, para que la gente sepa cuál es la suya."; return; }
    if (Sp.appsSpotify().some((a) => a.id.toLowerCase() === clientId.toLowerCase())) {
      S.error = "Esa app ya estaba añadida.";
      return;
    }
    await Net.anadirAppSpotify(clientId, nombre);
    S.modal = null;
  },

  async crearPartida() {
    const nombre = (document.getElementById("in-nombre")?.value || "").trim() || "Equipo 1";
    const mazo = document.getElementById("in-mazo")?.value || "famosas";
    if (!Sp.haySesion()) { S.error = "Primero conecta tu cuenta de Spotify."; return; }

    let codigo;
    do { codigo = R.generarCodigo(); } while (await Net.existeSala(codigo));

    const equipoId = "eq1";
    await Net.crearSala(codigo, {
      fase: "lobby",
      hostCliente: S.clienteId,
      config: { mazo },
      equipos: {
        [equipoId]: {
          id: equipoId, nombre, color: COLORES_EQUIPO[0], orden: 0, lider: S.clienteId,
          fichas: AJUSTES.fichasIniciales, cartas: [], miembros: { [S.clienteId]: true },
        },
      },
      usadas: {}, aportes: {}, bloqueadas: {}, ronda: null, ganador: null,
    });
    S.codigo = codigo; S.equipoId = equipoId; guardar(); entrarEnSala();
  },

  /** Paso 1 al unirse: solo el código, para ver qué equipos hay ya. */
  buscarSala: () => entrarPorCodigo((document.getElementById("in-codigo")?.value || "").trim()),

  /** Unirse a un equipo que ya existe (otro dispositivo de la misma familia). */
  async unirmeEquipo(el) {
    const equipoId = el.dataset.id;
    await Net.escribir(S.codigo, `equipos/${equipoId}/miembros/${S.clienteId}`, true);
    S.equipoId = equipoId; S.previa = null; guardar(); entrarEnSala();
  },

  /** Crear un equipo nuevo dentro de una partida ya existente. */
  async crearEquipoNuevo() {
    const nombre = (document.getElementById("in-nombre-equipo")?.value || "").trim();
    if (!nombre) { S.error = "Pon un nombre a vuestro equipo."; return; }

    const estado = await Net.leerSala(S.codigo);
    if (!estado) { S.error = "La partida ha dejado de existir."; S.vista = "unirse"; S.previa = null; return; }
    const equipos = Object.values(estado.equipos || {});
    if (equipos.length >= AJUSTES.maxEquipos) { S.error = "La partida ya tiene 4 equipos."; return; }

    const orden = equipos.length;
    const equipoId = "eq" + (orden + 1);
    await Net.escribir(S.codigo, `equipos/${equipoId}`, {
      id: equipoId, nombre, color: COLORES_EQUIPO[orden], orden, lider: S.clienteId,
      fichas: AJUSTES.fichasIniciales, cartas: [], miembros: { [S.clienteId]: true },
    });
    S.equipoId = equipoId; S.previa = null; guardar(); entrarEnSala();
  },

  async salir() {
    if (!confirm("¿Seguro que quieres salir de la partida?")) return;
    if (soyHost()) {
      await Net.borrarSala(S.codigo);
    } else {
      const eq = miEquipo();
      const otros = Object.keys(eq?.miembros || {}).filter((id) => id !== S.clienteId);
      if (otros.length) await Net.escribir(S.codigo, `equipos/${S.equipoId}/miembros/${S.clienteId}`, null);
      else await Net.escribir(S.codigo, `equipos/${S.equipoId}`, null);
    }
    desuscribir?.(); desuscribir = null;
    E = null; S.codigo = null; S.equipoId = null; S.vista = "inicio"; guardar();
    sincronizarUrl(null);
  },

  // ----- aportar canciones de Spotify (cualquier dispositivo, en cualquier momento) -----
  async aportarSpotify() {
    // Si nunca se conectó, o se conectó antes de que pidiéramos permiso para
    // leer canciones guardadas/playlists/reproducidas recientemente, hay que
    // (re)conectar para que Spotify pida esos permisos.
    if (!Sp.haySesion() || Sp.faltanPermisos()) {
      Sp.cerrarSesion();
      return irALoginSpotify("aportar");
    }
    S.aportando = true; S.info = "Leyendo tus canciones de Spotify (esto puede tardar un poco)…"; render();
    try {
      const canciones = await Sp.misCancionesFavoritas();
      const nombre = miEquipo()?.nombre || "Alguien";
      await Net.escribir(S.codigo, `aportes/${S.clienteId}`, { nombre, canciones });
    } catch (e) {
      if (e.tipo === "permisos") {
        // Le faltaban permisos y no lo detectamos antes (p.ej. los revocó a
        // mano en Spotify). Limpiamos la sesión para que el próximo toque
        // vuelva a pedirlos.
        Sp.cerrarSesion();
        S.error = "A tu Spotify le faltan permisos para leer canciones guardadas, playlists o "
          + "reproducciones recientes. Vuelve a pulsar el botón para reconectar y darlos.";
      } else if (e.tipo === "red") {
        // No se ha podido hablar con Spotify (tiempo agotado o directamente
        // sin conexión). Esto ya no se queda "leyendo…" para siempre: al
        // primer fallo de red se corta en segundos en vez de intentar
        // fuente a fuente durante minutos.
        S.error = e.message + " Prueba con otra red (por ejemplo, datos móviles en vez de wifi), revisa que "
          + "no haya un bloqueador de anuncios o filtro de red de por medio, y vuelve a intentarlo.";
      } else if (e.tipo === "vacio") {
        // Todas las fuentes respondieron sin error de permisos ni de red,
        // pero ninguna trajo canciones aprovechables. En vez de un "¿tienes
        // historial?" genérico, enseñamos el detalle por fuente (útil para
        // diagnosticar: por ejemplo, si dice "error 429" en vez de "0", es
        // un límite de peticiones de Spotify y basta con reintentarlo).
        S.error = "No he encontrado canciones tuyas en Spotify que se puedan usar. "
          + "Detalle por fuente: " + (e.detalle || "sin detalle") + ". Si tienes mucho historial y esto no "
          + "cuadra, prueba a esperar un minuto y reintentarlo (puede ser un límite temporal de Spotify).";
      } else {
        S.error = "Spotify: " + e.message;
      }
    }
    S.aportando = false; S.info = null;
  },

  /**
   * Si varias personas comparten el mismo móvil o iPad para aportar sus
   * canciones (una detrás de otra), la sesión de Spotify guardada en ese
   * dispositivo sería siempre la de la primera persona que se conectó. Este
   * botón desconecta esa cuenta y manda a conectar una distinta antes de
   * aportar.
   */
  cambiarCuentaSpotify() {
    Sp.cerrarSesion();
    return irALoginSpotify("aportar");
  },

  /** Abre la lista de canciones de Spotify aportadas por el grupo (título — artista). */
  verCancionesPool() { S.modal = "cancionesPool"; },

  /** Marca una canción como "tontería": desaparece del pool en esta sala, también si jugáis otra partida. */
  async quitarCancionPool(el) {
    const k = el.dataset.clave;
    if (!k) return;
    await Net.escribir(S.codigo, `bloqueadas/${k}`, true);
  },

  // ----- reproducción (solo anfitrión) -----
  pausar() { Sp.pausar(); },

  // ----- lobby -----
  async empezar() {
    const equipos = R.equiposEnOrden(E.equipos);
    if (equipos.length < 2) { S.error = "Hacen falta al menos 2 equipos."; return; }

    // Carta inicial para cada equipo.
    let usadas = { ...(E.usadas || {}) };
    const nuevos = JSON.parse(JSON.stringify(E.equipos));
    for (const eq of equipos) {
      const elegida = await siguienteCancion({ ...E, usadas });
      if (!elegida) break;
      usadas = elegida.usadas;
      nuevos[eq.id].cartas = [{
        titulo: elegida.carta.titulo, artista: elegida.carta.artista, anio: elegida.carta.anio,
      }];
    }
    // Guardamos quién empieza: si ese equipo acaba ganando 10-9, hace falta
    // sacar 2 de ventaja (ver R.comprobarVictoria) para que no gane solo por
    // la pequeña ventaja de haber arrancado la partida.
    const primerEquipoId = equipos[Math.floor(Math.random() * equipos.length)].id;
    await Net.actualizar(S.codigo, { equipos: nuevos, usadas, fase: "jugando", primerEquipo: primerEquipoId });
    await nuevaRonda(primerEquipoId);
  },

  // ----- turno -----
  hueco(el) {
    S.slot = Number(el.dataset.slot);
    // Durante la colocación guardamos la elección al momento: si se acaba el
    // tiempo, vale el último hueco tocado aunque no hayan pulsado Finalizar.
    // Solo quien creó el equipo puede tocar esto (el resto solo mira).
    if (E?.ronda?.subfase === "colocando" && E.ronda.equipoActivo === S.equipoId && soyLiderDeMiEquipo()) {
      Net.escribir(S.codigo, "ronda/colocacion", S.slot);
    }
  },

  finalizar() {
    if (S.slot == null || !soyLiderDeMiEquipo()) return;
    Net.actualizar(S.codigo, { "ronda/colocacion": S.slot, "ronda/confirmada": true });
    S.slot = null;
  },

  saltar() {
    if (!soyLiderDeMiEquipo()) return;
    const eq = miEquipo();
    if ((eq?.fichas || 0) < AJUSTES.fichasParaSaltar) return;
    Net.actualizar(S.codigo, {
      [`equipos/${S.equipoId}/fichas`]: eq.fichas - AJUSTES.fichasParaSaltar,
      "ronda/saltar": true,
    });
    S.slot = null;
  },

  /** Saltar la canción actual sin gastar fichas (canción rota o equivocada). */
  saltarGratis() {
    if (!puedeSaltarGratis()) { S.modal = null; return; }
    Net.escribir(S.codigo, "ronda/saltar", true);
    S.slot = null; S.modal = null;
  },

  async robar() {
    if (S.slot == null || !soyLiderDeMiEquipo()) return;
    const slot = S.slot; S.slot = null;
    await Net.transaccion(S.codigo, "ronda/robos", (actual) => {
      const a = actual || {};
      if (a[S.equipoId] !== undefined) return;                       // ya había elegido
      if (Object.values(a).includes(slot)) return;                   // hueco pillado
      if (E.ronda.colocacion === slot) return;                       // el del equipo activo
      return { ...a, [S.equipoId]: slot };
    });
  },

  pasarRobo() {
    if (!soyLiderDeMiEquipo()) return;
    Net.escribir(S.codigo, `ronda/robos/${S.equipoId}`, "pasa");
  },

  // ----- pregunta extra -----
  bonus(el) {
    if (!soyLiderDeMiEquipo()) return;
    const acertaron = el.dataset.valor === "si";
    const eq = miEquipo();
    const cambios = { "ronda/esperandoBonus": false, "ronda/bonus": acertaron };
    if (acertaron) cambios[`equipos/${S.equipoId}/fichas`] = R.sumarFicha(eq);
    Net.actualizar(S.codigo, cambios);
  },

  siguiente() {
    const puedeSeguir = (E?.ronda?.equipoActivo === S.equipoId && soyLiderDeMiEquipo()) || soyHost();
    if (!puedeSeguir) return;
    Net.escribir(S.codigo, "ronda/siguientePedida", true);
  },

  // ----- botón de ayuda (esquina) -----
  abrirAyuda() { S.modal = "ayuda"; },

  /** Reintentar que suene la canción actual (p. ej. tras abrir Spotify en el altavoz). */
  async reintentarSonar() {
    if (!soyHost()) return;
    const uri = uriRondaActual();
    S.modal = null;
    if (!uri) { S.error = "No encuentro la canción de esta ronda para reintentarla."; return; }
    await sonar(uri);
  },

  // ----- corregir un año equivocado (Spotify a veces se equivoca con remasters) -----
  corregirAnio() {
    if (!puedeCorregirAnio()) return;
    S.modal = "corregirAnio";
  },

  /**
   * Corrige el año Y recalcula quién debería quedarse la carta con ese año
   * correcto: si el equipo activo la tenía bien colocada, se rectifica y se
   * la lleva él; si alguno de los que intentaron robar tenía razón, pasa a
   * ser suya; si ya no la merece nadie, se la quitamos a quien la tuviera.
   * No toca las fichas gastadas en intentar robar (eso no depende del año),
   * pero si ya se había dado la ficha extra del bonus y ahora resulta que
   * no acertaron el año, se la quitamos.
   */
  async guardarAnio() {
    if (!puedeCorregirAnio()) { S.modal = null; return; }
    const val = parseInt(document.getElementById("in-anio-correcto")?.value, 10);
    const max = new Date().getFullYear();
    if (!val || val < 1900 || val > max) { S.error = `Pon un año entre 1900 y ${max}.`; return; }

    const r = E?.ronda;
    const carta = r?.carta;
    if (!r || !carta || !r.resultado) { S.modal = null; return; }

    const activoId = r.equipoActivo;
    const viejoGanador = r.resultado.ganadorCarta;
    const eqs = JSON.parse(JSON.stringify(E.equipos));

    // 1. Quitamos la carta (con el año viejo) de donde esté ahora mismo.
    if (viejoGanador && eqs[viejoGanador]) {
      eqs[viejoGanador].cartas = (eqs[viejoGanador].cartas || []).filter((c) =>
        !(c.titulo === carta.titulo && c.artista === carta.artista && c.anio === carta.anio));
    }

    // 2. Recalculamos con el año correcto, usando la misma colocación y los
    //    mismos intentos de robo de antes (eso no cambia, solo el año).
    const timelineActivo = R.ordenar(eqs[activoId]?.cartas || []);
    const aciertoActivo = R.slotValido(timelineActivo, val, r.colocacion);
    const intentos = [];
    for (const [eqId, slot] of Object.entries(r.robos || {})) {
      if (typeof slot !== "number") continue;
      intentos.push({ equipo: eqId, slot, correcto: R.slotValido(timelineActivo, val, slot) });
    }
    let ganadorNuevo = null;
    if (aciertoActivo) {
      ganadorNuevo = activoId;
    } else {
      for (const eqId of R.ordenDeRobo(eqs, activoId)) {
        if (intentos.find((i) => i.equipo === eqId && i.correcto)) { ganadorNuevo = eqId; break; }
      }
    }

    // 3. Se la damos a quien corresponda con el año correcto.
    const cartaCorregida = { titulo: carta.titulo, artista: carta.artista, anio: val };
    const eqsFinal = R.entregarCarta(eqs, ganadorNuevo, cartaCorregida);

    // 4. Si ya habían cobrado la ficha del bonus pero ahora no acertaron el año, se revoca.
    if (r.bonus === true && !aciertoActivo && eqsFinal[activoId]) {
      eqsFinal[activoId].fichas = Math.max(0, (eqsFinal[activoId].fichas || 0) - 1);
    }

    const bonusYaContestado = r.bonus !== undefined && r.bonus !== null;

    await Net.actualizar(S.codigo, {
      equipos: eqsFinal,
      "ronda/carta/anio": val,
      "ronda/resultado/aciertoActivo": aciertoActivo,
      "ronda/resultado/ganadorCarta": ganadorNuevo,
      "ronda/resultado/intentos": intentos,
      "ronda/resultado/slotsValidos": R.slotsValidos(timelineActivo, val),
      "ronda/esperandoBonus": aciertoActivo && !bonusYaContestado,
    });
    S.modal = null;
  },

  // ----- ver equipos (el tuyo incluido, útil mientras juega otro) -----
  verOtros() {
    const todos = R.equiposEnOrden(E.equipos);
    S.modal = "otros";
    // Por defecto se muestra el equipo al que le toca jugar (lo más útil
    // mientras esperas), pero se puede cambiar a cualquier otro, incluido
    // el tuyo propio, con las pestañas de arriba del modal.
    const activo = equipoActivo();
    S.modalEquipo = activo ? activo.id : (todos[0]?.id ?? null);
  },
  verEquipo(el) { S.modalEquipo = el.dataset.id; },

  async otraPartida() {
    if (!soyHost()) return;
    const nuevos = JSON.parse(JSON.stringify(E.equipos));
    for (const id of Object.keys(nuevos)) { nuevos[id].cartas = []; nuevos[id].fichas = AJUSTES.fichasIniciales; }
    await Net.actualizar(S.codigo, {
      equipos: nuevos, usadas: {}, fase: "lobby", ganador: null, ronda: null, primerEquipo: null,
    });
  },
};

app.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-accion]");
  if (!el || S.ocupado) return;
  const fn = acciones[el.dataset.accion];
  if (!fn) return;
  S.ocupado = true; S.error = null;
  try { await fn(el); } catch (e) { console.error(e); S.error = e.message; }
  S.ocupado = false;
  render();
});

// ============================================================
//  RENDER
// ============================================================
function render() {
  let html = "";
  if (S.vista === "sala" && E) html = vistaSala();
  else if (S.vista === "crear") html = vistaCrear();
  else if (S.vista === "unirse") html = vistaUnirse();
  else if (S.vista === "unirseEquipo") html = vistaUnirseEquipo();
  else html = vistaInicio();

  app.innerHTML = (S.error ? aviso("error", esc(S.error)) : "")
                + (S.info ? aviso("info", `<span class="gira">♪</span> ${esc(S.info)}`) : "")
                + html + modal();
}

const cabecera = (sub = "el juego de adivinar el año") => `
  <div class="logo">
    <div class="sub">${esc(sub)}</div>
    <h1>HITSTER <span style="color:var(--acento)">FAMILIA</span></h1>
  </div>`;

function vistaInicio() {
  return cabecera() + `
    <div class="tarjeta">
      <button class="grande" data-accion="irCrear">Crear partida nueva</button>
      <div style="height:10px"></div>
      <button class="grande sec" data-accion="irUnirse">Unirme con un código</button>
    </div>
    <div class="centro">
      <button class="sec" data-accion="verReglas">¿Cómo se juega?</button>
    </div>`;
}

function vistaCrear() {
  const spotify = S.spotifyOk
    ? `<div class="aviso ok">Spotify conectado.
         <button class="sec" style="padding:8px 16px;min-height:auto;font-size:13px;margin-left:8px"
                 data-accion="desconectarSpotify">Cambiar cuenta</button></div>`
    : `<div class="aviso info">Necesitas conectar una cuenta de <b>Spotify Premium</b> para que suene la música.
         Solo hace falta en este dispositivo, el que hace de anfitrión.</div>
       <button class="grande" data-accion="conectarSpotify">Conectar Spotify</button>
       <p class="mini centro" style="margin-top:10px">
         <button class="sec" style="padding:8px 14px;min-height:auto;font-size:13px" data-accion="abrirAnadirSpotifyApp">
           ¿Nunca has jugado con tus canciones?
         </button>
       </p>
       <div style="height:14px"></div>`;

  return cabecera("crear partida") + `
    <div class="tarjeta">
      ${spotify}
      <label for="in-nombre">Nombre de tu equipo</label>
      <input id="in-nombre" maxlength="18" placeholder="Los Campeones" />
      <label for="in-mazo">Mazo de canciones</label>
      <select id="in-mazo">
        <option value="famosas">Canciones famosas (recomendado)</option>
        <option value="es">Solo en español y latino</option>
        <option value="en">Solo en inglés</option>
        <option value="spotify">Canciones de Spotify de los jugadores</option>
        <option value="todo">Todo — Spotify de los jugadores + famosas</option>
        <option value="mixto">Mix variado — Spotify + famosas, mitad inglés mitad español</option>
      </select>
      <p class="mini" style="margin-top:10px">En «Spotify de los jugadores», «Todo» y «Mix variado», cualquiera
        que se una puede conectar su Spotify y aportar sus canciones favoritas (lo verás en la sala de espera).
        Cada persona que aporta tiene las mismas probabilidades de que le toque una canción suya, tenga muchas o
        pocas guardadas. En «Mix variado» además se reparte lo curado a partes iguales entre español e inglés,
        sin que se note un patrón fijo. Algunos años pueden fallar por remasterizaciones: si veis uno mal,
        podréis corregirlo en el momento.</p>
      <div style="height:16px"></div>
      <button class="grande" data-accion="crearPartida" ${S.spotifyOk ? "" : "disabled"}>Crear partida</button>
      <div style="height:10px"></div>
      <button class="grande sec" data-accion="volverInicio">Volver</button>
    </div>`;
}

function vistaUnirse() {
  return cabecera("unirse a una partida") + `
    <div class="tarjeta">
      <label for="in-codigo">Código de la partida</label>
      <input id="in-codigo" inputmode="numeric" maxlength="4" placeholder="1234"
             style="text-align:center;font-size:34px;letter-spacing:.3em;font-weight:800" />
      <div style="height:16px"></div>
      <button class="grande" data-accion="buscarSala">Continuar</button>
      <div style="height:10px"></div>
      <button class="grande sec" data-accion="volverInicio">Volver</button>
    </div>
    <p class="mini centro">No necesitas Spotify para jugar: la música la pone el anfitrión.</p>`;
}

function vistaUnirseEquipo() {
  const equipos = R.equiposEnOrden(S.previa?.equipos || {});
  const lleno = equipos.length >= AJUSTES.maxEquipos;
  return cabecera("¿con quién jugáis?") + `
    <div class="tarjeta">
      <h3>Equipos ya en la partida ${esc(S.codigo)}</h3>
      ${equipos.length ? equipos.map((e) => `
        <div class="equipo-fila">
          <span class="punto" style="background:${esc(e.color.hex)}"></span>
          <span class="nombre">${esc(e.nombre)}</span>
          <button class="sec" style="padding:9px 18px;min-height:auto" data-accion="unirmeEquipo" data-id="${esc(e.id)}">
            Unirme aquí
          </button>
        </div>`).join("") : '<p class="mini">Todavía no hay ningún equipo.</p>'}
    </div>
    ${lleno ? "" : `
      <div class="tarjeta">
        <h3>O crear un equipo nuevo</h3>
        <label for="in-nombre-equipo">Nombre de vuestro equipo</label>
        <input id="in-nombre-equipo" maxlength="18" placeholder="Los Primos" />
        <div style="height:12px"></div>
        <button class="grande" data-accion="crearEquipoNuevo">Crear este equipo</button>
      </div>`}
    <p class="mini centro">Elige "Unirme aquí" si otro familiar ya creó vuestro equipo desde su propio
      móvil o iPad: jugaréis juntos, como un solo equipo, cada uno desde su dispositivo. Eso sí, solo
      quien creó el equipo puede jugar los turnos; el resto podéis aportar vuestras canciones de Spotify.</p>
    <button class="grande sec" data-accion="volverInicio">Volver</button>`;
}

// ---------- sala ----------
function vistaSala() {
  if (E.fase === "lobby") return vistaLobby();
  if (E.fase === "fin") return vistaFin();
  return vistaJuego();
}

function vistaLobby() {
  const equipos = R.equiposEnOrden(E.equipos);
  const host = soyHost();
  const { gente, comunes } = resumenAportes(E);
  return `
    <div class="tarjeta centro">
      <h3>Código de la partida</h3>
      <div class="codigo-grande">${esc(S.codigo)}</div>
      <p class="mini">Los demás equipos entran desde esta misma web con este código.</p>
    </div>

    <div class="tarjeta">
      <h3>Equipos (${equipos.length}/${AJUSTES.maxEquipos})</h3>
      ${equipos.map((e) => {
        const conectados = Object.values(e.miembros || {}).filter(Boolean).length;
        const soyDeEste = e.id === S.equipoId;
        const etiqueta = soyDeEste ? ` <span class='mini'>(tú${soyLiderEquipo(e) ? ", líder" : ""})</span>` : "";
        return `
        <div class="equipo-fila">
          <span class="punto" style="background:${esc(e.color.hex)}"></span>
          <span class="nombre">${esc(e.nombre)}${etiqueta}</span>
          ${conectados > 1 ? `<span class="pastilla">${conectados} dispositivos</span>` : ""}
        </div>`;
      }).join("")}
      ${equipos.length < 2 ? '<p class="mini" style="margin-top:12px">Esperando a que entre algún equipo más…</p>' : ""}
      ${miEquipo() && !soyLiderDeMiEquipo() ? `
        <p class="mini" style="margin-top:12px">Solo quien creó vuestro equipo puede jugar los turnos.
          Vosotros podéis aportar canciones de Spotify y animar 🙂</p>` : ""}
    </div>

    ${["spotify", "todo", "mixto"].includes(E.config?.mazo) ? `
      <div class="tarjeta">
        <h3>Nuestras canciones</h3>
        <p class="mini">${gente
          ? `${gente} persona${gente === 1 ? "" : "s"} ${gente === 1 ? "ha" : "han"} aportado sus canciones`
            + (comunes ? ` · ${comunes} en común` : "")
          : "Nadie ha aportado canciones todavía."}</p>
        <button class="grande sec" data-accion="aportarSpotify" ${S.aportando ? "disabled" : ""}>
          ${Sp.haySesion() && !Sp.faltanPermisos() ? "Añadir mis canciones de Spotify" : "Conectar mi Spotify y aportar mis canciones"}
        </button>
        ${Sp.haySesion() && !Sp.faltanPermisos() ? `
          <p class="mini centro" style="margin-top:10px">¿Sois varios usando el mismo móvil?
            <button class="sec" style="padding:8px 14px;min-height:auto;font-size:13px;margin-left:4px"
                    data-accion="cambiarCuentaSpotify" ${S.aportando ? "disabled" : ""}>
              Conectar otra cuenta de Spotify
            </button>
          </p>` : `
          <p class="mini centro" style="margin-top:10px">
            <button class="sec" style="padding:8px 14px;min-height:auto;font-size:13px" data-accion="abrirAnadirSpotifyApp">
              ¿Nunca has jugado con tus canciones?
            </button>
          </p>`}
        ${gente ? `
          <div style="height:10px"></div>
          <button class="grande sec" data-accion="verCancionesPool">Ver / quitar canciones aportadas</button>` : ""}
      </div>` : ""}

    ${host ? `
      <div class="aviso info">Antes de empezar, abre Spotify en el móvil o altavoz donde queréis que
        suene la música y dale a reproducir algo un segundo (así queda como dispositivo activo).</div>
      <button class="grande" data-accion="empezar" ${equipos.length >= 2 ? "" : "disabled"}>
        Empezar la partida
      </button>
      <div style="height:10px"></div>` : `
      <div class="aviso info">Esperando a que el anfitrión empiece la partida…</div>`}

    <button class="grande sec" data-accion="salir">Salir</button>`;
}

/**
 * Barra superior con el estado de la sala. `limiteCrono` (opcional) pinta el
 * cronómetro como una pastilla más, pequeña, en vez del número gigante que
 * había antes en medio de la pantalla — lo importante durante la partida es
 * la línea del tiempo, el tiempo solo hace falta verlo de reojo en una
 * esquina (ver `tic()`, que sigue buscando el mismo id="crono" para
 * refrescarlo cada segundo, esté donde esté).
 */
/** Marcador compacto: cuántas cartas lleva cada equipo, visible durante toda la ronda. */
function marcador() {
  const equipos = R.equiposEnOrden(E?.equipos || {});
  if (equipos.length < 2) return "";
  return `<div class="marcador">
      ${equipos.map((e) => `<span class="pastilla marcador-equipo${e.id === S.equipoId ? " mio" : ""}"
            style="border-color:${esc(e.color.hex)}">
          <span class="punto" style="background:${esc(e.color.hex)}"></span>
          ${esc(e.nombre)} <b>${(e.cartas || []).length}</b></span>`).join("")}
    </div>`;
}

function barraSuperior() {
  const mio = miEquipo();
  const activo = equipoActivo();
  return `
    <div class="barra">
      <span class="pastilla">Sala ${esc(S.codigo)}</span>
      ${activo ? `<span class="pastilla">
          <span class="punto" style="background:${esc(activo.color.hex)}"></span>
          Turno: ${esc(activo.nombre)}</span>` : ""}
      ${mio ? `<span class="pastilla">${htmlFichas(mio.fichas || 0)}</span>` : ""}
      <span class="sep"></span>
      <button class="sec" style="padding:9px 18px;min-height:auto;font-size:14px" data-accion="verOtros">Ver equipos</button>
      <button class="sec" style="padding:9px 18px;min-height:auto;font-size:14px" data-accion="salir">Salir</button>
    </div>
    ${marcador()}`;
}

function controlesMusica() {
  if (!soyHost()) return "";
  return `
    <div class="fila" style="margin-top:12px">
      <button class="sec" data-accion="pausar">Pausar</button>
    </div>`;
}

/**
 * ¿Estamos en "gana por dos"? Pasa cuando el equipo que empezó la partida ha
 * llegado (o está empatado) a las cartas necesarias para ganar pero con
 * menos de 2 de ventaja sobre el segundo — ver R.comprobarVictoria. Salvo
 * que la carta decisiva se la haya robado a OTRO equipo en el turno de ese
 * equipo (ese equipo ya tuvo su propio turno y falló, así que no hace falta
 * pedir 2 de ventaja): en ese caso no se muestra el aviso, porque la
 * partida va a terminar ya en cuanto se pase de ronda.
 */
function enModoDesempate() {
  if (!E?.primerEquipo || !E.equipos?.[E.primerEquipo]) return false;
  const primeroN = (E.equipos[E.primerEquipo].cartas || []).length;
  if (primeroN < AJUSTES.cartasParaGanar) return false;
  const otros = Object.entries(E.equipos)
    .filter(([id]) => id !== E.primerEquipo)
    .map(([, e]) => (e.cartas || []).length);
  const segundoMax = otros.length ? Math.max(...otros) : 0;
  if (!(primeroN >= segundoMax && primeroN - segundoMax < 2)) return false;
  const r = E.ronda;
  if (r?.resultado?.ganadorCarta === E.primerEquipo && r.equipoActivo !== E.primerEquipo) return false;
  return true;
}

function vistaJuego() {
  const r = E.ronda;
  if (!r) return `<div class="tarjeta centro"><span class="gira">♪</span> Preparando la ronda…</div>`;
  const activo = equipoActivo();
  const soyActivo = r.equipoActivo === S.equipoId;
  const timeline = R.ordenar(activo.cartas || []);
  const desempate = enModoDesempate()
    ? aviso("info", `¡Gana por dos! <b>${esc(E.equipos[E.primerEquipo]?.nombre || "")}</b> llegó a `
      + `${AJUSTES.cartasParaGanar} pero, por haber empezado la partida, necesita sacar 2 cartas de `
      + `ventaja sobre el segundo para ganar.`)
    : "";

  if (r.subfase === "colocando") return barraSuperior() + desempate + faseColocando(r, activo, soyActivo, timeline) + botonAyuda();
  if (r.subfase === "saltando")  return barraSuperior() + desempate + faseSaltando(r, activo, timeline);
  if (r.subfase === "robando")   return barraSuperior() + desempate + faseRobando(r, activo, soyActivo, timeline) + botonAyuda();
  return barraSuperior() + desempate + faseRevelado(r, activo, soyActivo, timeline) + botonAyuda();
}

/** Se ha decidido saltar: enseñamos la carta boca arriba un momento antes de cambiarla. */
function faseSaltando(r, activo, timeline) {
  const carta = r.carta || {};
  return `
    <div class="tarjeta">
      <h3>Línea del tiempo de ${esc(activo.nombre)}</h3>
      ${htmlLinea(timeline)}
    </div>
    <div class="tarjeta centro">
      <h2>Esta era la canción</h2>
      <div style="max-width:210px;margin:0 auto">${htmlCarta(carta)}</div>
      <p class="mini" style="margin-top:10px">Cambiando de canción…</p>
    </div>`;
}

/** Botón flotante en la esquina: corregir el año o saltar una canción con problemas. */
function botonAyuda() {
  return `<button class="ayuda-flotante" data-accion="abrirAyuda" aria-label="Ayuda">?</button>`;
}

function faseColocando(r, activo, soyActivo, timeline) {
  const mio = miEquipo();
  // El dorso ya no es protagonista: un icono pequeño de acompañamiento basta,
  // lo importante ahora es la línea del tiempo (ver htmlLinea más abajo, con
  // cartas más grandes) y el cronómetro vive en la barra superior.
  const dorsoMini = `<div class="carta-mini">${htmlDorso()}</div>`;

  if (!soyActivo) {
    return `
      <div class="tarjeta">
        <h3>Línea del tiempo de ${esc(activo.nombre)}</h3>
        ${htmlLinea(timeline)}
      </div>
      <div class="tarjeta centro fila-estado">
        ${dorsoMini}
        <div class="estado-texto">
          <h2>Suena la canción…</h2>
          <p><b>${esc(activo.nombre)}</b> está decidiendo en qué año colocarla.</p>
          ${controlesMusica()}
        </div>
      </div>`;
  }

  const soyLider = soyLiderDeMiEquipo();
  const elegibles = soyLider ? new Set(Array.from({ length: timeline.length + 1 }, (_, i) => i)) : new Set();
  const puedeSaltar = soyLider && (mio.fichas || 0) >= AJUSTES.fichasParaSaltar;
  return `
    <div class="tarjeta">
      <h3>Vuestra línea del tiempo</h3>
      ${htmlLinea(timeline, { elegibles, elegido: S.slot })}
      ${soyLider ? `
        <div class="fila" style="margin-top:8px">
          <button data-accion="finalizar" ${S.slot == null ? "disabled" : ""}>Finalizar</button>
          <button class="sec" data-accion="saltar" ${puedeSaltar ? "" : "disabled"}>
            Saltar canción (${AJUSTES.fichasParaSaltar} fichas)
          </button>
        </div>
        ${S.slot == null ? '<p class="mini" style="margin-top:10px">Toca uno de los huecos con «+».</p>' : ""}`
      : '<p class="mini" style="margin-top:10px">Solo quien creó el equipo puede colocar la carta. Los demás podéis animar y opinar 🙂</p>'}
    </div>
    <div class="tarjeta centro fila-estado">
      ${dorsoMini}
      <div class="estado-texto">
        <h2>¡Os toca!</h2>
        <p>Escuchad la canción y elegid el hueco donde creéis que va según su año.</p>
        ${controlesMusica()}
      </div>
    </div>`;
}

function faseRobando(r, activo, soyActivo, timeline) {
  const mio = miEquipo();
  const soyLider = soyLiderDeMiEquipo();
  const robos = r.robos || {};
  const meToca = r.turnoRobo === S.equipoId;
  const yaElegi = robos[S.equipoId] !== undefined;
  const puedoDecidir = meToca && !yaElegi && soyLider;

  const marcas = {};
  if (r.colocacion != null) {
    marcas[r.colocacion] = { texto: "★", sub: activo.nombre, clase: "elegido" };
  }
  for (const [eqId, slot] of Object.entries(robos)) {
    if (typeof slot !== "number") continue;
    marcas[slot] = { texto: "●", sub: E.equipos[eqId]?.nombre || "", clase: "elegido" };
  }

  const ocupados = R.slotsOcupados(r);
  const elegibles = puedoDecidir && (mio.fichas || 0) >= 1
    ? new Set(Array.from({ length: timeline.length + 1 }, (_, i) => i).filter((i) => !ocupados.has(i)))
    : null;

  const enTurno = E.equipos[r.turnoRobo];

  let panel;
  if (soyActivo) {
    panel = `<h2>Ya está colocada</h2>
             <p>Ahora los demás equipos pueden intentar robaros la carta si creen que os habéis equivocado.</p>
             ${enTurno ? `<p>Le toca decidir a <b>${esc(enTurno.nombre)}</b>.</p>` : ""}`;
  } else if (meToca && !yaElegi && !soyLider) {
    panel = `<h2>¡Os toca decidir!</h2>
             <p>Le toca a vuestro equipo, pero solo quien creó el equipo puede decidir si robar o pasar.</p>`;
  } else if (meToca && !yaElegi) {
    panel = `<h2>¿Se han equivocado?</h2>
             <p>Si creéis que la canción va en otro hueco, poned una ficha ahí. Si acertáis, la carta es vuestra.</p>
             <p class="mini">Si os equivocáis perdéis la ficha (tenéis ${mio.fichas || 0}); si acertáis, no la
               perdéis, aunque el otro equipo se quede la carta por haber acertado también.</p>`;
  } else if (yaElegi) {
    panel = `<h2>Decisión tomada</h2><p>Esperando a los demás equipos…</p>`;
  } else {
    panel = `<h2>Turno de robo</h2><p>Le toca decidir a <b>${esc(enTurno?.nombre || "…")}</b>.</p>`;
  }

  const botones = puedoDecidir ? `
    <div class="fila" style="margin-top:8px">
      <button data-accion="robar" ${S.slot == null || (mio.fichas || 0) < 1 ? "disabled" : ""}>
        Robar en este hueco
      </button>
      <button class="sec" data-accion="pasarRobo">Pasar</button>
    </div>
    ${(mio.fichas || 0) < 1 ? '<p class="mini">No os quedan fichas para robar.</p>' : ""}` : "";

  return `
    <div class="tarjeta">
      <h3>Línea del tiempo de ${esc(activo.nombre)}</h3>
      ${htmlLinea(timeline, { elegibles, elegido: S.slot, marcas })}
      ${botones}
    </div>
    <div class="tarjeta centro fila-estado">
      <div class="carta-mini">${htmlDorso()}</div>
      <div class="estado-texto">
        ${panel}
        ${controlesMusica()}
      </div>
    </div>`;
}

function faseRevelado(r, activo, soyActivo, timeline) {
  const res = r.resultado || {};
  const carta = r.carta || {};
  const validos = new Set(res.slotsValidos || []);
  const ganador = res.ganadorCarta ? E.equipos[res.ganadorCarta] : null;

  // Si el equipo activo ha acertado, su carta recién ganada ya forma parte de
  // ESTA MISMA línea del tiempo (se insertó de verdad al resolver la ronda),
  // así que los huecos "✓ aquí iba"/"✗" —calculados sobre la línea de ANTES
  // de insertarla— quedarían descolocados (el marcador aparecía pegado a un
  // lado de la carta, en vez de sobre ella). En ese caso resaltamos
  // directamente la carta ganada con un borde verde discontinuo y no
  // pintamos huecos. Si ha fallado, la carta NO se añade a esta línea (se la
  // lleva otro equipo o se descarta), así que los huecos siguen alineados
  // con la línea tal cual se ve aquí, y los dejamos como estaban.
  const marcas = {};
  let cartaDestacada = null;
  if (res.aciertoActivo) {
    cartaDestacada = (c) => c.titulo === carta.titulo && c.artista === carta.artista && c.anio === carta.anio;
  } else {
    for (const i of validos) marcas[i] = { texto: "✓", sub: "aquí iba", clase: "correcto" };
    if (r.colocacion != null && !validos.has(r.colocacion)) {
      marcas[r.colocacion] = { texto: "✗", sub: activo.nombre, clase: "fallo" };
    }
    for (const it of res.intentos || []) {
      if (!it.correcto) marcas[it.slot] = { texto: "✗", sub: E.equipos[it.equipo]?.nombre || "", clase: "fallo" };
    }
  }

  let titular, clase;
  if (res.aciertoActivo) { titular = `¡${esc(activo.nombre)} ha acertado!`; clase = "ok"; }
  else if (ganador)      { titular = `${esc(activo.nombre)} falló — <b>${esc(ganador.nombre)}</b> roba la carta`; clase = "info"; }
  else                   { titular = `${esc(activo.nombre)} falló y nadie ha robado la carta`; clase = "malo"; }

  const soyLiderActivo = soyActivo && soyLiderDeMiEquipo();
  const bonus = r.esperandoBonus && soyLiderActivo ? `
    <div class="tarjeta centro">
      <h2>¿Habéis acertado también el artista y el nombre de la canción?</h2>
      <p class="mini">Sed honestos. Si sí, ganáis una ficha (máximo ${AJUSTES.fichasMaximas}).</p>
      <div class="fila">
        <button data-accion="bonus" data-valor="si">Sí</button>
        <button class="sec" data-accion="bonus" data-valor="no">No</button>
      </div>
    </div>` : "";

  const esperandoOtros = r.esperandoBonus && !soyLiderActivo
    ? aviso("info", soyActivo
        ? "Esperando a que quien creó vuestro equipo responda la pregunta del artista y el título…"
        : `${esc(activo.nombre)} está respondiendo a la pregunta del artista y el título…`) : "";

  const puedeSeguir = soyLiderActivo || soyHost();
  const siguiente = !r.esperandoBonus ? `
    ${r.bonus === true ? aviso("ok", `${esc(activo.nombre)} también acertó artista y título: +1 ficha.`) : ""}
    ${puedeSeguir
      ? `<button class="grande" data-accion="siguiente" ${r.siguientePedida ? "disabled" : ""}>
           ${r.siguientePedida ? "Preparando…" : "Siguiente ronda"}</button>`
      : aviso("info", "Esperando a que continúen…")}` : "";

  return `
    <div class="tarjeta">
      <h3>Línea del tiempo de ${esc(activo.nombre)}</h3>
      ${htmlLinea(timeline, { marcas, cartaDestacada })}
    </div>
    <div class="tarjeta centro fila-estado">
      <div class="carta-mini">${htmlCarta(carta)}</div>
      <div class="estado-texto">
        ${aviso(clase, titular)}
      </div>
    </div>
    ${bonus}${esperandoOtros}${siguiente}`;
}

function vistaFin() {
  const equipos = R.equiposEnOrden(E.equipos).sort((a, b) => (b.cartas || []).length - (a.cartas || []).length);
  const g = E.ganador ? E.equipos[E.ganador] : null;
  return cabecera("fin de la partida") + `
    <div class="tarjeta centro">
      ${g ? `<h2 style="color:${esc(g.color.hex)}">¡Ganan ${esc(g.nombre)}!</h2>
             <p>${(g.cartas || []).length} cartas colocadas en su sitio.</p>`
          : `<h2>Partida terminada</h2><p>Se han acabado las canciones del mazo.</p>`}
    </div>
    ${equipos.map((e) => `
      <div class="tarjeta">
        ${htmlEquipoFila(e)}
        ${htmlLinea(R.ordenar(e.cartas || []))}
      </div>`).join("")}
    ${soyHost() ? '<button class="grande" data-accion="otraPartida">Jugar otra vez</button><div style="height:10px"></div>' : ""}
    <button class="grande sec" data-accion="salir">Salir</button>`;
}

// ---------- modales ----------
function modal() {
  if (!S.modal) return "";
  let cuerpo = "";

  if (S.modal === "reglas") {
    cuerpo = `
      <h2>Cómo se juega</h2>
      <p>Cada equipo construye su propia línea del tiempo con canciones ordenadas por año.
         Gana el primero que consigue <b>${AJUSTES.cartasParaGanar} cartas</b> bien colocadas.</p>
      <p><b>En tu turno</b> suena una canción y ves una carta boca abajo. Tenéis
         ${AJUSTES.segundosTurno / 60} minutos para elegir el hueco donde creéis que encaja por año, y pulsáis
         <b>Finalizar</b>.</p>
      <p><b>Robo:</b> después, los demás equipos, por orden de juego, pueden poner una ficha en otro
         hueco. Si vosotros fallasteis y alguno de ellos acierta, se lleva la carta. Solo se pierde la
         ficha si el hueco elegido estaba mal: si erais los dos correctos (por ejemplo, dos canciones del
         mismo año, donde vale tanto antes como después), la carta es vuestra por prioridad, pero al que
         robó no le cuesta la ficha, porque también tenía razón.</p>
      <p><b>Fichas:</b> empezáis con ${AJUSTES.fichasIniciales} (máximo ${AJUSTES.fichasMaximas}).
         Si acertáis el año y además el artista y el título, ganáis una.
         Podéis gastar ${AJUSTES.fichasParaSaltar} para saltar una canción que no conocéis.</p>
      <p><b>Gana por dos:</b> si el equipo que empezó la partida es quien llega primero a
         ${AJUSTES.cartasParaGanar} cartas pero el segundo se queda a solo una (10-9), no se corta ahí:
         se sigue jugando hasta que alguien saque 2 cartas de ventaja. Si es cualquier otro equipo el que
         llega primero, gana en el momento, como siempre. Tiene un tope, eso sí: para que no se alargue de
         más, gana igualmente al llegar a ${AJUSTES.cartasParaGanar + 3}.</p>
      <p><b>Equipos con varios dispositivos:</b> todo el que se une a un equipo puede aportar sus canciones
         de Spotify, pero solo quien lo creó juega los turnos.</p>
      <p><b>El botón "?"</b> de la esquina sirve para corregir un año equivocado de Spotify, cambiar
         una canción rota/errónea sin gastar fichas, reintentar que suene la música si no ha sonado
         (por ejemplo, porque Spotify no tenía ningún dispositivo activo), o revisar la lista de
         canciones de Spotify que ha aportado el grupo y quitar las que sean una tontería.</p>
      <button class="grande sec" data-accion="cerrarModal">Cerrar</button>`;
  }

  if (S.modal === "anadirSpotifyApp") {
    const nApps = Sp.appsSpotify().length;
    cuerpo = `
      <h2>¿Nunca has jugado con tus canciones de Spotify?</h2>
      <p class="mini">Spotify solo deja que cada "aplicación" tenga hasta 5 personas autorizadas.
        ${nApps ? `Ahora mismo hay ${nApps} aplicaci${nApps === 1 ? "ón" : "ones"} registrada${nApps === 1 ? "" : "s"}, `
          + `así que si ya no os cabéis, ` : "Si "}en un par de minutos puedes crear la tuya propia y dar
        sitio a 5 personas más (tú incluido). Solo hace falta hacerlo una vez.</p>

      <p><b>Paso 1.</b> Entra en
        <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a>
        con tu cuenta de Spotify (si es la primera vez, se crea sola al entrar).</p>

      <p><b>Paso 2.</b> Pulsa <b>Create app</b>. Ponle el nombre que quieras y, en
        <b>Redirect URIs</b>, pega <u>exactamente</u> esta dirección (tócala para seleccionarla entera
        y cópiala):</p>
      <div class="tarjeta" style="word-break:break-all;font-family:ui-monospace,monospace;font-size:14px;margin-bottom:14px">
        ${esc(Sp.redirectUri())}
      </div>
      <p class="mini">Marca <b>Web API</b> y <b>Web Playback SDK</b>, acepta los términos y guarda.</p>

      <p><b>Paso 3.</b> Ya dentro de tu app nueva, ve a <b>Settings → User Management</b> y añade el
        email de Spotify de cada persona que vaya a jugar contigo con esta app (hasta 5; tú no hace
        falta que te añadas, como creador ya tienes acceso).</p>

      <p><b>Paso 4.</b> Vuelve a <b>Settings</b>, copia el <b>Client ID</b> de tu app y pégalo aquí,
        con un nombre para identificarla (por ejemplo, "Familia García"):</p>
      <label for="in-spotify-clientid">Client ID</label>
      <input id="in-spotify-clientid" placeholder="a1b2c3d4e5f6…" autocapitalize="off" autocorrect="off" />
      <label for="in-spotify-nombre">Nombre para identificarla</label>
      <input id="in-spotify-nombre" maxlength="24" placeholder="Familia García" />
      <div style="height:14px"></div>
      <button class="grande" data-accion="guardarAppSpotify">Añadir esta app</button>
      <p class="mini" style="margin-top:10px">En cuanto la añadas, cualquiera de esas personas — o tú
        mismo — ya puede conectar su Spotify con el botón de siempre: el juego prueba solo todas las
        apps registradas hasta encontrar una que le deje entrar, sin preguntar nada.</p>
      <div style="height:6px"></div>
      <button class="grande sec" data-accion="cerrarModal">Cerrar</button>`;
  }

  if (S.modal === "ayuda") {
    const puedeSaltar = puedeSaltarGratis();
    const puedeCorregir = puedeCorregirAnio();
    const r = E?.ronda;
    const puedeReintentar = soyHost() && !!r && ["colocando", "robando"].includes(r.subfase);
    const puedeVerPool = ["spotify", "todo", "mixto"].includes(E?.config?.mazo);
    cuerpo = `
      <h2>¿Algún problema con esta canción?</h2>
      ${puedeReintentar ? `
        <p class="mini">¿No suena la música, o Spotify dice que no encuentra ningún dispositivo activo?
          Abre Spotify en el móvil o el altavoz, dale a reproducir algo un segundo para que quede
          activo y pulsa este botón.</p>
        <button class="grande sec" data-accion="reintentarSonar">Reintentar reproducir</button>
        <div style="height:14px"></div>` : ""}
      ${!soyHost() && !!r && ["colocando", "robando"].includes(r.subfase) ? `
        <p class="mini">¿No suena la música? Pedid al anfitrión que abra Spotify en el altavoz y pulse
          "Reintentar reproducir" desde su propio botón «?».</p>
        <div style="height:14px"></div>` : ""}
      ${puedeSaltar ? `
        <p class="mini">¿Ha sonado una canción rota, repetida o que claramente no es la que tocaba?
          Podéis cambiarla sin gastar fichas.</p>
        <button class="grande sec" data-accion="saltarGratis">Cambiar esta canción (gratis)</button>
        <div style="height:14px"></div>` : ""}
      ${puedeCorregir ? `
        <p class="mini">¿Spotify ha puesto un año equivocado (remasterización, recopilatorio…)?</p>
        <button class="grande sec" data-accion="corregirAnio">Corregir el año</button>
        <div style="height:14px"></div>` : ""}
      ${puedeVerPool ? `
        <p class="mini">¿Alguna canción de Spotify que ha aportado el grupo es una tontería o no pega?</p>
        <button class="grande sec" data-accion="verCancionesPool">Ver canciones de Spotify añadidas</button>
        <div style="height:14px"></div>` : ""}
      ${!puedeSaltar && !puedeCorregir && !puedeReintentar && !puedeVerPool
        ? '<p class="mini">Ahora mismo no hay nada que corregir. Vuelve a mirar aquí si suena una canción rota, no suena nada o el año no cuadra.</p>' : ""}
      <button class="grande sec" data-accion="cerrarModal">Cerrar</button>`;
  }

  if (S.modal === "cancionesPool") {
    const pool = poolComunitario(E || {}).sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
    cuerpo = `
      <h2>Canciones de Spotify añadidas</h2>
      <p class="mini">Todo lo que ha aportado el grupo. Si alguna es una tontería o no pega en la partida,
        quitadla con la ✕: no volverá a salir.</p>
      ${pool.length ? `<div class="lista-pool">${pool.map((c) => `
        <div class="cancion-fila">
          <span class="titulo-cancion">${esc(c.titulo)} — ${esc(c.artista)}</span>
          <button class="quitar" data-accion="quitarCancionPool" data-clave="${esc(clave(c))}"
                  aria-label="Quitar ${esc(c.titulo)}">✕</button>
        </div>`).join("")}</div>`
        : '<p class="mini">Nadie ha aportado canciones todavía.</p>'}
      <button class="grande sec" data-accion="cerrarModal" style="margin-top:14px">Cerrar</button>`;
  }

  if (S.modal === "corregirAnio") {
    const actual = E?.ronda?.carta?.anio || "";
    cuerpo = `
      <h2>Corregir el año</h2>
      <p class="mini">A veces Spotify se equivoca (remasterizaciones, recopilatorios…). Con el año correcto,
        la app recalcula quién acertó: si cambia quién tenía razón, la carta pasará al equipo que
        correspondía.</p>
      <label for="in-anio-correcto">Año correcto</label>
      <input id="in-anio-correcto" inputmode="numeric" type="number" min="1900" max="${new Date().getFullYear()}"
             value="${esc(actual)}" style="text-align:center;font-size:28px;font-weight:800" />
      <div style="height:12px"></div>
      <div class="fila">
        <button data-accion="guardarAnio">Guardar</button>
        <button class="sec" data-accion="cerrarModal">Cancelar</button>
      </div>`;
  }

  if (S.modal === "otros") {
    const todos = R.equiposEnOrden(E.equipos);
    const sel = S.modalEquipo ? E.equipos[S.modalEquipo] : null;
    cuerpo = `
      <h2>Equipos</h2>
      ${todos.length > 1 ? `<div class="fila" style="margin-bottom:12px">
          ${todos.map((e) => `<button class="sec" data-accion="verEquipo" data-id="${esc(e.id)}"
              style="${S.modalEquipo === e.id ? `border-color:${esc(e.color.hex)}` : ""}">${esc(e.nombre)}${e.id === S.equipoId ? " (tú)" : ""}</button>`).join("")}
        </div>` : ""}
      ${sel ? `${htmlEquipoFila(sel)}${htmlLinea(R.ordenar(sel.cartas || []))}`
            : '<p>Elige un equipo para ver sus cartas.</p>'}
      <button class="grande sec" data-accion="cerrarModal">Cerrar</button>`;
  }

  return `<div class="velo"><div class="modal">${cuerpo}</div></div>`;
}

function pintarConfigPendiente() {
  app.innerHTML = cabecera("falta configurar") + `
    <div class="tarjeta">
      ${aviso("error", "La app todavía no está configurada.")}
      <p>Abre el archivo <b>js/config.js</b> y pega ahí la configuración de tu proyecto de
        <b>Firebase</b> (el Client ID de Spotify ya no hace falta tocarlo aquí: se añade con un
        botón dentro del propio juego, la primera vez que alguien intente conectar Spotify).</p>
      <p>Tienes las instrucciones paso a paso en el archivo <b>LEEME.md</b>.</p>
      <h3>Dato que te pedirá Spotify más adelante</h3>
      <p>Cuando crees tu app en el panel de Spotify Developer, en <i>Redirect URIs</i> pega
        exactamente esto:</p>
      <div class="tarjeta" style="word-break:break-all;font-family:ui-monospace,monospace;font-size:14px">
        ${esc(Sp.redirectUri())}
      </div>
    </div>`;
}

init();
