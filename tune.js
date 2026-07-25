/**
 * Comprobacion de equilibrio.
 *
 * Dos medidas, porque una sola engana:
 *
 * 1) ESPEJO: tripulacion completa contra tripulacion completa. Al ser equipos
 *    simetricos AMPLIFICA muchisimo las diferencias (una ventaja del 5% se
 *    convierte en 50 puntos de victorias). Sirve para ordenar de mejor a peor
 *    y detectar cosas rotas, no como probabilidad real.
 *
 * 2) PARTIDA REAL: equipos mixtos al azar, con estrellas y tamanos variados,
 *    como se juega de verdad. Aqui se mide si tener una sinergia activa hace
 *    ganar mas que no tenerla. Es la que de verdad importa.
 */
const { simulateBattle, computeSynergies } = require('./server/battle');
const { CHARACTERS } = require('./server/characterData');

const crews = [...new Set(CHARACTERS.map((c) => c.crew))];
const CELLS = [];
for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) CELLS.push({ x, y });

function crewBoard(crew) {
  return CHARACTERS.filter((c) => c.crew === crew)
    .map((c, i) => ({ pokemonId: c.id, star: 1, x: CELLS[i].x, y: CELLS[i].y }));
}

function mirrorTest(rounds) {
  const wins = {};
  crews.forEach((c) => (wins[c] = 0));
  for (const a of crews) for (const b of crews) {
    if (a === b) continue;
    for (let i = 0; i < rounds; i++) {
      const r = simulateBattle(crewBoard(a), crewBoard(b));
      if (r.winner === 'A') wins[a]++; else if (r.winner === 'B') wins[b]++;
    }
  }
  const games = (crews.length - 1) * rounds * 2;
  return Object.entries(wins).map(([c, w]) => [c, (100 * w) / games]).sort((x, y) => y[1] - x[1]);
}

function randomTeam() {
  const size = 3 + Math.floor(Math.random() * 4); // 3-6 unidades
  const cells = [...CELLS].sort(() => Math.random() - 0.5);
  return cells.slice(0, size).map((c) => {
    const ch = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    return { pokemonId: ch.id, star: 1 + Math.floor(Math.random() * 3), x: c.x, y: c.y };
  });
}

// ¿Gana mas quien tiene alguna sinergia activa?
function realTest(rounds) {
  let conSinergia = 0, sinSinergia = 0, comparables = 0;
  for (let i = 0; i < rounds; i++) {
    const A = randomTeam();
    const B = randomTeam();
    const tiersA = computeSynergies(A).summary.filter((s) => s.tier > 0).length;
    const tiersB = computeSynergies(B).summary.filter((s) => s.tier > 0).length;
    if (tiersA === tiersB) continue;
    // solo comparamos equipos del mismo tamano, para aislar el efecto sinergia
    if (A.length !== B.length) continue;
    comparables++;
    const r = simulateBattle(A, B);
    const masSinergiaEs = tiersA > tiersB ? 'A' : 'B';
    if (r.winner === masSinergiaEs) conSinergia++;
    else if (r.winner !== 'draw') sinSinergia++;
  }
  return { conSinergia, sinSinergia, comparables };
}

console.log('1) ESPEJO (amplifica; solo para ordenar)');
const rows = mirrorTest(Number(process.argv[2] || 40));
for (const [c, pct] of rows) {
  const m = pct > 68 ? ' <-- fuerte' : pct < 32 ? ' <-- debil' : '';
  console.log('   ' + c.padEnd(12), pct.toFixed(0).padStart(3) + '%' + m);
}
console.log('   spread:', (rows[0][1] - rows[rows.length - 1][1]).toFixed(0), 'puntos');

console.log('\n2) PARTIDA REAL (equipos mixtos del mismo tamano)');
const t = realTest(4000);
const pct = (100 * t.conSinergia) / (t.conSinergia + t.sinSinergia);
console.log(`   combates comparables: ${t.comparables}`);
console.log(`   gana el equipo con mas sinergias activas: ${pct.toFixed(1)}%`);
console.log('   (deberia estar claramente por encima de 50 pero lejos de 100)');
