// ============================================================
//  Prueba de extremo a extremo: arranca la app de verdad en un
//  navegador simulado, con Firebase y Spotify falsos, y juega
//  una partida entera de 3 equipos pulsando botones.
//
//  Ejecutar con:  npm test   (o el comando de package.json)
// ============================================================
import { JSDOM } from "jsdom";
// (el objeto crypto global de Node ya sirve)

let fallos = 0;
const t = (nombre, cond) => { if (!cond) { fallos++; console.error("  ✗ " + nombre); } };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- navegador simulado ----------
const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div></body></html>',
  { url: "https://ejemplo.github.io/hitster/", pretendToBeVisual: true }
);
const { window } = dom;
Object.assign(globalThis, {
  window, document: window.document,
  localStorage: window.localStorage, sessionStorage: window.sessionStorage,
  location: window.location, history: window.history,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  confirm: () => true, alert: () => {},
});
window.confirm = () => true;

// ---------- Spotify falso ----------
const llamadas = { play: 0, pause: 0, search: 0 };
const pista = (uri, nombre, anio, artista = "Artista", popularity = 60) => ({
  uri, name: nombre, artists: [{ name: artista }], popularity,
  album: { name: "Álbum", release_date: `${anio}-01-01` },
});

globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  const qs = u.includes("?") ? new URL(u).searchParams : new URLSearchParams();
  const json = (obj, status = 200) => ({
    ok: status < 300, status, statusText: "OK",
    text: async () => JSON.stringify(obj), json: async () => obj,
  });
  const vacio = { ok: true, status: 204, statusText: "", text: async () => "" };

  if (u.includes("accounts.spotify.com/api/token"))
    return json({ access_token: "tok", refresh_token: "ref", expires_in: 3600, scope: Sp.SCOPES });
  if (u.includes("/v1/me/player/play")) { llamadas.play++; return vacio; }
  if (u.includes("/v1/me/player/pause")) { llamadas.pause++; return vacio; }
  if (u.includes("/v1/me/player/volume")) return vacio;

  // Top tracks: dos rangos, con una canción repetida entre ambos (para probar
  // que los pesos se suman) y offset=49/50 siempre vacío (segunda página).
  if (u.includes("/v1/me/top/tracks")) {
    if (qs.get("offset") !== "0") return json({ items: [] });
    if (qs.get("time_range") === "long_term")
      return json({ items: [pista("spotify:track:top-a", "Favorita de largo plazo", 1986),
                             pista("spotify:track:top-b", "Compartida", 1999)] });
    if (qs.get("time_range") === "medium_term")
      return json({ items: [pista("spotify:track:top-b", "Compartida", 1999),
                             pista("spotify:track:top-c", "De medio plazo", 2005)] });
    return json({ items: [] });
  }
  // Reproducidas recientemente. A propósito, esta pista NO trae "popularity"
  // (a veces Spotify no lo incluye): sirve para comprobar que la app no
  // intenta guardar una `popularidad: undefined`, que Firebase rechazaría.
  if (u.includes("/v1/me/player/recently-played"))
    return json({ items: [{ track: {
      uri: "spotify:track:reciente-f", name: "Sonó hace poco",
      artists: [{ name: "Artista" }], album: { name: "Álbum", release_date: "2020-01-01" },
    } }] });
  // Canciones guardadas ("Me gusta").
  if (u.includes("/v1/me/tracks")) {
    if (qs.get("offset") !== "0") return json({ items: [] });
    return json({ items: [{ track: pista("spotify:track:guardada-d", "Canción guardada", 2012) }] });
  }
  // Playlists propias y sus canciones.
  if (u.includes("/v1/me/playlists"))
    return json({ items: [{ id: "pl1", owner: { id: "mi-id-de-prueba" } }] });
  if (u.includes("/v1/playlists/pl1/tracks"))
    return json({ items: [{ track: pista("spotify:track:playlist-e", "De mi playlist", 2018, "Artista", 8) }] });

  if (u.includes("/v1/search")) {
    llamadas.search++;
    return json({ tracks: { items: [{
      uri: "spotify:track:" + llamadas.search, name: "Canción", popularity: 60,
      artists: [{ name: "Artista" }], album: { name: "Álbum", release_date: "1999-01-01" },
    }] } });
  }
  if (u.includes("/v1/me"))
    return json({ id: "mi-id-de-prueba", product: "premium", display_name: "Test" });
  return json({ error: { message: "ruta no simulada: " + u } }, 404);
};

// Importamos spotify.js antes que nada más (no dispara ningún efecto al
// importarlo, a diferencia de app.js) para poder sembrar un token de sesión
// ya con todos los permisos concedidos (si no, con los cambios de "faltan
// permisos", la propia app forzaría una reconexión en cuanto probáramos a
// aportar canciones).
const Sp = await import("../js/spotify.js");

localStorage.setItem("hitster_spotify_token", JSON.stringify({
  access_token: "tok", refresh_token: "ref", expira: Date.now() + 3.6e6, alcance: Sp.SCOPES,
}));

// ---------- arrancamos la app ----------
const fb = await import("./stubs/firebase.mjs");
const Net = await import("../js/net.js");
const R = await import("../js/reglas.js");
const { AJUSTES, COLORES_EQUIPO } = await import("../js/config.js");
const App = await import("../js/app.js");
await esperar(20);

const html = () => document.getElementById("app").innerHTML;
const $ = (sel) => document.querySelector(sel);
const sesionGuardada = () => JSON.parse(localStorage.getItem("hitster_sesion") || "{}");

async function clic(sel, etiqueta = sel) {
  const el = $(sel);
  if (!el) throw new Error("No encuentro el botón: " + etiqueta + "\n---\n" + html().slice(0, 1200));
  if (el.disabled) throw new Error("Botón deshabilitado: " + etiqueta);
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await esperar(12);
}

function sinErrores(donde) {
  const err = $(".aviso.error");
  if (err) { fallos++; console.error(`  ✗ error en pantalla (${donde}): ${err.textContent.trim()}`); }
}

// ============================================================
console.log("\nPartida de extremo a extremo…");

t("arranca en la pantalla de inicio", html().includes("Crear partida nueva"));

// ------------------------------------------------------------
//  Flujo de "unirse a un equipo existente / crear uno nuevo" +
//  aportar canciones de Spotify desde un dispositivo que no es el anfitrión.
// ------------------------------------------------------------
console.log("Comprobando unirse a un equipo y aportar canciones de Spotify…");
const codigoAjeno = "5150";
fb._escribir(`salas/${codigoAjeno}`, {
  fase: "lobby", hostCliente: "otro-cliente", config: { mazo: "todo" },
  equipos: {
    eq1: { id: "eq1", nombre: "Los Tíos", color: COLORES_EQUIPO[0], orden: 0,
           fichas: AJUSTES.fichasIniciales, cartas: [], miembros: { "otro-cliente": true } },
  },
  usadas: {}, aportes: {}, ronda: null, ganador: null,
});

await clic('[data-accion="irUnirse"]', "Unirse");
document.getElementById("in-codigo").value = codigoAjeno;
await clic('[data-accion="buscarSala"]', "Buscar sala");
t("tras buscar la sala se ve el equipo existente", html().includes("Los Tíos"));
t("y la opción de crear un equipo nuevo", html().includes("Crear este equipo"));

await clic('[data-accion="unirmeEquipo"]', "Unirme a Los Tíos");
let salaAjena = fb._leer(`salas/${codigoAjeno}`);
const miId = sesionGuardada().clienteId;
t("nos unimos al equipo existente sin borrar al otro miembro",
  salaAjena.equipos.eq1.miembros[miId] === true && salaAjena.equipos.eq1.miembros["otro-cliente"] === true);
t("el lobby muestra la sección de Nuestras canciones (mazo todo)", html().includes("Nuestras canciones"));
t("aparece el botón para aportar Spotify", !!$('[data-accion="aportarSpotify"]'));

await clic('[data-accion="aportarSpotify"]', "Aportar mis canciones de Spotify");
await esperar(80); // varias llamadas de red encadenadas (top, recientes, guardadas, playlists)
salaAjena = fb._leer(`salas/${codigoAjeno}`);
const aporte = salaAjena.aportes?.[miId];
t("el aporte de Spotify queda guardado en la sala", !!aporte && aporte.canciones.length === 6);
t("el peso se suma cuando la misma canción sale en varias fuentes",
  aporte?.canciones.find((c) => c.uri === "spotify:track:top-b")?.peso === 5);
t("se incluyen canciones guardadas y de playlists propias, no solo el top",
  aporte?.canciones.some((c) => c.uri === "spotify:track:guardada-d")
  && aporte?.canciones.some((c) => c.uri === "spotify:track:playlist-e"));
t("se incluyen canciones reproducidas recientemente",
  aporte?.canciones.some((c) => c.uri === "spotify:track:reciente-f"));
t("se guarda la popularidad que da Spotify a cada canción",
  aporte?.canciones.find((c) => c.uri === "spotify:track:playlist-e")?.popularidad === 8
  && aporte?.canciones.find((c) => c.uri === "spotify:track:top-a")?.popularidad === 60);
sinErrores("aportar Spotify con una canción sin popularidad");
t("una canción sin popularidad de Spotify se guarda igualmente (sin romper el aporte)",
  aporte?.canciones.some((c) => c.uri === "spotify:track:reciente-f"));
t("a esa canción no se le pone una `popularidad` a null/undefined: la propiedad simplemente no existe",
  !Object.prototype.hasOwnProperty.call(
    aporte?.canciones.find((c) => c.uri === "spotify:track:reciente-f") || {}, "popularidad"));
t("tras aportar con éxito, se ofrece la opción de conectar otra cuenta de Spotify "
  + "(para cuando varios comparten el mismo móvil)",
  !!$('[data-accion="cambiarCuentaSpotify"]'));

await clic('[data-accion="salir"]', "Salir del equipo compartido");
salaAjena = fb._leer(`salas/${codigoAjeno}`);
t("al salir sin ser el único miembro, el equipo se mantiene", !!salaAjena?.equipos?.eq1);
t("solo se quita nuestra propia membresía", !salaAjena.equipos.eq1.miembros?.[miId]);

await clic('[data-accion="irUnirse"]', "Unirse otra vez");
document.getElementById("in-codigo").value = codigoAjeno;
await clic('[data-accion="buscarSala"]', "Buscar sala otra vez");
document.getElementById("in-nombre-equipo").value = "Equipo Nuevo De Prueba";
await clic('[data-accion="crearEquipoNuevo"]', "Crear equipo nuevo");
salaAjena = fb._leer(`salas/${codigoAjeno}`);
t("se puede crear un segundo equipo en una sala ya existente",
  salaAjena.equipos.eq2?.nombre === "Equipo Nuevo De Prueba");
t("el equipo nuevo nos tiene como único miembro", Object.keys(salaAjena.equipos.eq2.miembros).length === 1);

await clic('[data-accion="salir"]', "Salir del equipo nuevo, único miembro");
salaAjena = fb._leer(`salas/${codigoAjeno}`);
t("al salir siendo el único miembro, el equipo desaparece", !salaAjena?.equipos?.eq2);

fb._escribir(`salas/${codigoAjeno}`, null); // limpiar la sala de prueba

// ------------------------------------------------------------
//  Una sesión de Spotify "antigua" (conectada antes de pedir permiso para
//  leer canciones guardadas/playlists/reproducciones recientes) debe
//  detectarse como incompleta, para que la app fuerce reconectar en vez de
//  decir "no tienes historial" cuando el problema real son los permisos.
// ------------------------------------------------------------
console.log("Comprobando la detección de permisos insuficientes de Spotify…");
const tokenCompleto = JSON.parse(localStorage.getItem("hitster_spotify_token"));

localStorage.setItem("hitster_spotify_token", JSON.stringify({
  ...tokenCompleto, alcance: "user-read-private user-read-email user-top-read",
}));
t("una sesión antigua sin permisos de biblioteca/playlists/recientes se detecta como incompleta",
  Sp.faltanPermisos() === true);

localStorage.setItem("hitster_spotify_token", JSON.stringify({
  access_token: "tok", refresh_token: "ref", expira: Date.now() + 3.6e6, // sin campo "alcance" (formato viejo)
}));
t("una sesión sin campo de permisos guardado también fuerza reconectar", Sp.faltanPermisos() === true);

localStorage.setItem("hitster_spotify_token", JSON.stringify(tokenCompleto)); // restauramos para el resto de pruebas
t("con todos los permisos concedidos, no hace falta reconectar", Sp.faltanPermisos() === false);

// ------------------------------------------------------------
//  Pool comunitario: comprobación pura de la ponderación por canciones en común.
// ------------------------------------------------------------
console.log("Comprobando la ponderación del pool comunitario…");
const estadoPoolFalso = {
  aportes: {
    p1: { nombre: "Persona 1", canciones: [
      { titulo: "Compartida", artista: "Grupo", anio: 1999, uri: "u-compartida-1", peso: 5 },
      { titulo: "Solo de p1", artista: "Grupo", anio: 2001, uri: "u-solo-p1", peso: 3 },
    ] },
    p2: { nombre: "Persona 2", canciones: [
      { titulo: "Compartida", artista: "Grupo", anio: 1999, uri: "u-compartida-2", peso: 4 },
      { titulo: "Solo de p2", artista: "Grupo", anio: 2003, uri: "u-solo-p2", peso: 2 },
    ] },
  },
};
const poolFalso = App.poolComunitario(estadoPoolFalso);
const compartida = poolFalso.find((c) => App.clave(c) === App.clave({ titulo: "Compartida", artista: "Grupo" }));
t("la canción en común suma cuántas personas la aportan", compartida?.personas === 2);
// Los pesos ahora se normalizan por persona (peso/total-de-esa-persona) antes
// de sumarlos, para que nadie acapare el mazo: 5/8 (p1) + 4/6 (p2) = 31/24.
t("la canción en común suma los pesos normalizados de cada aporte",
  Math.abs((compartida?.peso ?? 0) - 31 / 24) < 1e-9);

let vecesElegidaComun = 0;
const INTENTOS = 4000;
for (let i = 0; i < INTENTOS; i++) if (App.elegirPonderado(poolFalso) === compartida) vecesElegidaComun++;
t("la ponderación favorece claramente la canción en común frente a las demás",
  vecesElegidaComun / INTENTOS > 0.5);

// El reparto entre personas debe ser justo: si alguien aporta muchas más
// canciones que otro, no debe acaparar el mazo (el bug que reportó el usuario:
// con dos personas, casi todo salía de una sola).
const estadoDesigual = {
  aportes: {
    muchas: { nombre: "Aporta muchas", canciones: Array.from({ length: 100 }, (_, i) => (
      { titulo: `CanciónMucha${i}`, artista: "A", anio: 2000 + (i % 20), uri: `u-mucha-${i}`, peso: 1 })) },
    pocas: { nombre: "Aporta pocas", canciones: Array.from({ length: 5 }, (_, i) => (
      { titulo: `CanciónPoca${i}`, artista: "B", anio: 1970 + i, uri: `u-poca-${i}`, peso: 1 })) },
  },
};
const poolDesigual = App.poolComunitario(estadoDesigual);
let vecesDePocas = 0;
const INTENTOS_JUSTICIA = 4000;
for (let i = 0; i < INTENTOS_JUSTICIA; i++) {
  if (App.elegirPonderado(poolDesigual).titulo.startsWith("CanciónPoca")) vecesDePocas++;
}
t("quien aporta pocas canciones no queda aplastado por quien aporta muchas (reparto ~50/50 por persona)",
  vecesDePocas / INTENTOS_JUSTICIA > 0.3 && vecesDePocas / INTENTOS_JUSTICIA < 0.7);

const titulosVistos = new Set();
for (let i = 0; i < 50; i++) {
  const c = App.sacarCancion({ config: { mazo: "todo" }, usadas: {}, ...estadoPoolFalso });
  if (c) titulosVistos.add(c.titulo);
}
t("con mazo 'todo', sacarCancion combina el pool comunitario con el mazo curado", titulosVistos.size > 1);

// El pool comunitario no debe estar sesgado solo a lo moderno: si hay canciones
// de varias décadas disponibles, con suficientes tiradas deben salir todas.
const poolMultiDecada = [
  { titulo: "Vieja", artista: "A", anio: 1965, uri: "u1", peso: 1, personas: 1 },
  { titulo: "Moderna muy popular", artista: "B", anio: 2023, uri: "u2", peso: 50, personas: 3 },
];
const decadasVistas = new Set();
for (let i = 0; i < 300; i++) decadasVistas.add(App.elegirPonderadoPorDecada(poolMultiDecada).titulo);
t("la ponderación por década deja salir también lo antiguo, aunque lo moderno sea más popular",
  decadasVistas.size === 2);

// El pool comunitario debe recordar quién aportó cada canción, y
// "usosPorAportante" debe contar bien cuántas de sus canciones ya sonaron.
const poolConAportantes = App.poolComunitario(estadoPoolFalso);
const solaDeP1 = poolConAportantes.find((c) => c.titulo === "Solo de p1");
t("cada canción guarda quién la aportó", solaDeP1?.aportantes?.has("p1") === true);
const usosSimulados = App.usosPorAportante(poolConAportantes,
  { [App.clave({ titulo: "Solo de p1", artista: "Grupo" })]: true });
t("usosPorAportante cuenta las canciones ya usadas de cada persona", usosSimulados.get("p1") === 1);
t("a quien no ha sonado nada no se le cuenta ningún uso", !usosSimulados.has("p2"));

// A lo largo de la partida, si una persona ya ha tenido varias canciones y
// otra ninguna, las siguientes elecciones deben favorecer a la que no ha
// sonado todavía (para que a todos les toque alguna canción suya).
const poolRotacion = [
  { titulo: "De sobreusada", artista: "X", anio: 2000, uri: "ux", peso: 1, personas: 1, aportantes: new Set(["sobreusada"]) },
  { titulo: "De nueva", artista: "Y", anio: 2000, uri: "uy", peso: 1, personas: 1, aportantes: new Set(["nueva"]) },
];
const usosDesequilibrados = new Map([["sobreusada", 5], ["nueva", 0]]);
let vecesLaNueva = 0;
const INTENTOS_ROTACION = 3000;
for (let i = 0; i < INTENTOS_ROTACION; i++) {
  if (App.elegirPonderado(poolRotacion, usosDesequilibrados).titulo === "De nueva") vecesLaNueva++;
}
t("se favorece a los aportantes que todavía no han tenido ninguna canción sonando",
  vecesLaNueva / INTENTOS_ROTACION > 0.7);

// Se deben preferir canciones medio conocidas: si dos canciones tienen el
// mismo peso pero una es muy popular y la otra una rareza que solo conoce
// quien la aportó, debe salir mucho más la popular.
const poolPopularidad = [
  { titulo: "Súper rara", artista: "Z", anio: 2000, uri: "ur", peso: 1, personas: 1, popularidad: 3 },
  { titulo: "Medio famosa", artista: "W", anio: 2000, uri: "uw", peso: 1, personas: 1, popularidad: 70 },
];
let vecesLaFamosa = 0;
const INTENTOS_POPULARIDAD = 3000;
for (let i = 0; i < INTENTOS_POPULARIDAD; i++) {
  if (App.elegirPonderado(poolPopularidad).titulo === "Medio famosa") vecesLaFamosa++;
}
t("se prefieren canciones medio conocidas frente a rarezas de un solo aportante",
  vecesLaFamosa / INTENTOS_POPULARIDAD > 0.8);
t("aun así, una rareza sigue pudiendo salir alguna vez (no se descarta del todo)",
  vecesLaFamosa / INTENTOS_POPULARIDAD < 1);

// Una canción marcada como "tontería" en `bloqueadas` no debe salir nunca del pool.
const claveCompartida = App.clave({ titulo: "Compartida", artista: "Grupo" });
const poolConBloqueo = App.poolComunitario({
  ...estadoPoolFalso, bloqueadas: { [claveCompartida]: true },
});
t("una canción bloqueada desaparece del pool comunitario",
  !poolConBloqueo.some((c) => App.clave(c) === claveCompartida));
t("las demás canciones del pool no se ven afectadas por el bloqueo",
  poolConBloqueo.some((c) => c.titulo === "Solo de p1") && poolConBloqueo.some((c) => c.titulo === "Solo de p2"));

// ------------------------------------------------------------
//  Corregir el año debe también rectificar quién se queda la carta.
// ------------------------------------------------------------
console.log("Comprobando que corregir el año rectifica al ganador…");
const codigoRectifica = "6060";
fb._escribir(`salas/${codigoRectifica}`, {
  fase: "lobby", hostCliente: "otro-host", config: { mazo: "famosas" },
  equipos: {
    eq1: { id: "eq1", nombre: "Equipo Uno", color: COLORES_EQUIPO[0], orden: 0, fichas: 3,
           cartas: [], miembros: {} },
    eq2: { id: "eq2", nombre: "Equipo Dos", color: COLORES_EQUIPO[1], orden: 1, fichas: 2,
           cartas: [], miembros: {} },
  },
  usadas: {}, aportes: {}, ronda: null, ganador: null,
});
await clic('[data-accion="irUnirse"]', "Unirse para probar la rectificación");
document.getElementById("in-codigo").value = codigoRectifica;
await clic('[data-accion="buscarSala"]', "Buscar sala de rectificación");
await clic('[data-accion="unirmeEquipo"]', "Unirme a Equipo Uno");

// Ahora que ya estamos dentro (y por tanto suscritos), fabricamos una ronda ya
// "resuelta" con el año viejo: el equipo activo la dio por buena (mal, porque
// el año real es otro) y un ladrón que había fallado con el año viejo, en
// realidad tenía razón con el año correcto.
fb._escribir(`salas/${codigoRectifica}`, {
  fase: "jugando", hostCliente: "otro-host", config: { mazo: "famosas" },
  equipos: {
    eq1: { id: "eq1", nombre: "Equipo Uno", color: COLORES_EQUIPO[0], orden: 0, fichas: 3,
           cartas: [ { titulo: "C1", artista: "X", anio: 1960 },
                     { titulo: "Disputada", artista: "Y", anio: 1975 },
                     { titulo: "C2", artista: "X", anio: 2000 } ], miembros: { [miId]: true } },
    eq2: { id: "eq2", nombre: "Equipo Dos", color: COLORES_EQUIPO[1], orden: 1, fichas: 2,
           cartas: [], miembros: {} },
  },
  usadas: {}, aportes: {}, ganador: null,
  ronda: {
    n: 1, equipoActivo: "eq1", subfase: "revelado",
    colocacion: 1, robos: { eq2: 2 }, confirmada: true,
    carta: { titulo: "Disputada", artista: "Y", anio: 1975 },
    resultado: {
      aciertoActivo: true, ganadorCarta: "eq1",
      intentos: [{ equipo: "eq2", slot: 2, correcto: false }],
      slotsValidos: [1],
    },
    esperandoBonus: false, siguientePedida: false, bonus: null, saltar: false, secreto: null,
  },
});
await esperar(40);
t("se ve la pantalla de revelado de la ronda fabricada", html().includes("ha acertado"));

await clic('[data-accion="abrirAyuda"]', "Abrir el botón de ayuda (rectificación)");
t("el botón de ayuda ofrece corregir el año", html().includes("Corregir el año"));
await clic('[data-accion="corregirAnio"]', "¿Año equivocado? (rectificación)");
document.getElementById("in-anio-correcto").value = "2010"; // el año real: va DESPUÉS de C2 (2000)
await clic('[data-accion="guardarAnio"]', "Guardar año corregido (rectificación)");
await esperar(40);

const salaRectificada = fb._leer(`salas/${codigoRectifica}`);
t("al equipo que la tenía mal (con el año viejo) se le quita la carta",
  !salaRectificada.equipos.eq1.cartas.some((c) => c.titulo === "Disputada"));
t("el equipo que había intentado robar y en realidad tenía razón se la queda",
  salaRectificada.equipos.eq2.cartas.some((c) => c.titulo === "Disputada" && c.anio === 2010));
t("el resultado de la ronda se rectifica: ya no acierta el equipo activo",
  salaRectificada.ronda.resultado.aciertoActivo === false);
t("el resultado de la ronda rectifica quién es el ganador",
  salaRectificada.ronda.resultado.ganadorCarta === "eq2");
t("la línea del equipo que pierde la carta sigue ordenada",
  salaRectificada.equipos.eq1.cartas.every((c, i, a) => !i || c.anio >= a[i - 1].anio));

fb._escribir(`salas/${codigoRectifica}`, null); // limpiar
await esperar(30); // el listener detecta que la sala desapareció y vuelve al inicio
t("al borrarse la sala fabricada, la app vuelve a la pantalla de inicio",
  html().includes("Crear partida nueva"));

// ------------------------------------------------------------
//  Solo el líder de un equipo (quien lo creó) puede jugar los turnos; el
//  resto de dispositivos de ese equipo solo pueden mirar y aportar Spotify.
// ------------------------------------------------------------
console.log("Comprobando que solo el líder del equipo puede jugar sus turnos…");
const codigoLider = "8080";
fb._escribir(`salas/${codigoLider}`, {
  fase: "lobby", hostCliente: "otro-host-lider", config: { mazo: "famosas" },
  equipos: {
    eq1: { id: "eq1", nombre: "Equipo Ajeno", color: COLORES_EQUIPO[0], orden: 0,
           lider: "el-lider-de-verdad", fichas: 3, cartas: [], miembros: { "el-lider-de-verdad": true } },
  },
  usadas: {}, aportes: {}, ronda: null, ganador: null,
});
await clic('[data-accion="irUnirse"]', "Unirse para probar permisos de líder");
document.getElementById("in-codigo").value = codigoLider;
await clic('[data-accion="buscarSala"]', "Buscar sala de permisos");
await clic('[data-accion="unirmeEquipo"]', "Unirme a Equipo Ajeno (no soy el líder)");

// Fabricamos una ronda en marcha para ese equipo, ya en pleno turno de colocar.
fb._escribir(`salas/${codigoLider}`, {
  fase: "jugando", hostCliente: "otro-host-lider", config: { mazo: "famosas" },
  equipos: {
    eq1: { id: "eq1", nombre: "Equipo Ajeno", color: COLORES_EQUIPO[0], orden: 0,
           lider: "el-lider-de-verdad", fichas: 3, cartas: [],
           miembros: { "el-lider-de-verdad": true, [miId]: true } },
  },
  usadas: {}, aportes: {}, ganador: null,
  ronda: {
    n: 1, equipoActivo: "eq1", subfase: "colocando",
    limite: Date.now() + 60000, colocacion: null, confirmada: false,
    robos: {}, turnoRobo: null, limiteRobo: 0,
    secreto: Net.ocultar({ titulo: "Secreta", artista: "Y", anio: 2001 }, codigoLider),
    carta: null, resultado: null, esperandoBonus: false, siguientePedida: false, saltar: false,
  },
});
await esperar(40);
t("como no soy el líder de mi equipo, no veo huecos para colocar la carta",
  document.querySelectorAll('[data-accion="hueco"]').length === 0);
t("se explica que solo quien creó el equipo puede colocar la carta",
  html().includes("Solo quien creó el equipo puede colocar la carta"));

await clic('[data-accion="abrirAyuda"]', "Abrir ayuda siendo no-líder");
t("sin ser líder ni anfitrión, no puedo saltar gratis ni corregir el año desde aquí",
  html().includes("Ahora mismo no hay nada que corregir"));
await clic('[data-accion="cerrarModal"]', "Cerrar ayuda");

await clic('[data-accion="salir"]', "Salir del equipo de prueba de permisos");
fb._escribir(`salas/${codigoLider}`, null);
await esperar(30);
t("al borrarse la sala de permisos, la app vuelve a la pantalla de inicio",
  html().includes("Crear partida nueva"));

// ------------------------------------------------------------
//  Aviso de "gana por dos" cuando el equipo que empezó llega a 10 con el
//  segundo a solo una carta (10-9).
// ------------------------------------------------------------
console.log('Comprobando el aviso de "gana por dos"…');
const codigoDesempate = "9090";
fb._escribir(`salas/${codigoDesempate}`, {
  fase: "lobby", hostCliente: "otro-host-desempate", config: { mazo: "famosas" },
  equipos: {
    eq1: { id: "eq1", nombre: "Los que Empezaron", color: COLORES_EQUIPO[0], orden: 0,
           fichas: 3, cartas: [], miembros: {} },
    eq2: { id: "eq2", nombre: "Los Retadores", color: COLORES_EQUIPO[1], orden: 1,
           fichas: 3, cartas: [], miembros: {} },
  },
  usadas: {}, aportes: {}, ronda: null, ganador: null,
});
await clic('[data-accion="irUnirse"]', "Unirse para probar el desempate");
document.getElementById("in-codigo").value = codigoDesempate;
await clic('[data-accion="buscarSala"]', "Buscar sala de desempate");
await clic('[data-accion="unirmeEquipo"]', "Unirme a Los que Empezaron");

const cartasDe = (n) => Array.from({ length: n }, (_, i) => ({ titulo: "c" + i, artista: "a", anio: 1970 + i }));
fb._escribir(`salas/${codigoDesempate}`, {
  fase: "jugando", hostCliente: "otro-host-desempate", config: { mazo: "famosas" }, primerEquipo: "eq1",
  equipos: {
    eq1: { id: "eq1", nombre: "Los que Empezaron", color: COLORES_EQUIPO[0], orden: 0,
           fichas: 3, cartas: cartasDe(AJUSTES.cartasParaGanar), miembros: { [miId]: true } },
    eq2: { id: "eq2", nombre: "Los Retadores", color: COLORES_EQUIPO[1], orden: 1,
           fichas: 3, cartas: cartasDe(AJUSTES.cartasParaGanar - 1), miembros: {} },
  },
  usadas: {}, ganador: null,
  ronda: {
    n: 1, equipoActivo: "eq2", subfase: "colocando",
    limite: Date.now() + 60000, colocacion: null, confirmada: false,
    robos: {}, turnoRobo: null, limiteRobo: 0,
    secreto: Net.ocultar({ titulo: "Otra", artista: "Z", anio: 2005 }, codigoDesempate),
    carta: null, resultado: null, esperandoBonus: false, siguientePedida: false, saltar: false,
  },
});
await esperar(40);
t('con 10-9 a favor de quien empezó, se avisa de "gana por dos"',
  html().includes("¡Gana por dos!"));
t("R.comprobarVictoria en ese mismo estado no da ganador todavía",
  R.comprobarVictoria(fb._leer(`salas/${codigoDesempate}`).equipos, "eq1") === null);

await clic('[data-accion="salir"]', "Salir de la sala de desempate");
fb._escribir(`salas/${codigoDesempate}`, null);
await esperar(30);
t("al borrarse la sala de desempate, la app vuelve a la pantalla de inicio",
  html().includes("Crear partida nueva"));

// ------------------------------------------------------------
//  Lista de canciones de Spotify aportadas, con opción de quitarlas.
// ------------------------------------------------------------
console.log("Comprobando la lista de canciones de Spotify aportadas…");
const codigoPool = "5050";
fb._escribir(`salas/${codigoPool}`, {
  fase: "lobby", hostCliente: "otro-host-pool", config: { mazo: "spotify" },
  equipos: {
    eq1: { id: "eq1", nombre: "Equipo Pool", color: COLORES_EQUIPO[0], orden: 0,
           fichas: 3, cartas: [], miembros: {} },
  },
  usadas: {},
  aportes: {
    persona1: { nombre: "Persona Uno", canciones: [
      { titulo: "Canción Rara De Verdad", artista: "Artista Raro", anio: 1988, uri: "u-rara", peso: 1 },
    ] },
    persona2: { nombre: "Persona Dos", canciones: [
      { titulo: "Otra Canción", artista: "Otro Artista", anio: 2015, uri: "u-otra", peso: 1 },
    ] },
  },
  bloqueadas: {}, ronda: null, ganador: null,
});
await clic('[data-accion="irUnirse"]', "Unirse para probar la lista de canciones");
document.getElementById("in-codigo").value = codigoPool;
await clic('[data-accion="buscarSala"]', "Buscar sala de canciones");
await clic('[data-accion="unirmeEquipo"]', "Unirme a Equipo Pool");
await esperar(30);

t("en el lobby aparece el botón para ver/quitar canciones aportadas",
  !!document.querySelector('[data-accion="verCancionesPool"]'));
await clic('[data-accion="verCancionesPool"]', "Ver canciones de Spotify aportadas");
t("la lista muestra título y artista de cada canción",
  html().includes("Canción Rara De Verdad — Artista Raro") && html().includes("Otra Canción — Otro Artista"));
t("la lista NO muestra el año de las canciones", !html().includes("1988") && !html().includes("2015"));
t("la lista NO dice quién aportó cada canción", !html().includes("Persona Uno") && !html().includes("Persona Dos"));

await clic('[data-accion="quitarCancionPool"]', "Quitar una canción de la lista (la primera con ✕)");
await esperar(30);
const salaPool = fb._leer(`salas/${codigoPool}`);
t("al quitar una canción, queda marcada como bloqueada en la sala",
  Object.keys(salaPool.bloqueadas || {}).length === 1);
const poolTrasQuitar = App.poolComunitario(salaPool);
t("la canción quitada ya no aparece en el pool comunitario", poolTrasQuitar.length === 1);
t("y la que sigue en la lista es la que no se quitó",
  poolTrasQuitar[0]?.titulo === "Otra Canción");

await clic('[data-accion="cerrarModal"]', "Cerrar la lista de canciones");
await clic('[data-accion="salir"]', "Salir de la sala de canciones");
fb._escribir(`salas/${codigoPool}`, null);
await esperar(30);
t("al borrarse la sala de canciones, la app vuelve a la pantalla de inicio",
  html().includes("Crear partida nueva"));

// ------------------------------------------------------------
//  Ahora sí, la partida real de principio a fin.
// ------------------------------------------------------------
await clic('[data-accion="irCrear"]', "Crear partida");
t("la pantalla de crear detecta la sesión de Spotify", html().includes("Spotify conectado"));

$("#in-nombre").value = "Los Abuelos";
await clic('[data-accion="crearPartida"]', "Crear partida");

const codigo = Object.keys(fb._leer("salas") || {})[0];
t("se ha creado una sala con código de 4 dígitos", /^\d{4}$/.test(codigo || ""));
t("el lobby muestra el código", html().includes(codigo));
sinErrores("lobby");

// Entran otros dos equipos desde sus propios dispositivos.
for (const [i, nombre] of [[1, "Los Primos"], [2, "Los Peques"]]) {
  fb._escribir(`salas/${codigo}/equipos/eq${i + 1}`, {
    id: "eq" + (i + 1), nombre, color: COLORES_EQUIPO[i], orden: i,
    fichas: AJUSTES.fichasIniciales, cartas: [], miembros: { ["cliente" + i]: true },
  });
}
await esperar(25);
t("el lobby lista los tres equipos", html().includes("Los Primos") && html().includes("Los Peques"));
t("ya no se pide elegir altavoz: se usa el dispositivo activo de Spotify por defecto",
  !document.querySelector('[data-accion="buscarDispositivos"]'));

await clic('[data-accion="empezar"]', "Empezar la partida");
await esperar(120);

const estado0 = fb._leer("salas/" + codigo);
t("la partida ha empezado", estado0.fase === "jugando");
t("cada equipo empieza con una carta",
  Object.values(estado0.equipos).every((e) => (e.cartas || []).length === 1));
t("cada equipo empieza con 3 fichas",
  Object.values(estado0.equipos).every((e) => e.fichas === AJUSTES.fichasIniciales));
t("ha sonado una canción", llamadas.play >= 1);
sinErrores("inicio de partida");

// ------------------------------------------------------------
//  Bucle de juego
// ------------------------------------------------------------
const MI = "eq1";
let vueltas = 0, rondasJugadas = 0, misTurnos = 0, filtraciones2 = 0,
    revelados = 0, robosHechos = 0, saltosHechos = 0, saltosGratisHechos = 0,
    filtraciones = 0, corregidoUnaVez = false, reintentadoUnaVez = false;

const rondasVistas = new Set();
const est = () => fb._leer("salas/" + codigo);

while (est().fase === "jugando" && vueltas++ < 2500) {
  const E = est();
  const r = E.ronda;
  if (!r) { await esperar(20); continue; }
  const activo = r.equipoActivo;
  const timeline = R.ordenar(E.equipos[activo].cartas || []);
  const secreto = r.secreto ? Net.revelar(r.secreto, codigo) : null;

  // La carta boca abajo NO debe filtrar ni el año ni el título en la pantalla.
  if (secreto && (r.subfase === "colocando" || r.subfase === "robando")) {
    const pantalla = html();
    // (el año y el artista pueden repetirse con cartas ya ganadas; el título
    // normalmente no, salvo el rarísimo caso de dos canciones distintas con
    // el mismo título pero artista diferente ya colocadas en algún tablero
    // —pasa una vez en el mazo curado ("Bailando")—, que no cuenta como fuga).
    const yaColocado = Object.values(E.equipos)
      .some((eq) => (eq.cartas || []).some((c) => c.titulo === secreto.titulo));
    if (!yaColocado && pantalla.includes(secreto.titulo)) filtraciones++;
  }

  if (r.subfase === "colocando") {
    rondasJugadas++;
    if (activo === MI) {
      // Una vez, como anfitrión, probamos "Reintentar reproducir" desde el
      // botón de ayuda (por si Spotify no tenía ningún dispositivo activo).
      if (!reintentadoUnaVez) {
        reintentadoUnaVez = true;
        const playsAntes = llamadas.play;
        await clic('[data-accion="abrirAyuda"]', "Abrir ayuda para reintentar reproducir");
        t('el botón de ayuda ofrece "Reintentar reproducir" mientras suena la canción',
          !!document.querySelector('[data-accion="reintentarSonar"]'));
        await clic('[data-accion="reintentarSonar"]', "Reintentar reproducir");
        await esperar(20);
        t("reintentar reproducir vuelve a llamar a Spotify", llamadas.play > playsAntes);
        sinErrores("tras reintentar reproducir");
      }
      // De vez en cuando saltamos la canción para ejercitar esa regla.
      misTurnos++;
      if (E.equipos[MI].fichas >= AJUSTES.fichasParaSaltar && misTurnos === 1) {
        saltosHechos++;
        await clic('[data-accion="saltar"]', "Saltar canción");
        await esperar(30);
        t('al saltar (pagando fichas) se ve antes la carta boca arriba 5s',
          html().includes("Esta era la canción"));
        continue; // el motor cambiará de canción solo, pasados esos 5s reales
      }
      // Otra vez, probamos el salto gratis (canción rota/errónea) desde el
      // botón de ayuda: no debe gastar fichas, y también debe enseñar antes
      // la carta.
      if (misTurnos === 2) {
        const fichasAntes = E.equipos[MI].fichas;
        await clic('[data-accion="abrirAyuda"]', "Abrir ayuda para saltar gratis");
        await clic('[data-accion="saltarGratis"]', "Cambiar canción gratis");
        await esperar(30);
        saltosGratisHechos++;
        t("saltar la canción gratis no gasta fichas", est().equipos[MI].fichas === fichasAntes);
        t('el salto gratis también enseña la carta antes de cambiarla',
          html().includes("Esta era la canción"));
        continue;
      }
      const huecos = [...document.querySelectorAll('[data-accion="hueco"]')];
      t("hay un hueco por cada posición posible", huecos.length === timeline.length + 1);
      // Acertamos la mitad de las veces (y no solo un tercio): con partidas
      // de hasta 3 equipos, un acierto demasiado bajo hace que algunas
      // partidas simuladas tarden muchísimas rondas en converger por pura
      // varianza — no es un problema del juego, es de esta prueba.
      const buenosMI = R.slotsValidos(timeline, secreto.anio);
      const idxMI = (rondasJugadas % 2 === 0 && buenosMI.length) ? buenosMI[0] : rondasJugadas % huecos.length;
      const elegido = huecos[idxMI];
      elegido.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await esperar(8);
      await clic('[data-accion="finalizar"]', "Finalizar");
    } else {
      // Otro equipo coloca desde su dispositivo. Igual que arriba: acierta
      // la mitad de las veces para que las partidas converjan con fiabilidad.
      const buenos = R.slotsValidos(timeline, secreto.anio);
      const slot = rondasJugadas % 2 === 0 && buenos.length
        ? buenos[0] : rondasJugadas % (timeline.length + 1);
      await fb.update(fb.ref(null, `salas/${codigo}/ronda`), { colocacion: slot, confirmada: true });
    }
    await esperar(15);
    continue;
  }

  if (r.subfase === "robando") {
    const turno = r.turnoRobo;
    if (!turno) { await esperar(12); continue; }
    if (turno === MI) {
      const huecos = [...document.querySelectorAll('[data-accion="hueco"]')];
      if (huecos.length && E.equipos[MI].fichas >= 1 && rondasJugadas % 2 === 0) {
        huecos[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await esperar(8);
        robosHechos++;
        await clic('[data-accion="robar"]', "Robar");
      } else {
        await clic('[data-accion="pasarRobo"]', "Pasar");
      }
    } else {
      const ocupados = R.slotsOcupados(r);
      const libres = [];
      for (let i = 0; i <= timeline.length; i++) if (!ocupados.has(i)) libres.push(i);
      const roba = E.equipos[turno].fichas >= 1 && libres.length && rondasJugadas % 3 !== 0;
      fb._escribir(`salas/${codigo}/ronda/robos/${turno}`, roba ? libres[0] : "pasa");
    }
    await esperar(15);
    continue;
  }

  if (r.subfase === "revelado") {
    if (!rondasVistas.has(r.n)) { rondasVistas.add(r.n); revelados++; }
    const carta = r.carta || {};
    const res = r.resultado || {};

    // Comprobaciones de coherencia del resultado.
    const esperado = R.slotValido(timeline, carta.anio, r.colocacion);
    t("el acierto del equipo activo se calcula bien", res.aciertoActivo === esperado);
    if (res.aciertoActivo) t("si acierta, se queda la carta", res.ganadorCarta === activo);
    if (res.ganadorCarta) {
      const tl = est().equipos[res.ganadorCarta].cartas.map((c) => c.anio);
      t("la línea del ganador sigue ordenada", tl.every((a, i) => !i || a >= tl[i - 1]));
    }
    t("la pantalla de revelado muestra el año", html().includes(String(carta.anio)));

    // Una vez, comprobamos que el botón de corregir el año funciona en plena
    // partida (la rectificación de quién gana ya se comprueba a fondo, con un
    // caso controlado, más arriba). Aquí solo miramos que no rompa nada.
    if (!corregidoUnaVez && res.ganadorCarta) {
      corregidoUnaVez = true;
      const anioNuevo = carta.anio === 1975 ? 1976 : 1975;
      await clic('[data-accion="abrirAyuda"]', "Abrir el botón de ayuda");
      await clic('[data-accion="corregirAnio"]', "¿Año equivocado?");
      t("se abre el modal de corregir el año", html().includes("Corregir el año"));
      document.getElementById("in-anio-correcto").value = String(anioNuevo);
      await clic('[data-accion="guardarAnio"]', "Guardar año corregido");
      await esperar(40);
      sinErrores("tras corregir el año en plena partida");
      // El resultado puede haber cambiado de dueño; comprobamos que, sea quien
      // sea el ganador ahora, todas las líneas del tiempo siguen bien ordenadas
      // y la canción disputada aparece en, como mucho, un único equipo.
      const equiposTrasCorregir = est().equipos;
      for (const eq of Object.values(equiposTrasCorregir)) {
        const anios = eq.cartas.map((c) => c.anio);
        t("cada línea del tiempo sigue ordenada tras corregir el año en plena partida",
          anios.every((a, i) => !i || a >= anios[i - 1]));
      }
      const dueños = Object.values(equiposTrasCorregir)
        .filter((eq) => eq.cartas.some((c) => c.titulo === carta.titulo && c.artista === carta.artista));
      t("la canción corregida no queda duplicada en más de un equipo", dueños.length <= 1);
    }

    // Una vez, durante la partida, abrimos el panel de "Otros equipos".
    if (revelados === 2) {
      await clic('[data-accion="verOtros"]', "Otros equipos");
      t("el panel de otros equipos se abre", html().includes("Otros equipos"));
      t("el panel deja elegir entre los otros dos equipos",
        html().includes("Los Primos") && html().includes("Los Peques"));
      await clic('[data-accion="verEquipo"]', "Ver equipo");
      await clic('[data-accion="cerrarModal"]', "Cerrar panel");
    }

    if (r.esperandoBonus) {
      if (activo === MI) {
        await clic('[data-accion="bonus"]', "Pregunta extra");
      } else {
        const eq = est().equipos[activo];
        fb._escribir(`salas/${codigo}/ronda/esperandoBonus`, false);
        fb._escribir(`salas/${codigo}/equipos/${activo}/fichas`, R.sumarFicha(eq));
      }
      await esperar(15);
      continue;
    }

    sinErrores("revelado");
    await clic('[data-accion="siguiente"]', "Siguiente ronda");
    await esperar(28);
    continue;
  }

  await esperar(20);
}

// ------------------------------------------------------------
const fin = est();
t("la partida termina", fin.fase === "fin");
t("hay un equipo ganador", !!fin.ganador);
t("el ganador tiene 10 cartas",
  (fin.equipos[fin.ganador]?.cartas || []).length >= AJUSTES.cartasParaGanar);
t("la pantalla final anuncia al ganador",
  html().includes("Ganan") && html().includes(fin.equipos[fin.ganador].nombre));
t("las fichas nunca se salen de rango",
  Object.values(fin.equipos).every((e) => e.fichas >= 0 && e.fichas <= AJUSTES.fichasMaximas));
t("todas las líneas del tiempo quedan ordenadas",
  Object.values(fin.equipos).every((e) => {
    const a = e.cartas.map((c) => c.anio);
    return a.every((v, i) => !i || v >= a[i - 1]);
  }));
t("ninguna canción se repite entre equipos", (() => {
  const todas = Object.values(fin.equipos).flatMap((e) => e.cartas.map((c) => c.titulo + c.artista));
  return new Set(todas).size === todas.length;
})());
t("la carta boca abajo nunca filtró el título de la canción", filtraciones === 0);
t("se ejercitó el robo al menos una vez", robosHechos > 0);
t("se ejercitó el salto de canción", saltosHechos > 0);
t("se ejercitó el salto gratis de canción", saltosGratisHechos > 0);
t("se buscó cada canción en Spotify", llamadas.search > 10);
t("se pausó la música al revelar", llamadas.pause >= revelados - 1);

console.log(`  ${revelados} rondas reveladas · ${robosHechos} robos · ${saltosHechos} saltos · ` +
            `ganador: ${fin.equipos[fin.ganador]?.nombre}`);

// La pantalla final muestra la línea del tiempo de todos los equipos.
t("la pantalla final muestra las tres líneas del tiempo",
  document.querySelectorAll(".linea").length === 3);

await clic('[data-accion="otraPartida"]', "Jugar otra vez");
t("se puede volver al lobby", est().fase === "lobby");
t("al reiniciar se reparten fichas y se vacían las cartas",
  Object.values(est().equipos).every(
    (e) => e.fichas === AJUSTES.fichasIniciales && (e.cartas || []).length === 0));

console.log(`\n${fallos === 0 ? "✓ PARTIDA COMPLETA SIN FALLOS" : "✗ " + fallos + " FALLOS"}\n`);
process.exit(fallos ? 1 : 0);
