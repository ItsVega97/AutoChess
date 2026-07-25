'use strict';

/**
 * Roster: 8 tripulaciones ("combos") con 5 miembros cada una (4 nakama +
 * su capitan como ficha legendaria de coste 5). 40 personajes en total.
 *
 * Cada personaje puede tener un retrato real (ver PORTRAITS mas abajo,
 * fichero servido desde public/img/characters/). El que no tenga retrato
 * usa como respaldo un "cartel de se busca" con sus iniciales y el color
 * de su tripulacion, generado en cliente sin depender de ninguna imagen.
 */

const BASE_STATS = {
  1: { hp: 600, atk: 48, def: 14 },
  2: { hp: 850, atk: 62, def: 20 },
  3: { hp: 1150, atk: 78, def: 28 },
  4: { hp: 1550, atk: 98, def: 38 },
  5: { hp: 2050, atk: 128, def: 52 },
};

/**
 * Habilidades (`ability`)
 *
 * Cada personaje acumula mana al atacar y al recibir golpes; al llenar la
 * barra lanza su tecnica. Los efectos disponibles (los aplica battle.js):
 *
 *   damage_single { mult }              dano a su objetivo actual
 *   damage_aoe    { mult, radius }      dano alrededor del objetivo
 *   damage_all    { mult }              dano a todos los enemigos
 *   execute       { mult, bonus }       mas dano cuanto menos vida le queda
 *   heal_self     { pct }               se cura un % de su vida maxima
 *   heal_team     { pct }               cura a toda la tripulacion
 *   shield_self   { pct }               escudo propio
 *   shield_team   { pct }               escudo para todos
 *   buff_atk_team { mult }              sube el ataque de los aliados
 *   buff_self     { atkMult, defMult }  se potencia a si mismo
 *
 * Modificadores opcionales combinables con los de dano:
 *   stun: N        aturde N ticks       drain: 0..1  se cura ese % del dano
 *   burn: {pct,ticks}                   dodge: 0..1  esquiva extra
 *
 * Equilibrio: el mana necesario sube con el coste del personaje (los de 1
 * lanzan a menudo efectos modestos; los capitanes tardan pero deciden la
 * ronda). El dano se expresa como multiplicador de su propio ataque, asi que
 * escala solo con las estrellas y las sinergias.
 */

// range en celdas, atkSpeed = ticks entre ataques (mas bajo = mas rapido)
const RAW = [
  // ---------------- SOMBRERO DE PAJA ----------------
  { id: 'usopp', name: 'Usopp', crew: 'strawhat', cost: 1, range: 3, atkSpeed: 8, initials: 'US',
    ability: { name: 'Kayaku Boshi', desc: 'Dispara una estrella de pólvora que explota sobre el enemigo.',
      mana: 40, effect: { type: 'damage_aoe', mult: 1.5, radius: 1 } } },
  { id: 'nami', name: 'Nami', crew: 'strawhat', cost: 2, range: 2, atkSpeed: 8, initials: 'NA',
    ability: { name: 'Thunderbolt Tempo', desc: 'Invoca un rayo que daña y aturde a la zona.',
      mana: 50, effect: { type: 'damage_aoe', mult: 1.6, radius: 1, stun: 6 } } },
  { id: 'sanji', name: 'Sanji', crew: 'strawhat', cost: 3, range: 1, atkSpeed: 6, initials: 'SA',
    ability: { name: 'Diable Jambe', desc: 'Patada al rojo vivo que quema al objetivo.',
      mana: 55, effect: { type: 'damage_single', mult: 2.6, burn: { pct: 0.03, ticks: 18 } } } },
  { id: 'zoro', name: 'Zoro', crew: 'strawhat', cost: 4, range: 1, atkSpeed: 6, initials: 'ZO',
    ability: { name: 'Santoryu: Oni Giri', desc: 'Corte de tres espadas devastador sobre un enemigo.',
      mana: 65, effect: { type: 'damage_single', mult: 3.6 } } },
  { id: 'luffy', name: 'Luffy', crew: 'strawhat', cost: 5, range: 1, atkSpeed: 7, initials: 'LU', captain: true,
    ability: { name: 'Gomu Gomu no Red Hawk', desc: 'Puño en llamas que arrasa la zona y le enardece.',
      mana: 80, effect: { type: 'damage_aoe', mult: 3.0, radius: 1, burn: { pct: 0.028, ticks: 18 }, selfAtkMult: 1.2 } } },

  // ---------------- BARBABLANCA ----------------
  { id: 'vista', name: 'Vista', crew: 'whitebeard', cost: 1, range: 1, atkSpeed: 7, initials: 'VI',
    ability: { name: 'Espada Florida', desc: 'Ráfaga de estocadas sobre su objetivo.',
      mana: 45, effect: { type: 'damage_single', mult: 2.2 } } },
  { id: 'jozu', name: 'Jozu', crew: 'whitebeard', cost: 2, range: 1, atkSpeed: 8, initials: 'JO',
    ability: { name: 'Brilliant Punk', desc: 'Su cuerpo de diamante le blinda y golpea con fuerza.',
      mana: 50, effect: { type: 'damage_single', mult: 1.7, selfShieldPct: 0.2 } } },
  { id: 'marco', name: 'Marco', crew: 'whitebeard', cost: 3, range: 2, atkSpeed: 7, initials: 'MC',
    ability: { name: 'Llamas del Fénix', desc: 'Las llamas azules regeneran a toda la tripulación.',
      mana: 60, effect: { type: 'heal_team', pct: 0.18 } } },
  { id: 'ace', name: 'Ace', crew: 'whitebeard', cost: 4, range: 2, atkSpeed: 7, initials: 'AC',
    ability: { name: 'Hiken', desc: 'Un enorme puño de fuego calcina a los enemigos cercanos.',
      mana: 65, effect: { type: 'damage_aoe', mult: 2.4, radius: 1, burn: { pct: 0.04, ticks: 24 } } } },
  { id: 'whitebeard', name: 'Barbablanca', crew: 'whitebeard', cost: 5, range: 1, atkSpeed: 9, initials: 'WB', captain: true,
    ability: { name: 'Shima Yurashi', desc: 'Agrieta el aire y sacude el barco entero: daña a todos.',
      mana: 85, effect: { type: 'damage_all', mult: 1.9, stun: 4 } } },

  // ---------------- BIG MOM ----------------
  { id: 'perospero', name: 'Perospero', crew: 'bigmom', cost: 1, range: 2, atkSpeed: 8, initials: 'PR',
    ability: { name: 'Candy Wall', desc: 'Levanta un muro de caramelo que protege al equipo.',
      mana: 45, effect: { type: 'shield_team', pct: 0.12 } } },
  { id: 'cracker', name: 'Cracker', crew: 'bigmom', cost: 2, range: 2, atkSpeed: 8, initials: 'CK',
    ability: { name: 'Pretzel', desc: 'Se cubre de galleta y ataca desde dentro de la armadura.',
      mana: 50, effect: { type: 'damage_single', mult: 1.9, selfShieldPct: 0.22 } } },
  { id: 'smoothie', name: 'Smoothie', crew: 'bigmom', cost: 3, range: 2, atkSpeed: 7, initials: 'SM',
    ability: { name: 'Exprimir', desc: 'Escurre a su víctima y se cura con lo exprimido.',
      mana: 55, effect: { type: 'damage_single', mult: 2.3, drain: 0.5 } } },
  { id: 'katakuri', name: 'Katakuri', crew: 'bigmom', cost: 4, range: 2, atkSpeed: 6, initials: 'KT',
    ability: { name: 'Mochi Tsuki', desc: 'Ráfaga de puños de mochi; su Kenbunshoku le hace esquivar.',
      mana: 65, effect: { type: 'damage_single', mult: 3.2, selfDodge: 0.2 } } },
  { id: 'bigmom', name: 'Big Mom', crew: 'bigmom', cost: 5, range: 1, atkSpeed: 8, initials: 'BM', captain: true,
    ability: { name: 'Soul Pocus', desc: 'Arranca la vida de todos los enemigos y se alimenta de ella.',
      mana: 85, effect: { type: 'damage_all', mult: 1.7, drain: 0.35 } } },

  // ---------------- PIRATAS DE LAS BESTIAS ----------------
  { id: 'jack', name: 'Jack', crew: 'beast', cost: 1, range: 1, atkSpeed: 8, initials: 'JK',
    ability: { name: 'Pisotón de Mamut', desc: 'Carga con su forma de mamut y aplasta la zona.',
      mana: 45, effect: { type: 'damage_aoe', mult: 1.6, radius: 1 } } },
  { id: 'ulti', name: 'Ulti', crew: 'beast', cost: 2, range: 1, atkSpeed: 7, initials: 'UL',
    ability: { name: 'Ul-Cabezazo', desc: 'Un cabezazo de saurio que deja aturdido al rival.',
      mana: 50, effect: { type: 'damage_single', mult: 2.1, stun: 8 } } },
  { id: 'queen', name: 'Queen', crew: 'beast', cost: 3, range: 1, atkSpeed: 7, initials: 'QN',
    ability: { name: 'Brachio Bomb', desc: 'Se lanza en forma de braquiosaurio sobre el grupo enemigo.',
      mana: 60, effect: { type: 'damage_aoe', mult: 2.2, radius: 1 } } },
  { id: 'king', name: 'King', crew: 'beast', cost: 4, range: 1, atkSpeed: 6, initials: 'KG',
    ability: { name: 'Llamarada Lunaria', desc: 'Envuelve la cubierta en fuego lunario.',
      mana: 65, effect: { type: 'damage_aoe', mult: 2.3, radius: 1, burn: { pct: 0.045, ticks: 24 } } } },
  { id: 'kaido', name: 'Kaido', crew: 'beast', cost: 5, range: 1, atkSpeed: 8, initials: 'KD', captain: true,
    ability: { name: 'Bolo Breath', desc: 'Aliento de dragón que abrasa a todos los enemigos.',
      mana: 85, effect: { type: 'damage_all', mult: 1.8, burn: { pct: 0.04, ticks: 26 } } } },

  // ---------------- PIRATAS PELIRROJOS ----------------
  { id: 'yasopp', name: 'Yasopp', crew: 'redhair', cost: 1, range: 3, atkSpeed: 8, initials: 'YS',
    ability: { name: 'Disparo Certero', desc: 'Un tiro imposible de fallar a larguísima distancia.',
      mana: 40, effect: { type: 'damage_single', mult: 2.4 } } },
  { id: 'luckyroux', name: 'Lucky Roux', crew: 'redhair', cost: 2, range: 1, atkSpeed: 8, initials: 'LR',
    ability: { name: 'A Bocajarro', desc: 'Remata sin pestañear al enemigo más malherido.',
      mana: 50, effect: { type: 'execute', mult: 1.8, bonus: 1.6 } } },
  { id: 'rockstar', name: 'Rockstar', crew: 'redhair', cost: 3, range: 1, atkSpeed: 7, initials: 'RK',
    ability: { name: 'Tajo Ascendente', desc: 'Corte limpio que abre en canal al objetivo.',
      mana: 55, effect: { type: 'damage_single', mult: 2.5 } } },
  { id: 'bennbeckman', name: 'Benn Beckman', crew: 'redhair', cost: 4, range: 2, atkSpeed: 6, initials: 'BE',
    ability: { name: 'Culatazo', desc: 'Un golpe seco con el rifle que corta la respiración.',
      mana: 60, effect: { type: 'damage_single', mult: 2.6, stun: 10 } } },
  { id: 'shanks', name: 'Shanks', crew: 'redhair', cost: 5, range: 1, atkSpeed: 6, initials: 'SH', captain: true,
    ability: { name: 'Haoshoku Haki', desc: 'Su voluntad de Rey paraliza y hiere a toda la cubierta.',
      mana: 80, effect: { type: 'damage_all', mult: 1.5, stun: 10 } } },

  // ---------------- PIRATAS DE BARBANEGRA ----------------
  { id: 'docq', name: 'Doc Q', crew: 'blackbeard', cost: 1, range: 1, atkSpeed: 9, initials: 'DQ',
    ability: { name: 'Manzana Envenenada', desc: 'Una mordida que va pudriendo al enemigo.',
      mana: 40, effect: { type: 'damage_single', mult: 1.3, burn: { pct: 0.04, ticks: 30 } } } },
  { id: 'vanaugur', name: 'Van Augur', crew: 'blackbeard', cost: 2, range: 3, atkSpeed: 7, initials: 'VA',
    ability: { name: 'Tiro del Supersónico', desc: 'Una bala imposible que atraviesa la cubierta.',
      mana: 50, effect: { type: 'damage_single', mult: 2.8 } } },
  { id: 'burgess', name: 'Jesus Burgess', crew: 'blackbeard', cost: 3, range: 1, atkSpeed: 6, initials: 'JB',
    ability: { name: 'Champion Press', desc: 'Levanta y estrella todo lo que tiene delante.',
      mana: 55, effect: { type: 'damage_aoe', mult: 2.1, radius: 1 } } },
  { id: 'shiryu', name: 'Shiryu', crew: 'blackbeard', cost: 4, range: 1, atkSpeed: 7, initials: 'SY',
    ability: { name: 'Corte Invisible', desc: 'Desaparece y corta sin que nadie lo vea venir.',
      mana: 60, effect: { type: 'damage_single', mult: 3.0, selfDodge: 0.25 } } },
  { id: 'blackbeard', name: 'Barbanegra', crew: 'blackbeard', cost: 5, range: 1, atkSpeed: 8, initials: 'BN', captain: true,
    ability: { name: 'Kurouzu', desc: 'Un agujero negro que absorbe a todos y le devuelve fuerzas.',
      mana: 85, effect: { type: 'damage_all', mult: 1.6, drain: 0.4 } } },

  // ---------------- PIRATAS DE ROGER ----------------
  { id: 'buggy', name: 'Buggy', crew: 'roger', cost: 1, range: 2, atkSpeed: 8, initials: 'BU',
    ability: { name: 'Bara Bara Cannon', desc: 'Se despedaza y ataca desde todos los ángulos.',
      mana: 40, effect: { type: 'damage_aoe', mult: 1.5, radius: 1 } } },
  { id: 'crocus', name: 'Crocus', crew: 'roger', cost: 2, range: 1, atkSpeed: 8, initials: 'CU',
    ability: { name: 'Cuidados del Doctor', desc: 'Atiende a la tripulación y les devuelve la salud.',
      mana: 50, effect: { type: 'heal_team', pct: 0.14 } } },
  { id: 'gaban', name: 'Scopper Gaban', crew: 'roger', cost: 3, range: 1, atkSpeed: 7, initials: 'GB',
    ability: { name: 'Hachazo del Veterano', desc: 'Un hachazo brutal cargado de experiencia.',
      mana: 55, effect: { type: 'damage_single', mult: 2.6 } } },
  { id: 'rayleigh', name: 'Silvers Rayleigh', crew: 'roger', cost: 4, range: 1, atkSpeed: 6, initials: 'RY',
    ability: { name: 'Haki del Rey Oscuro', desc: 'Su Haki corta al enemigo y le deja sin aliento.',
      mana: 65, effect: { type: 'damage_single', mult: 3.1, stun: 8 } } },
  { id: 'roger', name: 'Gol D. Roger', crew: 'roger', cost: 5, range: 1, atkSpeed: 7, initials: 'GR', captain: true,
    ability: { name: 'Divine Departure', desc: 'El tajo del Rey de los Piratas parte el horizonte.',
      mana: 85, effect: { type: 'damage_all', mult: 2.1 } } },

  // ---------------- BAROQUE WORKS ----------------
  { id: 'doublefinger', name: 'Miss Doublefinger', crew: 'baroque', cost: 1, range: 1, atkSpeed: 8, initials: 'MD',
    ability: { name: 'Stinger', desc: 'Convierte su cuerpo en púas y ensarta al rival.',
      mana: 45, effect: { type: 'damage_single', mult: 2.1 } } },
  { id: 'mr2', name: 'Mr. 2 Bon Kurei', crew: 'baroque', cost: 2, range: 1, atkSpeed: 7, initials: 'M2',
    ability: { name: 'Swan Arabesque', desc: 'Una pirueta letal que golpea a todo lo que rodea.',
      mana: 50, effect: { type: 'damage_aoe', mult: 1.8, radius: 1 } } },
  { id: 'robin', name: 'Miss All Sunday', crew: 'baroque', cost: 3, range: 2, atkSpeed: 8, initials: 'MR',
    ability: { name: 'Clutch', desc: 'Decenas de brazos inmovilizan y quiebran al enemigo.',
      mana: 55, effect: { type: 'damage_single', mult: 2.0, stun: 12 } } },
  { id: 'mr1', name: 'Mr. 1', crew: 'baroque', cost: 4, range: 1, atkSpeed: 6, initials: 'M1',
    ability: { name: 'Spider', desc: 'Su cuerpo de cuchillas siega todo lo que tiene cerca.',
      mana: 60, effect: { type: 'damage_aoe', mult: 2.4, radius: 1 } } },
  { id: 'crocodile', name: 'Sir Crocodile', crew: 'baroque', cost: 5, range: 2, atkSpeed: 7, initials: 'SC', captain: true,
    ability: { name: 'Ground Death', desc: 'Deseca la cubierta entera y absorbe la vida de todos.',
      mana: 80, effect: { type: 'damage_all', mult: 1.6, drain: 0.4 } } },
];

// Retratos reales (archivo en public/img/characters/<fichero>), opcionales.
// Un personaje sin entrada aqui usa el cartel de iniciales como respaldo.
// Para anadir uno: guarda la imagen en public/img/characters/ y pon aqui
// `id: 'nombre-de-archivo.jpg'`.
const PORTRAITS = {
  // luffy: 'luffy.jpg',
};

const CHARACTERS = RAW.map((c) => {
  const base = BASE_STATS[c.cost];
  return {
    ...c,
    hp: base.hp,
    atk: base.atk,
    def: base.def,
    portrait: PORTRAITS[c.id] || null,
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
      2: { atkMult: 1.15 },
      4: { atkMult: 1.3 },
      5: { atkMult: 1.5 },
    },
  },
  whitebeard: {
    label: 'Piratas de Barbablanca',
    icon: '🌊',
    color: 'whitebeard',
    // allMult multiplica vida, ataque Y defensa a la vez, asi que numeros
    // pequenos aqui equivalen a bonificaciones enormes en las demas.
    desc: 'Bonificacion a todas las estadisticas (el hombre mas fuerte del mundo).',
    thresholds: {
      2: { allMult: 1.06 },
      4: { allMult: 1.13 },
      5: { allMult: 1.22 },
    },
  },
  bigmom: {
    label: 'Piratas de Big Mom',
    icon: '🍰',
    color: 'bigmom',
    desc: 'El equipo empieza con un escudo y se cura al derrotar enemigos.',
    thresholds: {
      2: { shieldPct: 0.28 },
      4: { shieldPct: 0.45, healOnKillPct: 0.16 },
      5: { shieldPct: 0.65, healOnKillPct: 0.26 },
    },
  },
  beast: {
    label: 'Piratas de las Bestias',
    icon: '🐉',
    color: 'beast',
    desc: 'Los ataques queman con aliento de dragon (dano continuo).',
    thresholds: {
      2: { burnPct: 0.035, burnTicks: 20 },
      4: { burnPct: 0.052, burnTicks: 24, atkMult: 1.13 },
      5: { burnPct: 0.067, burnTicks: 28, atkMult: 1.25 },
    },
  },
  redhair: {
    label: 'Piratas Pelirrojos',
    icon: '⚡',
    color: 'redhair',
    desc: 'El Haki del Conquistador encadena ataques y puede aturdir.',
    thresholds: {
      2: { chainChance: 0.3, chainPct: 0.6 },
      4: { chainChance: 0.45, chainPct: 0.75, stunChance: 0.18 },
      5: { chainChance: 0.67, chainPct: 0.97, stunChance: 0.32 },
    },
  },
  blackbeard: {
    label: 'Piratas de Barbanegra',
    icon: '🌑',
    color: 'blackbeard',
    desc: 'La oscuridad y la gravedad esquivan ataques y aceleran al equipo.',
    thresholds: {
      2: { dodgeChance: 0.2 },
      4: { dodgeChance: 0.35, speedMult: 1.2 },
      5: { dodgeChance: 0.5, speedMult: 1.4 },
    },
  },
  roger: {
    label: 'Piratas de Roger',
    icon: '👑',
    color: 'roger',
    desc: 'El legado del Rey de los Piratas: vida y regeneracion sin fin.',
    thresholds: {
      2: { regenPct: 0.012 },
      4: { regenPct: 0.027, hpMult: 1.22 },
      5: { regenPct: 0.04, hpMult: 1.35 },
    },
  },
  baroque: {
    label: 'Baroque Works',
    icon: '🕶️',
    color: 'baroque',
    desc: 'Agentes disciplinados: mas ataque y defensa para todo el equipo.',
    thresholds: {
      2: { atkMult: 1.15, defMult: 1.2 },
      4: { atkMult: 1.3, defMult: 1.45 },
      5: { atkMult: 1.5, defMult: 1.75 },
    },
  },
};

const STAR_MULT = { 1: 1, 2: 1.8, 3: 3.24, 4: 5.832 };
const MAX_STAR = 4;

module.exports = { CHARACTERS, CHARACTERS_BY_ID, CREWS, STAR_MULT, MAX_STAR };
