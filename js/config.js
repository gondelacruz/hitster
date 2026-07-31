// ============================================================
//  CONFIGURACIÓN — ESTO ES LO ÚNICO QUE TIENES QUE TOCAR
//  Sigue las instrucciones del archivo LEEME.md
// ============================================================

// 1) Pega aquí el "Client ID" de tu app de Spotify Developer
export const SPOTIFY_CLIENT_ID = "PEGA_AQUI_TU_CLIENT_ID";

// 2) Pega aquí la configuración de tu proyecto de Firebase
export const FIREBASE_CONFIG = {
  apiKey: "PEGA_AQUI",
  authDomain: "PEGA_AQUI",
  databaseURL: "PEGA_AQUI",
  projectId: "PEGA_AQUI",
  storageBucket: "PEGA_AQUI",
  messagingSenderId: "PEGA_AQUI",
  appId: "PEGA_AQUI",
};

// ------------------------------------------------------------
//  Ajustes del juego (puedes cambiarlos si queréis otro ritmo)
// ------------------------------------------------------------
export const AJUSTES = {
  cartasParaGanar: 10,     // cartas necesarias para ganar
  segundosTurno: 180,      // 3 minutos para colocar la carta
  segundosRobo: 45,        // tiempo de cada equipo para decidir si roba
  fichasIniciales: 3,
  fichasMaximas: 5,
  fichasParaSaltar: 2,
  maxEquipos: 4,
};

export const COLORES_EQUIPO = [
  { id: "coral",   nombre: "Coral",    hex: "#FF5A5F" },
  { id: "turquesa",nombre: "Turquesa", hex: "#00C2B2" },
  { id: "ambar",   nombre: "Ámbar",    hex: "#FFB020" },
  { id: "lila",    nombre: "Lila",     hex: "#A374FF" },
];

// Paleta de las cartas (estilo Hitster)
export const COLORES_CARTA = [
  "#E8503A", "#00A6A0", "#F2A93B", "#7B5AD6",
  "#2E8BC0", "#E0518F", "#5BAF56", "#D94F70",
];
