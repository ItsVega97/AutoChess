'use strict';

// Regresion del bug: al mover fichas por la cubierta desaparecian personajes.
// moveToBoard calculaba el indice del ocupante ANTES de sacar de la lista la
// ficha que se movia, asi que despues apuntaba a otra: se cambiaba de sitio la
// equivocada y, con el banquillo lleno, se perdia una ficha.
const GameRoom = require('../server/GameRoom');

const io = { sockets: { sockets: new Map() } };

function salaDePruebas() {
  const sala = new GameRoom(io, [
    { id: 's1', name: 'Vega' },
    { id: 's2', name: 'Rival' },
  ]);
  sala.clearTimer();
  sala.phase = 'prep';
  sala.broadcastState = () => {};
  const p = sala.players.A;
  p.maxTeam = 6;
  return { sala, p };
}

// fichas distintas para que no se fusionen entre ellas
const FICHAS = ['luffy', 'zoro', 'nami', 'usopp', 'sanji', 'shanks', 'ace', 'marco'];
function ponerEnCubierta(sala, p, lista) {
  p.board = lista.map(([id, x, y], i) => ({ uid: `u${i + 1}`, pokemonId: id, star: 1, x, y }));
}

let fallos = 0;
function comprobar(nombre, ok, extra) {
  console.log(`${ok ? 'OK  ' : 'MAL '} ${nombre}${ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra)}`);
  if (!ok) fallos++;
}
const censo = (p) => p.board.length + p.bench.filter(Boolean).length;
const en = (p, x, y) => p.board.filter((u) => u.x === x && u.y === y);

// ---------- mover dentro de la cubierta a una casilla ocupada ----------
{
  const { sala, p } = salaDePruebas();
  ponerEnCubierta(sala, p, [['luffy', 0, 0], ['zoro', 1, 0], ['nami', 2, 0]]);
  p.bench = p.bench.map(() => null);
  const antes = censo(p);

  // la primera de la lista se mueve encima de la tercera
  sala.moveToBoard('A', 'u1', 2, 0);

  comprobar('no se pierde ninguna ficha', censo(p) === antes, { antes, ahora: censo(p) });
  comprobar('se intercambian de casilla',
    p.board.find((u) => u.uid === 'u1').x === 2 && p.board.find((u) => u.uid === 'u3').x === 0,
    p.board.map((u) => `${u.uid}@${u.x},${u.y}`));
  comprobar('la que no se toca se queda donde estaba',
    p.board.find((u) => u.uid === 'u2').x === 1);
  comprobar('no quedan dos fichas en la misma casilla',
    p.board.every((u) => en(p, u.x, u.y).length === 1),
    p.board.map((u) => `${u.uid}@${u.x},${u.y}`));
}

// ---------- lo mismo con el banquillo LLENO (aqui se perdia la ficha) ----------
{
  const { sala, p } = salaDePruebas();
  ponerEnCubierta(sala, p, [['luffy', 0, 0], ['zoro', 1, 0], ['nami', 2, 0]]);
  // personajes distintos a los de la cubierta: si no, se fusionan y la cuenta
  // baja por motivos legitimos
  p.bench = ['jozu', 'marco', 'ace', 'vista', 'king', 'queen']
    .map((id, i) => ({ uid: `b${i}`, pokemonId: id, star: 1 }));
  const antes = censo(p);

  sala.moveToBoard('A', 'u1', 2, 0);

  comprobar('con el banquillo lleno tampoco se pierde nada', censo(p) === antes, { antes, ahora: censo(p) });
  comprobar('el banquillo sigue igual de lleno', p.bench.filter(Boolean).length === 6);
  comprobar('el intercambio se hace igual',
    p.board.find((u) => u.uid === 'u1').x === 2 && p.board.find((u) => u.uid === 'u3').x === 0);
}

// ---------- del banquillo a una casilla ocupada ----------
{
  const { sala, p } = salaDePruebas();
  ponerEnCubierta(sala, p, [['luffy', 0, 0], ['zoro', 1, 0]]);
  p.bench = p.bench.map(() => null);
  p.bench[3] = { uid: 'bx', pokemonId: 'nami', star: 1 };
  const antes = censo(p);

  sala.moveToBoard('A', 'bx', 1, 0);

  comprobar('no se pierde ninguna ficha al bajar al ocupante', censo(p) === antes, { antes, ahora: censo(p) });
  comprobar('la del banquillo sube a la casilla',
    !!p.board.find((u) => u.uid === 'bx' && u.x === 1 && u.y === 0));
  comprobar('el ocupante baja al banquillo',
    p.bench.some((u) => u && u.uid === 'u2') && !p.board.some((u) => u.uid === 'u2'),
    p.bench.map((u) => (u ? u.uid : '-')));
}

// ---------- con el cupo lleno, cambiar una por otra ----------
{
  const { sala, p } = salaDePruebas();
  p.maxTeam = 2;
  ponerEnCubierta(sala, p, [['luffy', 0, 0], ['zoro', 1, 0]]);
  p.bench = p.bench.map(() => null);
  p.bench[0] = { uid: 'bx', pokemonId: 'nami', star: 1 };
  const antes = censo(p);

  sala.moveToBoard('A', 'bx', 3, 2); // casilla libre: no cabe, no pasa nada
  comprobar('con el cupo lleno no entra en una casilla libre',
    p.board.length === 2 && p.bench.some((u) => u && u.uid === 'bx'));

  sala.moveToBoard('A', 'bx', 1, 0); // cambiando por una que ya esta: si vale
  comprobar('pero si se puede cambiar por una de las que estan',
    p.board.length === 2 && !!p.board.find((u) => u.uid === 'bx'), p.board.map((u) => u.uid));
  comprobar('y sigue sin perderse nada', censo(p) === antes, { antes, ahora: censo(p) });
}

// ---------- soltar una ficha en su propia casilla ----------
{
  const { sala, p } = salaDePruebas();
  ponerEnCubierta(sala, p, [['luffy', 0, 0], ['zoro', 1, 0]]);
  p.bench = p.bench.map(() => null);
  const antes = censo(p);
  sala.moveToBoard('A', 'u1', 0, 0);
  comprobar('soltarla donde ya estaba no hace nada raro',
    censo(p) === antes && p.board.find((u) => u.uid === 'u1').x === 0, { ahora: censo(p) });
}

// ---------- muchos movimientos seguidos ----------
{
  const { sala, p } = salaDePruebas();
  ponerEnCubierta(sala, p, FICHAS.slice(0, 5).map((id, i) => [id, i, 0]));
  p.bench = p.bench.map(() => null);
  const antes = censo(p);
  const uids = p.board.map((u) => u.uid);
  for (let i = 0; i < 300; i++) {
    const uid = uids[Math.floor(Math.random() * uids.length)];
    sala.moveToBoard('A', uid, Math.floor(Math.random() * 5), Math.floor(Math.random() * 3));
  }
  comprobar('300 movimientos al azar y siguen las cinco', censo(p) === antes, { antes, ahora: censo(p) });
  comprobar('sin dos fichas en la misma casilla',
    p.board.every((u) => en(p, u.x, u.y).length === 1),
    p.board.map((u) => `${u.uid}@${u.x},${u.y}`));
  comprobar('estan todas las de siempre',
    uids.every((id) => p.board.some((u) => u.uid === id)), p.board.map((u) => u.uid));
}

console.log(fallos ? `\n${fallos} comprobaciones fallidas` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
