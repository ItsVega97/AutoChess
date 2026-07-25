'use strict';

const { CHARACTERS } = require('./characterData');

// Probabilidad de que un hueco de la tienda saque un personaje de cada coste.
// Como en Tactics Royale, el roster entero esta disponible desde la primera
// ronda: los capitanes (coste 5) pueden salir ya en la ronda 1, solo que muy de
// vez en cuando. Las probabilidades no cambian nunca, lo que cambia es el oro
// que tienes para aprovecharlas.
//         coste:   1   2   3   4   5
const COST_ODDS = [ 40, 26, 18, 11,  5];

const POOL_BY_COST = {};
for (const c of CHARACTERS) {
  (POOL_BY_COST[c.cost] = POOL_BY_COST[c.cost] || []).push(c);
}

// Cuantas tropas caben en la cubierta esta ronda: al estilo Tactics Royale se
// empieza con una sola y se gana un hueco despues de cada combate, hasta 6.
const MAX_TEAM = 6;
function teamSizeForRound(round) {
  return Math.min(MAX_TEAM, Math.max(1, round));
}

const TOTAL_ODDS = COST_ODDS.reduce((a, b) => a + b, 0);
function rollCost() {
  const r = Math.random() * TOTAL_ODDS;
  let acc = 0;
  for (let i = 0; i < COST_ODDS.length; i++) {
    acc += COST_ODDS[i];
    if (r < acc) return i + 1;
  }
  return 1;
}

// La tienda ensena 4 personajes y se renueva entera cada vez que compras uno,
// como en Tactics Royale.
const SHOP_SIZE = 4;
function rollShop() {
  const shop = [];
  for (let i = 0; i < SHOP_SIZE; i++) {
    const cost = rollCost();
    const pool = POOL_BY_COST[cost] || POOL_BY_COST[1];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    shop.push(pick.id);
  }
  return shop;
}

function goldIncome(gold, streak) {
  const base = 5;
  const interest = Math.min(5, Math.floor(gold / 10));
  let streakBonus = 0;
  if (streak >= 6) streakBonus = 3;
  else if (streak >= 4) streakBonus = 2;
  else if (streak >= 2) streakBonus = 1;
  return base + interest + streakBonus;
}

// Con 20 puntos de vida el dano por ronda tiene que ser pequeno: contamos
// cuantas unidades sobrevivieron (no su coste, que se dispara al fusionar) y
// lo limitamos, de forma que perder cuesta ~2-3 al principio y ~5-6 al final.
// Asi una partida dura del orden de 5-7 derrotas.
const MAX_ROUND_DAMAGE = 6;
function roundDamage(round, survivors) {
  const base = 1 + Math.floor(round / 4);
  return Math.min(MAX_ROUND_DAMAGE, base + Math.ceil(survivors.length / 2));
}

module.exports = {
  COST_ODDS, MAX_TEAM, SHOP_SIZE,
  teamSizeForRound, rollShop, goldIncome, roundDamage,
};
