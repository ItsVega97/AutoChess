'use strict';

/**
 * Roster: 8 tripulaciones ("combos") con 5 miembros cada una (4 nakama +
 * su capitan como ficha legendaria de coste 5). 40 personajes en total.
 *
 * No usamos artwork oficial (sin fuente fiable y libre de derechos para
 * hotlink, y romperia en redes que bloqueen el CDN). En su lugar cada
 * personaje tiene un "cartel de se busca" generado con sus iniciales y el
 * color de su tripulacion, dibujado en cliente sin depender de la red.
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
  // SOMBRERO DE PAJA
  { id: 'usopp', name: 'Usopp', crew: 'strawhat', cost: 1, range: 3, atkSpeed: 8, initials: 'US' },
  { id: 'nami', name: 'Nami', crew: 'strawhat', cost: 2, range: 2, atkSpeed: 8, initials: 'NA' },
  { id: 'sanji', name: 'Sanji', crew: 'strawhat', cost: 3, range: 1, atkSpeed: 6, initials: 'SA' },
  { id: 'zoro', name: 'Zoro', crew: 'strawhat', cost: 4, range: 1, atkSpeed: 6, initials: 'ZO' },
  { id: 'luffy', name: 'Luffy', crew: 'strawhat', cost: 5, range: 1, atkSpeed: 7, initials: 'LU', captain: true },
  // BARBABLANCA
  { id: 'vista', name: 'Vista', crew: 'whitebeard', cost: 1, range: 1, atkSpeed: 7, initials: 'VI' },
  { id: 'jozu', name: 'Jozu', crew: 'whitebeard', cost: 2, range: 1, atkSpeed: 8, initials: 'JO' },
  { id: 'marco', name: 'Marco', crew: 'whitebeard', cost: 3, range: 2, atkSpeed: 7, initials: 'MC' },
  { id: 'ace', name: 'Ace', crew: 'whitebeard', cost: 4, range: 2, atkSpeed: 7, initials: 'AC' },
  { id: 'whitebeard', name: 'Barbablanca', crew: 'whitebeard', cost: 5, range: 1, atkSpeed: 9, initials: 'WB', captain: true },
  // BIG MOM
  { id: 'perospero', name: 'Perospero', crew: 'bigmom', cost: 1, range: 2, atkSpeed: 8, initials: 'PR' },
  { id: 'cracker', name: 'Cracker', crew: 'bigmom', cost: 2, range: 2, atkSpeed: 8, initials: 'CK' },
  { id: 'smoothie', name: 'Smoothie', crew: 'bigmom', cost: 3, range: 2, atkSpeed: 7, initials: 'SM' },
  { id: 'katakuri', name: 'Katakuri', crew: 'bigmom', cost: 4, range: 2, atkSpeed: 6, initials: 'KT' },
  { id: 'bigmom', name: 'Big Mom', crew: 'bigmom', cost: 5, range: 1, atkSpeed: 8, initials: 'BM', captain: true },
  // PIRATAS DE LAS BESTIAS
  { id: 'jack', name: 'Jack', crew: 'beast', cost: 1, range: 1, atkSpeed: 8, initials: 'JK' },
  { id: 'ulti', name: 'Ulti', crew: 'beast', cost: 2, range: 1, atkSpeed: 7, initials: 'UL' },
  { id: 'queen', name: 'Queen', crew: 'beast', cost: 3, range: 1, atkSpeed: 7, initials: 'QN' },
  { id: 'king', name: 'King', crew: 'beast', cost: 4, range: 1, atkSpeed: 6, initials: 'KG' },
  { id: 'kaido', name: 'Kaido', crew: 'beast', cost: 5, range: 1, atkSpeed: 8, initials: 'KD', captain: true },
  // PIRATAS PELIRROJOS
  { id: 'yasopp', name: 'Yasopp', crew: 'redhair', cost: 1, range: 3, atkSpeed: 8, initials: 'YS' },
  { id: 'luckyroux', name: 'Lucky Roux', crew: 'redhair', cost: 2, range: 1, atkSpeed: 8, initials: 'LR' },
  { id: 'rockstar', name: 'Rockstar', crew: 'redhair', cost: 3, range: 1, atkSpeed: 7, initials: 'RK' },
  { id: 'bennbeckman', name: 'Benn Beckman', crew: 'redhair', cost: 4, range: 2, atkSpeed: 6, initials: 'BE' },
  { id: 'shanks', name: 'Shanks', crew: 'redhair', cost: 5, range: 1, atkSpeed: 6, initials: 'SH', captain: true },
  // PIRATAS DE BARBANEGRA
  { id: 'docq', name: 'Doc Q', crew: 'blackbeard', cost: 1, range: 1, atkSpeed: 9, initials: 'DQ' },
  { id: 'vanaugur', name: 'Van Augur', crew: 'blackbeard', cost: 2, range: 3, atkSpeed: 7, initials: 'VA' },
  { id: 'burgess', name: 'Jesus Burgess', crew: 'blackbeard', cost: 3, range: 1, atkSpeed: 6, initials: 'JB' },
  { id: 'shiryu', name: 'Shiryu', crew: 'blackbeard', cost: 4, range: 1, atkSpeed: 7, initials: 'SY' },
  { id: 'blackbeard', name: 'Barbanegra', crew: 'blackbeard', cost: 5, range: 1, atkSpeed: 8, initials: 'BN', captain: true },
  // PIRATAS DE ROGER
  { id: 'buggy', name: 'Buggy', crew: 'roger', cost: 1, range: 2, atkSpeed: 8, initials: 'BU' },
  { id: 'crocus', name: 'Crocus', crew: 'roger', cost: 2, range: 1, atkSpeed: 8, initials: 'CU' },
  { id: 'gaban', name: 'Scopper Gaban', crew: 'roger', cost: 3, range: 1, atkSpeed: 7, initials: 'GB' },
  { id: 'rayleigh', name: 'Silvers Rayleigh', crew: 'roger', cost: 4, range: 1, atkSpeed: 6, initials: 'RY' },
  { id: 'roger', name: 'Gol D. Roger', crew: 'roger', cost: 5, range: 1, atkSpeed: 7, initials: 'GR', captain: true },
  // BAROQUE WORKS
  { id: 'doublefinger', name: 'Miss Doublefinger', crew: 'baroque', cost: 1, range: 1, atkSpeed: 8, initials: 'MD' },
  { id: 'mr2', name: 'Mr. 2 Bon Kurei', crew: 'baroque', cost: 2, range: 1, atkSpeed: 7, initials: 'M2' },
  { id: 'robin', name: 'Miss All Sunday', crew: 'baroque', cost: 3, range: 2, atkSpeed: 8, initials: 'MR' },
  { id: 'mr1', name: 'Mr. 1', crew: 'baroque', cost: 4, range: 1, atkSpeed: 6, initials: 'M1' },
  { id: 'crocodile', name: 'Sir Crocodile', crew: 'baroque', cost: 5, range: 2, atkSpeed: 7, initials: 'SC', captain: true },
];

const CHARACTERS = RAW.map((c) => {
  const base = BASE_STATS[c.cost];
  return {
    ...c,
    hp: base.hp,
    atk: base.atk,
    def: base.def,
  };
});

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

// Los 8 combos (sinergias de tripulacion). Umbrales: 2, 4 y la tripulacion
// completa (5, incluyendo al capitan) para el bonus maximo.
const CREWS = {
  strawhat: {
    label: 'Sombrero de Paja',
    icon: '🏴‍☠️',
    color: 'strawhat',
    desc: 'El equipo gana ataque; con la tripulacion completa, mucho mas.',
    thresholds: {
      2: { atkMult: 1.2 },
      4: { atkMult: 1.4 },
      5: { atkMult: 1.7 },
    },
  },
  whitebeard: {
    label: 'Piratas de Barbablanca',
    icon: '🌊',
    color: 'whitebeard',
    desc: 'Bonificacion masiva a todas las estadisticas (el hombre mas fuerte del mundo).',
    thresholds: {
      2: { allMult: 1.15 },
      4: { allMult: 1.3 },
      5: { allMult: 1.5 },
    },
  },
  bigmom: {
    label: 'Piratas de Big Mom',
    icon: '🍰',
    color: 'bigmom',
    desc: 'El equipo empieza con un escudo y se cura al derrotar enemigos.',
    thresholds: {
      2: { shieldPct: 0.15 },
      4: { shieldPct: 0.28, healOnKillPct: 0.1 },
      5: { shieldPct: 0.4, healOnKillPct: 0.18 },
    },
  },
  beast: {
    label: 'Piratas de las Bestias',
    icon: '🐉',
    color: 'beast',
    desc: 'Los ataques queman con aliento de dragon (dano continuo).',
    thresholds: {
      2: { burnPct: 0.05, burnTicks: 20 },
      4: { burnPct: 0.08, burnTicks: 24, atkMult: 1.15 },
      5: { burnPct: 0.11, burnTicks: 28, atkMult: 1.3 },
    },
  },
  redhair: {
    label: 'Piratas Pelirrojos',
    icon: '⚡',
    color: 'redhair',
    desc: 'El Haki del Conquistador encadena ataques y puede aturdir.',
    thresholds: {
      2: { chainChance: 0.2, chainPct: 0.5 },
      4: { chainChance: 0.35, chainPct: 0.7, stunChance: 0.2 },
      5: { chainChance: 0.5, chainPct: 0.9, stunChance: 0.35 },
    },
  },
  blackbeard: {
    label: 'Piratas de Barbanegra',
    icon: '🌑',
    color: 'blackbeard',
    desc: 'La oscuridad y la gravedad esquivan ataques y aceleran al equipo.',
    thresholds: {
      2: { dodgeChance: 0.15 },
      4: { dodgeChance: 0.28, speedMult: 1.15 },
      5: { dodgeChance: 0.4, speedMult: 1.3 },
    },
  },
  roger: {
    label: 'Piratas de Roger',
    icon: '👑',
    color: 'roger',
    desc: 'El legado del Rey de los Piratas: vida y regeneracion sin fin.',
    thresholds: {
      2: { regenPct: 0.02 },
      4: { regenPct: 0.04, hpMult: 1.2 },
      5: { regenPct: 0.06, hpMult: 1.4 },
    },
  },
  baroque: {
    label: 'Baroque Works',
    icon: '🕶️',
    color: 'baroque',
    desc: 'Agentes disciplinados: mas ataque y defensa para todo el equipo.',
    thresholds: {
      2: { atkMult: 1.15, defMult: 1.15 },
      4: { atkMult: 1.3, defMult: 1.3 },
      5: { atkMult: 1.5, defMult: 1.5 },
    },
  },
};

const STAR_MULT = { 1: 1, 2: 1.8, 3: 3.24, 4: 5.832 };
const MAX_STAR = 4;

module.exports = { CHARACTERS, CHARACTERS_BY_ID, CREWS, STAR_MULT, MAX_STAR };
