'use strict';

/**
 * Roster: 32 criaturas, 4 por cada uno de los 8 tipos (= los 8 combos).
 * dex = numero de Pokedex nacional, usado para pedir el artwork oficial a PokeAPI:
 *   https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{dex}.png
 */

const BASE_STATS = {
  1: { hp: 600, atk: 48, def: 14 },
  2: { hp: 850, atk: 62, def: 20 },
  3: { hp: 1150, atk: 78, def: 28 },
  4: { hp: 1550, atk: 98, def: 38 },
  5: { hp: 2050, atk: 128, def: 52 },
};

// range en celdas, atkSpeed = ticks entre ataques (mas bajo = mas rapido)
const RAW = [
  // FIRE
  { id: 'charmander', dex: 4, name: 'Charmander', type: 'fire', cost: 1, range: 1, atkSpeed: 8 },
  { id: 'vulpix', dex: 37, name: 'Vulpix', type: 'fire', cost: 1, range: 2, atkSpeed: 7 },
  { id: 'growlithe', dex: 58, name: 'Growlithe', type: 'fire', cost: 2, range: 1, atkSpeed: 7 },
  { id: 'charizard', dex: 6, name: 'Charizard', type: 'fire', cost: 5, range: 2, atkSpeed: 7 },
  // WATER
  { id: 'squirtle', dex: 7, name: 'Squirtle', type: 'water', cost: 1, range: 2, atkSpeed: 8 },
  { id: 'psyduck', dex: 54, name: 'Psyduck', type: 'water', cost: 1, range: 1, atkSpeed: 8 },
  { id: 'poliwag', dex: 60, name: 'Poliwag', type: 'water', cost: 2, range: 2, atkSpeed: 8 },
  { id: 'blastoise', dex: 9, name: 'Blastoise', type: 'water', cost: 5, range: 3, atkSpeed: 8 },
  // GRASS
  { id: 'bulbasaur', dex: 1, name: 'Bulbasaur', type: 'grass', cost: 1, range: 2, atkSpeed: 9 },
  { id: 'oddish', dex: 43, name: 'Oddish', type: 'grass', cost: 1, range: 1, atkSpeed: 9 },
  { id: 'bellsprout', dex: 69, name: 'Bellsprout', type: 'grass', cost: 2, range: 2, atkSpeed: 9 },
  { id: 'venusaur', dex: 3, name: 'Venusaur', type: 'grass', cost: 5, range: 2, atkSpeed: 8 },
  // ELECTRIC
  { id: 'pikachu', dex: 25, name: 'Pikachu', type: 'electric', cost: 1, range: 2, atkSpeed: 6 },
  { id: 'voltorb', dex: 100, name: 'Voltorb', type: 'electric', cost: 1, range: 1, atkSpeed: 6 },
  { id: 'magnemite', dex: 81, name: 'Magnemite', type: 'electric', cost: 2, range: 2, atkSpeed: 6 },
  { id: 'raichu', dex: 26, name: 'Raichu', type: 'electric', cost: 4, range: 2, atkSpeed: 6 },
  // PSYCHIC
  { id: 'abra', dex: 63, name: 'Abra', type: 'psychic', cost: 1, range: 3, atkSpeed: 9 },
  { id: 'drowzee', dex: 96, name: 'Drowzee', type: 'psychic', cost: 1, range: 2, atkSpeed: 9 },
  { id: 'mrmime', dex: 122, name: 'Mr. Mime', type: 'psychic', cost: 3, range: 3, atkSpeed: 8 },
  { id: 'alakazam', dex: 65, name: 'Alakazam', type: 'psychic', cost: 4, range: 3, atkSpeed: 8 },
  // FIGHTING
  { id: 'machop', dex: 66, name: 'Machop', type: 'fighting', cost: 1, range: 1, atkSpeed: 7 },
  { id: 'mankey', dex: 56, name: 'Mankey', type: 'fighting', cost: 1, range: 1, atkSpeed: 6 },
  { id: 'hitmonlee', dex: 106, name: 'Hitmonlee', type: 'fighting', cost: 3, range: 1, atkSpeed: 6 },
  { id: 'machamp', dex: 68, name: 'Machamp', type: 'fighting', cost: 4, range: 1, atkSpeed: 7 },
  // FLYING
  { id: 'pidgey', dex: 16, name: 'Pidgey', type: 'flying', cost: 1, range: 1, atkSpeed: 6 },
  { id: 'spearow', dex: 21, name: 'Spearow', type: 'flying', cost: 1, range: 1, atkSpeed: 6 },
  { id: 'farfetchd', dex: 83, name: "Farfetch'd", type: 'flying', cost: 2, range: 1, atkSpeed: 7 },
  { id: 'pidgeot', dex: 18, name: 'Pidgeot', type: 'flying', cost: 4, range: 1, atkSpeed: 5 },
  // DRAGON
  { id: 'dratini', dex: 147, name: 'Dratini', type: 'dragon', cost: 2, range: 1, atkSpeed: 9 },
  { id: 'dragonair', dex: 148, name: 'Dragonair', type: 'dragon', cost: 3, range: 1, atkSpeed: 9 },
  { id: 'gyarados', dex: 130, name: 'Gyarados', type: 'dragon', cost: 4, range: 1, atkSpeed: 8 },
  { id: 'dragonite', dex: 149, name: 'Dragonite', type: 'dragon', cost: 5, range: 1, atkSpeed: 8 },
];

const POKEMON = RAW.map((p) => {
  const base = BASE_STATS[p.cost];
  return {
    ...p,
    hp: base.hp,
    atk: base.atk,
    def: base.def,
    sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.dex}.png`,
  };
});

const POKEMON_BY_ID = Object.fromEntries(POKEMON.map((p) => [p.id, p]));

// Los 8 combos (sinergias por tipo). Umbrales: 2 y 4 unidades del mismo tipo en el tablero.
const SYNERGIES = {
  fire: {
    label: 'Llama Ardiente',
    icon: '🔥',
    desc: 'Los ataques infligen quemadura (daño continuo).',
    thresholds: {
      2: { burnPct: 0.05, burnTicks: 20 },
      4: { burnPct: 0.09, burnTicks: 24, atkMult: 1.2 },
    },
  },
  water: {
    label: 'Torrente',
    icon: '💧',
    desc: 'El equipo empieza el combate con un escudo.',
    thresholds: {
      2: { shieldPct: 0.15 },
      4: { shieldPct: 0.3, healOnKillPct: 0.1 },
    },
  },
  grass: {
    label: 'Espesura',
    icon: '🌿',
    desc: 'El equipo regenera vida cada segundo.',
    thresholds: {
      2: { regenPct: 0.02 },
      4: { regenPct: 0.045, hpMult: 1.2 },
    },
  },
  electric: {
    label: 'Estática',
    icon: '⚡',
    desc: 'Los ataques pueden encadenar un rayo a otro enemigo.',
    thresholds: {
      2: { chainChance: 0.2, chainPct: 0.5 },
      4: { chainChance: 0.4, chainPct: 0.75, stunChance: 0.25 },
    },
  },
  psychic: {
    label: 'Premonición',
    icon: '🔮',
    desc: 'El equipo inflige más daño de ataque.',
    thresholds: {
      2: { atkMult: 1.15 },
      4: { atkMult: 1.4 },
    },
  },
  fighting: {
    label: 'Combate',
    icon: '🥊',
    desc: 'El equipo gana ataque físico puro.',
    thresholds: {
      2: { atkMult: 1.25 },
      4: { atkMult: 1.5, defMult: 1.3 },
    },
  },
  flying: {
    label: 'Alas Veloces',
    icon: '🕊️',
    desc: 'El equipo gana probabilidad de esquivar ataques.',
    thresholds: {
      2: { dodgeChance: 0.15 },
      4: { dodgeChance: 0.3, speedMult: 1.2 },
    },
  },
  dragon: {
    label: 'Poder Ancestral',
    icon: '🐉',
    desc: 'Bonificación masiva a todas las estadísticas.',
    thresholds: {
      2: { allMult: 1.3 },
      4: { allMult: 1.6 },
    },
  },
};

const STAR_MULT = { 1: 1, 2: 1.8, 3: 3.24, 4: 5.832 };
const MAX_STAR = 4;

module.exports = { POKEMON, POKEMON_BY_ID, SYNERGIES, STAR_MULT, MAX_STAR };
