// Reproduce el log de muchos combates y comprueba dos invariantes:
//  1) nunca hay dos unidades vivas en la misma casilla
//  2) las habilidades se lanzan con una frecuencia razonable
const { simulateBattle } = require('./server/battle');
const { CHARACTERS } = require('./server/characterData');

const crews = [...new Set(CHARACTERS.map((c) => c.crew))];

function randomBoard(size) {
  const cells = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) cells.push({ x, y });
  cells.sort(() => Math.random() - 0.5);
  const pool = CHARACTERS;
  return cells.slice(0, size).map((c) => {
    const ch = pool[Math.floor(Math.random() * pool.length)];
    return { pokemonId: ch.id, star: 1 + Math.floor(Math.random() * 3), x: c.x, y: c.y };
  });
}

let collisions = 0;
let battles = 0;
let totalAbilities = 0;
let totalUnits = 0;
let maxOverlapSeen = 0;

for (let i = 0; i < 300; i++) {
  const A = randomBoard(1 + Math.floor(Math.random() * 6));
  const B = randomBoard(1 + Math.floor(Math.random() * 6));
  const res = simulateBattle(A, B);
  battles++;
  totalUnits += A.length + B.length;
  totalAbilities += res.log.filter((e) => e.type === 'ability').length;

  // reproduce el log tick a tick
  const pos = new Map();
  const alive = new Map();
  let t = 0;
  const checkTick = () => {
    const seen = new Map();
    for (const [uid, p] of pos) {
      if (!alive.get(uid)) continue;
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) {
        collisions++;
        maxOverlapSeen = Math.max(maxOverlapSeen, 2);
        if (collisions <= 3) {
          console.error(`COLISION en t=${t}: ${uid} y ${seen.get(key)} ambos en ${key}`);
        }
      } else {
        seen.set(key, uid);
      }
    }
  };

  for (const e of res.log) {
    if (e.t !== t) { checkTick(); t = e.t; }
    if (e.type === 'spawn') { pos.set(e.uid, { x: e.x, y: e.y }); alive.set(e.uid, true); }
    else if (e.type === 'move') pos.set(e.uid, { x: e.x, y: e.y });
    else if (e.type === 'death') alive.set(e.uid, false);
  }
  checkTick();
}

console.log(`combates: ${battles}`);
console.log(`colisiones detectadas: ${collisions}`);
console.log(`habilidades por unidad: ${(totalAbilities / totalUnits).toFixed(2)}`);
console.log(collisions === 0 ? 'OK: nunca hay dos unidades en la misma casilla' : 'FALLO: hay apilamientos');
process.exit(collisions === 0 ? 0 : 1);
