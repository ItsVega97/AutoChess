'use strict';

// Regresion del bug: en una partida de 4, cuando alguien se iba (aunque ya
// estuviese eliminado) se echaba del juego a TODOS los demas.
const GameRoom = require('../server/GameRoom');

// io de mentira: apunta lo que recibe cada socket
function hacerIo(ids) {
  const recibido = {};
  const sockets = new Map();
  for (const id of ids) {
    recibido[id] = [];
    sockets.set(id, { emit: (ev, datos) => recibido[id].push({ ev, datos }) });
  }
  return { io: { sockets: { sockets } }, recibido, sockets };
}
const eventos = (recibido, id) => recibido[id].map((e) => e.ev);

let fallos = 0;
function comprobar(nombre, ok, extra) {
  console.log(`${ok ? 'OK  ' : 'MAL '} ${nombre}${ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra)}`);
  if (!ok) fallos++;
}

// ---------- 4 jugadores: 3 personas + 1 bot ----------
{
  const { io, recibido } = hacerIo(['s1', 's2', 's3']);
  const sala = new GameRoom(io, [
    { id: 's1', name: 'Vega' },
    { id: 's2', name: 'Isgarth' },
    { id: 's3', name: 'Swarly' },
    { id: 'bot', name: 'CPU Marine', isBot: true },
  ]);
  sala.clearTimer();
  sala.round = 5;
  // Swarly (C) y el bot (D) ya estan eliminados
  sala.players.C.alive = false; sala.players.C.hp = 0; sala.placements.C = 3;
  sala.players.D.alive = false; sala.players.D.hp = 0; sala.placements.D = 4;
  sala.pairs = [['A', 'B']];

  // Swarly cierra la pestana y no vuelve
  sala.finalizeDisconnect('C');

  comprobar('nadie recibe opponentLeft', !['s1', 's2'].some((id) => eventos(recibido, id).includes('opponentLeft')),
    { s1: eventos(recibido, 's1'), s2: eventos(recibido, 's2') });
  comprobar('un eliminado que se va no genera aviso de abandono',
    !['s1', 's2'].some((id) => eventos(recibido, id).includes('playerLeft')));
  comprobar('la partida sigue viva', !sala.ended && sala.aliveSides().length === 2, { ended: sala.ended, vivos: sala.aliveSides() });
  comprobar('siguen emparejados A-B', JSON.stringify(sala.pairs) === '[["A","B"]]', sala.pairs);
  sala.clearTimer();
}

// ---------- 4 jugadores: se va uno que SIGUE vivo ----------
{
  const { io, recibido } = hacerIo(['s1', 's2', 's3']);
  const sala = new GameRoom(io, [
    { id: 's1', name: 'Vega' },
    { id: 's2', name: 'Isgarth' },
    { id: 's3', name: 'Swarly' },
    { id: 'bot', name: 'CPU Marine', isBot: true },
  ]);
  sala.clearTimer();
  sala.round = 3;
  sala.pairs = [['A', 'C'], ['B', 'D']];

  sala.finalizeDisconnect('C'); // Swarly abandona en mitad de su combate con Vega

  comprobar('a los demas se les avisa con playerLeft',
    eventos(recibido, 's1').includes('playerLeft') && eventos(recibido, 's2').includes('playerLeft'),
    { s1: eventos(recibido, 's1'), s2: eventos(recibido, 's2') });
  comprobar('nadie recibe opponentLeft', !['s1', 's2'].some((id) => eventos(recibido, id).includes('opponentLeft')));
  comprobar('la partida sigue viva', !sala.ended && sala.aliveSides().length === 3, { vivos: sala.aliveSides() });
  comprobar('el combate del que se fue se anula', JSON.stringify(sala.pairs) === '[["B","D"]]', sala.pairs);
  // y su ronda cuenta como descanso
  sala.lastFights.B = { result: { winner: 'draw' }, lado: 'A', rival: 'D' };
  sala.lastFights.D = { result: { winner: 'draw' }, lado: 'B', rival: 'B' };
  sala.applyBattleResult();
  comprobar('a Vega se le marca la ronda como descanso',
    sala.roundInfo.A && sala.roundInfo.A.result === 'bye', sala.roundInfo && sala.roundInfo.A);
  sala.clearTimer();
}

// ---------- 1v1: si el rival se va, ganas ----------
{
  const { io, recibido } = hacerIo(['s1', 's2']);
  const sala = new GameRoom(io, [
    { id: 's1', name: 'Vega' },
    { id: 's2', name: 'Isgarth' },
  ]);
  sala.clearTimer();
  sala.round = 4;
  sala.pairs = [['A', 'B']];

  sala.finalizeDisconnect('B');

  const fin = recibido.s1.find((e) => e.ev === 'gameOver');
  comprobar('el que se queda recibe gameOver con victoria', !!fin && fin.datos.won === true, fin && fin.datos);
  comprobar('la sala se da por terminada', sala.ended === true);
  sala.clearTimer();
}

console.log(fallos ? `\n${fallos} comprobaciones fallidas` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
