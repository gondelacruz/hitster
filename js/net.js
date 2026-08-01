// ============================================================
//  RED — salas en tiempo real con Firebase Realtime Database
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, update, onValue, remove,
  onDisconnect, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { FIREBASE_CONFIG } from "./config.js";

let db = null;

export async function conectar() {
  if (db) return db;
  const app = initializeApp(FIREBASE_CONFIG);
  db = getDatabase(app);
  try { await signInAnonymously(getAuth(app)); } catch (e) {
    console.warn("Login anónimo no disponible:", e.message);
  }
  return db;
}

const sala = (codigo) => ref(db, "salas/" + codigo);

export async function existeSala(codigo) {
  const snap = await get(sala(codigo));
  return snap.exists();
}

export async function crearSala(codigo, estado) {
  await set(sala(codigo), { ...estado, creada: serverTimestamp() });
}

export async function leerSala(codigo) {
  const snap = await get(sala(codigo));
  return snap.exists() ? snap.val() : null;
}

export function escuchar(codigo, cb) {
  return onValue(sala(codigo), (snap) => cb(snap.exists() ? snap.val() : null));
}

export function escribir(codigo, ruta, valor) {
  return set(ref(db, `salas/${codigo}/${ruta}`), valor);
}

export function actualizar(codigo, cambios) {
  return update(sala(codigo), cambios);
}

export function borrarSala(codigo) {
  return remove(sala(codigo));
}

/** Escritura atómica: útil para que dos equipos no pidan el mismo hueco a la vez. */
export function transaccion(codigo, ruta, fn) {
  return runTransaction(ref(db, `salas/${codigo}/${ruta}`), fn);
}

// ---------- apps de Spotify registradas (compartidas por todas las salas) ----------
// Antes, los Client ID de Spotify se pegaban a mano en config.js. Ahora viven
// aquí, en la base de datos, para que cualquiera pueda registrar la suya
// propia desde dentro del juego (botón "¿Nunca has jugado con tus
// canciones?", ver app.js) sin tener que tocar ni redesplegar código. Ojo:
// esto exige que las reglas de Firebase permitan leer/escribir el nodo
// "spotifyApps" — ver LEEME.md, Paso 3.
const NODO_APPS_SPOTIFY = "spotifyApps";
const listaApps = (val) => (val ? Object.entries(val).map(([id, v]) => ({ id, nombre: v?.nombre || "Grupo" })) : []);

/** Todas las apps de Spotify que la familia ha ido registrando hasta ahora. */
export async function leerAppsSpotify() {
  const snap = await get(ref(db, NODO_APPS_SPOTIFY));
  return listaApps(snap.exists() ? snap.val() : null);
}

/** Se mantiene al día en cuanto alguien registra una app nueva, sin recargar la página. */
export function escucharAppsSpotify(cb) {
  return onValue(ref(db, NODO_APPS_SPOTIFY), (snap) => cb(listaApps(snap.exists() ? snap.val() : null)));
}

/** Registra una app de Spotify nueva para que la use toda la familia (ver acciones.guardarAppSpotify). */
export async function anadirAppSpotify(clientId, nombre) {
  await set(ref(db, `${NODO_APPS_SPOTIFY}/${clientId}`), { nombre });
}

/**
 * Migración de una sola vez: si nadie ha registrado ninguna app todavía (base
 * de datos recién creada, o una que ya llevaba tiempo con Client IDs a mano
 * en config.js), sembramos esos IDs en Firebase para no perder una
 * configuración que ya estaba funcionando. Si ya hay algo registrado, no
 * tocamos nada — así que esto es seguro de llamar siempre, en cada arranque.
 */
export async function sembrarAppsSpotifySiHaceFalta(semilla) {
  if (!semilla?.length) return;
  const actuales = await leerAppsSpotify();
  if (actuales.length) return;
  const cambios = {};
  for (const a of semilla) if (a?.id) cambios[a.id] = { nombre: a.nombre || "Grupo" };
  if (Object.keys(cambios).length) await update(ref(db, NODO_APPS_SPOTIFY), cambios);
}

/**
 * Marca este dispositivo como miembro conectado de un equipo (varios
 * dispositivos pueden compartir el mismo equipo). Si cierra la pestaña,
 * queda marcado como desconectado, pero no se borra: puede volver a entrar.
 */
export function marcarPresencia(codigo, equipoId, clienteId) {
  const r = ref(db, `salas/${codigo}/equipos/${equipoId}/miembros/${clienteId}`);
  set(r, true);
  onDisconnect(r).set(false);
}

/** Hora del servidor, para que el cronómetro sea igual en todos los dispositivos. */
export const ahoraServidor = () => serverTimestamp();

// Diferencia entre el reloj de este dispositivo y el del servidor de Firebase.
// Así el cronómetro marca lo mismo en el iPad de todos.
let _offset = 0;
export function vigilarReloj() {
  onValue(ref(db, ".info/serverTimeOffset"), (s) => { _offset = s.val() || 0; });
}
export const ahora = () => Date.now() + _offset;

// ---------- Ocultar la carta en curso ----------
// No es criptografía seria: solo evita que alguien vea el año abriendo la
// consola del navegador durante la partida. Es un juego de familia.
export function ocultar(obj, clave) {
  const texto = JSON.stringify(obj);
  let out = "";
  for (let i = 0; i < texto.length; i++) {
    out += String.fromCharCode(texto.charCodeAt(i) ^ clave.charCodeAt(i % clave.length) ^ 0x5a);
  }
  return btoa(unescape(encodeURIComponent(out)));
}

export function revelar(cifrado, clave) {
  try {
    const texto = decodeURIComponent(escape(atob(cifrado)));
    let out = "";
    for (let i = 0; i < texto.length; i++) {
      out += String.fromCharCode(texto.charCodeAt(i) ^ clave.charCodeAt(i % clave.length) ^ 0x5a);
    }
    return JSON.parse(out);
  } catch { return null; }
}
