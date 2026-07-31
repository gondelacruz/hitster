# Hitster Familia

Juego de adivinar el año de las canciones, para jugar en casa con varios iPads o móviles.
Un equipo hace de anfitrión (pone la música con su Spotify) y los demás entran con un código de 4 dígitos.

**No hace falta programar nada.** Solo copiar y pegar tres cosas en un archivo.

---

## Lo que necesitas antes de empezar

- Una cuenta de **Spotify Premium** (solo la del anfitrión; los demás no necesitan Spotify).
- Una cuenta de **GitHub** (ya la tienes).
- Una cuenta de **Google/Gmail** para Firebase (ya la tienes: gdelacruz021@gmail.com).

Tiempo total: unos 15 minutos, y solo se hace una vez.

---

## Paso 1 — Subir la web a GitHub

1. Entra en <https://github.com/new>.
2. En **Repository name** escribe `hitster` y marca **Public**. Pulsa **Create repository**.
3. En la página que aparece, pulsa el enlace **uploading an existing file**.
4. Arrastra ahí **el contenido de esta carpeta**: `index.html`, `styles.css` y las carpetas `js` y `test`.
   (No hace falta subir `node_modules` si aparece.)
5. Pulsa **Commit changes**.

### Activar la web

6. En el repositorio, ve a **Settings** (arriba) → **Pages** (menú de la izquierda).
7. En **Source** elige **Deploy from a branch**, rama **main**, carpeta **/ (root)**. Pulsa **Save**.
8. Espera 1-2 minutos y recarga. GitHub te dará una dirección así:

   ```
   https://TU-USUARIO.github.io/hitster/
   ```

   **Apunta esa dirección**: es tu juego, y la vas a necesitar en el paso siguiente.

Si entras ahora, verás una pantalla que dice «falta configurar». Es normal.

---

## Paso 2 — Crear la aplicación de Spotify

1. Entra en <https://developer.spotify.com/dashboard> con tu cuenta de Spotify.
2. Pulsa **Create app**.
3. Rellena:
   - **App name**: `Hitster Familia`
   - **App description**: `Juego familiar`
   - **Redirect URIs**: pega **exactamente** la dirección del paso 1, con la barra final:
     ```
     https://TU-USUARIO.github.io/hitster/
     ```
   - **Which API/SDKs are you planning to use?**: marca **Web API** y **Web Playback SDK**.
4. Acepta los términos y pulsa **Save**.
5. Entra en la app → **Settings**. Copia el **Client ID** (una cadena larga de letras y números).

> Si quiere hacer de anfitrión otra persona de la familia, ve a **Settings → User Management**
> y añade su nombre y su email de Spotify. Sin eso, Spotify le dará error al conectar.

---

## Paso 3 — Crear la base de datos (Firebase)

Sirve para que los iPads se vean entre ellos en tiempo real. Es gratis.

1. Entra en <https://console.firebase.google.com> y pulsa **Crear un proyecto**.
2. Nombre: `hitster-familia`. Puedes **desactivar** Google Analytics. Pulsa **Crear proyecto**.
3. En el menú de la izquierda: **Compilación → Realtime Database** → **Crear base de datos**.
   - Ubicación: la que te ofrezca (Europa si está disponible).
   - Reglas de seguridad: elige **Iniciar en modo de prueba** y pulsa **Habilitar**.
4. Ve a la pestaña **Reglas** de la Realtime Database, borra lo que haya y pega esto:

   ```json
   {
     "rules": {
       "salas": {
         "$codigo": {
           ".read": true,
           ".write": true,
           ".validate": "$codigo.matches(/^[0-9]{4}$/)"
         }
       }
     }
   }
   ```

   Pulsa **Publicar**. (Cualquiera que adivine un código de 4 dígitos podría ver esa partida.
   Para jugar en familia está bien; no se guarda ningún dato personal.)

5. Ahora la configuración: pulsa el engranaje ⚙️ arriba a la izquierda → **Configuración del proyecto**.
6. Baja hasta **Tus apps** y pulsa el icono **`</>`** (Web).
7. Apodo: `hitster`. **No** marques Firebase Hosting. Pulsa **Registrar app**.
8. Te mostrará un bloque de código con `const firebaseConfig = { ... }`. **Copia lo que hay entre las llaves.**

---

## Paso 4 — Pegar las dos cosas en el archivo de configuración

1. En tu repositorio de GitHub, entra en la carpeta `js` y pulsa el archivo `config.js`.
2. Pulsa el lápiz ✏️ (**Edit this file**).
3. Sustituye:

   - `PEGA_AQUI_TU_CLIENT_ID` por el **Client ID** de Spotify (déjalo entre comillas).
   - Todo el bloque `FIREBASE_CONFIG` por el que copiaste de Firebase.

   Debe quedar parecido a esto:

   ```js
   export const SPOTIFY_CLIENT_ID = "a1b2c3d4e5f6...";

   export const FIREBASE_CONFIG = {
     apiKey: "AIzaSy...",
     authDomain: "hitster-familia.firebaseapp.com",
     databaseURL: "https://hitster-familia-default-rtdb.europe-west1.firebasedatabase.app",
     projectId: "hitster-familia",
     storageBucket: "hitster-familia.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123",
   };
   ```

   > Importante: tiene que aparecer `databaseURL`. Si Firebase no te lo dio, cópialo de la
   > pantalla de Realtime Database (es la dirección que sale arriba, empieza por `https://`).

4. Pulsa **Commit changes**. Espera un minuto a que GitHub republique la web.

**Ya está.** Abre `https://TU-USUARIO.github.io/hitster/` en el iPad.

---

## Cómo jugar

**El anfitrión** (quien tiene Spotify Premium):

1. Abre la web → **Crear partida nueva** → **Conectar Spotify**.
2. Pone el nombre de su equipo, elige el mazo y pulsa **Crear partida**.
3. Aparece un **código de 4 dígitos**. Se lo dice a los demás.
4. Elige dónde suena la música: un altavoz o el móvil donde ya tenga Spotify abierto
   (**Elegir altavoz de Spotify**), o el propio navegador (**Sonar en este dispositivo**).
5. Cuando estén todos, pulsa **Empezar la partida**.

**Los demás equipos**: abren la misma web → **Unirme con un código** → escriben el código y su nombre.
No necesitan Spotify ni cuenta de nada.

### Las reglas

- Cada equipo empieza con **una carta** y **3 fichas** (máximo 5).
- En tu turno suena una canción y ves una carta boca abajo. Tenéis **3 minutos** para elegir
  el hueco de vuestra línea del tiempo donde creéis que encaja por año, y pulsáis **Finalizar**.
- Después, los demás equipos, **por orden de juego**, pueden gastar **1 ficha** para poner su ficha
  en otro hueco. Dos equipos no pueden pedir el mismo hueco.
- Si el equipo del turno acierta, se queda la carta y se le pregunta si también acertó
  **artista y título**; si dicen que sí, ganan una ficha.
- Si falla, el primer equipo (por orden de juego) que haya acertado el hueco **le roba la carta**.
  Si nadie acierta, la carta se descarta.
- En vuestro turno podéis gastar **2 fichas** para saltar una canción que no conocéis.
- **Gana el primer equipo con 10 cartas** bien ordenadas.

El botón **Otros equipos** enseña las cartas de los demás en cualquier momento.

---

## Los mazos

| Mazo | Qué trae |
|---|---|
| **Mixto** | 707 canciones de 1950 a hoy, internacionales y en español. Es el recomendado. |
| **Solo internacional** | 478 canciones. |
| **Solo español y latino** | 229 canciones: Mecano, Serrat, Héroes, Estopa, Soda Stereo, Rosalía, Bad Bunny… |
| **Nuestras canciones** | Mezcla tus más escuchadas de Spotify con el mazo curado. |

Los años del mazo curado están puestos a mano y comprobados: son el año de lanzamiento original,
no el del disco remasterizado. Por eso la app **nunca** usa el año que da Spotify.

> El mazo «Nuestras canciones» es la excepción: ahí el año sale del álbum de Spotify y en
> remasterizaciones o recopilatorios puede fallar. Si alguien protesta, tiene razón.

### Añadir o corregir canciones

Están todas en `js/canciones.js`, una por línea:

```js
["Título de la canción", "Artista", 1985, "es"],
```

El último valor es `"int"` (internacional) o `"es"` (español/latino). Añade las que quieras
al final de la lista, antes del `];`.

---

## Si algo no va

| Problema | Qué hacer |
|---|---|
| «INVALID_CLIENT: Invalid redirect URI» | La dirección de **Redirect URIs** en Spotify no es idéntica a la de tu web. Tiene que llevar `https://`, el `/hitster/` y **la barra final**. |
| «Spotify no encuentra un dispositivo activo» | Abre Spotify en el móvil o el altavoz, dale a play a cualquier cosa un segundo, y en el juego pulsa **Cambiar altavoz**. |
| No suena nada en el iPad | Safari en iPad bloquea el audio si no lo lanza un toque. Usa mejor **Elegir altavoz de Spotify** apuntando a un altavoz o al móvil. |
| «Este reproductor necesita Spotify Premium» | La cuenta del anfitrión no es Premium. Es un requisito de Spotify, no hay forma de saltárselo. |
| Los demás equipos no ven la partida | Revisa que `databaseURL` esté en `config.js` y que publicaste las reglas de Firebase. |
| Se cerró la pestaña del anfitrión | Volved a entrar en la web: la partida se recupera sola. Si el anfitrión sale con el botón **Salir**, la partida se borra. |

---

## Para curiosos (no hace falta leer esto)

La web es estática: no hay servidor propio. El login de Spotify usa **PKCE**, así que no hay
ninguna contraseña ni secreto guardado en el código. El estado de la partida vive en Firebase y
el dispositivo del anfitrión es el que manda: reparte las canciones, controla los tiempos y calcula
los resultados. La carta en juego se guarda ofuscada para que no se pueda ver el año abriendo la
consola del navegador.

Hay pruebas automáticas. Con Node instalado:

```bash
npm install          # solo la primera vez
npm test
```

- `test/pruebas.mjs`: 34 comprobaciones de las reglas + 180 partidas simuladas.
- `test/partida.mjs`: arranca la app entera en un navegador simulado (con Firebase y Spotify
  falsos) y juega una partida completa de 3 equipos pulsando botones.
