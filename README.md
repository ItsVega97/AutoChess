# Nakama Royale

Demo jugable de un **auto-battler online en 3D** con temática pirata (One Piece),
inspirado en la jugabilidad de *Tactics Royale* (Clash Royale) y en autobattlers
tipo TFT: compras en tienda, banquillo, tablero, fusiones de unidades y combates
automáticos por rondas contra otro jugador en tiempo real (o contra una IA para
probarlo tú solo al instante).

El combate se juega sobre una **ilustración de la cubierta del Thousand Sunny**:
el tablero son las casillas que ya vienen pintadas en el dibujo, y encima se
colocan los personajes en 3D. Son 5x3 casillas por jugador y 12 puntos de vida
cada uno — partidas rápidas, de unas 5-8 rondas.

La escena 3D ocupa toda la pantalla y la interfaz va **superpuesta** encima
(estilo Tactics Royale), de modo que la partida entra siempre en una sola
pantalla de móvil sin necesidad de desplazarse.

## Cómo jugar (local)

```bash
npm install
npm start
```

Abre `http://localhost:3000` en el navegador.

Arriba se elige el modo — **⚔️ 1v1** o **🏴‍☠️ 4 piratas** — y ese modo vale para
los dos botones:

- **🤖 Jugar vs CPU**: empieza al instante, con 1 o 3 bots según el modo.
- **Jugar Online**: te mete en la cola de ese modo (hacen falta 2 o 4 jugadores).
  En **4 piratas**, si en la cola ya sois **dos o más**, aparece un botón para
  empezar ya rellenando los huecos que falten con bots.
  Abre la misma URL en **otra pestaña, otro navegador o desde otro dispositivo en
  la misma red** (usando la IP de la máquina, ej. `http://192.168.1.x:3000`) y
  pulsa también "Jugar Online" para emparejar jugadores reales.

### Modo 4 piratas

Cuatro tripulaciones en la misma mesa. Cada ronda te toca **un rival distinto**
(no repite dos rondas seguidas) y todos comparten la misma fase de preparación.
Cuando el número de vivos es impar, uno **descansa** esa ronda por turnos. Vas
cayendo hasta que solo queda uno: al morir se te dice tu puesto (4º, 3º, 2º) y
arriba a la derecha tienes el marcador con la vida de los cuatro.

**Si alguien se va**, tiene 30 segundos para volver; pasados esos, se le trata
como a cualquier otro eliminado y **la partida sigue** con el resto (solo sale
un aviso arriba). Si le tocaba pelear contigo esa ronda, el combate se anula y
tú descansas. La partida únicamente se acaba cuando ya no queda con quien
pelear, y entonces por la vía normal: el que queda **gana**.

## Cómo cambiar el nombre (y la URL) de la web

El nombre visible ya es **Nakama Royale** (pestaña del navegador, logo,
`package.json`). Lo único que sigue diciendo `pokechess-royale` es el **nombre
del servicio en Render**, que es de donde sale la URL
`https://pokechess-royale.onrender.com`:

1. En [dashboard.render.com](https://dashboard.render.com) entra en el servicio →
   **Settings** → **Name** → cámbialo a `nakama-royale` → **Save**.
   La URL pasa a ser `https://nakama-royale.onrender.com` **al instante**, y la
   antigua deja de funcionar (avisa a quien tenga el enlace guardado).
2. Después cambia también la línea `name:` de `render.yaml` para que coincida:

   ```yaml
   services:
     - type: web
       name: nakama-royale
   ```

   Si cambias el `render.yaml` **sin** haber renombrado antes en el panel, Render
   ve un servicio nuevo y te crea un segundo despliegue en vez de renombrar el
   que ya tienes.

Con un dominio propio (`nakamaroyale.com`, por ejemplo) es **Settings → Custom
Domains** en Render y un registro CNAME en tu proveedor de dominio; el
certificado HTTPS lo pone Render solo.

## Cómo desplegarlo para jugar online de verdad (con otra persona en internet)

Este repo es un servidor Node.js + Socket.io autocontenido, sin base de datos.
Incluye un `render.yaml` (Render Blueprint) para desplegarlo en 2-3 clics, gratis:

1. Entra en [render.com](https://render.com) (puedes registrarte con tu cuenta de
   GitHub, plan gratuito).
2. **New +** → **Blueprint** → conecta este repositorio.
3. Render detecta `render.yaml` automáticamente (build `npm install`, arranque
   `npm start`, puerto vía `process.env.PORT`, ya soportado) → **Apply**.
4. En 1-2 minutos tendrás una URL pública. Compártela: cualquiera que la abra
   puede pulsar "Jugar Online" y emparejarse con otro jugador conectado en ese
   momento.

También funciona igual en Railway o Fly.io si los prefieres (mismo comando de
arranque `npm start` y puerto por `process.env.PORT`).

> Nota: el plan gratuito de Render "duerme" el servicio tras ~15 min sin tráfico
> y tarda unos segundos en despertar con la primera visita — normal en free tier,
> no afecta a la partida una vez cargada.

## Cómo se juega

1. **Fase de preparación (30s)**: compra personajes en la tienda, tócalos para
   seleccionarlos y luego toca una casilla de tu mitad de la cubierta para
   colocarlos. La ronda dura siempre esos 30 segundos: no hay botón de "listo",
   así que nadie puede adelantarle el combate a los demás.
   La tienda enseña **4 personajes** y **se renueva entera cada vez que compras
   uno**: es la única forma de cambiar la oferta, no hay botón de reroll. Entre
   rondas **no cambia**, así que lo que no compraste sigue esperándote. Comprar
   se puede **también durante el combate**: la ficha espera en el banquillo y
   entra en la ronda siguiente (colocar y vender sí son cosa de la preparación).
   Los **40 personajes están disponibles desde la primera ronda**, capitanes
   incluidos: lo que cambia es lo raro que es que salga cada uno según su coste.

   | Coste | Probabilidad por hueco |
   |---|---|
   | 1 🪙 | 28% |
   | 2 🪙 | 24% |
   | 3 🪙 | 20% |
   | 4 🪙 | 16% |
   | 5 🪙 (capitán) | 12% |

   Están **bastante igualadas a propósito**: los costes altos aparecen lo
   bastante como para poder ir a por ellos, y los de 1 dejan de inundar la
   tienda. Lo que de verdad frena a los capitanes es su precio, no que no
   salgan. Con 4 huecos eso es un **40% de tiendas con capitán**.

   En una misma tienda **nunca se repite personaje**: no vas a ver dos Usopp a
   la vez. Para juntar copias hay que ir comprando en tiendas distintas.
2. **Combate automático**: tu tripulación lucha sola contra la del rival, con la
   formación exacta en la que la colocaste. Gana quien deje unidades vivas. El
   daño va como en Tactics Royale: **1 punto por cada tropa que le sobreviva al
   ganador, más 1 por haber ganado**. Ganar con dos tropas en pie quita 3 de los
   12 puntos de vida del rival.
3. **Cupo de tropas**: empiezas pudiendo desplegar **una sola tropa**, y ganas un
   hueco después de cada combate hasta un máximo de **6**. El marcador de arriba
   (⚔️ 3/4) dice cuántas llevas en cubierta y cuántas te caben; no es un nivel.
   Con el cupo lleno solo puedes cambiar una tropa por otra del banquillo.
   La partida acaba cuando uno de los dos llega a 0 de sus 12 puntos de vida.
   Si sueltas una tropa **encima de otra que ya está en cubierta**, las dos se
   **intercambian** de casilla; si la que sueltas viene del banquillo, la que
   estaba baja al hueco que acaba de quedar libre.
4. **Fusión**: consigue 2 copias iguales de un personaje (mismo nivel de estrella)
   y se fusionan automáticamente en la siguiente estrella, hasta un máximo de ⭐⭐⭐⭐.
5. **Vender**: selecciona una ficha y toca la papelera (que te dice por cuánto
   se vende). Devuelve lo que costaron todas las copias que lleva dentro **menos
   una moneda**, así que rotar el equipo cuesta algo. Un coste 3 a ⭐ se vende
   por 2; a ⭐⭐ (2 copias, 6 🪙) por 5; a ⭐⭐⭐ (4 copias, 12 🪙) por 11.
6. **Habilidades**: cada personaje llena su barra de maná (azul, debajo de la de
   vida) atacando y encajando golpes. Al llenarla lanza su técnica — desde el
   *Hiken* de Ace hasta el *Shima Yurashi* de Barbablanca. Puedes consultar la
   habilidad de cada uno pasando el ratón por su ficha en la tienda.

Solo cabe **un personaje por casilla**, tanto al colocarlos como durante el
combate: las unidades cuerpo a cuerpo rodean al rival en vez de amontonarse.

## Las 8 tripulaciones (combos)

Cada tripulación es un combo de 5 fichas: 4 nakama + su capitán como ficha
legendaria (coste 5). Con 2 miembros en tu equipo activas el nivel I, con 4 el
nivel II, y si reúnes **la tripulación completa (los 5, con capitán incluido)**
se activa un nivel III definitivo.

Solo cuentan los personajes **distintos**: llevar dos Marco en la cubierta suma
un miembro de Barbablanca, no dos.

| Tripulación | Combo | Efecto |
|---|---|---|
| 🏴‍☠️ Sombrero de Paja (capitán: Luffy) | Voluntad heredada | Más ataque para todo el equipo |
| 🌊 Piratas de Barbablanca (capitán: Barbablanca) | Temblor del mundo | Bonificación masiva a todas las estadísticas |
| 🍰 Piratas de Big Mom (capitana: Big Mom) | Alma vital | Escudo inicial y curación al derrotar enemigos |
| 🐉 Piratas de las Bestias (capitán: Kaido) | Aliento de dragón | Los ataques queman (daño continuo) |
| ⚡ Piratas Pelirrojos (capitán: Shanks) | Haki del Conquistador | Los ataques encadenan a otro enemigo y pueden aturdir |
| 🌑 Piratas de Barbanegra (capitán: Barbanegra) | Oscuridad y gravedad | Esquiva ataques y aumenta la velocidad |
| 👑 Piratas de Roger (capitán: Gol D. Roger) | Legado del Rey | Regeneración de vida y más vida máxima |
| 🕶️ Baroque Works (capitán: Crocodile) | Agentes disciplinados | Más ataque y más defensa |

Roster: 40 personajes (5 por tripulación).

## Banderas de las tripulaciones

Los emojis de cada tripulación se pueden sustituir por su **Jolly Roger** real:
deja el PNG en `public/img/crews/<tripulación>.png` (por ejemplo
`public/img/crews/beast.png`). El servidor mira esa carpeta y manda la ruta en
`/api/units`, así que no hay que tocar código; el que no tenga imagen sigue con
su emoji. Los nombres exactos están en el README de esa carpeta.

Para bajarlas de la wiki de golpe:

```bash
node tools/fetch-flags.js
```

## Cuentas e inicio de sesión

Al entrar a la web lo primero es la pantalla `public/img/menu/login.webp`, con
dos caminos:

- **Iniciar sesión con Google.** El botón azul está pintado en la ilustración y
  encima va el botón de verdad de Google, estirado hasta cubrirlo y
  transparente: se toca el dibujo y se abre el login de siempre.
- **Entrar sin cuenta.** Se juega igual, pero la partida no suma puntos ni sale
  en la tabla; el nombre lo escribes tú en el menú.

**La primera vez** que entras con Google el juego te lleva a la ficha de pirata:
un nombre (2 a 16 letras, no se puede repetir) y una cara, elegida entre las
cartas de los 40 personajes. A partir de ahí el menú muestra tu nombre y tu cara,
y aparece «Cerrar sesión» debajo del letrero.

### Configurar el login (hace falta una vez)

Sin `GOOGLE_CLIENT_ID` el servidor no monta el login: la pantalla lo dice y deja
entrar sin cuenta, así que el juego nunca se queda bloqueado. Para activarlo:

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   → *Crear credenciales* → *ID de cliente de OAuth* → tipo **Aplicación web**.
2. En **Orígenes de JavaScript autorizados** añade la URL de la web
   (`https://tu-servicio.onrender.com`) y, si vas a probar en local,
   `http://localhost:3000`.
3. Copia el *Client ID* y ponlo como variable de entorno `GOOGLE_CLIENT_ID`
   (en Render: *Environment* → *Add Environment Variable*).

El servidor comprueba la firma del token contra las claves públicas de Google y
que sea para esa aplicación; no hay ninguna dependencia extra ni secreto de
cliente. La sesión que devuelve vive en memoria (30 días), así que al reiniciar
el servidor hay que volver a entrar, pero la cuenta y los puntos siguen ahí.

## Ránkings

Botón en el menú → la ilustración `public/img/menu/rankings.webp`, con las
divisiones y la cabecera pintadas y las filas de jugadores dibujadas encima.
Sale **todo el que tenga cuenta**, de más a menos puntos, con su cara, su
división y su total; tu fila va resaltada en dorado, y si no entras en el top se
te añade al final.

- **Ganar una partida: +20 puntos. Perderla: −15.** No se baja de 0. Los bots no
  puntúan y las partidas de invitado tampoco.
- Divisiones: **Novato** (0–1000), **Capitán** (1000–2000), **Shichibukai**
  (2000–3000), **Yonkou** (3000–4000) y **Rey Pirata** (4000+).
- Al terminar una partida, la pantalla de resultado te dice cuánto has sumado o
  restado y en qué división quedas.

Las cuentas se guardan en `data/users.json` y el marcador antiguo por nombre
(sin cuenta) sigue en `data/rankings.json`. Ninguno de los dos va al
repositorio. Ojo con el plan gratuito de Render: el disco es efímero y ambos
archivos se borran en cada despliegue o reinicio del servicio. Para que las
cuentas y los puntos sobrevivan hace falta un disco persistente (planes de pago)
o una base de datos externa.

## Wiki Pirata

Botón en el menú → pantalla propia, montada igual que el inicio: la ilustración
`public/img/menu/wiki.webp` manda, y encima van las dos columnas de verdad
colocadas sobre los paneles pintados (en píxeles del dibujo, 1024x1536).

- A la izquierda, una fila por tripulación; la elegida lleva aro dorado.
- A la derecha, el combo con sus tres niveles y la ficha de los cinco
  personajes: retrato, coste, estadísticas y habilidad. Las dos columnas tienen
  scroll propio.
- Las columnas van sobre un fondo opaco que tapa las filas y las fichas que la
  imagen trae pintadas, así que el contenido real puede ser el que sea.

Los retratos salen de la carta ilustrada del personaje si la tiene; si no, del
propio modelo 3D.

## Imágenes de los personajes

### Cartas ilustradas (lo que se ve en la tienda)

Lo que más manda: si existe `public/img/cards/<id>.webp` (o `.png`), la tienda
usa **esa carta entera** —marco, ilustración, nombre y coste incluidos—, el
banquillo se queda con un recorte de la cara y la Wiki con un avatar redondo.
Solo hay que dejar el archivo en la carpeta con el id del personaje en
minúsculas (`luffy.webp`, `zoro.webp`…): el servidor mira la carpeta y lo manda
en `/api/units`, sin tocar código.

Ojo: **el coste que se ve en la tienda es el impreso en el dibujo**, no se pinta
nada encima. Si cambias el coste de un personaje en `server/characterData.js`
hay que volver a exportar su carta; el color del marco también va por coste
(1 rojo, 2 verde, 3 azul, 4 morado, 5 dorado).

Están **las 40**, las cinco de cada tripulación.

Las originales sin comprimir están en `assets-src/cards/` (`<id>.png` tal cual
llegaron y `<id>-crop.png` ya recortadas). Antes de subir una carta conviene
recortarle el fondo pegado al dibujo, meterla en 340x440 y pasarla a WebP (en
el juego se ve como mucho a 105 px de alto), que baja de ~410 KB a ~35 KB.

Nada de lienzos comunes: cada carta va a su tamaño. Las tandas vinieron con
proporciones muy distintas (de 0,53 los Piratas de Roger a 0,74 los Mugiwara) y
al meterlas todas en un lienzo fijo las estrechas se quedaban flotando dentro
de la tarjeta y con el recorte de cara descuadrado. Recortadas pegadas al
dibujo, en la tienda todas ocupan el mismo alto y cada una su ancho, y el
encuadre de cara del banquillo y la wiki (que se mueve en % de la propia
imagen) sale igual sea cual sea la proporción.

### Retratos generados

Si un personaje no tiene carta, el retrato de la tienda, el banquillo y la Wiki
se **renderiza de su modelo 3D** (medio cuerpo, con las luces de la cubierta) y
se cachea. Los que todavía no tienen modelo muestran sus iniciales.

Si además quieres darle a alguno una imagen 2D propia, tiene prioridad sobre el
retrato generado:

1. Guarda la imagen en `public/img/characters/` (por ejemplo `luffy.jpg`).
2. Añade la entrada en el objeto `PORTRAITS` de `server/characterData.js`:
   ```js
   const PORTRAITS = { luffy: 'luffy.jpg' };
   ```

Los personajes sin retrato muestran automáticamente sus iniciales sobre el color
de su tripulación, así que no hace falta tenerlas las 40 para empezar. No se
enlazan imágenes desde wikis externas: son poco fiables (se rompen al cambiar la
URL, bloqueadas por CORS en algunas redes) y de derechos dudosos.

## Pantallas ilustradas

Cuatro pantallas están montadas igual: manda una ilustración de 1024x1536 y
encima van los controles de verdad, colocados en píxeles del dibujo dentro de un
`.lienzo` que `encajarLienzo()` escala y centra. Las cajas de cada una están en
`public/css/style.css` y el encaje (qué trozo tiene que verse sí o sí) en el
mapa `LIENZOS` de `public/js/game.js`:

| Pantalla | Ilustración | Lienzo |
| --- | --- | --- |
| Inicio de sesión | `login.webp` | `login-lienzo` |
| Ficha de pirata | `login.webp` | `perfil-lienzo` |
| Menú | `harbor.webp` | `menu-lienzo` |
| Ránkings | `rankings.webp` | `rank-lienzo` |
| Wiki Pirata | `wiki.webp` | `wiki-lienzo` |

Si cambias un dibujo hay que volver a medir sus cajas. El lienzo arranca oculto
y `game.js` lo destapa al colocarlo: el HTML se pinta antes de que corra el
módulo (va diferido) y si no se veía un fogonazo del dibujo a tamaño real, como
un zoom al entrar.

### El menú

Es la ilustración `public/img/menu/harbor.webp`: el título, el letrero del
nombre y los cuatro botones **están pintados en ella**. Encima van los
controles de verdad, colocados en píxeles del dibujo (1024x1536) dentro de
`.menu-lienzo`, que `encajarMenu()` escala y centra en la pantalla:

- Cada botón pintado tiene encima una zona tocable transparente (`.m-zona`)
  que se ilumina al pulsar. El texto no se repite: el del dibujo es el bueno.
- El letrero del nombre lleva encima un pergamino del mismo color que tapa el
  «Vega» pintado, con el campo de texto real dentro.
- El selector de modo viene con el 1v1 marcado en el dibujo, así que el estado
  real se pinta encima: oscurecido el que no está elegido, aro dorado el
  elegido.
- Buscando partida y «empezar con bots» son carteles que se ponen encima de
  «Jugar online» y «Jugar vs CPU».

El encaje llena la pantalla, pero sin pasarse de lo que dejaría fuera el título
o el último botón; lo que sobra a los lados se rellena con la propia imagen
desenfocada. Comprobado de 360x520 a 1280x800.

Con la sesión iniciada, el letrero del nombre enseña el nombre de la cuenta (ya
no se puede escribir) y la cara elegida, y debajo aparece «Cerrar sesión».

## Marcos del banquillo y de la tienda

La barra de abajo son dos ilustraciones, no CSS:

- `public/img/ui/bench.webp` — el barril con la bandera pirata y los seis huecos
  del banquillo. Los huecos se colocan por encima con los porcentajes medidos
  sobre la propia imagen (`HUECOS_BANQUILLO` en `public/js/game.js`), así que si
  cambias el dibujo hay que volver a medirlos.
- `public/img/ui/shop.webp` — el tablón de madera de la tienda. Las cuatro
  cartas se reparten dentro con `.shop-inner` (`public/css/style.css`).

El barril hace también de **papelera**: al seleccionar una ficha aparece encima
por cuánto se vende, y al tocarlo se vende.

Los dos marcos van **directamente sobre la ilustración**, sin panel ni degradado
detrás y pegados al borde de abajo, y la cubierta se coloca lo más baja que
puede (sin esconder la última fila) para que el casco del barco quede por
detrás de ellos. Lo que sobra de pantalla por arriba y por abajo lo rellena un
degradado que arranca con el color medio del borde del dibujo, así que no se
ve la juntura.

Los PNG originales (con transparencia, sin recortar el margen) están en
`assets-src/ui/`, junto con la referencia de la tienda llena y el mockup de la
pantalla completa que se usaron para calcular las medidas.

## Animaciones de los modelos

Un `.glb` puede traer animaciones, y el juego usa cuatro: **reposo**, **andar**,
**golpear** y **morir**. Se reparten por el nombre del clip (no por el orden),
buscando palabras sueltas: `death`/`muerte`/`fall` → morir, `walk`/`run`/`caminar`
→ andar, `punch`/`attack`/`arrow`/`golpe` → golpear, `idle`/`gesture`/`stand`
→ reposo. Lo que no encaje se reparte por los huecos que queden, **menos la
muerte**: es mejor no tenerla que caerse al suelo con una animación que en
realidad era otra cosa. Un modelo con una sola animación la usa para todo. Los
nombres que suelta Mixamo (`Walking`, `Punch`, `Arrow`, `Death`) ya caen donde
toca.

En combate cada ficha pide la suya: anda mientras se mueve de casilla, pega al
atacar o al lanzar su habilidad, se cae al morir y el resto del tiempo está en
reposo, con una mezcla corta entre una y otra para que no salte de golpe.

**El ritmo lo pone el motor, no Mixamo.** Descarga los clips tal cual y
`scene3d.js` los estira o los encoge:

- **Golpear** dura el 70% del hueco que el motor deja entre ataque y ataque
  (`atkSpeed` × 150 ms), así que el que pega rápido se ve pegando rápido: Sanji
  y Zoro (atkSpeed 6) golpean en 0,63 s y Nami y Usopp (8) en 0,84 s. El 30%
  restante es el respiro. `game.js` usa esa misma cuenta para decidir cuánto
  tiempo pide el golpe, así no se corta a medias.
- **Morir** se ajusta a 1,5 s, se reproduce **una sola vez** y se queda en el
  suelo; la ficha se desvanece a los 1,8 s.
- **Andar** y **reposo** van a 0,75 y 0,85: las animaciones de Mixamo son de
  persona a tamaño real y a 55 píxeles se ven nerviosas.

Los números están juntos y comentados arriba de `ponerAccion()`.

### De Mixamo al juego, en un comando

Mixamo descarga **tres `.fbx` sueltos**, uno por animación, y el juego necesita
**un solo `.glb`** con las tres dentro. `tools/mixamo-a-glb.js` lo hace todo:

```bash
npm install --no-save fbx2gltf @gltf-transform/core \
  @gltf-transform/functions @gltf-transform/extensions sharp   # una sola vez

node tools/mixamo-a-glb.js \
  --idle "Breathing Idle.fbx" \
  --walk "Walking.fbx" \
  --attack "Punching.fbx" \
  --salida public/models/strawhat/luffy.glb
```

Convierte los FBX, coge el que trae el modelo (el que bajaste **With Skin**)
como base, le pega las otras dos animaciones **reenganchando cada pista al hueso
que le toca por nombre**, las renombra a `Idle` / `Walking` / `Punching` y
optimiza las texturas a WebP 1024.

Dos cosas que hace y que conviene saber:

- **Avisa si una animación viene vacía** (menos de 0,2 s). Mixamo exporta a
  veces clips de dos claves que no mueven nada; es lo que dejó a Zoro, Rayleigh
  y Shiryu clavados en pose de T. Si sale el aviso, vuelve a Mixamo, comprueba
  que la vista previa se mueve y descárgala otra vez con FBX Binary, 30 fps y
  **sin** *keyframe reduction*.
- **Nunca cuantiza** (`quantize`). Con modelos con esqueleto la descuantización
  se mete en las matrices de los huesos y la ficha sale a una escala absurda.

En Mixamo, descarga la primera animación con **With Skin** y las otras dos con
**Without Skin**; el esqueleto **No Fingers (25)** basta y sobra a este tamaño.

Dos cosas a tener en cuenta al preparar un modelo con esqueleto:

- El tamaño se mide **con la animación de reposo puesta**, no con la pose que
  trae el archivo, porque muchas vienen centradas en el origen o con los brazos
  en cruz y la ficha salía flotando o más baja que las demás.
- **No lo comprimas con `--compress quantize`**: al cuantizar, la escala se va a
  las matrices de los huesos y el modelo acaba midiendo lo que no es. Para uno
  con esqueleto:

  ```bash
  gltf-transform optimize entrada.glb salida.glb \
    --texture-size 1024 --texture-compress webp --compress false --simplify false
  ```

  Con eso, Luffy pasa de 28,3 MB a 814 KB, Sanji de 21,0 MB a 851 KB y Roger
  de 12,9 MB a 951 KB, conservando sus tres animaciones cada uno. Casi todo el
  peso eran las texturas (4096x4096 en dos de ellos).

Van animados **Luffy**, **Sanji**, **Usopp**, **Gol D. Roger**, **Zoro**,
**Rayleigh** y **Shiryu**. Los que no traen animaciones se quedan quietos, sin
más.

Dos avisos de lo que se ha visto al integrarlos:

- **Animaciones vacías.** Algunas exportaciones traen el clip declarado pero sin
  contenido: dos claves y 0,07 s, que no mueven nada. Si se usan, la ficha se
  queda **congelada con los brazos en cruz** (la pose de enlace). El juego las
  descarta —cualquier clip de menos de 0,2 s— y tira de las que sí valgan, así
  que como mucho se repite una animación, pero nunca se queda tiesa. Aun así,
  conviene reexportar: se comprueba rápido mirando la duración de cada clip.
- **Archivos incompletos.** Si la subida se corta, el `.glb` declara en su
  cabecera un tamaño mayor que el que tiene y no hay forma de leerlo
  (`Invalid typed array length`). Se ve comparando `byteLength` con el tamaño
  del archivo.

## Fichas 3D

Por defecto cada ficha es una **peana 3D con un cartel vertical** que muestra el
retrato del personaje, al estilo de una figura de mesa. Funciona sin descargar
nada y se ve bien en móvil.

Para sustituir la de un personaje por un **modelo 3D real**, deja su archivo en
`public/models/<tripulación>/<id>.glb` (por ejemplo `public/models/strawhat/luffy.glb`)
— hay una carpeta por tripulación con la tabla de nombres exactos en su README.
No hay que tocar código: el servidor publica en `/api/models` los modelos que
encuentra y el juego carga solo esos, dejando la ficha con el retrato para los
personajes que aún no lo tengan. Cada modelo se reescala a la altura de la
casilla, se centra y se orienta hacia el bando contrario. Un personaje con
modelo pierde la peana y el cartel: se queda su sombra, una chapita con su
nombre y sus estrellas encima de la cabeza, y las barras de vida y maná durante
el combate. Si trae animaciones se reproduce la primera en bucle.

El formato que necesita el juego es **`.glb`** (glTF binario), a poder ser de
bajo poligonaje (unos pocos miles de triángulos) y en pose neutra. Dónde
conseguirlos:

| Sitio | Qué ofrece |
|---|---|
| [Sketchfab](https://sketchfab.com) | El catálogo más grande; filtra por "Downloadable" + licencia CC. Exporta a `.glb` |
| [Mixamo](https://www.mixamo.com) | Gratis (Adobe): riggea y anima automáticamente cualquier modelo humanoide |
| [Ready Player Me](https://readyplayer.me) | Genera avatares 3D personalizables y los exporta en `.glb` |
| [Kenney](https://kenney.nl/assets) | Packs low-poly gratuitos (props y escenario, no personajes con licencia) |
| [TurboSquid](https://www.turbosquid.com) / [CGTrader](https://www.cgtrader.com) | De pago, mayor calidad |

Consulta [`public/models/README.md`](public/models/README.md) para la lista
completa de nombres de archivo por tripulación.

## Arquitectura

- `server/characterData.js` — roster de 40 personajes (con su habilidad y coste
  de maná) y definición de los 8 combos.
- `server/economy.js` — tienda (4 huecos), probabilidades fijas por coste,
  cupo de tropas, oro, ingresos, precio de venta y daño.
- `server/battle.js` — motor de combate por turnos (tick de 150ms) determinista
  sobre una arena de 5x6, genera un log de eventos (movimiento, ataques, muertes,
  quemaduras, escudos...) que el cliente reproduce para animar el combate igual
  en ambos jugadores, con la formación real de cada uno.
- `server/GameRoom.js` — máquina de estados de una partida de 2 o 4 jugadores
  (preparación / combate / resultado), emparejamientos por ronda, tienda,
  banquillo, fusiones, IA del bot, reconexión y eliminación por puestos.
- `server/index.js` — servidor Express + Socket.io, una cola por modo y las
  rutas de cuentas (`/api/config`, `/api/auth/google`, `/api/me`,
  `/api/profile`, `/api/rankings`).
- `server/users.js` — cuentas de jugador: nombre, icono, puntos de ranking
  (+20 / −15) y divisiones. Se guardan en `data/users.json`.
- `server/auth.js` — inicio de sesión con Google, sin dependencias: comprueba la
  firma del token contra las claves públicas de Google y entrega un token de
  sesión propio, que vive en memoria.
- `server/rankings.js` — marcador antiguo por nombre de pirata, para las
  partidas de quien juega sin cuenta.
- `public/js/scene3d.js` — la escena de combate: pone la ilustración de la
  cubierta de fondo y dibuja encima las fichas y los efectos con Three.js. La
  correspondencia entre casilla del juego y casilla dibujada es una homografía
  sacada de las cuatro esquinas de la rejilla del dibujo, así que cada ficha cae
  clavada en su sitio con la perspectiva de la ilustración. El dibujo se ve
  **entero** (se mete dentro de la pantalla sin recortar) y se centra en el
  hueco libre entre el HUD y la barra inferior (`setInsets`); detrás va un
  degradado de cielo y mar para lo que sobre a los lados.
- `public/img/scene/deck.png` — la ilustración. Si se cambia por otra hay que
  volver a medir las 4 esquinas de su rejilla en la constante `ART` de
  `scene3d.js`.
- `public/js/game.js` — sockets, interfaz 2D (tienda, banquillo, HUD) y la
  traducción entre las coordenadas del servidor y las de la escena.
- `public/vendor/` — Three.js y `GLTFLoader` incluidos en el repo (ver el README
  de esa carpeta).
- `public/models/` — modelos 3D de los personajes, una carpeta por tripulación.

## Herramientas de comprobación

```bash
node verify_battle.js   # 300 combates: comprueba que nunca se apilan unidades
node tune.js            # equilibrio de las 8 sinergias
```

`tune.js` da dos medidas porque una sola engaña: el enfrentamiento espejo
(tripulación contra tripulación) amplifica muchísimo cualquier diferencia y sirve
solo para ordenar, mientras que la prueba con equipos mixtos al azar refleja lo
que pasa en una partida real.

## Notas

- Proyecto de fan, sin ánimo de lucro ni afiliación con Eiichiro Oda/Shueisha/Toei
  Animation.
- Sin base de datos: el estado de las partidas vive en memoria del servidor.
