'use strict';

const { CHARACTERS } = require('./characterData');

const SHOP_ODDS = {
  1: [100, 0, 0, 0, 0],
  2: [80, 20, 0, 0, 0],
  3: [65, 25, 10, 0, 0],
  4: [50, 30, 15, 5, 0],
  5: [40, 30, 20, 8, 2],
  6: [30, 30, 25, 10, 5],
  7: [20, 25, 30, 18, 7],
  8: [15, 20, 25, 25, 15],
};

const POOL_BY_COST = {};
for (const c of CHARACTERS) {
  (POOL_BY_COST[c.cost] = POOL_BY_COST[c.cost] || []).push(c);
}

function levelForRound(round) {
  return Math.min(8, Math.floor((round + 1) / 2));
}

// El tablero compacto (5x3 por jugador) da menos hueco que el antiguo 8x4,
// asi que el tope de unidades sube mas despacio y se queda en 6.
function boardCapacityForLevel(level) {
  return Math.min(6, Math.max(2, Math.ceil(level * 0.8)));
}

function rollCost(level) {
  const odds = SHOP_ODDS[Math.min(8, Math.max(1, level))];
  const r = Math.random() * 100;
  let acc = 0;
  for (let i = 0; i < odds.length; i++) {
    acc += odds[i];
    if (r < acc) return i + 1;
  }
  return 1;
}

function rollShop(level) {
  const shop = [];
  for (let i = 0; i < 5; i++) {
    const cost = rollCost(level);
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

module.exports = { SHOP_ODDS, levelForRound, boardCapacityForLevel, rollShop, goldIncome, roundDamage };
