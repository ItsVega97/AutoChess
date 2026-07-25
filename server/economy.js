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

// Cuantas tropas caben en la cubierta esta ronda: al estilo Tactics Royale se
// empieza con una sola y se gana un hueco despues de cada combate, hasta 6.
const MAX_TEAM = 6;
function teamSizeForRound(round) {
  return Math.min(MAX_TEAM, Math.max(1, round));
}

// La calidad de la tienda va por su cuenta: sube cada dos rondas hasta 8, que
// es donde salen los capitanes. Ya no depende del tamano del equipo.
function shopTierForRound(round) {
  return Math.min(8, Math.max(1, Math.floor((round + 1) / 2)));
}

function rollCost(tier) {
  const odds = SHOP_ODDS[Math.min(8, Math.max(1, tier))];
  const r = Math.random() * 100;
  let acc = 0;
  for (let i = 0; i < odds.length; i++) {
    acc += odds[i];
    if (r < acc) return i + 1;
  }
  return 1;
}

// La tienda ensena 4 personajes y se renueva entera cada vez que compras uno,
// como en Tactics Royale.
const SHOP_SIZE = 4;
function rollShop(tier) {
  const shop = [];
  for (let i = 0; i < SHOP_SIZE; i++) {
    const cost = rollCost(tier);
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
  SHOP_ODDS, MAX_TEAM, SHOP_SIZE,
  teamSizeForRound, shopTierForRound, rollShop, goldIncome, roundDamage,
};
