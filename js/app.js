// ============================================================
//  HITSTER FAMILIA — aplicación principal
// ============================================================
import { AJUSTES, COLORES_EQUIPO, SPOTIFY_CLIENT_ID, FIREBASE_CONFIG } from "./config.js";
import { CANCIONES } from "./canciones.js";
import * as R from "./reglas.js";
import * as Net from "./net.js";
import * as Sp from "./spotify.js";
import {
  esc, htmlCarta, htmlDorso, htmlFichas, htmlLinea, htmlEquipoFila, reloj, aviso,
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
  modal: null,          // 'otros' | 'reglas' | 'equipo' | 'dispositivos' | 'corregirAnio'
  modalEquipo: null,
  slot: null,           // hueco seleccionado (aún sin confirmar)
  deviceId: null,
  dispositivos: [],
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

// ============================================================
//  ARRANQUE
// ============================================================
async function init() {
  const sesion = cargarSesion();
  S.clienteId = sesion.clienteId || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

  if (SPOTIFY_CLIENT_ID.includes("PEGA_AQUI") || String(FIREBASE_CONFIG.databaseURL).includes("PEGA_AQUI")) {
    return pintarConfigPendiente();
  }

  try {
    await Net.conectar();
    Net.vigilarReloj();
  } catch (e) {
    S.error = "No se pudo conectar con la base de datos. Revisa la configuración de Firebase.";
    return render();
  }

  try {
    await Sp.procesarVuelta();
  } catch (e) { S.error = e.message; }
  S.spotifyOk = Sp.haySesion();

  S.deviceId = localStorage.getItem("hitster_dispositivo") || null;

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
  }
  guardar();
  render();
  setInterval(tic, 300);
}

function entrarEnSala() {
  S.vista = "sala";
  desuscribir?.();
  desuscribir = Net.escuchar(S.codigo, (estado) => {
    if (!estado) {                       // la sala ha desaparecido
      E = null; S.codigo = null; S.equipoId = null; S.vista = "inicio";
      S.error = "La partida se ha cerrado.";
      guardar(); return render();
    }
    E = estado;
    if (soyHost()) motor();
    render();
  });
  Net.marcarPresencia(S.codigo, S.equipoId, S.clienteId);
}

/** Latido: refresca el cronómetro y deja que el anfitrión avance por tiempo. */
function tic() {
  if (!E) return;
  const nodo = document.getElementById("crono");
  if (nodo) {
    const limite = nodo.dataset.limite ? Number(nodo.dataset.limite) : 0;
    const seg = (limite - Net.ahora()) / 1000;
    nodo.textContent = reloj(seg);
    nodo.classList.toggle("urgente", seg <= 15);
  }
  if (soyHost()) motor();
}

// ============================================================
//  MAZO
// ============================================================
export const clave = (c) => `${c.titulo}|${c.artista}`.toLowerCase().replace(/[.#$/[\]]/g, "");

/** Junta los aportes de Spotify de todos los dispositivos de la sala en un solo pool. */
export function poolComunitario(estado) {
  const aportes = estado.aportes || {};
  const mapa = new Map();
  for (const aporte of Object.values(aportes)) {
    for (const c of aporte.canciones || []) {
      const k = clave(c);
      const actual = mapa.get(k);
      if (actual) { actual.peso += c.peso || 1; actual.personas += 1; }
      else mapa.set(k, { ...c, mazo: "top", peso: c.peso || 1, personas: 1 });
    }
  }
  return [...mapa.values()];
}

/** Resumen para mostrar en el lobby: cuánta gente ha aportado y cuántas coinciden. */
export function resumenAportes(estado) {
  const gente = Object.keys(estado.aportes || {}).length;
  const comunes = poolComunitario(estado).filter((c) => c.personas > 1).length;
  return { gente, comunes };
}

export function baraja(config, estado) {
  let base = CANCIONES.map(([titulo, artista, anio, m]) => ({ titulo, artista, anio, mazo: m }));
  if (config.mazo === "int") base = base.filter((c) => c.mazo === "int");
  if (config.mazo === "es") base = base.filter((c) => c.mazo === "es");
  if (config.mazo === "top") {
    return { propias: poolComunitario(estado), curadas: base };
  }
  return { propias: [], curadas: base };
}

/** Elige un elemento al azar dando más peso a los que tienen `peso`/`personas` más altos. */
export function elegirPonderado(lista) {
  const pesos = lista.map((c) => Math.max(1, c.peso || 1) * (c.personas > 1 ? 4 : 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < lista.length; i++) { r -= pesos[i]; if (r <= 0) return lista[i]; }
  return lista[lista.length - 1];
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
  return fuente === a ? elegirPonderado(fuente) : fuente[Math.floor(Math.random() * fuente.length)];
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

async function motorPaso() {
  const r = E.ronda;
  const t = Net.ahora();

  // --- fase 1: el equipo activo coloca su carta ---
  if (r.subfase === "colocando") {
    if (r.saltar) {
      if (hecho.saltada === r.limite) return;
      hecho.saltada = r.limite;
      return void (await nuevaCancionEnRonda());
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

  // --- fase 2: los demás equipos deciden si roban, por orden de juego ---
  if (r.subfase === "robando") {
    const orden = R.ordenDeRobo(E.equipos, r.equipoActivo);
    const robos = r.robos || {};
    const pendiente = orden.find((id) => robos[id] === undefined);

    if (!pendiente) {
      if (hecho.resuelta === r.n) return;
      hecho.resuelta = r.n;
      return void (await resolver());
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
    if (hecho.lanzada === r.n) return;
    hecho.lanzada = r.n;
    const ganador = R.comprobarVictoria(E.equipos);
    if (ganador) {
      await Sp.pausar(S.deviceId).catch(() => {});
      return void (await Net.actualizar(S.codigo, { fase: "fin", ganador, ronda: null }));
    }
    return void (await nuevaRonda(R.siguienteEquipo(E.equipos, r.equipoActivo)));
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

  await Sp.pausar(S.deviceId).catch(() => {});
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
    },
  });
  sonar(carta.uri);
}

/** Cambia la canción de la ronda actual (al saltar). */
async function nuevaCancionEnRonda() {
  const elegida = await siguienteCancion(E);
  if (!elegida) return;
  const { carta, usadas } = elegida;
  await Net.actualizar(S.codigo, {
    usadas,
    "ronda/secreto": Net.ocultar(carta, S.codigo),
    "ronda/limite": Net.ahora() + AJUSTES.segundosTurno * 1000,
    "ronda/colocacion": null,
    "ronda/saltar": false,
  });
  sonar(carta.uri);
}

async function sonar(uri) {
  try {
    await Sp.reproducir(uri, S.deviceId);
    S.error = null;
  } catch (e) {
    S.error = e.status === 404
      ? "Spotify no encuentra un dispositivo activo. Abre Spotify en el móvil o altavoz y vuelve a elegirlo abajo."
      : "Spotify: " + e.message;
    render();
  }
}

// ============================================================
//  ACCIONES DEL JUGADOR
// ============================================================
const acciones = {
  // ----- pantallas iniciales -----
  irCrear: () => { S.vista = "crear"; S.error = null; },
  irUnirse: () => { S.vista = "unirse"; S.error = null; },
  volverInicio: () => { S.vista = "inicio"; S.previa = null; S.error = null; },
  verReglas: () => { S.modal = "reglas"; },
  cerrarModal: () => { S.modal = null; S.modalEquipo = null; },

  conectarSpotify: () => {
    sessionStorage.setItem("hitster_volver_a", "crear");
    return Sp.iniciarLogin();
  },

  desconectarSpotify: () => { Sp.cerrarSesion(); S.spotifyOk = false; },

  async crearPartida() {
    const nombre = (document.getElementById("in-nombre")?.value || "").trim() || "Equipo 1";
    const mazo = document.getElementById("in-mazo")?.value || "mixto";
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
          id: equipoId, nombre, color: COLORES_EQUIPO[0], orden: 0,
          fichas: AJUSTES.fichasIniciales, cartas: [], miembros: { [S.clienteId]: true },
        },
      },
      usadas: {}, aportes: {}, ronda: null, ganador: null,
    });
    S.codigo = codigo; S.equipoId = equipoId; guardar(); entrarEnSala();
  },

  /** Paso 1 al unirse: solo el código, para ver qué equipos hay ya. */
  async buscarSala() {
    const codigo = (document.getElementById("in-codigo")?.value || "").trim();
    if (!/^\d{4}$/.test(codigo)) { S.error = "El código son 4 dígitos."; return; }

    const estado = await Net.leerSala(codigo);
    if (!estado) { S.error = "No existe ninguna partida con ese código."; return; }
    if (estado.fase !== "lobby") { S.error = "Esa partida ya ha empezado."; return; }

    S.codigo = codigo; S.previa = estado; S.vista = "unirseEquipo";
  },

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
      id: equipoId, nombre, color: COLORES_EQUIPO[orden], orden,
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
  },

  // ----- aportar canciones de Spotify (cualquier dispositivo, en cualquier momento) -----
  async aportarSpotify() {
    if (!Sp.haySesion()) {
      sessionStorage.setItem("hitster_volver_a", "aportar");
      return Sp.iniciarLogin();
    }
    S.aportando = true; S.info = "Leyendo tus canciones de Spotify (esto puede tardar un poco)…"; render();
    try {
      const canciones = await Sp.misCancionesFavoritas();
      const nombre = miEquipo()?.nombre || "Alguien";
      await Net.escribir(S.codigo, `aportes/${S.clienteId}`, { nombre, canciones });
      if (!canciones.length) S.error = "No he encontrado canciones tuyas en Spotify (¿tienes suficiente historial?).";
    } catch (e) {
      S.error = "Spotify: " + e.message;
    }
    S.aportando = false; S.info = null;
  },

  // ----- reproducción (solo anfitrión) -----
  async buscarDispositivos() {
    S.dispositivos = await Sp.dispositivos();
    S.modal = "dispositivos";
  },
  async usarNavegador() {
    try {
      S.info = "Arrancando el reproductor…"; render();
      S.deviceId = await Sp.iniciarReproductorNavegador();
      await Sp.desbloquearAudio();
      S.info = null; S.modal = null;
    } catch (e) { S.error = e.message; S.info = null; }
  },
  elegirDispositivo(el) {
    S.deviceId = el.dataset.id;
    localStorage.setItem("hitster_dispositivo", S.deviceId);
    S.modal = null;
  },
  repetir() {
    const secreto = Net.revelar(E?.ronda?.secreto, S.codigo);
    if (secreto?.uri) sonar(secreto.uri);
  },
  pausar() { Sp.pausar(S.deviceId); },

  // ----- lobby -----
  async empezar() {
    const equipos = R.equiposEnOrden(E.equipos);
    if (equipos.length < 2) { S.error = "Hacen falta al menos 2 equipos."; return; }
    if (!S.deviceId) { S.error = "Elige primero dónde suena la música."; return; }

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
    await Net.actualizar(S.codigo, { equipos: nuevos, usadas, fase: "jugando" });
    await nuevaRonda(equipos[Math.floor(Math.random() * equipos.length)].id);
  },

  // ----- turno -----
  hueco(el) {
    S.slot = Number(el.dataset.slot);
    // Durante la colocación guardamos la elección al momento: si se acaba el
    // tiempo, vale el último hueco tocado aunque no hayan pulsado Finalizar.
    if (E?.ronda?.subfase === "colocando" && E.ronda.equipoActivo === S.equipoId) {
      Net.escribir(S.codigo, "ronda/colocacion", S.slot);
    }
  },

  finalizar() {
    if (S.slot == null) return;
    Net.actualizar(S.codigo, { "ronda/colocacion": S.slot, "ronda/confirmada": true });
    S.slot = null;
  },

  saltar() {
    const eq = miEquipo();
    if ((eq?.fichas || 0) < AJUSTES.fichasParaSaltar) return;
    Net.actualizar(S.codigo, {
      [`equipos/${S.equipoId}/fichas`]: eq.fichas - AJUSTES.fichasParaSaltar,
      "ronda/saltar": true,
    });
    S.slot = null;
  },

  async robar() {
    if (S.slot == null) return;
    const slot = S.slot; S.slot = null;
    await Net.transaccion(S.codigo, "ronda/robos", (actual) => {
      const a = actual || {};
      if (a[S.equipoId] !== undefined) return;                       // ya había elegido
      if (Object.values(a).includes(slot)) return;                   // hueco pillado
      if (E.ronda.colocacion === slot) return;                       // el del equipo activo
      return { ...a, [S.equipoId]: slot };
    });
  },

  pasarRobo() { Net.escribir(S.codigo, `ronda/robos/${S.equipoId}`, "pasa"); },

  // ----- pregunta extra -----
  bonus(el) {
    const acertaron = el.dataset.valor === "si";
    const eq = miEquipo();
    const cambios = { "ronda/esperandoBonus": false, "ronda/bonus": acertaron };
    if (acertaron) cambios[`equipos/${S.equipoId}/fichas`] = R.sumarFicha(eq);
    Net.actualizar(S.codigo, cambios);
  },

  siguiente() { Net.escribir(S.codigo, "ronda/siguientePedida", true); },

  // ----- corregir un año equivocado (Spotify a veces se equivoca con remasters) -----
  corregirAnio() { S.modal = "corregirAnio"; },

  async guardarAnio() {
    const val = parseInt(document.getElementById("in-anio-correcto")?.value, 10);
    const max = new Date().getFullYear();
    if (!val || val < 1900 || val > max) { S.error = `Pon un año entre 1900 y ${max}.`; return; }

    const eqId = E?.ronda?.resultado?.ganadorCarta;
    const objetivo = E?.ronda?.carta;
    if (!eqId || !objetivo) { S.modal = null; return; }

    const corregidas = R.ordenar((E.equipos[eqId].cartas || []).map((c) =>
      (c.titulo === objetivo.titulo && c.artista === objetivo.artista && c.anio === objetivo.anio)
        ? { ...c, anio: val } : c));

    await Net.actualizar(S.codigo, {
      [`equipos/${eqId}/cartas`]: corregidas,
      "ronda/carta/anio": val,
    });
    S.modal = null;
  },

  // ----- ver otros equipos -----
  verOtros() {
    const otros = R.equiposEnOrden(E.equipos).filter((e) => e.id !== S.equipoId);
    S.modal = "otros";
    S.modalEquipo = otros.length === 1 ? otros[0].id : null;
  },
  verEquipo(el) { S.modalEquipo = el.dataset.id; },

  async otraPartida() {
    if (!soyHost()) return;
    const nuevos = JSON.parse(JSON.stringify(E.equipos));
    for (const id of Object.keys(nuevos)) { nuevos[id].cartas = []; nuevos[id].fichas = AJUSTES.fichasIniciales; }
    await Net.actualizar(S.codigo, { equipos: nuevos, usadas: {}, fase: "lobby", ganador: null, ronda: null });
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
       <div style="height:14px"></div>`;

  return cabecera("crear partida") + `
    <div class="tarjeta">
      ${spotify}
      <label for="in-nombre">Nombre de tu equipo</label>
      <input id="in-nombre" maxlength="18" placeholder="Los Campeones" />
      <label for="in-mazo">Mazo de canciones</label>
      <select id="in-mazo">
        <option value="mixto">Mixto — internacional + español/latino (recomendado)</option>
        <option value="int">Solo internacional</option>
        <option value="es">Solo español y latino</option>
        <option value="top">Nuestras canciones — mezcla lo que aporte cada dispositivo</option>
      </select>
      <p class="mini" style="margin-top:10px">En «Nuestras canciones», cualquiera que se una a la partida puede
        conectar su Spotify y aportar sus canciones favoritas (lo verás en la sala de espera). Se priorizan las
        que varias personas tengáis en común. Algunos años pueden fallar por remasterizaciones: si veis uno mal,
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
      móvil o iPad: jugaréis juntos, como un solo equipo, cada uno desde su dispositivo.</p>
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
        return `
        <div class="equipo-fila">
          <span class="punto" style="background:${esc(e.color.hex)}"></span>
          <span class="nombre">${esc(e.nombre)}${e.id === S.equipoId ? " <span class='mini'>(tú)</span>" : ""}</span>
          ${conectados > 1 ? `<span class="pastilla">${conectados} dispositivos</span>` : ""}
        </div>`;
      }).join("")}
      ${equipos.length < 2 ? '<p class="mini" style="margin-top:12px">Esperando a que entre algún equipo más…</p>' : ""}
    </div>

    ${E.config?.mazo === "top" ? `
      <div class="tarjeta">
        <h3>Nuestras canciones</h3>
        <p class="mini">${gente
          ? `${gente} persona${gente === 1 ? "" : "s"} ${gente === 1 ? "ha" : "han"} aportado sus canciones`
            + (comunes ? ` · ${comunes} en común` : "")
          : "Nadie ha aportado canciones todavía."}</p>
        <button class="grande sec" data-accion="aportarSpotify" ${S.aportando ? "disabled" : ""}>
          ${Sp.haySesion() ? "Añadir mis canciones de Spotify" : "Conectar mi Spotify y aportar mis canciones"}
        </button>
      </div>` : ""}

    ${host ? `
      <div class="tarjeta">
        <h3>¿Dónde suena la música?</h3>
        <p class="mini">${S.deviceId ? "Dispositivo elegido." : "Elige un altavoz o reproduce en este navegador."}</p>
        <div class="fila">
          <button class="sec" data-accion="buscarDispositivos">Elegir altavoz de Spotify</button>
          <button class="sec" data-accion="usarNavegador">Sonar en este dispositivo</button>
        </div>
      </div>
      <button class="grande" data-accion="empezar" ${equipos.length >= 2 && S.deviceId ? "" : "disabled"}>
        Empezar la partida
      </button>
      <div style="height:10px"></div>` : `
      <div class="aviso info">Esperando a que el anfitrión empiece la partida…</div>`}

    <button class="grande sec" data-accion="salir">Salir</button>`;
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
      <button class="sec" style="padding:9px 18px;min-height:auto;font-size:14px" data-accion="verOtros">Otros equipos</button>
      <button class="sec" style="padding:9px 18px;min-height:auto;font-size:14px" data-accion="salir">Salir</button>
    </div>`;
}

function controlesMusica() {
  if (!soyHost()) return "";
  return `
    <div class="fila" style="margin-top:12px">
      <button class="sec" data-accion="repetir">Volver a poner la canción</button>
      <button class="sec" data-accion="pausar">Pausar</button>
      <button class="sec" data-accion="buscarDispositivos">Cambiar altavoz</button>
    </div>`;
}

function vistaJuego() {
  const r = E.ronda;
  if (!r) return `<div class="tarjeta centro"><span class="gira">♪</span> Preparando la ronda…</div>`;
  const activo = equipoActivo();
  const soyActivo = r.equipoActivo === S.equipoId;
  const timeline = R.ordenar(activo.cartas || []);

  if (r.subfase === "colocando") return barraSuperior() + faseColocando(r, activo, soyActivo, timeline);
  if (r.subfase === "robando")   return barraSuperior() + faseRobando(r, activo, soyActivo, timeline);
  return barraSuperior() + faseRevelado(r, activo, soyActivo, timeline);
}

function faseColocando(r, activo, soyActivo, timeline) {
  const mio = miEquipo();
  const crono = `<div class="crono" id="crono" data-limite="${r.limite}">${reloj((r.limite - Net.ahora()) / 1000)}</div>`;

  if (!soyActivo) {
    return `
      <div class="tarjeta centro">
        <h2>Suena la canción…</h2>
        ${crono}
        <p><b>${esc(activo.nombre)}</b> está decidiendo en qué año colocarla.</p>
        <div style="max-width:180px;margin:0 auto">${htmlDorso()}</div>
        ${controlesMusica()}
      </div>
      <div class="tarjeta">
        <h3>Línea del tiempo de ${esc(activo.nombre)}</h3>
        ${htmlLinea(timeline)}
      </div>`;
  }

  const elegibles = new Set(Array.from({ length: timeline.length + 1 }, (_, i) => i));
  const puedeSaltar = (mio.fichas || 0) >= AJUSTES.fichasParaSaltar;
  return `
    <div class="tarjeta centro">
      <h2>¡Os toca!</h2>
      ${crono}
      <p>Escuchad la canción y elegid el hueco donde creéis que va según su año.</p>
      <div style="max-width:180px;margin:0 auto">${htmlDorso()}</div>
      ${controlesMusica()}
    </div>
    <div class="tarjeta">
      <h3>Vuestra línea del tiempo</h3>
      ${htmlLinea(timeline, { elegibles, elegido: S.slot })}
      <div class="fila" style="margin-top:8px">
        <button data-accion="finalizar" ${S.slot == null ? "disabled" : ""}>Finalizar</button>
        <button class="sec" data-accion="saltar" ${puedeSaltar ? "" : "disabled"}>
          Saltar canción (${AJUSTES.fichasParaSaltar} fichas)
        </button>
      </div>
      ${S.slot == null ? '<p class="mini" style="margin-top:10px">Toca uno de los huecos con «+».</p>' : ""}
    </div>`;
}

function faseRobando(r, activo, soyActivo, timeline) {
  const mio = miEquipo();
  const robos = r.robos || {};
  const meToca = r.turnoRobo === S.equipoId;
  const yaElegi = robos[S.equipoId] !== undefined;

  const marcas = {};
  if (r.colocacion != null) {
    marcas[r.colocacion] = { texto: "★", sub: activo.nombre, clase: "elegido" };
  }
  for (const [eqId, slot] of Object.entries(robos)) {
    if (typeof slot !== "number") continue;
    marcas[slot] = { texto: "●", sub: E.equipos[eqId]?.nombre || "", clase: "elegido" };
  }

  const ocupados = R.slotsOcupados(r);
  const elegibles = meToca && !yaElegi && (mio.fichas || 0) >= 1
    ? new Set(Array.from({ length: timeline.length + 1 }, (_, i) => i).filter((i) => !ocupados.has(i)))
    : null;

  const enTurno = E.equipos[r.turnoRobo];
  const crono = r.limiteRobo
    ? `<div class="crono" id="crono" data-limite="${r.limiteRobo}">${reloj((r.limiteRobo - Net.ahora()) / 1000)}</div>`
    : "";

  let panel;
  if (soyActivo) {
    panel = `<h2>Ya está colocada</h2>
             <p>Ahora los demás equipos pueden intentar robaros la carta si creen que os habéis equivocado.</p>
             ${enTurno ? `<p>Le toca decidir a <b>${esc(enTurno.nombre)}</b>.</p>` : ""}`;
  } else if (meToca && !yaElegi) {
    panel = `<h2>¿Se han equivocado?</h2>
             <p>Si creéis que la canción va en otro hueco, poned una ficha ahí. Si acertáis, la carta es vuestra.</p>
             <p class="mini">Intentarlo cuesta 1 ficha (tenéis ${mio.fichas || 0}).</p>`;
  } else if (yaElegi) {
    panel = `<h2>Decisión tomada</h2><p>Esperando a los demás equipos…</p>`;
  } else {
    panel = `<h2>Turno de robo</h2><p>Le toca decidir a <b>${esc(enTurno?.nombre || "…")}</b>.</p>`;
  }

  const botones = meToca && !yaElegi ? `
    <div class="fila" style="margin-top:8px">
      <button data-accion="robar" ${S.slot == null || (mio.fichas || 0) < 1 ? "disabled" : ""}>
        Robar en este hueco
      </button>
      <button class="sec" data-accion="pasarRobo">Pasar</button>
    </div>
    ${(mio.fichas || 0) < 1 ? '<p class="mini">No os quedan fichas para robar.</p>' : ""}` : "";

  return `
    <div class="tarjeta centro">${panel}${crono}
      <div style="max-width:180px;margin:10px auto 0">${htmlDorso()}</div>
      ${controlesMusica()}
    </div>
    <div class="tarjeta">
      <h3>Línea del tiempo de ${esc(activo.nombre)}</h3>
      ${htmlLinea(timeline, { elegibles, elegido: S.slot, marcas })}
      ${botones}
    </div>`;
}

function faseRevelado(r, activo, soyActivo, timeline) {
  const res = r.resultado || {};
  const carta = r.carta || {};
  const validos = new Set(res.slotsValidos || []);
  const ganador = res.ganadorCarta ? E.equipos[res.ganadorCarta] : null;

  const marcas = {};
  for (const i of validos) marcas[i] = { texto: "✓", sub: "aquí iba", clase: "correcto" };
  if (r.colocacion != null && !validos.has(r.colocacion)) {
    marcas[r.colocacion] = { texto: "✗", sub: activo.nombre, clase: "fallo" };
  }
  for (const it of res.intentos || []) {
    if (!it.correcto) marcas[it.slot] = { texto: "✗", sub: E.equipos[it.equipo]?.nombre || "", clase: "fallo" };
  }

  let titular, clase;
  if (res.aciertoActivo) { titular = `¡${esc(activo.nombre)} ha acertado!`; clase = "ok"; }
  else if (ganador)      { titular = `${esc(activo.nombre)} falló — <b>${esc(ganador.nombre)}</b> roba la carta`; clase = "info"; }
  else                   { titular = `${esc(activo.nombre)} falló y nadie ha robado la carta`; clase = "malo"; }

  const bonus = r.esperandoBonus && soyActivo ? `
    <div class="tarjeta centro">
      <h2>¿Habéis acertado también el artista y el nombre de la canción?</h2>
      <p class="mini">Sed honestos. Si sí, ganáis una ficha (máximo ${AJUSTES.fichasMaximas}).</p>
      <div class="fila">
        <button data-accion="bonus" data-valor="si">Sí</button>
        <button class="sec" data-accion="bonus" data-valor="no">No</button>
      </div>
    </div>` : "";

  const esperandoOtros = r.esperandoBonus && !soyActivo
    ? aviso("info", `${esc(activo.nombre)} está respondiendo a la pregunta del artista y el título…`) : "";

  const puedeSeguir = soyActivo || soyHost();
  const siguiente = !r.esperandoBonus ? `
    ${r.bonus === true ? aviso("ok", `${esc(activo.nombre)} también acertó artista y título: +1 ficha.`) : ""}
    ${puedeSeguir
      ? `<button class="grande" data-accion="siguiente" ${r.siguientePedida ? "disabled" : ""}>
           ${r.siguientePedida ? "Preparando…" : "Siguiente ronda"}</button>`
      : aviso("info", "Esperando a que continúen…")}` : "";

  const corregir = ganador && !r.siguientePedida ? `
    <div class="centro" style="margin-top:8px">
      <button class="sec" style="padding:8px 16px;min-height:auto;font-size:13px" data-accion="corregirAnio">
        ¿Año equivocado? Corregir
      </button>
    </div>` : "";

  return `
    <div class="tarjeta centro">
      ${aviso(clase, titular)}
      <div style="max-width:210px;margin:0 auto">${htmlCarta(carta)}</div>
      ${corregir}
    </div>
    <div class="tarjeta">
      <h3>Línea del tiempo de ${esc(activo.nombre)}</h3>
      ${htmlLinea(timeline, { marcas })}
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
      <p><b>Robo:</b> después, los demás equipos, por orden de juego, pueden gastar 1 ficha para
         poner su ficha en otro hueco. Si vosotros fallasteis y alguno de ellos acierta, se lleva la carta.</p>
      <p><b>Fichas:</b> empezáis con ${AJUSTES.fichasIniciales} (máximo ${AJUSTES.fichasMaximas}).
         Si acertáis el año y además el artista y el título, ganáis una.
         Podéis gastar ${AJUSTES.fichasParaSaltar} para saltar una canción que no conocéis.</p>
      <button class="grande sec" data-accion="cerrarModal">Cerrar</button>`;
  }

  if (S.modal === "dispositivos") {
    cuerpo = `
      <h2>¿Dónde suena la música?</h2>
      <p class="mini">Abre Spotify en el móvil, el ordenador o el altavoz y ponlo a sonar un segundo
         para que aparezca aquí.</p>
      ${S.dispositivos.length
        ? S.dispositivos.map((d) => `
            <div class="equipo-fila">
              <span class="nombre">${esc(d.name)} <span class="mini">${esc(d.type)}</span></span>
              <button class="sec" style="padding:9px 18px;min-height:auto"
                      data-accion="elegirDispositivo" data-id="${esc(d.id)}">Usar</button>
            </div>`).join("")
        : '<p>No he encontrado ningún dispositivo de Spotify activo.</p>'}
      <div style="height:12px"></div>
      <button class="grande sec" data-accion="usarNavegador">Sonar en este dispositivo</button>
      <div style="height:8px"></div>
      <button class="grande sec" data-accion="buscarDispositivos">Buscar otra vez</button>
      <div style="height:8px"></div>
      <button class="grande sec" data-accion="cerrarModal">Cerrar</button>`;
  }

  if (S.modal === "corregirAnio") {
    const actual = E?.ronda?.carta?.anio || "";
    cuerpo = `
      <h2>Corregir el año</h2>
      <p class="mini">A veces Spotify se equivoca (remasterizaciones, recopilatorios…). Esto solo corrige
        el año para que valga a partir de ahora; no cambia el resultado de esta ronda.</p>
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
    const otros = R.equiposEnOrden(E.equipos).filter((e) => e.id !== S.equipoId);
    const sel = S.modalEquipo ? E.equipos[S.modalEquipo] : null;
    cuerpo = `
      <h2>Otros equipos</h2>
      ${otros.length > 1 ? `<div class="fila" style="margin-bottom:12px">
          ${otros.map((e) => `<button class="sec" data-accion="verEquipo" data-id="${esc(e.id)}"
              style="${S.modalEquipo === e.id ? `border-color:${esc(e.color.hex)}` : ""}">${esc(e.nombre)}</button>`).join("")}
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
      <p>Abre el archivo <b>js/config.js</b> y pega:</p>
      <p>1. El <b>Client ID</b> de tu aplicación de Spotify Developer.<br>
         2. La configuración de tu proyecto de <b>Firebase</b>.</p>
      <p>Tienes las instrucciones paso a paso en el archivo <b>LEEME.md</b>.</p>
      <h3>Dato que te pedirá Spotify</h3>
      <p>En el panel de Spotify, en <i>Redirect URIs</i>, pega exactamente esto:</p>
      <div class="tarjeta" style="word-break:break-all;font-family:ui-monospace,monospace;font-size:14px">
        ${esc(Sp.redirectUri())}
      </div>
    </div>`;
}

init();
