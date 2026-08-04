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
  clientId: "client_id_de_pruebas",
}));

// ---------- arrancamos la app ----------
const fb = await import("./stubs/firebase.mjs");
const Net = await import("../js/net.js");
const R = await import("../js/reglas.js");
const Ui = await import("../js/ui.js");
// Importante: importamos config.js por esta misma ruta (el doble de prueba),
// no como "../js/config.js": los módulos reales (app.js, spotify.js) reciben
// config.js REDIRIGIDO a este doble (ver test/hooks.mjs), y así nos
// aseguramos de ver exactamente los mismos valores que ellos.
const { AJUSTES, COLORES_EQUIPO, SPOTIFY_CLIENT_IDS_SEMILLA } = await import("./stubs/config.mjs");
const App = await import("../js/app.js");
await esperar(20);

// Las apps de Spotify ya no se hardcodean: viven en Firebase, y se rellenan
// con lo que hubiera en config.js SOLO la primera vez (base de datos vacía).
// Con el stub de Firebase arrancando siempre en blanco, esta migración
// automática debe haber ocurrido nada más arrancar la app.
t("al arrancar con Firebase vacío, se siembra la semilla de config.js como primera app de Spotify",
  Sp.appsSpotify().some((a) => a.id === SPOTIFY_CLIENT_IDS_SEMILLA[0].id));
t("la semilla queda guardada de verdad en Firebase, no solo en memoria",
  fb._leer(`spotifyApps/${SPOTIFY_CLIENT_IDS_SEMILLA[0].id}`)?.nombre === SPOTIFY_CLIENT_IDS_SEMILLA[0].nombre);

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
  aporte?.canciones.find((c) => c.uri === "spotify:track:top-b")?.peso === 2);
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

localStorage.setItem("hitster_spotify_token", JSON.stringify({
  ...tokenCompleto,
  alcance: "user-library-read playlist-read-private user-read-recently-played", // falta user-top-read
}));
t("a 'user-top-read' NO se le exige: sin él no hace falta reconectar (el top no es imprescindible, "
  + "se usan playlists/guardadas/recientes igual)",
  Sp.faltanPermisos() === false);

localStorage.setItem("hitster_spotify_token", JSON.stringify(tokenCompleto)); // restauramos para el resto de pruebas
t("con todos los permisos concedidos, no hace falta reconectar", Sp.faltanPermisos() === false);

// ------------------------------------------------------------
//  Si alguien ya había aceptado esta app en Spotify alguna vez, por defecto
//  Spotify le manda de vuelta al instante sin enseñarle la pantalla de
//  permisos — así que si le faltaba un permiso nuevo, nunca tendría manera
//  de concedérselo (el "reconectar" no serviría de nada). Por eso el login
//  siempre debe forzar que se vea esa pantalla.
// ------------------------------------------------------------
console.log("Comprobando que el login a Spotify siempre fuerza ver la pantalla de permisos…");
{
  const locationDeVerdad = globalThis.location;
  globalThis.location = { href: "", origin: "https://ejemplo.github.io", pathname: "/hitster/" };
  await Sp.iniciarLogin();
  const urlGenerada = globalThis.location.href;
  globalThis.location = locationDeVerdad;

  t("el login a Spotify pide 'show_dialog=true' (si no, quien ya había aceptado antes no vería "
    + "la pantalla de permisos y no podría conceder uno nuevo)",
    urlGenerada.includes("show_dialog=true"));
}

// ------------------------------------------------------------
//  Con varias apps de Spotify configuradas (para no toparse con el límite de
//  5 usuarios por app), iniciarLogin debe poder usar la que se le pida, y
//  acordarse de con cuál para canjear el código después.
// ------------------------------------------------------------
console.log("Comprobando que se puede elegir con qué Client ID conectar (varias apps de Spotify)…");
{
  const locationDeVerdad = globalThis.location;
  globalThis.location = { href: "", origin: "https://ejemplo.github.io", pathname: "/hitster/" };
  await Sp.iniciarLogin("client-id-grupo-b");
  const urlGenerada = globalThis.location.href;
  const clienteGuardado = sessionStorage.getItem("hitster_spotify_client");
  globalThis.location = locationDeVerdad;

  t("iniciarLogin acepta un Client ID concreto y lo manda en la URL de autorización",
    urlGenerada.includes("client_id=client-id-grupo-b"));
  t("se recuerda con qué Client ID nos fuimos, para canjear el código con el mismo",
    clienteGuardado === "client-id-grupo-b");
}

// ------------------------------------------------------------
//  Si hay más de una app configurada, no debe preguntarse nada: se prueba la
//  primera y, si esa cuenta no está autorizada ahí, se reintenta sola con la
//  siguiente. Aquí probamos directamente las piezas de ese mecanismo
//  (siguienteAppSinProbar/marcarIntentado vía iniciarLogin/limpiarIntentados
//  y verificarAcceso), sin pasar por toda la interfaz.
// ------------------------------------------------------------
console.log("Comprobando el reintento automático entre varias apps de Spotify (sin preguntar nada)…");
{
  // Ya no se hardcodean en config.js: se guardan en Firebase, y app.js las
  // carga con Sp.fijarAppsSpotify (ver init()). Aquí simulamos que ya hay
  // una segunda app registrada, tal y como quedaría tras usar el botón
  // "¿Nunca has jugado con tus canciones?".
  const appsOriginales = Sp.appsSpotify();
  Sp.fijarAppsSpotify([...appsOriginales, { id: "client-id-grupo-b", nombre: "Grupo B" }]);
  sessionStorage.removeItem("hitster_spotify_intentados");

  t("sin haber probado ninguna app todavía, la siguiente sin probar es la primera configurada",
    Sp.siguienteAppSinProbar() === appsOriginales[0].id);

  const locationDeVerdad = globalThis.location;
  globalThis.location = { href: "", origin: "https://ejemplo.github.io", pathname: "/hitster/" };
  await Sp.iniciarLogin(); // sin indicar cuál: debe coger la primera sin probar y marcarla
  globalThis.location = locationDeVerdad;

  t("tras probar la primera app (sin indicarla), la siguiente sin probar es la segunda (Grupo B)",
    Sp.siguienteAppSinProbar() === "client-id-grupo-b");

  globalThis.location = { href: "", origin: "https://ejemplo.github.io", pathname: "/hitster/" };
  await Sp.iniciarLogin(); // ahora debe coger automáticamente la segunda (Grupo B), sin que nadie elija
  const urlGenerada = globalThis.location.href;
  globalThis.location = locationDeVerdad;
  t("tras agotar la primera, iniciarLogin() sin argumento usa sola la siguiente sin preguntar nada",
    urlGenerada.includes("client_id=client-id-grupo-b"));

  t("una vez probadas las dos apps configuradas, ya no queda ninguna más por probar",
    Sp.siguienteAppSinProbar() === null);

  Sp.limpiarIntentados();
  t("al limpiar los intentos (login que sí funcionó), se vuelve a empezar por la primera",
    Sp.siguienteAppSinProbar() === appsOriginales[0].id);

  Sp.fijarAppsSpotify(appsOriginales); // restauramos: solo la(s) app(s) original(es), como espera el resto de pruebas
  sessionStorage.removeItem("hitster_spotify_intentados");
}

console.log("Comprobando verificarAcceso() (distingue 'cuenta no autorizada en esta app' de otros fallos)…");
{
  const fetchDeVerdad = globalThis.fetch;
  const tokenGuardado = localStorage.getItem("hitster_spotify_token");
  localStorage.setItem("hitster_spotify_token", JSON.stringify({
    access_token: "tok", refresh_token: "ref", expira: Date.now() + 3600000,
    alcance: Sp.SCOPES, clientId: Sp.appsSpotify()[0]?.id,
  }));

  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => "Forbidden" });
  t("verificarAcceso() devuelve false si /me responde 403 (cuenta no autorizada en esta app)",
    (await Sp.verificarAcceso()) === false);

  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => "Unauthorized" });
  t("verificarAcceso() devuelve false también con 401",
    (await Sp.verificarAcceso()) === false);

  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: "yo" }) });
  t("verificarAcceso() devuelve true si /me responde bien",
    (await Sp.verificarAcceso()) === true);

  let lanzo = false;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "Error del servidor" });
  try { await Sp.verificarAcceso(); } catch { lanzo = true; }
  t("verificarAcceso() deja subir otros errores (no 401/403) tal cual, no los confunde con 'no autorizado'",
    lanzo);

  globalThis.fetch = fetchDeVerdad;
  localStorage.setItem("hitster_spotify_token", tokenGuardado);
}

// ------------------------------------------------------------
//  Botón "¿Nunca has jugado con tus canciones?": cualquiera puede registrar
//  su propia app de Spotify desde dentro del juego (sin tocar config.js), y
//  queda guardada en Firebase para todo el mundo. Lo probamos desde el
//  lobby, con la sesión de Spotify temporalmente vacía para que aparezca el
//  botón (igual que le pasaría a alguien que nunca ha conectado nada).
// ------------------------------------------------------------
console.log("Comprobando el alta de una nueva app de Spotify (self-service) desde el lobby…");
{
  const tokenGuardado = localStorage.getItem("hitster_spotify_token");
  const codigoAlta = "7171";
  fb._escribir(`salas/${codigoAlta}`, {
    fase: "lobby", hostCliente: "otro-host-alta", config: { mazo: "spotify" },
    equipos: {
      eq1: { id: "eq1", nombre: "Equipo Alta", color: COLORES_EQUIPO[0], orden: 0,
             fichas: 3, cartas: [], miembros: {} },
    },
    usadas: {}, aportes: {}, ronda: null, ganador: null,
  });
  await clic('[data-accion="irUnirse"]', "Unirse para probar el alta de app de Spotify");
  document.getElementById("in-codigo").value = codigoAlta;
  await clic('[data-accion="buscarSala"]', "Buscar sala de alta de app");
  await clic('[data-accion="unirmeEquipo"]', "Unirme a Equipo Alta");

  // Sin sesión de Spotify (como si nunca hubiéramos conectado nada). El
  // lobby calcula el botón a mostrar leyendo Sp.haySesion() en cada render,
  // así que basta con forzar un re-render (reescribiendo la sala tal cual)
  // para que se refleje, sin tocar nada del estado interno de la app.
  localStorage.removeItem("hitster_spotify_token");
  fb._escribir(`salas/${codigoAlta}`, fb._leer(`salas/${codigoAlta}`));
  await esperar(20);

  t("sin sesión de Spotify, el lobby ofrece el botón para dar de alta una app propia",
    !!$('[data-accion="abrirAnadirSpotifyApp"]'));

  await clic('[data-accion="abrirAnadirSpotifyApp"]', "Abrir instrucciones para añadir una app de Spotify");
  t("las instrucciones muestran el Redirect URI exacto de esta web (el que hay que pegar en Spotify)",
    html().includes(Sp.redirectUri()));

  await clic('[data-accion="guardarAppSpotify"]', "Intentar guardar sin rellenar nada");
  t("si el Client ID no tiene pinta de serlo (32 letras/números), se avisa y no se guarda nada",
    html().includes("no tiene la pinta"));

  document.getElementById("in-spotify-clientid").value = "0123456789abcdef0123456789abcdef";
  await clic('[data-accion="guardarAppSpotify"]', "Guardar sin ponerle nombre a la app");
  t("hace falta ponerle un nombre a la app antes de guardarla", html().includes("Ponle un nombre"));

  // Ojo: cada click re-renderiza el modal entero (app.innerHTML), así que los
  // valores escritos antes se pierden — hay que rellenar ambos campos otra
  // vez justo antes del envío que sí debe funcionar.
  document.getElementById("in-spotify-clientid").value = "0123456789abcdef0123456789abcdef";
  document.getElementById("in-spotify-nombre").value = "Familia de Pruebas";
  await clic('[data-accion="guardarAppSpotify"]', "Guardar la nueva app de Spotify");
  t("la nueva app queda guardada de verdad en Firebase, para toda la familia",
    fb._leer("spotifyApps/0123456789abcdef0123456789abcdef")?.nombre === "Familia de Pruebas");
  t("tras guardarla con éxito, el modal se cierra", !html().includes("Añadir esta app"));
  t("la nueva app ya está disponible al instante para el reintento automático (sin recargar nada)",
    Sp.appsSpotify().some((a) => a.id === "0123456789abcdef0123456789abcdef"));

  // Limpieza: quitamos la app de prueba, restauramos la sesión y salimos.
  fb._escribir("spotifyApps/0123456789abcdef0123456789abcdef", null);
  localStorage.setItem("hitster_spotify_token", tokenGuardado);
  await clic('[data-accion="salir"]', "Salir de la sala de alta de app");
  fb._escribir(`salas/${codigoAlta}`, null);
  await esperar(30);
  t("al borrarse la sala de alta de app, la app vuelve a la pantalla de inicio",
    html().includes("Crear partida nueva"));
}

// ------------------------------------------------------------
//  Si falla justo el "top" de Spotify (sin permiso, o cualquier otro motivo),
//  no debe impedir aportar: se usan igual las demás fuentes (recientes,
//  guardadas, playlists), sin lanzar ningún error.
// ------------------------------------------------------------
console.log("Comprobando que sin el 'top' de Spotify se puede aportar igual (se usan las demás fuentes)…");
{
  const fetchDeVerdad = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj), json: async () => obj });
    if (u.includes("/v1/me/top/tracks")) {
      return {
        ok: false, status: 403, statusText: "Forbidden",
        text: async () => JSON.stringify({ error: { message: "Insufficient client scope" } }),
      };
    }
    if (u.includes("/v1/me/player/recently-played"))
      return json({ items: [{ track: pista("spotify:track:sin-top-1", "Sin permiso de top", 2015) }] });
    if (u.includes("/v1/me/tracks")) return json({ items: [] });
    if (u.includes("/v1/playlists/plx/tracks"))
      return json({ items: [{ track: pista("spotify:track:sin-top-2", "De una playlist", 2019) }] });
    if (u.includes("/v1/me/playlists")) return json({ items: [{ id: "plx", owner: { id: "mi-id-de-prueba" } }] });
    if (u.includes("/v1/me")) return json({ id: "mi-id-de-prueba" });
    return json({});
  };
  let resultado = null, error = null;
  try { resultado = await Sp.misCancionesFavoritas(); } catch (e) { error = e; }
  globalThis.fetch = fetchDeVerdad;

  t("sin permiso de 'top', si las demás fuentes sí traen canciones, no se lanza ningún error",
    error === null);
  t("las canciones de recientes y playlists se aprovechan igual, sin depender del 'top'",
    resultado?.some((c) => c.uri === "spotify:track:sin-top-1")
    && resultado?.some((c) => c.uri === "spotify:track:sin-top-2"));
}

// ------------------------------------------------------------
//  Si TODAS las fuentes de Spotify responden sin error de permisos pero
//  ninguna trae canciones aprovechables, la app ya no dice sin más "no tienes
//  historial": lanza un error con detalle de qué pasó en cada fuente, para
//  poder diagnosticar en vez de adivinar (p. ej. distinguir "0 de verdad" de
//  un límite de peticiones de Spotify).
// ------------------------------------------------------------
console.log("Comprobando el diagnóstico cuando Spotify no devuelve canciones aprovechables…");
{
  const fetchDeVerdad = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj), json: async () => obj });
    if (u.includes("/v1/me/top/tracks")) return json({ items: [] });
    if (u.includes("/v1/me/player/recently-played")) return json({ items: [] });
    if (u.includes("/v1/me/tracks")) return json({ items: [] });
    if (u.includes("/v1/me/playlists")) return json({ items: [] });
    if (u.includes("/v1/me")) return json({ id: "mi-id-de-prueba" });
    return json({});
  };
  let error = null;
  try { await Sp.misCancionesFavoritas(); } catch (e) { error = e; }
  globalThis.fetch = fetchDeVerdad;

  t("si ninguna fuente trae canciones (pero tampoco da error de permisos), se lanza un error",
    error?.tipo === "vacio");
  t("el error de 'vacío' trae un detalle legible con las 5 fuentes probadas",
    ["top largo plazo", "top medio plazo", "reproducidas recientemente", "guardadas", "playlists propias"]
      .every((etiqueta) => (error?.detalle || "").includes(etiqueta)));
}

// ------------------------------------------------------------
//  Si Spotify (o algo de por medio: un proxy, un filtro de red, un
//  bloqueador de anuncios…) responde con texto que no es JSON de verdad, el
//  error ya no se queda en un misterioso "Unexpected token": se ve el código
//  real y un trozo del texto, para poder diagnosticarlo de un vistazo.
// ------------------------------------------------------------
console.log("Comprobando que una respuesta no-JSON de Spotify se explica con claridad…");
{
  const fetchDeVerdad = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false, status: 503, statusText: "Service Unavailable",
    text: async () => "The service you requested is temporarily unavailable.",
  });
  let error = null;
  try { await Sp.misCancionesFavoritas(); } catch (e) { error = e; }
  globalThis.fetch = fetchDeVerdad;

  t("una respuesta no-JSON de Spotify muestra el código real y un trozo del texto, no un 'Unexpected token'",
    (error?.detalle || "").includes("503") && (error?.detalle || "").includes("temporarily unavailable"));
}

// ------------------------------------------------------------
//  Si la red falla del todo (tiempo agotado, sin conexión…), la app ya no se
//  queda "Leyendo tus canciones…" colgada minutos enteros: al primer fallo de
//  red se corta y no se sigue intentando fuente a fuente sin sentido.
// ------------------------------------------------------------
console.log("Comprobando que un fallo de red no deja la app colgada…");
{
  const fetchDeVerdad = globalThis.fetch;
  let llamadasDeRed = 0;
  globalThis.fetch = async () => {
    llamadasDeRed++;
    const e = new Error("simulación de fallo de red");
    e.name = "AbortError"; // así es como se ve un fetch() cortado por el límite de tiempo
    throw e;
  };
  const inicio = Date.now();
  let error = null;
  try { await Sp.misCancionesFavoritas(); } catch (e) { error = e; }
  const duracion = Date.now() - inicio;
  globalThis.fetch = fetchDeVerdad;

  t("un fallo de red se detecta como tal, no como 'sin canciones'", error?.tipo === "red");
  t("al fallar la red en la primera fuente, no se sigue intentando el resto sin sentido",
    llamadasDeRed === 1);
  t("el fallo de red se resuelve rápido, sin quedarse colgado", duracion < 2000);
}

// ------------------------------------------------------------
//  Empates de año: el hueco de en medio entre dos cartas del mismo año no
//  hace falta ofrecerlo (vale igual justo antes o justo después), y un robo
//  correcto que pierde la carta por prioridad del equipo activo no debe
//  costar la ficha (los dos bugs que reportó el usuario).
// ------------------------------------------------------------
console.log("Comprobando los empates de año (hueco redundante y ficha no perdida)…");

const timelineEmpate = [
  { titulo: "Antes", artista: "A", anio: 1990 },
  { titulo: "Igual 1", artista: "B", anio: 2000 },
  { titulo: "Igual 2", artista: "C", anio: 2000 },
  { titulo: "Después", artista: "D", anio: 2010 },
];
const htmlEmpate = Ui.htmlLinea(timelineEmpate, {
  elegibles: new Set(Array.from({ length: timelineEmpate.length + 1 }, (_, i) => i)),
});
const domEmpate = new JSDOM(`<div id="e">${htmlEmpate}</div>`).window.document;
const huecosEmpate = [...domEmpate.querySelectorAll('[data-accion="hueco"]')];
t("el hueco entre dos cartas del mismo año no se ofrece como opción",
  !huecosEmpate.some((h) => Number(h.dataset.slot) === 2));
t("pero los huecos antes y después de esa pareja siguen ahí",
  huecosEmpate.some((h) => Number(h.dataset.slot) === 1) && huecosEmpate.some((h) => Number(h.dataset.slot) === 3));
t("el resto de huecos (sin empate) se ofrecen todos con normalidad",
  huecosEmpate.length === timelineEmpate.length + 1 - 1); // 5 posibles - 1 redundante

// Si sí hay algo real que mostrar ahí (una marca de la ronda ya tomada), el
// hueco no desaparece del todo, aunque sea uno "redundante".
const htmlEmpateConMarca = Ui.htmlLinea(timelineEmpate, { marcas: { 2: { texto: "★", sub: "Equipo" } } });
t("si ya hay una marca puesta en el hueco redundante, se sigue viendo",
  htmlEmpateConMarca.includes("★"));

// Robo correcto que pierde la carta por prioridad del activo: no cuesta ficha.
const equiposRoboEmpate = {
  activo: { cartas: [{ titulo: "Igual 1", artista: "B", anio: 2000 }], fichas: 3 },
  ladron: { cartas: [], fichas: 3 },
};
const rondaRoboEmpate = { equipoActivo: "activo", colocacion: 1, robos: { ladron: 0 } };
// colocacion:1 = después de "Igual 1" (2000); robos.ladron slot:0 = antes de
// "Igual 1". La carta secreta también es de 2000: por la regla de empates,
// AMBOS huecos son correctos.
const resRoboEmpate = R.resolverRonda({ equipos: equiposRoboEmpate, ronda: rondaRoboEmpate, anioCarta: 2000 });
t("con empate de años, el equipo activo se queda la carta (tiene prioridad)",
  resRoboEmpate.ganadorCarta === "activo");
t("el intento de robo se registra como correcto (también tenía razón)",
  resRoboEmpate.intentos.find((i) => i.equipo === "ladron")?.correcto === true);
t("y por eso NO pierde la ficha, aunque no se quede la carta",
  resRoboEmpate.equipos.ladron.fichas === 3);

// Contraste: un robo de verdad equivocado sí sigue constando la ficha, como siempre.
const rondaRoboMalo = { equipoActivo: "activo", colocacion: 1, robos: { ladron: 3 } }; // slot fuera de lugar
const resRoboMalo = R.resolverRonda({ equipos: equiposRoboEmpate, ronda: rondaRoboMalo, anioCarta: 2000 });
t("un robo de verdad equivocado sigue costando la ficha",
  resRoboMalo.equipos.ladron.fichas === 2);

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

// Ya no hay ningún multiplicador extra por "varias personas la tienen": el
// único motivo por el que "Compartida" pesa más es que sus normalizados se
// SUMAN (5/8 + 4/6 = 31/24 ≈ 1.29) frente a 3/8 y 2/6 de las que solo tiene
// una persona, sobre un total de 2 (cada persona reparte 1 en total entre
// sus canciones). Eso da ≈ 0.65 de probabilidad: algo más que las demás,
// pero ni de lejos "casi siempre" — con grupos pequeños que apenas
// comparten 1-2 canciones, un multiplicador aparte (como tenía antes) hacía
// que esas pocas salieran prácticamente siempre partida tras partida (el
// bug que reportó el usuario).
let vecesElegidaComun = 0;
const INTENTOS = 4000;
for (let i = 0; i < INTENTOS; i++) if (App.elegirPonderado(poolFalso) === compartida) vecesElegidaComun++;
t("la canción en común sale algo más a menudo que las demás (por el peso sumado, no por un bonus aparte)",
  vecesElegidaComun / INTENTOS > 0.55 && vecesElegidaComun / INTENTOS < 0.75);

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
//  Reparto justo por PERSONA en el pool de Spotify (no por canción suelta):
//  quien tenga guardadas 100 canciones de un solo artista no debe acaparar
//  el mazo solo por tener muchas más que los demás (el caso real reportado:
//  a alguien le salió casi todo de Roger Waters, que solo escuchaba él).
// ------------------------------------------------------------
console.log("Comprobando el reparto justo por persona en el pool de Spotify…");
let vecesDePocasPorPersona = 0;
const INTENTOS_PERSONA = 4000;
for (let i = 0; i < INTENTOS_PERSONA; i++) {
  if (App.elegirDeSpotifyPorPersona(poolDesigual).titulo.startsWith("CanciónPoca")) vecesDePocasPorPersona++;
}
t("elegirDeSpotifyPorPersona reparte ~50/50 entre personas, tenga cada una las canciones que tenga",
  vecesDePocasPorPersona / INTENTOS_PERSONA > 0.4 && vecesDePocasPorPersona / INTENTOS_PERSONA < 0.6);
t("elegirDeSpotifyPorPersona no revienta si a alguna canción le falta 'aportantes'",
  !!App.elegirDeSpotifyPorPersona([{ titulo: "Suelta", artista: "A", anio: 2000, uri: "s1" }]));

// ------------------------------------------------------------
//  Mazo "mixto": reparto ~50/50 entre español e inglés, autocorrectivo pero
//  sin alternancia estricta (para que no se note un patrón previsible).
// ------------------------------------------------------------
console.log("Comprobando el reparto de idiomas del mazo 'mixto'…");
const catalogoIdiomas = [
  ...Array.from({ length: 10 }, (_, i) => ({ titulo: `Es${i}`, artista: "A", anio: 2000, mazo: "es" })),
  ...Array.from({ length: 10 }, (_, i) => ({ titulo: `En${i}`, artista: "A", anio: 2000, mazo: "int" })),
];
// Si ya llevamos usadas 8 canciones en inglés y 0 en español, lo siguiente
// debe favorecer muchísimo al español, pero sin ser un 100% forzoso.
const usadasSesgadas = {};
for (let i = 0; i < 8; i++) usadasSesgadas[App.clave({ titulo: `En${i}`, artista: "A" })] = true;
const disponiblesSesgadas = catalogoIdiomas.filter((c) => !usadasSesgadas[App.clave(c)]);
let vecesEsCorrigiendo = 0;
const INTENTOS_IDIOMA = 3000;
for (let i = 0; i < INTENTOS_IDIOMA; i++) {
  if (App.elegirBalanceadoPorIdioma(catalogoIdiomas, usadasSesgadas, disponiblesSesgadas).mazo === "es") vecesEsCorrigiendo++;
}
t("si vamos sobrados de inglés, el mazo 'mixto' se autocorrige hacia el español",
  vecesEsCorrigiendo / INTENTOS_IDIOMA > 0.6);
t("pero no de forma absoluta: sigue pudiendo salir inglés (no es alternancia estricta)",
  vecesEsCorrigiendo / INTENTOS_IDIOMA < 1);

let vecesEsSinHistorial = 0;
for (let i = 0; i < INTENTOS_IDIOMA; i++) {
  if (App.elegirBalanceadoPorIdioma(catalogoIdiomas, {}, catalogoIdiomas).mazo === "es") vecesEsSinHistorial++;
}
t("sin historial todavía, el mazo 'mixto' arranca ~50/50",
  vecesEsSinHistorial / INTENTOS_IDIOMA > 0.4 && vecesEsSinHistorial / INTENTOS_IDIOMA < 0.6);

const soloIngles = catalogoIdiomas.filter((c) => c.mazo !== "es");
t("si el español se agota, el mazo 'mixto' sigue dando canciones en inglés",
  App.elegirBalanceadoPorIdioma(catalogoIdiomas, {}, soloIngles)?.mazo === "int");

// Integración: con mazo 'mixto' (y sin nadie aportando por Spotify, para
// aislar solo la parte curada), sacarCancion debe acabar repartiendo ~50/50
// entre idiomas a lo largo de muchas rondas de una partida simulada.
let vistasEs = 0, vistasEnMixto = 0;
let usadasMixto = {};
for (let i = 0; i < 200; i++) {
  const c = App.sacarCancion({ config: { mazo: "mixto" }, usadas: usadasMixto, aportes: {} });
  if (!c) break;
  usadasMixto = { ...usadasMixto, [App.clave(c)]: true };
  if (c.mazo === "es") vistasEs++; else if (c.mazo === "int") vistasEnMixto++;
}
const totalVistasMixto = vistasEs + vistasEnMixto;
t("con mazo 'mixto' y sin Spotify aportado, sacarCancion reparte ~50/50 entre idiomas en toda la partida",
  totalVistasMixto > 100 && Math.abs(vistasEs / totalVistasMixto - 0.5) < 0.15);

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
// Cuando aciertan, la carta recién ganada ya forma parte de esta misma línea
// del tiempo: en vez de un marcador de hueco "✓ aquí iba" (que quedaría
// descolocado, pegado a un lado de la carta real), la carta se resalta
// directamente con un borde discontinuo — ver htmlLinea/faseRevelado.
t("al acertar, la carta ganada se resalta directamente en la línea (sin un marcador de hueco aparte)",
  document.querySelectorAll(".celda-carta.destacada").length === 1
  && !html().includes("aquí iba"));

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
//  El motor de la partida (motorPaso) marca cada paso como "hecho" para no
//  repetirlo dos veces mientras Firebase confirma el cambio. Antes, esa
//  marca se ponía ANTES de completar la escritura: si esa escritura fallaba
//  (aquí lo simulamos con una carta "secreta" indescifrable, que hace que
//  `resolver()` lance un error), la marca se quedaba puesta para siempre y
//  la partida se quedaba congelada de por vida — el bug real que reportó
//  el usuario: "le he dado a pasar y se ha quedado todo parado, nadie
//  tenía nada que hacer". Aquí comprobamos que, tras ese fallo, el motor
//  reintenta solo en cuanto la causa desaparece (en vez de quedarse
//  bloqueado aunque la carta vuelva a ser legible).
// ------------------------------------------------------------
console.log("Comprobando que el motor se recupera solo si falla al resolver una ronda…");
const codigoMotor = "9090";
fb._escribir(`salas/${codigoMotor}`, {
  fase: "lobby", hostCliente: miId, config: { mazo: "famosas" },
  equipos: {
    eq1: { id: "eq1", nombre: "Equipo Motor", color: COLORES_EQUIPO[0], orden: 0,
           fichas: 3, cartas: [], miembros: {} },
    eq2: { id: "eq2", nombre: "Equipo Rival", color: COLORES_EQUIPO[1], orden: 1,
           fichas: 3, cartas: [], miembros: {} },
  },
  usadas: {}, aportes: {}, ronda: null, ganador: null,
});
await clic('[data-accion="irUnirse"]', "Unirse para probar la recuperación del motor");
document.getElementById("in-codigo").value = codigoMotor;
await clic('[data-accion="buscarSala"]', "Buscar sala del motor");
await clic('[data-accion="unirmeEquipo"]', "Unirme a Equipo Motor (con hostCliente = yo, para que corra el motor)");

// El motor solo corre con la sala en fase "jugando" (ver `motor()`).
fb._escribir(`salas/${codigoMotor}/fase`, "jugando");

// Fabricamos una ronda ya en fase de robo, con la decisión de robar ya
// tomada (así el motor entra directo en la rama "resolver") y una carta
// secreta corrupta a propósito, para que `Net.revelar` no pueda leerla.
fb._escribir(`salas/${codigoMotor}/ronda`, {
  // n con un valor improbable a propósito: el motor recuerda "ronda ya
  // resuelta" por número de ronda (hecho.resuelta), y no queremos que
  // choque con el n=1 de la partida real de 3 equipos que se juega más
  // abajo en este mismo archivo (mismo cliente, mismo proceso).
  n: 918273, equipoActivo: "eq1", subfase: "robando",
  colocacion: 0, robos: { eq2: "pasa" }, confirmada: true, turnoRobo: null, limiteRobo: 0,
  carta: null, resultado: null, esperandoBonus: false, siguientePedida: false, saltar: false,
  limiteSalto: 0, secreto: "esto-no-es-una-carta-cifrada-valida",
});
await esperar(60);
let salaMotor = fb._leer(`salas/${codigoMotor}`);
t("con una carta secreta indescifrable, la ronda se queda en 'robando' (resolver falla)",
  salaMotor.ronda.subfase === "robando");

// Ahora arreglamos la carta secreta (la sustituimos por una de verdad,
// cifrada como lo haría el propio juego) SIN tocar nada más: si la marca de
// "ya resuelto" se hubiera quedado pegada para siempre (el bug antiguo), la
// ronda jamás avanzaría aunque la carta ya se pueda leer perfectamente.
fb._escribir(`salas/${codigoMotor}/ronda/secreto`,
  Net.ocultar({ titulo: "Recuperada", artista: "Motor", anio: 1990 }, codigoMotor));
await esperar(350); // sobra un ciclo entero de tic() (300ms) para el reintento

salaMotor = fb._leer(`salas/${codigoMotor}`);
t("en cuanto la carta vuelve a ser legible, el motor reintenta solo y la ronda avanza a 'revelado' "
  + "(si la marca de 'hecho' se hubiera quedado pegada, esto nunca pasaría)",
  salaMotor.ronda.subfase === "revelado");
t("la carta recuperada es la correcta", salaMotor.ronda.carta?.titulo === "Recuperada");

await clic('[data-accion="salir"]', "Salir de la sala de prueba del motor");
fb._escribir(`salas/${codigoMotor}`, null);
await esperar(30);
t("al borrarse la sala del motor, la app vuelve a la pantalla de inicio",
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
//  Si el equipo que empezó llega a 10-9 ROBANDO en el turno de OTRO equipo
//  (que ya había fallado su propio turno), no hace falta pedirle 2 de
//  ventaja: ese otro equipo ya tuvo su oportunidad justa esa misma ronda y
//  la falló por su cuenta — el "gana por dos" solo tiene sentido cuando el
//  que empezó llega ahí en SU PROPIO turno (el bug que reportó el usuario).
// ------------------------------------------------------------
console.log('Comprobando que un robo limpio en turno ajeno no exige "gana por dos"…');

// Comprobación directa y pura de la función, sin pasar por toda la interfaz.
const cartasDeDesempate = (n) => Array.from({ length: n }, (_, i) => ({ titulo: "d" + i, artista: "a", anio: 1980 + i }));
const equiposDesempatePuro = {
  eq1: { id: "eq1", orden: 0, cartas: cartasDeDesempate(AJUSTES.cartasParaGanar) },       // 10
  eq2: { id: "eq2", orden: 1, cartas: cartasDeDesempate(AJUSTES.cartasParaGanar - 1) },   // 9
};
t("si el primer equipo llega a 10-9 en SU PROPIO turno, sigue haciendo falta 2 de ventaja",
  R.comprobarVictoria(equiposDesempatePuro, "eq1", { ganadorCarta: "eq1", equipoActivo: "eq1" }) === null);
t("pero si llega a 10-9 ROBANDO en el turno de otro equipo, gana ya (ese equipo ya falló su propio turno)",
  R.comprobarVictoria(equiposDesempatePuro, "eq1", { ganadorCarta: "eq1", equipoActivo: "eq2" }) === "eq1");
t("sin información de la ronda (compatibilidad hacia atrás), se sigue pidiendo 2 de ventaja como antes",
  R.comprobarVictoria(equiposDesempatePuro, "eq1") === null);

// Ahora de extremo a extremo: fabricamos justo esa ronda (eq2 juega su turno,
// falla, eq1 se la roba y llega a 10-9) y comprobamos que ni se muestra el
// aviso de "gana por dos" ni hace falta otra ronda: la partida ya termina,
// con eq1 como ganador.
const codigoRoboLimpio = "4040";
fb._escribir(`salas/${codigoRoboLimpio}`, {
  // hostCliente = yo, para poder pulsar "Siguiente" aunque el equipo activo
  // de la ronda fabricada (eq2) no sea el mío (ver el mismo truco en la
  // prueba del motor, más arriba).
  fase: "lobby", hostCliente: miId, config: { mazo: "famosas" },
  equipos: {
    eq1: { id: "eq1", nombre: "Los que Empezaron", color: COLORES_EQUIPO[0], orden: 0,
           fichas: 3, cartas: [], miembros: {} },
    eq2: { id: "eq2", nombre: "Los Retadores", color: COLORES_EQUIPO[1], orden: 1,
           fichas: 3, cartas: [], miembros: {} },
  },
  usadas: {}, aportes: {}, ronda: null, ganador: null,
});
await clic('[data-accion="irUnirse"]', "Unirse para probar el robo limpio");
document.getElementById("in-codigo").value = codigoRoboLimpio;
await clic('[data-accion="buscarSala"]', "Buscar sala de robo limpio");
await clic('[data-accion="unirmeEquipo"]', "Unirme a Los que Empezaron (robo limpio)");

const cartaRobada = { titulo: "LaRobada", artista: "Z", anio: 2005 };
fb._escribir(`salas/${codigoRoboLimpio}`, {
  fase: "jugando", hostCliente: miId, config: { mazo: "famosas" }, primerEquipo: "eq1",
  equipos: {
    eq1: { id: "eq1", nombre: "Los que Empezaron", color: COLORES_EQUIPO[0], orden: 0, fichas: 3,
           cartas: [...cartasDeDesempate(AJUSTES.cartasParaGanar - 1), cartaRobada], // 10, la robada incluida
           miembros: { [miId]: true } },
    eq2: { id: "eq2", nombre: "Los Retadores", color: COLORES_EQUIPO[1], orden: 1, fichas: 2,
           cartas: cartasDeDesempate(AJUSTES.cartasParaGanar - 1), miembros: {} }, // 9, sin cambios: falló su turno
  },
  usadas: {}, ganador: null,
  ronda: {
    // n con un valor improbable a propósito, por el mismo motivo que la
    // prueba del motor: `hecho.lanzada` se recuerda por número de ronda, sin
    // distinguir de qué sala es, y no debe chocar con otras rondas n=1 de
    // este mismo archivo.
    n: 424242, equipoActivo: "eq2", subfase: "revelado",
    colocacion: 3, robos: { eq1: 0 }, confirmada: true,
    carta: cartaRobada,
    resultado: {
      aciertoActivo: false, ganadorCarta: "eq1",
      intentos: [{ equipo: "eq1", slot: 0, correcto: true }],
      slotsValidos: [],
    },
    esperandoBonus: false, siguientePedida: false, bonus: null, saltar: false, secreto: null,
  },
});
await esperar(40);
t('al robar limpiamente en turno ajeno, NO se muestra el aviso de "gana por dos"',
  !html().includes("¡Gana por dos!"));

await clic('[data-accion="siguiente"]', "Siguiente (robo limpio)");
await esperar(40);
const salaRoboLimpio = fb._leer(`salas/${codigoRoboLimpio}`);
t("la partida termina ya, sin pedir otra ronda de desempate", salaRoboLimpio.fase === "fin");
t("y gana quien empezó, que se llevó la carta limpiamente en turno ajeno", salaRoboLimpio.ganador === "eq1");

await clic('[data-accion="salir"]', "Salir de la sala de robo limpio");
fb._escribir(`salas/${codigoRoboLimpio}`, null);
await esperar(30);
t("al borrarse la sala de robo limpio, la app vuelve a la pantalla de inicio",
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
// La URL debe reflejar el código de la partida (para tener una dirección
// propia por partida, en vez de depender de que el caché/sesión guardada
// "adivine" en cuál estábamos — ver LEEME).
t("crear una partida refleja su código en la URL (?codigo=...)",
  new URLSearchParams(location.search).get("codigo") === codigo);

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
      // Entre dos cartas del mismo año, el hueco de en medio ya no se ofrece
      // (es redundante: vale igual justo antes o justo después — ver
      // htmlLinea), así que hay uno por posición posible MENOS esos huecos
      // redundantes.
      const redundantesMI = timeline.slice(1).filter((c, i) => c.anio === timeline[i].anio).length;
      t("hay un hueco por cada posición posible (menos las redundantes entre años iguales)",
        huecos.length === timeline.length + 1 - redundantesMI);
      // Acertamos la mitad de las veces (y no solo un tercio): con partidas
      // de hasta 3 equipos, un acierto demasiado bajo hace que algunas
      // partidas simuladas tarden muchísimas rondas en converger por pura
      // varianza — no es un problema del juego, es de esta prueba.
      const huecoPorSlot = (slot) => huecos.find((h) => Number(h.dataset.slot) === slot);
      const buenosMI = R.slotsValidos(timeline, secreto.anio);
      // Si el primer slot válido fuera justo uno redundante (ya oculto), el
      // de al lado también vale por la misma regla de empates — cogemos el
      // primero de la lista que de verdad tenga hueco clicable.
      const elegido = (rondasJugadas % 2 === 0 && buenosMI.length)
        ? (buenosMI.map(huecoPorSlot).find(Boolean) || huecos[rondasJugadas % huecos.length])
        : huecos[rondasJugadas % huecos.length];
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

    // Una vez, durante la partida, abrimos el panel de "Ver equipos" (ahora
    // incluye también el propio equipo, no solo los rivales).
    if (revelados === 2) {
      await clic('[data-accion="verOtros"]', "Ver equipos");
      t("el panel de equipos se abre", html().includes("<h2>Equipos</h2>"));
      t("el panel deja elegir entre los tres equipos, incluido el propio",
        html().includes("Los Primos") && html().includes("Los Peques") && html().includes("Los Abuelos"));
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

await clic('[data-accion="salir"]', "Salir de la partida completa");
t("al salir, la URL vuelve a no tener código (no arrastramos una partida vieja)",
  !new URLSearchParams(location.search).get("codigo"));

console.log(`\n${fallos === 0 ? "✓ PARTIDA COMPLETA SIN FALLOS" : "✗ " + fallos + " FALLOS"}\n`);
process.exit(fallos ? 1 : 0);
