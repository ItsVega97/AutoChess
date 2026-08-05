# Nakama Royale

Autobattler online 3D con temática One Piece, al estilo Tactics Royale. Todo en
**español**: la interfaz, los comentarios del código, los mensajes de commit y
los nombres de las variables nuevas. Mantén ese criterio.

## Poner en marcha

```bash
npm install
npm test      # 50 comprobaciones (mover, abandono, tienda, cuentas)
npm start     # http://localhost:3000  (PORT para cambiarlo)
```

`GOOGLE_CLIENT_ID` activa el inicio de sesión con Google. Sin esa variable el
juego funciona igual y se entra sin cuenta, así que no es bloqueante.

## Cómo está montado

- `server/battle.js` — motor de combate determinista, tick de 150 ms sobre una
  arena de 5x6. Devuelve un log de eventos que el cliente reproduce, así que el
  combate se ve idéntico en las dos pantallas.
- `server/GameRoom.js` — la partida de 2 o 4 jugadores: preparación, combate,
  resultado, emparejamientos por ronda, tienda, banquillo, fusiones, bot,
  reconexión y eliminación por puestos.
- `server/characterData.js` — los 40 personajes y los 8 combos. `atkSpeed` va
  en ticks (6–9): más bajo, más rápido.
- `server/users.js` / `server/auth.js` — cuentas de Google, puntos de ranking
  (+20 / −15) y divisiones. Se guardan en `data/`, que no va al repositorio.
- `public/js/scene3d.js` — la escena de combate con Three.js. La cubierta es
  una ilustración y la correspondencia casilla-juego ↔ casilla-dibujo es una
  homografía sacada de las cuatro esquinas de la rejilla pintada.
- `public/js/models.js` — carga de los `.glb`, normalización de tamaño y
  reparto de las animaciones en reposo / andar / golpear.
- `public/js/game.js` — sockets, interfaz 2D y las pantallas ilustradas.

## Cosas que ya costaron encontrar (no las repitas)

- **Nunca cuantices un `.glb` con esqueleto** (`gltf-transform --compress
  quantize`). La descuantización acaba en las matrices de los huesos y la ficha
  sale a una escala absurda. Usa `--compress false`.
- **`Box3.setFromObject` no vale con `SkinnedMesh`**: calcula la caja antes de
  que el esqueleto esté listo, se la guarda vacía y no la recalcula. Hay que
  actualizar el esqueleto a mano (ver `cajaDelModelo` en `models.js`).
- **La caja mide TODO lo que cuelga del modelo**, armas incluidas. Una espada
  levantada por encima de la cabeza encoge al personaje, porque se escala para
  que quepa el conjunto.
- **Mixamo exporta a veces clips vacíos** (dos claves, 0,07 s). Se descartan
  por debajo de 0,2 s; si no, la ficha se queda en pose de T.
- **Al juntar animaciones de varios `.fbx`**, cada archivo trae su propia copia
  del esqueleto. El mapa de huesos por nombre se calcula UNA vez sobre el
  modelo base y los duplicados se tiran en el acto; si no, la segunda animación
  se engancha a un hueso que luego se borra.
- Las pantallas ilustradas (inicio, login, ficha de pirata, ránkings, wiki) son
  una imagen de 1024x1536 con los controles de verdad encima, en píxeles del
  dibujo. Si cambias una imagen, hay que volver a medir sus cajas.

## Modelos 3D de los personajes

Van en `public/models/<tripulación>/<id>.glb`, con cuatro animaciones dentro:
`Idle`, `Walking`, `Punch` (o `Arrow` si es a distancia) y `Death`.

La cadena es: imagen chibi → Meshy (Smart Topology, T-Pose, ~15.000 polígonos)
→ Mixamo (esqueleto *No Fingers*, tres animaciones) → `tools/mixamo-a-glb.js`,
que las junta en un solo archivo. Está documentado en el README.

El ritmo de las animaciones **no se hornea en Mixamo**: lo pone el motor, en
`scene3d.js`, a partir del `atkSpeed` de cada ficha. Y **las texturas de Meshy
vienen a 4096**, que son 25 MB por modelo: hay que bajarlas a 1024 antes de
meterlas en el repositorio (de 25 MB a ~1 MB).

## Comprobar los cambios

Además de `npm test`, para lo visual se levanta el servidor y se mira con
Playwright (`--use-gl=swiftshader --enable-unsafe-swiftshader`), a 412x780 que
es el móvil de referencia. En pantalla cada ficha mide unos 55 píxeles: antes
de afinar un detalle, comprueba si se ve a ese tamaño.
