# PokéChess Royale

Demo jugable de un **auto-battler online** con temática Pokémon, inspirado en la
jugabilidad de *Tactics Royale* (Clash Royale) y en autobattlers tipo TFT: compras
en tienda, banquillo, tablero, fusiones de unidades y combates automáticos por rondas
contra otro jugador en tiempo real (o contra una IA para probarlo tú solo al instante).

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
2. **New +** → **Blueprint** → conecta este repositorio (`ItsVega97/AutoChess`,
   rama `claude/pokemon-autochess-demo-2d3jbs`).
3. Render detecta `render.yaml` automáticamente (build `npm install`, arranque
   `npm start`, puerto vía `process.env.PORT`, ya soportado) → **Apply**.
4. En 1-2 minutos tendrás una URL pública tipo `https://pokechess-royale.onrender.com`.
   Compártela: cualquiera que la abra puede pulsar "Jugar Online" y emparejarse
   con otro jugador conectado en ese momento.

También funciona igual en Railway o Fly.io si los prefieres (mismo comando de
arranque `npm start` y puerto por `process.env.PORT`).

> Nota: el plan gratuito de Render "duerme" el servicio tras ~15 min sin tráfico
> y tarda unos segundos en despertar con la primera visita — normal en free tier,
> no afecta a la partida una vez cargada.

## Cómo se juega

1. **Fase de preparación (30s)**: compra criaturas en la tienda, colócalas en tu
   mitad del tablero arrastrándolas desde el banquillo, y pulsa "Listo" cuando
   acabes (o espera a que se acabe el tiempo).
2. **Combate automático**: tu equipo lucha solo contra el del rival. Gana quien
   deje unidades vivas; el perdedor pierde vida según lo que sobrevivió al ganador.
3. Sube de nivel automáticamente cada ronda (más oro, tienda con criaturas más
   fuertes, más hueco en el tablero) hasta que uno de los dos jugadores llega a 0
   de vida.
4. **Fusión**: consigue 3 copias iguales de una criatura (mismo nivel de estrella)
   y se fusionan automáticamente en una versión ⭐⭐ o ⭐⭐⭐ mucho más fuerte.

## Los 8 combos (sinergias de tipo)

Cada tipo Pokémon es un combo: con 2 unidades del mismo tipo en tu equipo activas
el nivel I, con las 4 disponibles de ese tipo activas el nivel II.

| Tipo | Combo | Efecto |
|---|---|---|
| 🔥 Fuego | Llama Ardiente | Los ataques queman (daño continuo) |
| 💧 Agua | Torrente | El equipo empieza con un escudo |
| 🌿 Planta | Espesura | Regeneración de vida por segundo |
| ⚡ Eléctrico | Estática | Los ataques encadenan a otro enemigo (y pueden aturdir) |
| 🔮 Psíquico | Premonición | Más daño de ataque para todo el equipo |
| 🥊 Lucha | Combate | Ataque físico puro muy elevado |
| 🕊️ Volador | Alas Veloces | Probabilidad de esquivar ataques + velocidad |
| 🐉 Dragón | Poder Ancestral | Bonificación masiva a todas las estadísticas |

Roster: 32 criaturas (4 por tipo, con costes de 1 a 5 monedas), con arte oficial
obtenido de [PokeAPI](https://pokeapi.co/) (`sprites/pokemon/other/official-artwork`).

## Arquitectura

- `server/pokemonData.js` — roster de 32 criaturas y definición de los 8 combos.
- `server/economy.js` — tienda, probabilidades por nivel, oro e ingresos.
- `server/battle.js` — motor de combate por turnos (tick de 150ms) determinista,
  genera un log de eventos (movimiento, ataques, muertes, quemaduras, escudos...)
  que el cliente reproduce para animar el combate igual en ambos jugadores.
- `server/GameRoom.js` — máquina de estados de una partida 1v1 (preparación /
  combate / resultado), tienda, banquillo, fusiones, IA del bot.
- `server/index.js` — servidor Express + Socket.io, cola de emparejamiento.
- `public/` — cliente (HTML/CSS + un único `game.js` con render en `<canvas>`,
  arrastrar y soltar, y reproducción animada del combate).

## Notas

- Proyecto de fan, sin ánimo de lucro ni afiliación con Nintendo/Game Freak/The
  Pokémon Company. Usa artwork oficial vía PokeAPI solo con fines de demo.
- Sin base de datos: el estado de las partidas vive en memoria del servidor.
