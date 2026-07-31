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
