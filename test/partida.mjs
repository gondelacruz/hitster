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
const pista = (uri, nombre, anio, artista = "Artista") => ({
  uri, name: nombre, artists: [{ name: artista }],
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
    return json({ access_token: "tok", refresh_token: "ref", expires_in: 3600 });
  if (u.includes("/v1/me/player/devices"))
    return json({ devices: [{ id: "dev1", name: "Altavoz del salón", type: "Speaker" }] });
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
  // Canciones guardadas ("Me gusta").
  if (u.includes("/v1/me/tracks")) {
    if (qs.get("offset") !== "0") return json({ items: [] });
    return json({ items: [{ track: pista("spotify:track:guardada-d", "Canción guardada", 2012) }] });
  }
  // Playlists propias y sus canciones.
  if (u.includes("/v1/me/playlists"))
    return json({ items: [{ id: "pl1", owner: { id: "mi-id-de-prueba" } }] });
  if (u.includes("/v1/playlists/pl1/tracks"))
    return json({ items: [{ track: pista("spotify:track:playlist-e", "De mi playlist", 2018) }] });

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

localStorage.setItem("hitster_spotify_token", JSON.stringify({
  access_token: "tok", refresh_token: "ref", expira: Date.now() + 3.6e6,
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
  await esperar(20);
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
  fase: "lobby", hostCliente: "otro-cliente", config: { mazo: "top" },
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
t("el lobby muestra la sección de Nuestras canciones (mazo top)", html().includes("Nuestras canciones"));
t("aparece el botón para aportar Spotify", !!$('[data-accion="aportarSpotify"]'));

await clic('[data-accion="aportarSpotify"]', "Aportar mis canciones de Spotify");
await esperar(80); // varias llamadas de red encadenadas (top, guardadas, playlists)
salaAjena = fb._leer(`salas/${codigoAjeno}`);
const aporte = salaAjena.aportes?.[miId];
t("el aporte de Spotify queda guardado en la sala", !!aporte && aporte.canciones.length === 5);
t("el peso se suma cuando la misma canción sale en varias fuentes",
  aporte?.canciones.find((c) => c.uri === "spotify:track:top-b")?.peso === 5);
t("se incluyen canciones guardadas y de playlists propias, no solo el top",
  aporte?.canciones.some((c) => c.uri === "spotify:track:guardada-d")
  && aporte?.canciones.some((c) => c.uri === "spotify:track:playlist-e"));

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
t("la canción en común suma los pesos de cada aporte", compartida?.peso === 9);

let vecesElegidaComun = 0;
const INTENTOS = 4000;
for (let i = 0; i < INTENTOS; i++) if (App.elegirPonderado(poolFalso) === compartida) vecesElegidaComun++;
t("la ponderación favorece claramente la canción en común frente a las demás",
  vecesElegidaComun / INTENTOS > 0.5);

const titulosVistos = new Set();
for (let i = 0; i < 50; i++) {
  const c = App.sacarCancion({ config: { mazo: "top" }, usadas: {}, ...estadoPoolFalso });
  if (c) titulosVistos.add(c.titulo);
}
t("con mazo 'top', sacarCancion combina el pool comunitario con el mazo curado", titulosVistos.size > 1);

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

await clic('[data-accion="buscarDispositivos"]', "Elegir altavoz");
t("aparece el altavoz de Spotify", html().includes("Altavoz del salón"));
await clic('[data-accion="elegirDispositivo"]', "Usar altavoz");

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
    revelados = 0, robosHechos = 0, saltosHechos = 0, filtraciones = 0, corregidoUnaVez = false;

const rondasVistas = new Set();
const est = () => fb._leer("salas/" + codigo);

while (est().fase === "jugando" && vueltas++ < 4000) {
  const E = est();
  const r = E.ronda;
  if (!r) { await esperar(20); continue; }
  const activo = r.equipoActivo;
  const timeline = R.ordenar(E.equipos[activo].cartas || []);
  const secreto = r.secreto ? Net.revelar(r.secreto, codigo) : null;

  // La carta boca abajo NO debe filtrar ni el año ni el título en la pantalla.
  if (secreto && (r.subfase === "colocando" || r.subfase === "robando")) {
    const pantalla = html();
    // (el año y el artista pueden repetirse con cartas ya ganadas; el título no)
    if (pantalla.includes(secreto.titulo)) filtraciones++;
  }

  if (r.subfase === "colocando") {
    rondasJugadas++;
    if (activo === MI) {
      // De vez en cuando saltamos la canción para ejercitar esa regla.
      misTurnos++;
      if (E.equipos[MI].fichas >= AJUSTES.fichasParaSaltar && misTurnos === 1) {
        saltosHechos++;
        await clic('[data-accion="saltar"]', "Saltar canción");
        await esperar(20);
        continue;
      }
      const huecos = [...document.querySelectorAll('[data-accion="hueco"]')];
      t("hay un hueco por cada posición posible", huecos.length === timeline.length + 1);
      const elegido = huecos[rondasJugadas % huecos.length];
      elegido.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await esperar(15);
      await clic('[data-accion="finalizar"]', "Finalizar");
    } else {
      // Otro equipo coloca desde su dispositivo.
      const buenos = R.slotsValidos(timeline, secreto.anio);
      const slot = rondasJugadas % 3 === 0 && buenos.length
        ? buenos[0] : rondasJugadas % (timeline.length + 1);
      await fb.update(fb.ref(null, `salas/${codigo}/ronda`), { colocacion: slot, confirmada: true });
    }
    await esperar(25);
    continue;
  }

  if (r.subfase === "robando") {
    const turno = r.turnoRobo;
    if (!turno) { await esperar(20); continue; }
    if (turno === MI) {
      const huecos = [...document.querySelectorAll('[data-accion="hueco"]')];
      if (huecos.length && E.equipos[MI].fichas >= 1 && rondasJugadas % 2 === 0) {
        huecos[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await esperar(15);
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
    await esperar(25);
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

    // Una vez, comprobamos la corrección manual del año (por si Spotify se equivoca).
    if (!corregidoUnaVez && res.ganadorCarta) {
      corregidoUnaVez = true;
      const ganadorId = res.ganadorCarta;
      const anioNuevo = carta.anio === 1975 ? 1976 : 1975;
      await clic('[data-accion="corregirAnio"]', "¿Año equivocado?");
      t("se abre el modal de corregir el año", html().includes("Corregir el año"));
      document.getElementById("in-anio-correcto").value = String(anioNuevo);
      await clic('[data-accion="guardarAnio"]', "Guardar año corregido");
      await esperar(40);
      const trasCorregir = est().equipos[ganadorId].cartas
        .find((c) => c.titulo === carta.titulo && c.artista === carta.artista);
      t("el año corregido se guarda en la carta del equipo", trasCorregir?.anio === anioNuevo);
      const aniosGanador = est().equipos[ganadorId].cartas.map((c) => c.anio);
      t("la línea del equipo sigue ordenada tras la corrección",
        aniosGanador.every((a, i) => !i || a >= aniosGanador[i - 1]));
      t("corregir el año no deshace el resultado ya calculado de la ronda",
        est().ronda.resultado.ganadorCarta === ganadorId);
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
      await esperar(25);
      continue;
    }

    sinErrores("revelado");
    await clic('[data-accion="siguiente"]', "Siguiente ronda");
    await esperar(45);
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
