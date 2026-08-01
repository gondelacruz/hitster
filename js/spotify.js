// ============================================================
//  SPOTIFY — login (PKCE, sin servidor), búsqueda y reproducción
//  Solo el anfitrión necesita conectar Spotify, y necesita Premium.
// ============================================================
import { SPOTIFY_CLIENT_ID } from "./config.js";

export const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-modify-playback-state",
  "streaming",
  "user-top-read",
  "user-library-read",
  "playlist-read-private",
  "user-read-recently-played",
].join(" ");

// Permisos que hacen falta específicamente para "Nuestras canciones". Si
// alguien conectó su Spotify antes de que existieran (o alguno se ha
// revocado), su sesión guardada no los tendrá y hay que reconectar.
// Incluimos "user-top-read" porque es la fuente que más pesa (top de largo y
// medio plazo); sin él, a alguien con mucho historial pero sin "Me gusta"
// guardados ni playlists propias le podría no salir nada, aunque sí escuche
// mucha música.
const SCOPES_APORTAR = [
  "user-library-read", "playlist-read-private", "user-read-recently-played", "user-top-read",
];

const LS = "hitster_spotify_token";

export function redirectUri() {
  // La URL exacta de la app, sin parámetros. Esta es la que hay que
  // registrar en el panel de Spotify Developer.
  return location.origin + location.pathname;
}

// ---------- PKCE ----------
function aleatorio(n) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function challenge(verifier) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Ninguna llamada a Spotify debería quedarse colgada para siempre: si la
// conexión falla a medias (wifi inestable, red bloqueada…) el navegador puede
// tardar muchísimo en darse por vencido él solo, y mientras tanto la pantalla
// se queda en "Leyendo tus canciones…" sin decir nada. Con este límite, a los
// 12s como mucho se corta y se avisa, en vez de dejar a alguien esperando
// minutos sin saber si sigue funcionando o se ha quedado colgado.
const TIEMPO_ESPERA_MS = 12000;

async function fetchConLimite(url, opciones = {}) {
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), TIEMPO_ESPERA_MS);
  try {
    return await fetch(url, { ...opciones, signal: controlador.signal });
  } catch (e) {
    const err = new Error(
      e?.name === "AbortError"
        ? "Spotify ha tardado demasiado en responder (conexión lenta o caída)."
        : "No se ha podido conectar con Spotify (revisa la conexión a internet de este dispositivo)."
    );
    err.red = true; // fallo de red/tiempo, no un error que venga de Spotify
    throw err;
  } finally {
    clearTimeout(limite);
  }
}

export async function iniciarLogin() {
  const verifier = aleatorio(64);
  sessionStorage.setItem("hitster_verifier", verifier);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
  });
  location.href = "https://accounts.spotify.com/authorize?" + params;
}

/** Si volvemos de Spotify con ?code=..., lo canjeamos por un token. */
export async function procesarVuelta() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    history.replaceState({}, "", redirectUri());
    throw new Error("Spotify devolvió un error: " + error);
  }
  if (!code) return false;
  const verifier = sessionStorage.getItem("hitster_verifier");
  history.replaceState({}, "", redirectUri());
  if (!verifier) return false;

  const res = await fetchConLimite("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error("No se pudo completar el login de Spotify.");
  guardarToken(await res.json());
  return true;
}

function guardarToken(data) {
  const actual = leerToken() || {};
  localStorage.setItem(LS, JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token || actual.refresh_token,
    expira: Date.now() + (data.expires_in - 60) * 1000,
    // Spotify solo manda "scope" al autorizar (no siempre al refrescar), así
    // que si no viene, conservamos el que ya teníamos guardado.
    alcance: data.scope || actual.alcance || "",
  }));
}

function leerToken() {
  try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; }
}

export function haySesion() {
  const t = leerToken();
  return !!(t && t.refresh_token);
}

/**
 * ¿A esta sesión le faltan permisos para leer canciones guardadas, playlists
 * o reproducciones recientes? Pasa con cuentas que conectaron Spotify antes
 * de que pidiéramos estos permisos: hay que reconectar para que Spotify los
 * vuelva a pedir (no hace falta tocar nada del lado de Spotify, solo volver
 * a iniciar sesión desde la app).
 */
export function faltanPermisos() {
  const t = leerToken();
  if (!t) return true;
  const concedidos = (t.alcance || "").split(" ").filter(Boolean);
  return SCOPES_APORTAR.some((s) => !concedidos.includes(s));
}

export function cerrarSesion() {
  localStorage.removeItem(LS);
}

export async function token() {
  const t = leerToken();
  if (!t) throw new Error("Sin sesión de Spotify");
  if (Date.now() < t.expira) return t.access_token;

  const res = await fetchConLimite("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
    }),
  });
  if (!res.ok) { cerrarSesion(); throw new Error("La sesión de Spotify ha caducado."); }
  guardarToken(await res.json());
  return leerToken().access_token;
}

// ---------- Llamadas a la Web API ----------
async function api(ruta, opciones = {}) {
  const res = await fetchConLimite("https://api.spotify.com/v1" + ruta, {
    ...opciones,
    headers: {
      Authorization: "Bearer " + (await token()),
      "Content-Type": "application/json",
      ...(opciones.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const texto = await res.text();
  let cuerpo = null;
  if (texto) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      // A veces la respuesta no es JSON de Spotify de verdad: algo se ha
      // colado por el medio (un proxy, un filtro de red, un bloqueador de
      // anuncios del navegador…) y ha devuelto texto plano o una página de
      // error en su lugar. Antes esto se veía como un misterioso "Unexpected
      // token" sin más pista; ahora guardamos el código real y un trozo del
      // texto, para poder ver de un vistazo qué está devolviendo de verdad.
      const e = new Error(`Spotify no devolvió datos válidos (código ${res.status}): "${texto.slice(0, 140)}"`);
      e.status = res.status;
      throw e;
    }
  }
  if (!res.ok) {
    const msg = cuerpo?.error?.message || res.statusText;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return cuerpo;
}

export const perfil = () => api("/me");

const MALAS = /\b(karaoke|tribute|made famous by|in the style of|cover version|instrumental version)\b/i;

function puntuar(track, titulo, artista) {
  const n = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let p = track.popularity || 0;
  const nombres = track.artists.map((a) => n(a.name)).join(" ");
  if (nombres.includes(n(artista).split(/[&,]| feat| ft\./)[0].trim())) p += 60;
  if (n(track.name) === n(titulo)) p += 40;
  else if (n(track.name).startsWith(n(titulo))) p += 20;
  if (MALAS.test(track.name) || MALAS.test(track.album?.name || "")) p -= 200;
  if (/\blive\b|en vivo|en directo/i.test(track.name)) p -= 60;
  return p;
}

/** Busca una canción concreta en Spotify y devuelve su URI. */
export async function buscarTrack(titulo, artista) {
  const intentos = [
    `track:"${titulo}" artist:"${artista}"`,
    `${titulo} ${artista}`,
  ];
  for (const q of intentos) {
    const r = await api(`/search?q=${encodeURIComponent(q)}&type=track&limit=10`);
    const items = r?.tracks?.items || [];
    if (!items.length) continue;
    const mejor = items.map((t) => ({ t, p: puntuar(t, titulo, artista) }))
                       .sort((a, b) => b.p - a.p)[0];
    if (mejor && mejor.p > -100) {
      return { uri: mejor.t.uri, nombreReal: mejor.t.name, artistaReal: mejor.t.artists.map(a=>a.name).join(", ") };
    }
  }
  return null;
}

/**
 * Reproduce en el dispositivo de Spotify que esté activo (el móvil o altavoz
 * donde el anfitrión tenga Spotify abierto). No pedimos elegir dispositivo:
 * es el comportamiento por defecto de Spotify Connect.
 */
export async function reproducir(uri) {
  await api(`/me/player/play`, {
    method: "PUT",
    body: JSON.stringify({ uris: [uri], position_ms: 0 }),
  });
}

export async function pausar() {
  try { await api(`/me/player/pause`, { method: "PUT" }); } catch { /* ya estaba parado */ }
}

/**
 * Canciones favoritas del dueño de esta sesión, para el mazo "Nuestras canciones".
 * Combina varias fuentes con distinto peso (cuantas más señales de que de verdad
 * le gusta o la ha escuchado, más probable que salga en la partida):
 *   - top tracks de largo plazo (varios años de historial): peso 3
 *   - top tracks de medio plazo (~6 meses): peso 2
 *   - reproducidas recientemente (las últimas ~50): peso 2
 *   - canciones guardadas ("Me gusta"): peso 2
 *   - canciones de sus propias playlists: peso 1
 * Se descarta a propósito el "top" de corto plazo (últimas 4 semanas): mezcla
 * escuchas puntuales recientes con los favoritos de verdad (para eso ya está
 * lo de "reproducidas recientemente", que es más literal).
 *
 * Si el resultado sale vacío, SIEMPRE lanzamos un error explicando por qué (en
 * vez de devolver una lista vacía sin más), distinguiendo dos casos:
 *   - `e.tipo === "permisos"`: alguna fuente falló con 401/403 (cuenta
 *     conectada antes de pedir estos permisos, o alguno revocado a mano).
 *   - `e.tipo === "vacio"`: todas las fuentes respondieron sin error, pero
 *     ninguna trajo canciones aprovechables (por ejemplo, un fallo pasajero
 *     de la API que no es un 401/403 pero tampoco da datos, o una cuenta que
 *     de verdad no tiene top/recientes/guardadas/playlists propias). Para no
 *     tener que adivinar, `e.detalle` trae un resumen de qué pasó en cada
 *     fuente (cuántas canciones trajo o qué error dio), para poder ver de un
 *     vistazo cuál es la fuente problemática.
 *
 * También guardamos la `popularidad` que da Spotify a cada canción (0-100),
 * para que luego, al elegir cuál suena, se pueda dar preferencia a las que
 * más gente conoce y no salgan rarezas que solo ha escuchado quien la aportó.
 */
export async function misCancionesFavoritas() {
  const mapa = new Map(); // uri -> {titulo, artista, anio, uri, peso, popularidad}
  let huboErrorDePermisos = false;
  let errorDeRed = null; // si la red/Spotify falla del todo, no tiene sentido seguir probando fuente a fuente
  const fuentes = []; // diagnóstico legible por si el resultado sale vacío
  const marcarSiEsPermiso = (e) => {
    if (e?.status === 401 || e?.status === 403) huboErrorDePermisos = true;
  };

  const sumar = (t, peso) => {
    const anio = parseInt((t.album?.release_date || "").slice(0, 4), 10);
    if (!anio || !t.uri) return;
    const tienePopularidad = typeof t.popularity === "number";
    const actual = mapa.get(t.uri);
    if (actual) {
      actual.peso += peso;
      // Ojo: nunca asignamos `undefined` a una propiedad. Firebase rechaza
      // escribir cualquier campo puesto a `undefined` (a diferencia de
      // JSON.stringify, que simplemente lo omitiría), así que si no hay
      // popularidad, la propiedad ni se crea.
      if (actual.popularidad === undefined && tienePopularidad) actual.popularidad = t.popularity;
      return;
    }
    const cancion = { titulo: t.name, artista: t.artists.map((a) => a.name).join(", "), anio, uri: t.uri, peso };
    if (tienePopularidad) cancion.popularidad = t.popularity;
    mapa.set(t.uri, cancion);
  };

  /**
   * Ejecuta una fuente y anota, para el diagnóstico, cuántas canciones nuevas
   * trajo (o qué falló). Si ya sabemos que la red/Spotify ha fallado del
   * todo, no seguimos probando las fuentes que quedan: no tiene sentido
   * (ni es rápido) esperar el límite de tiempo una y otra vez sabiendo de
   * antemano que va a fallar igual.
   */
  const probar = async (etiqueta, fn) => {
    if (errorDeRed) { fuentes.push(`${etiqueta}: sin probar (fallo de red anterior)`); return; }
    const antes = mapa.size;
    try {
      await fn();
      fuentes.push(`${etiqueta}: ${mapa.size - antes}`);
    } catch (e) {
      if (e?.red) { errorDeRed = e; fuentes.push(`${etiqueta}: ${e.message}`); return; }
      marcarSiEsPermiso(e);
      fuentes.push(`${etiqueta}: error ${e?.status ?? "?"} (${e?.message || "sin detalle"})`);
    }
  };

  for (const [rango, peso, etiqueta] of [
    ["long_term", 3, "top largo plazo"], ["medium_term", 2, "top medio plazo"],
  ]) {
    await probar(etiqueta, async () => {
      for (const offset of [0, 50]) {
        const r = await api(`/me/top/tracks?limit=50&offset=${offset}&time_range=${rango}`);
        for (const t of r?.items || []) sumar(t, peso);
      }
    });
  }

  await probar("reproducidas recientemente", async () => {
    const r = await api(`/me/player/recently-played?limit=50`);
    for (const it of r?.items || []) if (it.track) sumar(it.track, 2);
  });

  await probar("guardadas", async () => {
    for (const offset of [0, 50]) {
      const r = await api(`/me/tracks?limit=50&offset=${offset}`);
      for (const it of r?.items || []) if (it.track) sumar(it.track, 2);
    }
  });

  await probar("playlists propias", async () => {
    const perfilActual = await perfil();
    const listas = await api(`/me/playlists?limit=50`);
    const propias = (listas?.items || []).filter((p) => p.owner?.id === perfilActual.id).slice(0, 15);
    for (const p of propias) {
      try {
        const r = await api(`/playlists/${p.id}/tracks?limit=50&fields=items(track(name,uri,artists(name),album(release_date),popularity))`);
        for (const it of r?.items || []) if (it.track) sumar(it.track, 1);
      } catch (e) {
        // Si es un fallo de red, no tiene sentido seguir probando playlist a
        // playlist (podría haber hasta 15): lo dejamos subir para que
        // `probar` lo detecte y pare ahí mismo.
        if (e?.red) throw e;
        marcarSiEsPermiso(e); // alguna playlist suelta puede fallar (colaborativa, borrada…)
      }
    }
  });

  const resultado = [...mapa.values()];
  if (!resultado.length) {
    let err;
    if (errorDeRed) {
      err = new Error(errorDeRed.message);
      err.tipo = "red";
    } else if (huboErrorDePermisos) {
      err = new Error("Faltan permisos de Spotify (canciones guardadas, playlists, top o recientes).");
      err.tipo = "permisos";
    } else {
      err = new Error("Spotify no ha devuelto ninguna canción aprovechable de ninguna fuente.");
      err.tipo = "vacio";
    }
    err.detalle = fuentes.join(" · ");
    throw err;
  }
  return resultado;
}
