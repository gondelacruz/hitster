// Firebase falso: base de datos en memoria con listeners, para las pruebas.
const DB = { data: {}, listeners: [], pendiente: false };

const partes = (p) => String(p).split("/").filter(Boolean);

function leer(path) {
  let n = DB.data;
  for (const k of partes(path)) { if (n == null || typeof n !== "object") return undefined; n = n[k]; }
  return n;
}

function escribir(path, valor) {
  const ks = partes(path);
  if (!ks.length) { DB.data = valor ?? {}; return; }
  let n = DB.data;
  for (let i = 0; i < ks.length - 1; i++) {
    if (typeof n[ks[i]] !== "object" || n[ks[i]] === null) n[ks[i]] = {};
    n = n[ks[i]];
  }
  const ultima = ks[ks.length - 1];
  if (valor === null || valor === undefined) delete n[ultima];
  else n[ultima] = JSON.parse(JSON.stringify(valor));
}

function avisar() {
  if (DB.pendiente) return;
  DB.pendiente = true;
  queueMicrotask(() => {
    DB.pendiente = false;
    for (const l of [...DB.listeners]) l.cb(snap(l.path));
  });
}

const snap = (path) => {
  const v = leer(path);
  return { exists: () => v !== undefined && v !== null, val: () => (v === undefined ? null : v) };
};

export const initializeApp = () => ({});
export const getDatabase = () => ({});
export const getAuth = () => ({});
export const signInAnonymously = async () => ({ user: { uid: "test" } });
export const ref = (_db, path) => ({ path });
export const serverTimestamp = () => Date.now();

// Firebase de verdad rechaza escribir `undefined` en cualquier propiedad
// anidada (aunque JSON.stringify lo borraría en silencio). Lo replicamos
// aquí a propósito: si no lo hiciéramos, un bug como "un objeto se queda con
// una clave puesta a `undefined`" pasaría los tests tranquilamente y solo
// explotaría en producción, como pasó con la `popularidad` de Spotify.
function comprobarSinUndefined(valor, ruta) {
  if (valor === undefined) {
    throw new Error(`set failed: value argument contains undefined in property '${ruta}'`);
  }
  if (valor === null || typeof valor !== "object") return;
  for (const [k, v] of Object.entries(valor)) comprobarSinUndefined(v, ruta ? `${ruta}.${k}` : k);
}

export async function set(r, v) {
  comprobarSinUndefined(v, partes(r.path).join("."));
  escribir(r.path, v); avisar();
}
export async function get(r) { return snap(r.path); }
export async function remove(r) { escribir(r.path, null); avisar(); }

export async function update(r, cambios) {
  for (const [k, v] of Object.entries(cambios)) {
    comprobarSinUndefined(v, [...partes(r.path), ...k.split("/")].join("."));
    escribir(r.path + "/" + k, v);
  }
  avisar();
}

export function onValue(r, cb) {
  const l = { path: r.path, cb };
  DB.listeners.push(l);
  cb(snap(r.path));
  return () => { DB.listeners = DB.listeners.filter((x) => x !== l); };
}

export function onDisconnect() { return { set: async () => {} }; }

export async function runTransaction(r, fn) {
  const res = fn(leer(r.path) ?? null);
  if (res === undefined) return { committed: false };
  escribir(r.path, res); avisar();
  return { committed: true };
}

// Utilidades solo para las pruebas
export const _db = DB;
export const _leer = leer;
export const _escribir = (p, v) => { escribir(p, v); avisar(); };
