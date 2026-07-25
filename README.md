# Nakama Royale

Demo jugable de un **auto-battler online** con temática pirata (One Piece),
inspirado en la jugabilidad de *Tactics Royale* (Clash Royale) y en autobattlers
tipo TFT: compras en tienda, banquillo, tablero, fusiones de unidades y combates
automáticos por rondas contra otro jugador en tiempo real (o contra una IA para
probarlo tú solo al instante).

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

1. **Fase de preparación (30s)**: compra personajes en la tienda, colócalos en tu
   mitad del tablero — tócalos y luego toca la casilla destino, o arrástralos —
   y pulsa "Listo" cuando acabes (o espera a que se acabe el tiempo).
2. **Combate automático**: tu tripulación lucha sola contra la del rival, con la
   formación exacta en la que la colocaste. Gana quien deje unidades vivas; el
   perdedor pierde vida según lo que sobrevivió al ganador.
3. Sube de nivel automáticamente cada ronda (más oro, tienda con personajes más
   fuertes, más hueco en el tablero) hasta que uno de los dos jugadores llega a 0
   de vida.
4. **Fusión**: consigue 2 copias iguales de un personaje (mismo nivel de estrella)
   y se fusionan automáticamente en la siguiente estrella, hasta un máximo de ⭐⭐⭐⭐.

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

Roster: 40 personajes (5 por tripulación). Sin artwork oficial hotlinkeado desde
wikis externas (poco fiable y con dudas de derechos): cada personaje tiene un
"cartel de se busca" generado en cliente con sus iniciales y el color de su
tripulación — nunca depende de la red y encaja con la temática pirata.

## Arquitectura

- `server/characterData.js` — roster de 40 personajes y definición de los 8 combos.
- `server/economy.js` — tienda, probabilidades por nivel, oro e ingresos.
- `server/battle.js` — motor de combate por turnos (tick de 150ms) determinista,
  genera un log de eventos (movimiento, ataques, muertes, quemaduras, escudos...)
  que el cliente reproduce para animar el combate igual en ambos jugadores, con
  la formación real de cada jugador.
- `server/GameRoom.js` — máquina de estados de una partida 1v1 (preparación /
  combate / resultado), tienda, banquillo, fusiones, IA del bot, reconexión.
- `server/index.js` — servidor Express + Socket.io, cola de emparejamiento.
- `public/` — cliente (HTML/CSS + un único `game.js`): pantalla de partida a
  pantalla completa sin scroll, render en `<canvas>`, tocar-para-colocar (además
  de arrastrar), y reproducción animada del combate.

## Notas

- Proyecto de fan, sin ánimo de lucro ni afiliación con Eiichiro Oda/Shueisha/Toei
  Animation. No usa imágenes oficiales (evita depender de hotlinks poco fiables o
  con derechos dudosos); los avatares son carteles de "se busca" generados en cliente.
- Sin base de datos: el estado de las partidas vive en memoria del servidor.
