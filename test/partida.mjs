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
globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
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
  if (u.includes("/v1/me/top/tracks")) return json({ items: [] });
  if (u.includes("/v1/search")) {
    llamadas.search++;
    return json({ tracks: { items: [{
      uri: "spotify:track:" + llamadas.search, name: "Canción", popularity: 60,
      artists: [{ name: "Artista" }], album: { name: "Álbum", release_date: "1999-01-01" },
    }] } });
  }
  if (u.includes("/v1/me")) return json({ product: "premium", display_name: "Test" });
  return json({ error: { message: "ruta no simulada: " + u } }, 404);
};

localStorage.setItem("hitster_spotify_token", JSON.stringify({
  access_token: "tok", refresh_token: "ref", expira: Date.now() + 3.6e6,
}));

// ---------- arrancamos la app ----------
const fb = await import("./stubs/firebase.mjs");
const Net = await import("../js/net.js");
const R = await import("../js/reglas.js");
const { AJUSTES } = await import("../js/config.js");
await import("../js/app.js");
await esperar(20);

const html = () => document.getElementById("app").innerHTML;
const $ = (sel) => document.querySelector(sel);

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

await clic('[data-accion="irCrear"]', "Crear partida");
t("la pantalla de crear detecta la sesión de Spotify", html().includes("Spotify conectado"));

$("#in-nombre").value = "Los Abuelos";
await clic('[data-accion="crearPartida"]', "Crear partida");

const codigo = Object.keys(fb._leer("salas") || {})[0];
t("se ha creado una sala con código de 4 dígitos", /^\d{4}$/.test(codigo || ""));
t("el lobby muestra el código", html().includes(codigo));
sinErrores("lobby");

// Entran otros dos equipos desde sus propios dispositivos.
const COLORES = (await import("../js/config.js")).COLORES_EQUIPO;
for (const [i, nombre] of [[1, "Los Primos"], [2, "Los Peques"]]) {
  fb._escribir(`salas/${codigo}/equipos/eq${i + 1}`, {
    id: "eq" + (i + 1), nombre, color: COLORES[i], orden: i,
    fichas: AJUSTES.fichasIniciales, cartas: [], clienteId: "cliente" + i, conectado: true,
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
    revelados = 0, robosHechos = 0, saltosHechos = 0, filtraciones = 0;

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
