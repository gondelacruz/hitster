// ============================================================
//  CONFIGURACIÓN — ESTO ES LO ÚNICO QUE TIENES QUE TOCAR
//  Sigue las instrucciones del archivo LEEME.md
// ============================================================

// 1) Pega aquí el "Client ID" de tu app de Spotify Developer.
//    Con una sola entrada os vale a casi todos. Si sois muchos aportando
//    canciones y os topáis con el límite de Spotify (una app en modo
//    desarrollo solo admite 5 personas autorizadas — ver LEEME.md), puedes
//    crear una SEGUNDA app en developer.spotify.com/dashboard, autorizar en
//    ella a otro grupo de hasta 5 personas, y añadir su Client ID aquí como
//    una entrada más. La app dejará elegir con cuál conectarse en cuanto
//    haya más de una.
export const SPOTIFY_CLIENT_IDS = [
  { id: "6a7b96a2dbe14a2ea0648a9793b69d6d", nombre: "Grupo A" },
  { id: "aefd3c956c684cce86e5e8ef1a7851af", nombre: "Grupo B" },
];

// 2) Pega aquí la configuración de tu proyecto de Firebase
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCCE4qI5eq4fWvYVJNGzNlDhBukTLI5fhM",
  authDomain: "hitster-familia.firebaseapp.com",
  databaseURL: "https://hitster-familia-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "hitster-familia",
  storageBucket: "hitster-familia.firebasestorage.app",
  messagingSenderId: "1071974451984",
  appId: "1:1071974451984:web:4a8516e45aae2859d3f395",
  measurementId: "G-B9R8NJ3QFV"
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
