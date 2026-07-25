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

function boardCapacityForLevel(level) {
  return Math.min(8, level);
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

function roundDamage(round, survivors) {
  const base = 2 + Math.floor(round / 3);
  const survivorDmg = survivors.reduce((s, u) => s + u.cost * u.star, 0);
  return base + survivorDmg;
}

module.exports = { SHOP_ODDS, levelForRound, boardCapacityForLevel, rollShop, goldIncome, roundDamage };
