'use strict';

// La tienda: probabilidades por coste y que no repita personaje.
const { rollShop, SHOP_SIZE, COST_ODDS } = require('../server/economy');
const { CHARACTERS_BY_ID } = require('../server/characterData');

let fallos = 0;
function comprobar(nombre, ok, extra) {
  console.log(`${ok ? 'OK  ' : 'MAL '} ${nombre}${ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra)}`);
  if (!ok) fallos++;
}

const TIENDAS = 20000;
const cuenta = [0, 0, 0, 0, 0];
let repetidas = 0;
let huecosMal = 0;
for (let i = 0; i < TIENDAS; i++) {
  const tienda = rollShop();
  if (tienda.length !== SHOP_SIZE) huecosMal++;
  if (new Set(tienda).size !== tienda.length) repetidas++;
  for (const id of tienda) cuenta[CHARACTERS_BY_ID[id].cost - 1]++;
}

comprobar('todas las tiendas traen 4 personajes', huecosMal === 0, { huecosMal });
comprobar('ninguna tienda repite personaje', repetidas === 0, { repetidas });

const total = cuenta.reduce((a, b) => a + b, 0);
const pct = cuenta.map((n) => (n / total) * 100);
console.log('     reparto por coste: ' + pct.map((p, i) => `${i + 1}🪙 ${p.toFixed(1)}%`).join('  '));
const esperado = COST_ODDS.map((n) => (n / COST_ODDS.reduce((a, b) => a + b, 0)) * 100);
const desvio = pct.map((p, i) => Math.abs(p - esperado[i]));
comprobar('el reparto real se parece al configurado (±1,5 puntos)',
  desvio.every((d) => d < 1.5), { esperado: esperado.map((e) => +e.toFixed(1)), real: pct.map((p) => +p.toFixed(1)) });
comprobar('los capitanes (coste 5) salen bastante mas que antes', pct[4] > 9, { real: +pct[4].toFixed(1) });
comprobar('los de coste 1 ya no inundan la tienda', pct[0] < 32, { real: +pct[0].toFixed(1) });

console.log(fallos ? `\n${fallos} comprobaciones fallidas` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
