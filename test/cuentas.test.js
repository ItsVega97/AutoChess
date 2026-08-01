'use strict';

// Cuentas de jugador: puntos de ranking, divisiones y nombres.
// Se usa un archivo aparte para no tocar los datos de verdad.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'users.json');
const COPIA = `${FILE}.test-backup`;
let habia = false;
try { fs.copyFileSync(FILE, COPIA); habia = true; } catch (e) { /* no hay nada guardado */ }
try { fs.unlinkSync(FILE); } catch (e) { /* idem */ }

const users = require('../server/users');

let fallos = 0;
function comprobar(nombre, ok, extra) {
  console.log(`${ok ? 'OK  ' : 'MAL '} ${nombre}${ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra)}`);
  if (!ok) fallos++;
}

// --- alta desde Google ---
const a = users.upsertFromGoogle({ sub: 'g-1', email: 'a@x.com', picture: '' });
comprobar('la cuenta nueva empieza a 0 puntos', a.points === 0, a);
comprobar('la cuenta nueva tiene que elegir nombre', users.vista(a).needsProfile === true);
comprobar('entrar otra vez no crea una cuenta nueva', users.upsertFromGoogle({ sub: 'g-1' }) === a);

// --- nombre e icono ---
comprobar('un nombre de una letra se rechaza', !!users.setProfile('g-1', { name: 'A' }).error);
const r1 = users.setProfile('g-1', { name: 'Luffy', icon: 'luffy' });
comprobar('se guarda nombre e icono', !r1.error && r1.user.name === 'Luffy' && r1.user.icon === 'luffy', r1);
comprobar('ya no pide elegir nombre', users.vista(users.get('g-1')).needsProfile === false);

users.upsertFromGoogle({ sub: 'g-2', email: 'b@x.com' });
comprobar('no deja repetir nombre (ni cambiando mayusculas)',
  !!users.setProfile('g-2', { name: 'luFFy' }).error);
comprobar('con otro nombre si deja', !users.setProfile('g-2', { name: 'Zoro' }).error);

// --- puntos: +20 al ganar, -15 al perder ---
users.recordMatch('g-1', true);
comprobar('ganar suma 20', users.get('g-1').points === 20, users.get('g-1'));
users.recordMatch('g-1', false);
comprobar('perder resta 15', users.get('g-1').points === 5, users.get('g-1'));
users.recordMatch('g-1', false);
comprobar('los puntos no bajan de 0', users.get('g-1').points === 0, users.get('g-1'));
comprobar('se llevan la cuenta de partidas y victorias',
  users.get('g-1').games === 3 && users.get('g-1').wins === 1, users.get('g-1'));

// --- divisiones ---
const esperado = [
  [0, 'Novato'], [999, 'Novato'], [1000, 'Capitán'], [1999, 'Capitán'],
  [2000, 'Shichibukai'], [3000, 'Yonkou'], [4000, 'Rey Pirata'], [99999, 'Rey Pirata'],
];
let malDiv = null;
for (const [pts, label] of esperado) {
  if (users.divisionDe(pts).label !== label) malDiv = { pts, dio: users.divisionDe(pts).label, esperaba: label };
}
comprobar('cada tramo de puntos cae en su division', malDiv === null, malDiv);

// --- tabla ---
users.get('g-2').points = 500;
const tabla = users.top(10);
comprobar('la tabla ordena de mas a menos puntos y numera',
  tabla.length === 2 && tabla[0].name === 'Zoro' && tabla[0].rank === 1 && tabla[1].rank === 2, tabla);
users.upsertFromGoogle({ sub: 'g-3' });
comprobar('quien no ha elegido nombre no sale en la tabla', users.top(10).length === 2);

// --- de la partida a la cuenta ---
// Que GameRoom.endGame le sume los puntos a la cuenta del que jugaba, y no al
// invitado que entra sin iniciar sesion.
{
  const GameRoom = require('../server/GameRoom');
  const sockets = new Map([['s1', { emit() {} }], ['s2', { emit() {} }]]);
  const io = { sockets: { sockets } };
  const sala = new GameRoom(io, [
    { id: 's1', name: 'Luffy', userId: 'g-1' },
    { id: 's2', name: 'Invitado' },
  ]);
  sala.clearTimer();
  const antesGanador = users.get('g-1').points;
  const antesPerdedor = users.get('g-2').points;
  sala.players.B.alive = false; // gana A
  sala.endGame();
  comprobar('el ganador con cuenta suma 20 al acabar la partida',
    users.get('g-1').points === antesGanador + 20, users.get('g-1'));
  comprobar('el invitado sin cuenta no toca ninguna otra cuenta',
    users.get('g-2').points === antesPerdedor, users.get('g-2'));
}

// Se deja el disco como estaba (el guardado va diferido, asi que hay que
// esperar a que escriba antes de restaurar).
setTimeout(() => {
  try { fs.unlinkSync(FILE); } catch (e) { /* nada que borrar */ }
  if (habia) { fs.copyFileSync(COPIA, FILE); fs.unlinkSync(COPIA); }
  console.log(fallos ? `\n${fallos} comprobaciones han fallado` : '\nTodo correcto');
  process.exit(fallos ? 1 : 0);
}, 800);
