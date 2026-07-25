# Modelos 3D de los personajes

Una carpeta por tripulación (sinergia). Dentro de cada una hay un `README.md`
con la tabla exacta de nombres de archivo que espera el juego.

| Carpeta | Tripulación | Capitán |
|---|---|---|
| `strawhat/` | 🏴‍☠️ Sombrero de Paja | Luffy |
| `whitebeard/` | 🌊 Piratas de Barbablanca | Barbablanca |
| `bigmom/` | 🍰 Piratas de Big Mom | Big Mom |
| `beast/` | 🐉 Piratas de las Bestias | Kaido |
| `redhair/` | ⚡ Piratas Pelirrojos | Shanks |
| `blackbeard/` | 🌑 Piratas de Barbanegra | Barbanegra |
| `roger/` | 👑 Piratas de Roger | Gol D. Roger |
| `baroque/` | 🕶️ Baroque Works | Sir Crocodile |

## Cómo subir un modelo

1. Ponlo en la carpeta de su tripulación con el nombre del `id` del personaje
   y extensión `.glb` (por ejemplo `strawhat/luffy.glb`).
2. Ya está. El servidor mira esta carpeta y publica en `/api/models` la lista de
   los que hay; el juego carga el modelo de los personajes que aparezcan ahí y
   deja la ficha con el retrato para el resto.

No hace falta tenerlos todos: puedes ir subiéndolos de uno en uno.

> La lista se refresca sola cada 30 segundos, así que en local basta con dejar
> el archivo y recargar la página. En el servidor desplegado aparece con el
> siguiente despliegue.

## Formato

- **`.glb`** (glTF binario, un único archivo con mallas y texturas dentro).
- Bajo poligonaje: son 12 fichas en pantalla a la vez y tiene que ir fluido en
  el móvil. Unos pocos miles de triángulos por modelo es lo ideal.
- **Peso del archivo**: apunta a menos de 2 MB por personaje. Lo que más pesa
  casi siempre son las texturas: bajarlas a 1024x1024 y guardarlas como JPEG en
  vez de PNG suele dejar el archivo en una décima parte sin que se note en
  pantalla, porque cada ficha se ve del tamaño de una casilla. Un `.glb` de
  10-15 MB funciona, pero se nota al entrar a la partida desde el móvil.
  Con [gltf-transform](https://gltf-transform.dev) es un comando:
  `gltf-transform optimize entrada.glb salida.glb --texture-size 1024`.
- Pose neutra o T-pose. Si trae animaciones, se reproduce la primera en bucle.
- El juego reescala cada modelo automáticamente a la altura de una casilla, lo
  centra y lo gira hacia el bando contrario, así que no te preocupes por la
  escala ni por el origen del modelo.
- Un personaje con modelo pierde la peana y el cartel: se le pone una chapita
  con su nombre y sus estrellas encima de la cabeza, y mantiene las barras de
  vida y maná durante el combate.

## Dónde conseguirlos

- [Sketchfab](https://sketchfab.com) — el catálogo más grande; filtra por
  "Downloadable" y licencia CC, y exporta a `.glb`.
- [Mixamo](https://www.mixamo.com) — gratis: riggea y anima cualquier humanoide.
- [Ready Player Me](https://readyplayer.me) — genera avatares en `.glb`.
- [TurboSquid](https://www.turbosquid.com) / [CGTrader](https://www.cgtrader.com) — de pago.
