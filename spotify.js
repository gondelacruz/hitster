// ============================================================
//  SPOTIFY — login (PKCE, sin servidor), búsqueda y reproducción
//  Solo el anfitrión necesita conectar Spotify, y necesita Premium.
// ============================================================
import { SPOTIFY_CLIENT_ID } from "./config.js";

const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-modify-playback-state",
  "streaming",
  "user-top-read",
].join(" ");

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

  const res = await fetch("https://accounts.spotify.com/api/token", {
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
  }));
}

function leerToken() {
  try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; }
}

export function haySesion() {
  const t = leerToken();
  return !!(t && t.refresh_token);
}

export function cerrarSesion() {
  localStorage.removeItem(LS);
}

export async function token() {
  const t = leerToken();
  if (!t) throw new Error("Sin sesión de Spotify");
  if (Date.now() < t.expira) return t.access_token;

  const res = await fetch("https://accounts.spotify.com/api/token", {
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
  const res = await fetch("https://api.spotify.com/v1" + ruta, {
    ...opciones,
    headers: {
      Authorization: "Bearer " + (await token()),
      "Content-Type": "application/json",
      ...(opciones.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const texto = await res.text();
  const cuerpo = texto ? JSON.parse(texto) : null;
  if (!res.ok) {
    const msg = cuerpo?.error?.message || res.statusText;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return cuerpo;
}

export const perfil = () => api("/me");
export const dispositivos = () => api("/me/player/devices").then((r) => r?.devices || []);

export async function esPremium() {
  try { return (await perfil()).product === "premium"; } catch { return false; }
}

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

export async function reproducir(uri, deviceId) {
  const q = deviceId ? `?device_id=${deviceId}` : "";
  await api(`/me/player/play${q}`, {
    method: "PUT",
    body: JSON.stringify({ uris: [uri], position_ms: 0 }),
  });
}

export async function pausar(deviceId) {
  const q = deviceId ? `?device_id=${deviceId}` : "";
  try { await api(`/me/player/pause${q}`, { method: "PUT" }); } catch { /* ya estaba parado */ }
}

export async function volumen(pct, deviceId) {
  const q = new URLSearchParams({ volume_percent: String(Math.round(pct)) });
  if (deviceId) q.set("device_id", deviceId);
  try { await api(`/me/player/volume?${q}`, { method: "PUT" }); } catch {}
}

/** Canciones más escuchadas del usuario (para el mazo "Nuestras canciones"). */
export async function topTracks() {
  const out = [];
  for (const rango of ["long_term", "medium_term", "short_term"]) {
    for (const offset of [0, 49]) {
      try {
        const r = await api(`/me/top/tracks?limit=50&offset=${offset}&time_range=${rango}`);
        for (const t of r?.items || []) {
          const anio = parseInt((t.album?.release_date || "").slice(0, 4), 10);
          if (!anio) continue;
          out.push({
            titulo: t.name,
            artista: t.artists.map((a) => a.name).join(", "),
            anio,
            uri: t.uri,
            mazo: "top",
          });
        }
      } catch { /* algún rango puede venir vacío */ }
    }
  }
  const vistos = new Set();
  return out.filter((c) => !vistos.has(c.uri) && vistos.add(c.uri));
}

// ---------- Reproductor dentro del navegador (Web Playback SDK) ----------
let reproductor = null;
let idNavegador = null;

export function deviceIdNavegador() { return idNavegador; }

export function iniciarReproductorNavegador() {
  return new Promise((resolve, reject) => {
    if (idNavegador) return resolve(idNavegador);
    const arranca = () => {
      reproductor = new window.Spotify.Player({
        name: "Hitster Familia",
        getOAuthToken: (cb) => token().then(cb),
        volume: 0.8,
      });
      reproductor.addListener("ready", ({ device_id }) => { idNavegador = device_id; resolve(device_id); });
      reproductor.addListener("initialization_error", ({ message }) => reject(new Error(message)));
      reproductor.addListener("authentication_error", ({ message }) => reject(new Error(message)));
      reproductor.addListener("account_error", () =>
        reject(new Error("Este reproductor necesita Spotify Premium.")));
      reproductor.connect();
    };
    if (window.Spotify) return arranca();
    window.onSpotifyWebPlaybackSDKReady = arranca;
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.onerror = () => reject(new Error("No se pudo cargar el reproductor de Spotify."));
    document.head.appendChild(s);
    setTimeout(() => { if (!idNavegador) reject(new Error("El reproductor tardó demasiado en arrancar.")); }, 15000);
  });
}

/** iOS/iPadOS exige un toque del usuario antes de dejar sonar audio. */
export async function desbloquearAudio() {
  try { await reproductor?.activateElement?.(); } catch {}
}
