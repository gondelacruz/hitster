// Configuración falsa para las pruebas (la real tiene los "PEGA_AQUI").
export { AJUSTES, COLORES_EQUIPO, COLORES_CARTA } from "../../js/config.js";
// Array mutable a propósito: algunas pruebas empujan una segunda entrada
// temporalmente para comprobar el selector de "con qué app conectarse"
// cuando hay más de una configurada, y la quitan al terminar.
export const SPOTIFY_CLIENT_IDS = [{ id: "client_id_de_pruebas", nombre: "Grupo A" }];
export const FIREBASE_CONFIG = {
  apiKey: "test", authDomain: "test", databaseURL: "https://test.firebaseio.com",
  projectId: "test", storageBucket: "test", messagingSenderId: "1", appId: "1",
};
