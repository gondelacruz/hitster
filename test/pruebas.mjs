// Pruebas de las reglas + simulación de partidas completas.
// Ejecutar con:  node test/pruebas.mjs
import * as R from "../js/reglas.js";
import { AJUSTES, COLORES_EQUIPO } from "../js/config.js";
import { CANCIONES } from "../js/canciones.js";

let ok = 0, fallos = 0;
const t = (nombre, cond) => {
  if (cond) { ok++; } else { fallos++; console.error("  ✗ " + nombre); }
};

const cartas = (...anios) => anios.map((a, i) => ({ titulo: "c" + i, artista: "a", anio: a }));

// ---------------------------------------------------------------- slotValido
{
  const l = cartas(1970, 1985, 2000);
  t("antes del primero, año menor", R.slotValido(l, 1960, 0) === true);
  t("antes del primero, año mayor", R.slotValido(l, 1990, 0) === false);
  t("en medio correcto", R.slotValido(l, 1980, 1) === true);
  t("en medio incorrecto", R.slotValido(l, 1995, 1) === false);
  t("al final correcto", R.slotValido(l, 2010, 3) === true);
  t("al final incorrecto", R.slotValido(l, 1990, 3) === false);
  t("slot fuera de rango", R.slotValido(l, 1980, 9) === false);
  t("slot null", R.slotValido(l, 1980, null) === false);
  t("línea vacía, cualquier año vale", R.slotValido([], 1999, 0) === true);
}

// -------------------------------------------------------------- años iguales
{
  const l = cartas(1970, 1985, 2000);
  t("empate: vale a la izquierda", R.slotValido(l, 1985, 1) === true);
  t("empate: vale a la derecha", R.slotValido(l, 1985, 2) === true);
  t("empate: dos slots válidos", JSON.stringify(R.slotsValidos(l, 1985)) === "[1,2]");
  t("sin empate: un solo slot", R.slotsValidos(l, 1990).length === 1);
}

// ------------------------------------------------------------------- inserción
{
  const l = R.insertarOrdenada(cartas(1970, 2000), { titulo: "x", artista: "a", anio: 1985 });
  t("insertar mantiene el orden", l.map((c) => c.anio).join() === "1970,1985,2000");
}

// ------------------------------------------------------------- orden de robo
{
  const eqs = {};
  ["A", "B", "C", "D"].forEach((n, i) => { eqs[n] = { id: n, nombre: n, orden: i, fichas: 3, cartas: [] }; });
  t("orden de robo empieza por el siguiente", JSON.stringify(R.ordenDeRobo(eqs, "B")) === '["C","D","A"]');
  t("siguiente equipo cicla", R.siguienteEquipo(eqs, "D") === "A");
  t("con 2 equipos solo roba el otro",
     JSON.stringify(R.ordenDeRobo({ A: eqs.A, B: eqs.B }, "A")) === '["B"]');
}

// --------------------------------------------------------------- slots ocupados
{
  const oc = R.slotsOcupados({ colocacion: 2, robos: { B: 0, C: "pasa", D: 4 } });
  t("ocupados incluye la colocación", oc.has(2));
  t("ocupados incluye robos numéricos", oc.has(0) && oc.has(4));
  t("ocupados ignora los que pasan", oc.size === 3);
}

// ------------------------------------------------------------------- resolver
{
  const eqs = {
    A: { id: "A", orden: 0, fichas: 3, cartas: cartas(1970, 2000) },
    B: { id: "B", orden: 1, fichas: 3, cartas: [] },
    C: { id: "C", orden: 2, fichas: 3, cartas: [] },
  };
  // El activo acierta: se queda la carta, los ladrones pierden su ficha igual.
  let r = R.resolverRonda({
    equipos: eqs, anioCarta: 1985,
    ronda: { equipoActivo: "A", colocacion: 1, robos: { B: 0, C: "pasa" } },
  });
  t("activo acierta y se lleva la carta", r.aciertoActivo && r.ganadorCarta === "A");
  t("el robo fallido cuesta ficha", r.equipos.B.fichas === 2);
  t("pasar no cuesta ficha", r.equipos.C.fichas === 3);

  // El activo falla y B acierta.
  r = R.resolverRonda({
    equipos: eqs, anioCarta: 1985,
    ronda: { equipoActivo: "A", colocacion: 0, robos: { B: 1, C: 2 } },
  });
  t("activo falla", r.aciertoActivo === false);
  t("el ladrón que acierta se lleva la carta", r.ganadorCarta === "B");
  t("ambos ladrones pagan ficha", r.equipos.B.fichas === 2 && r.equipos.C.fichas === 2);

  // Nadie acierta: la carta se descarta.
  r = R.resolverRonda({
    equipos: eqs, anioCarta: 1985,
    ronda: { equipoActivo: "A", colocacion: 0, robos: { B: 2, C: "pasa" } },
  });
  t("si nadie acierta la carta se descarta", r.ganadorCarta === null);

  // Empate de años: gana el primero en orden de juego.
  const eqs2 = {
    A: { id: "A", orden: 0, fichas: 3, cartas: cartas(1985, 1985) },
    B: { id: "B", orden: 1, fichas: 3, cartas: [] },
    C: { id: "C", orden: 2, fichas: 3, cartas: [] },
  };
  r = R.resolverRonda({
    equipos: eqs2, anioCarta: 1985,
    ronda: { equipoActivo: "A", colocacion: 9, robos: { B: 0, C: 1 } },
  });
  t("con dos aciertos gana el primero en orden de juego", r.ganadorCarta === "B");
}

// ------------------------------------------------------------------- fichas
{
  t("la ficha extra respeta el máximo", R.sumarFicha({ fichas: AJUSTES.fichasMaximas }) === AJUSTES.fichasMaximas);
  t("la ficha extra suma", R.sumarFicha({ fichas: 2 }) === 3);
}

// ------------------------------------------------------------------ victoria
{
  const eqs = {
    A: { id: "A", orden: 0, cartas: new Array(AJUSTES.cartasParaGanar).fill({ anio: 1 }) },
    B: { id: "B", orden: 1, cartas: [] },
  };
  t("gana con 10 cartas", R.comprobarVictoria(eqs) === "A");
  t("sin ganador devuelve null", R.comprobarVictoria({ B: eqs.B }) === null);
}

// ------------------------------------------------------------------- código
{
  const cs = new Set();
  for (let i = 0; i < 3000; i++) cs.add(R.generarCodigo());
  t("el código siempre son 4 dígitos", [...cs].every((c) => /^\d{4}$/.test(c)));
}

// ============================================================
//  SIMULACIÓN DE PARTIDAS COMPLETAS
// ============================================================
function simular(nEquipos, semilla) {
  let s = semilla;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;

  const mazo = CANCIONES.map(([titulo, artista, anio]) => ({ titulo, artista, anio }));
  const usadas = new Set();
  const sacar = () => {
    for (let i = 0; i < 200; i++) {
      const c = mazo[Math.floor(rnd() * mazo.length)];
      if (!usadas.has(c.titulo + c.artista)) { usadas.add(c.titulo + c.artista); return c; }
    }
    return null;
  };

  let equipos = {};
  for (let i = 0; i < nEquipos; i++) {
    const id = "eq" + (i + 1);
    equipos[id] = { id, nombre: id, color: COLORES_EQUIPO[i], orden: i,
                    fichas: AJUSTES.fichasIniciales, cartas: [sacar()] };
  }

  let activo = "eq1", rondas = 0;
  while (!R.comprobarVictoria(equipos) && rondas < 5000) {
    rondas++;
    const carta = sacar();
    if (!carta) break;

    const timeline = R.ordenar(equipos[activo].cartas);

    // A veces saltan la canción si tienen fichas.
    if (equipos[activo].fichas >= AJUSTES.fichasParaSaltar && rnd() < 0.08) {
      equipos[activo].fichas -= AJUSTES.fichasParaSaltar;
      continue;
    }

    // Colocación: aciertan ~55% de las veces.
    const buenos = R.slotsValidos(timeline, carta.anio);
    const colocacion = rnd() < 0.55
      ? buenos[Math.floor(rnd() * buenos.length)]
      : Math.floor(rnd() * (timeline.length + 1));

    // Robos, respetando huecos únicos y que tengan fichas.
    const robos = {};
    const ronda = { equipoActivo: activo, colocacion, robos };
    for (const id of R.ordenDeRobo(equipos, activo)) {
      if (equipos[id].fichas < 1 || rnd() < 0.45) { robos[id] = "pasa"; continue; }
      const libres = [];
      const oc = R.slotsOcupados(ronda);
      for (let i = 0; i <= timeline.length; i++) if (!oc.has(i)) libres.push(i);
      if (!libres.length) { robos[id] = "pasa"; continue; }
      robos[id] = rnd() < 0.5 && buenos.filter((b) => libres.includes(b)).length
        ? buenos.filter((b) => libres.includes(b))[0]
        : libres[Math.floor(rnd() * libres.length)];
    }

    const res = R.resolverRonda({ equipos, ronda, anioCarta: carta.anio });
    equipos = R.entregarCarta(res.equipos, res.ganadorCarta, carta);
    if (res.aciertoActivo && rnd() < 0.3) {
      equipos[activo].fichas = R.sumarFicha(equipos[activo]);
    }

    // ---- invariantes que deben cumplirse SIEMPRE ----
    for (const e of Object.values(equipos)) {
      const anios = e.cartas.map((c) => c.anio);
      if (anios.some((a, i) => i && a < anios[i - 1])) throw new Error("línea temporal desordenada");
      if (e.fichas < 0 || e.fichas > AJUSTES.fichasMaximas) throw new Error("fichas fuera de rango: " + e.fichas);
      if (e.cartas.some((c) => !c || !c.anio)) throw new Error("carta inválida en la línea");
    }
    const titulos = Object.values(equipos).flatMap((e) => e.cartas.map((c) => c.titulo + c.artista));
    if (new Set(titulos).size !== titulos.length) throw new Error("carta duplicada entre equipos");

    activo = R.siguienteEquipo(equipos, activo);
  }
  return { rondas, ganador: R.comprobarVictoria(equipos), equipos };
}

console.log("\nSimulando partidas…");
let terminadas = 0, totalRondas = 0;
for (let n = 2; n <= 4; n++) {
  for (let i = 0; i < 60; i++) {
    const r = simular(n, 7919 * (i + 1) + n);
    if (r.ganador) { terminadas++; totalRondas += r.rondas; }
    else { fallos++; console.error(`  ✗ partida de ${n} equipos sin ganador (${r.rondas} rondas)`); }
  }
}
t("todas las partidas simuladas terminan con ganador", terminadas === 180);
console.log(`  180 partidas simuladas · media de ${Math.round(totalRondas / terminadas)} rondas por partida`);

console.log(`\n${fallos === 0 ? "✓ TODO CORRECTO" : "✗ HAY FALLOS"} — ${ok} pruebas pasadas, ${fallos} fallidas\n`);
process.exit(fallos ? 1 : 0);
