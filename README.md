# Nakama Royale

Demo jugable de un **auto-battler online en 3D** con temática pirata (One Piece),
inspirado en la jugabilidad de *Tactics Royale* (Clash Royale) y en autobattlers
tipo TFT: compras en tienda, banquillo, tablero, fusiones de unidades y combates
automáticos por rondas contra otro jugador en tiempo real (o contra una IA para
probarlo tú solo al instante).

El combate se juega sobre la **cubierta 3D de un barco pirata** renderizada con
Three.js, con un tablero compacto de 5x3 casillas por jugador y 20 puntos de vida
cada uno — partidas rápidas, de unas 8-14 rondas.

La escena 3D ocupa toda la pantalla y la interfaz va **superpuesta** encima
(estilo Tactics Royale), de modo que la partida entra siempre en una sola
pantalla de móvil sin necesidad de desplazarse.

## Cómo jugar (local)

```bash
npm install
npm start
```

Abre `http://localhost:3000` en el navegador.

- **🤖 Jugar vs CPU**: empieza una partida al instante contra un bot, ideal para
  probar la demo tú solo.
- **⚔️ Jugar Online (1v1)**: te mete en una cola de emparejamiento. Abre la misma
  URL en **otra pestaña, otro navegador o desde otro dispositivo en la misma red**
  (usando la IP de la máquina, ej. `http://192.168.1.x:3000`) y pulsa también
  "Jugar Online" para emparejar dos jugadores reales.

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
   colocarlos. Pulsa "Listo" cuando acabes (o espera a que se acabe el tiempo).
   La tienda enseña **4 personajes** y **se renueva entera cada vez que compras
   uno**: es la única forma de cambiar la oferta, no hay botón de reroll.
   Los **40 personajes están disponibles desde la primera ronda**, capitanes
   incluidos: lo que cambia es lo raro que es que salga cada uno según su coste.

   | Coste | Probabilidad por hueco |
   |---|---|
   | 1 🪙 | 40% |
   | 2 🪙 | 26% |
   | 3 🪙 | 18% |
   | 4 🪙 | 11% |
   | 5 🪙 (capitán) | 5% |

   Con 4 huecos, eso es un **18,5% de tiendas con capitán**: puedes fichar a
   Shanks en la ronda 1 si tienes suerte y te gastas medio bolsillo en él.
2. **Combate automático**: tu tripulación lucha sola contra la del rival, con la
   formación exacta en la que la colocaste. Gana quien deje unidades vivas; el
   perdedor pierde vida según lo que sobrevivió al ganador.
3. **Cupo de tropas**: empiezas pudiendo desplegar **una sola tropa**, y ganas un
   hueco después de cada combate hasta un máximo de **6**. El marcador de arriba
   (⚔️ 3/4) dice cuántas llevas en cubierta y cuántas te caben; no es un nivel.
   Con el cupo lleno solo puedes cambiar una tropa por otra del banquillo.
   La partida acaba cuando uno de los dos llega a 0 de sus 20 puntos de vida.
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

## Imágenes de los personajes

Cada personaje puede tener un retrato propio. Se usa tanto en la tienda y el
banquillo (2D) como en el "cartel de se busca" de su ficha 3D en la cubierta.

1. Guarda la imagen en `public/img/characters/` (por ejemplo `luffy.jpg`).
2. Añade la entrada en el objeto `PORTRAITS` de `server/characterData.js`:
   ```js
   const PORTRAITS = { luffy: 'luffy.jpg' };
   ```

Los personajes sin retrato muestran automáticamente sus iniciales sobre el color
de su tripulación, así que no hace falta tenerlas las 40 para empezar. No se
enlazan imágenes desde wikis externas: son poco fiables (se rompen al cambiar la
URL, bloqueadas por CORS en algunas redes) y de derechos dudosos.

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
- `server/GameRoom.js` — máquina de estados de una partida 1v1 (preparación /
  combate / resultado), tienda, banquillo, fusiones, IA del bot, reconexión.
- `server/index.js` — servidor Express + Socket.io, cola de emparejamiento.
- `public/js/scene3d.js` — toda la escena 3D (Three.js): barco, mar, casillas,
  fichas, efectos de combate y selección de casilla por raycasting. La cámara
  encuadra la cubierta en el hueco libre entre el HUD y la barra inferior
  (`setInsets`), así la interfaz superpuesta nunca tapa el tablero.
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
