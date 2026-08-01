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

> **Importante — límite de 5 personas.** Mientras tu app de Spotify esté en "modo desarrollo"
> (lo normal, y gratis), **solo 5 cuentas de Spotify pueden usarla**, y hay que añadirlas a mano:
> ve a **Settings → User Management**, pulsa **Add new user** y pon el nombre y el email de
> Spotify de cada persona que vaya a conectar su cuenta (el anfitrión, y cualquiera que aporte
> sus canciones). Es un paso único por persona, no hay que repetirlo en cada partida. Sin
> añadirlas ahí, Spotify les dará error al conectar. Sacar este límite de raíz ("modo extendido")
> exige ser una empresa registrada con más de 250.000 usuarios activos al mes, así que no es una
> opción real para jugar en familia — si sois más de 5 aportando canciones, mira la sección
> **"Más de 5 personas aportando canciones"** más abajo.

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
   export const SPOTIFY_CLIENT_IDS = [
     { id: "a1b2c3d4e5f6...", nombre: "Grupo A" },
   ];

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

## Más de 5 personas aportando canciones

Spotify solo deja 5 cuentas autorizadas por app "en modo desarrollo" (ver el aviso del Paso 2), y
no hay forma de subir ese número sin ser una empresa registrada con 250.000+ usuarios al mes — o
sea, no es una opción real para un juego familiar. La forma de conseguir más hueco es crear una
**segunda app de Spotify** (Spotify deja hasta 25 apps por cuenta de desarrollador) y repartir a
la gente entre ambas: 5 en una, 5 en la otra, etc.

1. Repite el **Paso 2** (Crear la aplicación de Spotify) para crear una segunda app —mismo
   **Redirect URI**, el de siempre— y copia su **Client ID**.
2. En **Settings → User Management** de esta segunda app, añade al segundo grupo de hasta 5
   personas (los que no cupieron en la primera).
3. En `js/config.js`, añade una entrada más a la lista, con un nombre que ayude a la gente a
   saber cuál es la suya (por ejemplo, "Los mayores" / "Los peques", o "Grupo A" / "Grupo B"):

   ```js
   export const SPOTIFY_CLIENT_IDS = [
     { id: "el-client-id-de-la-primera-app", nombre: "Grupo A" },
     { id: "el-client-id-de-la-segunda-app", nombre: "Grupo B" },
   ];
   ```

4. Pulsa **Commit changes**. No hace falta decirle a nadie a qué grupo pertenece ni que elija
   nada: en cuanto haya más de una entrada en la lista, la app prueba sola la primera app
   configurada y, si esa cuenta no está en su lista de autorizados, lo detecta sola y reintenta
   automáticamente con la siguiente — la persona solo ve la pantalla de login de Spotify pedirle
   que entre otra vez, sin ningún selector de por medio.

Con una sola entrada en la lista (lo normal, hasta 5 personas), la app no hace nada de esto —
funciona exactamente igual que siempre.

---

## Cómo jugar

**El anfitrión** (quien tiene Spotify Premium):

1. Abre la web → **Crear partida nueva** → **Conectar Spotify**.
2. Pone el nombre de su equipo, elige el mazo y pulsa **Crear partida**.
3. Aparece un **código de 4 dígitos**. Se lo dice a los demás.
4. Abre Spotify en el móvil o el altavoz donde quiere que suene la música y le da a reproducir
   algo un segundo, para que quede como dispositivo activo (la app usa siempre ese, el que esté
   sonando en Spotify Connect; no hace falta elegir nada dentro del juego).
5. Cuando estén todos, pulsa **Empezar la partida**.

**Los demás equipos**: abren la misma web → **Unirme con un código** → escriben el código. Después eligen
si se **unen a un equipo que ya existe** (por ejemplo, si otro familiar ya creó "Los Abuelos" desde su
propio móvil y quieren jugar juntos desde varios dispositivos) o si **crean un equipo nuevo**. No necesitan
Spotify ni cuenta de nada para jugar.

> **Ojo con los equipos de varios dispositivos:** solo quien **creó** el equipo (el líder) puede jugar
> sus turnos —colocar la carta, robar, responder al bonus, avanzar de ronda—. El resto de dispositivos
> que se unan a ese mismo equipo solo pueden mirar, animar y aportar sus canciones de Spotify. Es para
> evitar líos cuando varios móviles tocan botones a la vez en el mismo equipo.

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
- En vuestro turno podéis gastar **2 fichas** para saltar una canción que no conocéis. Antes de
  cambiarla, la app **enseña la carta boca arriba 5 segundos** para que sepáis qué canción era, y
  luego pasa a la siguiente sola.
- **Gana el primer equipo con 10 cartas** bien ordenadas — con una excepción, ver "Gana por dos"
  más abajo.

El botón **Otros equipos** enseña las cartas de los demás en cualquier momento.

### Gana por dos

Si el equipo que **empezó la partida** es quien llega primero a 10 cartas pero el segundo se queda
a solo una (un 10-9), la partida no se corta ahí: hay que seguir jugando hasta que alguien saque
**2 cartas de ventaja**, como el "gana por dos" del tenis. Veréis un aviso en pantalla mientras dure
esta situación. Si es **cualquier otro equipo** el que llega primero a 10, gana en el momento, como
siempre — la regla solo evita que quien empezó la partida gane por el margen mínimo, ya que arrancar
da una pequeña ventaja. Por si acaso, tiene un tope: si nadie saca esas 2 de ventaja antes de llegar
a 13 cartas, gana quien más lleve en ese momento (para que la partida no se alargue de más).

### El botón «?» de la esquina

Durante la partida hay un botón redondo con un **«?»** flotando en la esquina inferior derecha.
Sirve para varias cosas:

- **Canción rota o claramente equivocada** (a veces Spotify empareja mal una búsqueda): podéis
  **cambiarla sin gastar fichas**. Solo puede hacerlo el líder del equipo en su turno, o el
  anfitrión.
- **Año equivocado en la carta ya revelada** (pasa a veces con reediciones o remasterizaciones):
  escribid el año real y la app **recalcula quién acertó**. Si el equipo que jugó el turno en
  realidad tenía razón, rectifica y se queda la carta; si en realidad tenía razón alguno de los
  que intentaron robar, pasa a ser suya; y si ya no la merece nadie, se la quita a quien la tuviera.
- **No suena la música** (por ejemplo, Spotify no tenía ningún dispositivo activo): el **anfitrión**
  abre Spotify en el móvil o el altavoz, le da a reproducir algo un segundo para que quede activo, y
  pulsa **Reintentar reproducir** en su propio botón «?». Solo lo ve el anfitrión; el resto de
  jugadores ven un aviso pidiéndoselo.
- **Canciones de Spotify que no pegan** (mazo «Spotify» o «Todo»): un botón abre la lista de todo lo
  aportado por el grupo, mostrando solo **título — artista** (sin decir de quién es ni qué año tiene,
  para no delatar a nadie). Cada canción tiene una **✕** para quitarla si alguien decide que es una
  tontería; una vez quitada, no vuelve a salir en esa sala. La misma lista está disponible desde la
  sala de espera, antes de empezar a jugar.

---

## Los mazos

| Mazo | Qué trae |
|---|---|
| **Canciones famosas** | 707 canciones de 1950 a hoy, en español e inglés. Es el recomendado. |
| **Solo en español y latino** | 229 canciones: Mecano, Serrat, Héroes, Estopa, Soda Stereo, Rosalía, Bad Bunny… |
| **Solo en inglés** | 474 canciones. |
| **Canciones de Spotify de los jugadores** | Solo lo que aporte cada persona conectando su Spotify. |
| **Todo** | Lo que aporten los jugadores + las 707 canciones famosas, mezclado. |

El mazo «Canciones de Spotify de los jugadores» depende totalmente de lo que aportéis: si sois
pocos o aportáis poco, la partida puede acabarse antes de llegar a 10 cartas porque se agoten las
canciones disponibles. Si queréis partida larga garantizada, usad «Todo».

### Nuestras canciones (Spotify / Todo): cómo funciona

Cualquier dispositivo (el anfitrión, el líder o cualquiera que se una a un equipo) puede pulsar, en la
sala de espera, **Añadir mis canciones de Spotify**. Cada uno conecta su propia cuenta desde su propio
móvil —no hace falta que todos usen la de Premium del anfitrión, esto solo lee sus canciones
favoritas—. La app combina lo que aporte cada persona y **prioriza las canciones que varios tengáis en
común**: si tú y tu hermano tenéis la misma canción en el top, es más probable que salga que una que
solo escucháis vosotros dos por separado — pero sin pasarse: si el grupo solo comparte una o dos
canciones, no van a salir siempre esas mismas partida tras partida, sigue habiendo sitio real para el
resto.

Antes de sumar, la app **normaliza el peso de cada persona**: si alguien conecta su Spotify y aporta
muchísimas más canciones que otro (más historial, más playlists), no acapara el mazo. Cada persona
"pesa" lo mismo en el reparto global; solo dentro de su propia lista se respeta qué le gusta más.
Además, durante la partida la app **se acuerda de qué aportante ya ha tenido canciones sonando** y
favorece a quien todavía no ha tenido ninguna, para que a todo el que se una con su Spotify le suene
algo suyo en algún momento, en vez de dejarlo todo al azar.

La app también usa la **popularidad** que le da Spotify a cada canción (un dato de 0 a 100, cuánta
gente la escucha) para preferir canciones **medio conocidas** frente a rarezas que solo ha
escuchado quien las aportó — así es más probable que el resto del grupo pueda reconocerlas y
jugar. No las descarta del todo: una canción muy personal y poco conocida sigue pudiendo salir de
vez en cuando, solo que con menos frecuencia.

¿Vais a usar el **mismo móvil varias personas** para aportar (por ejemplo, para probarlo vosotros
mismos)? Después de aportar aparece un botón **Conectar otra cuenta de Spotify**: sin él, el
dispositivo se quedaría con la sesión de la primera persona que se conectó y no habría forma de que
otra persona aportara la suya desde ahí.

¿Alguna canción de las aportadas es una tontería, un error o simplemente no pega con la partida?
Desde la sala de espera (botón **Ver / quitar canciones aportadas**) o, ya en la partida, desde el
botón «?», podéis abrir la lista completa de canciones del grupo (solo título y artista, sin decir
de quién es ni el año) y quitar cualquiera con la ✕. Una vez quitada, no vuelve a salir en esa sala,
ni siquiera si jugáis otra partida ahí.

Para acertar mejor con lo que de verdad te gusta, cada aportación mezcla varias fuentes de Spotify:
tu top de los últimos años, tu top de los últimos 6 meses, lo que has **escuchado recientemente**,
tus canciones con "Me gusta" y las canciones de tus propias playlists (no las que sigues de otra
gente). Se descarta a propósito el "top de las últimas 4 semanas" de Spotify (para eso ya está lo de
"escuchado recientemente", que es más directo).

La primera vez que conectes tu Spotify para aportar canciones, te pedirá permiso para leer tu
biblioteca, tus playlists y tu actividad reciente. Es normal, acepta y ya está. Si conectaste tu
Spotify **antes** de que existieran estos permisos (por ejemplo, si ya jugasteis con una versión
anterior de la app), al pulsar "Añadir mis canciones de Spotify" la app se dará cuenta de que faltan
permisos y te llevará otra vez a la pantalla de Spotify para dártelos — no hace falta hacer nada
especial, solo aceptar de nuevo.

El top personal de todo el mundo suele estar lleno de música actual (es lo que más se escucha).
Para que la partida no se quede solo en canciones de los últimos años, la app sortea primero la
década (dando más peso a partir de 1964, igual que en el mazo curado) y solo después mira qué
canción de esa década tenéis en común. Aun así, si nadie ha escuchado nada de, por ejemplo, los 80,
no va a aparecer de la nada: solo se reparte mejor lo que sí tenéis.

Los años del mazo curado están puestos a mano y comprobados: son el año de lanzamiento original,
no el del disco remasterizado. Por eso la app **nunca** usa el año que da Spotify para ese mazo.

> Los mazos «Spotify de los jugadores» y «Todo» son la excepción: ahí el año sale del álbum de
> Spotify y en remasterizaciones o recopilatorios puede fallar. Para eso está el botón de
> corregir el año en el momento.

### Añadir o corregir canciones

Están todas en `js/canciones.js`, una por línea:

```js
["Título de la canción", "Artista", 1985, "es"],
```

El último valor es `"int"` (inglés), `"es"` (español/latino) u `"otro"` (otros idiomas: solo unas
pocas, para que el mazo «Canciones famosas» y «Todo» las incluyan pero no salgan en «Solo en
inglés»). Añade las que quieras al final de la lista, antes del `];`.

---

## Si algo no va

| Problema | Qué hacer |
|---|---|
| «INVALID_CLIENT: Invalid redirect URI» | La dirección de **Redirect URIs** en Spotify no es idéntica a la de tu web. Tiene que llevar `https://`, el `/hitster/` y **la barra final**. |
| «Spotify no encuentra ningún dispositivo activo» | Abre Spotify en el móvil o el altavoz del anfitrión y dale a reproducir cualquier cosa un segundo, para que quede como dispositivo activo. Después, el anfitrión pulsa **Reintentar reproducir** en el botón «?» de la esquina (no hace falta refrescar la página ni saltar la canción). |
| No suena nada en el iPad | Abre la app de Spotify en el propio iPad (o en un altavoz/móvil aparte) y dale a play un segundo. Si ya estabais a mitad de ronda, el anfitrión puede pulsar **Reintentar reproducir** en el botón «?» en vez de perder la canción. |
| «Este reproductor necesita Spotify Premium» | La cuenta del anfitrión no es Premium. Es un requisito de Spotify, no hay forma de saltárselo. |
| Los demás equipos no ven la partida | Revisa que `databaseURL` esté en `config.js` y que publicaste las reglas de Firebase. |
| Se cerró la pestaña del anfitrión | Volved a entrar en la web: la partida se recupera sola. Si el anfitrión sale con el botón **Salir**, la partida se borra. |
| Un familiar no puede colocar la carta ni robar | Es normal si no fue quien creó ese equipo: solo el líder del equipo juega los turnos. El resto puede aportar canciones de Spotify y mirar. |
| «No he encontrado canciones tuyas en Spotify» aunque sí tenga historial | Si ya tenía la sesión conectada de antes, probablemente le faltan permisos nuevos (biblioteca, playlists, reproducciones recientes — el "top" no hace falta, es opcional). La app detecta esto sola en la mayoría de los casos y le lleva otra vez a la pantalla de Spotify para darlos. Si aun así vuelve a salir el aviso, ahora incluye un detalle por fuente (top, recientes, guardadas, playlists) para saber cuál es la que falla — si alguna dice "error 429", es un límite temporal de peticiones de Spotify: basta con esperar un minuto y reintentarlo. |
| «Leyendo tus canciones de Spotify…» se queda colgado varios minutos | Ya no debería pasar: cada petición a Spotify tiene un límite de 12 segundos, y si falla la primera, se corta ahí en vez de seguir intentando fuente a fuente. Si aun así tarda mucho o el aviso dice "no se ha podido conectar con Spotify", prueba con otra red (datos móviles en vez de wifi), sin bloqueadores de anuncios ni VPN — algo de por medio puede estar cortando las peticiones a `api.spotify.com` antes de que lleguen. |

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
