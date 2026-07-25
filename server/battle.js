'use strict';

const { CHARACTERS_BY_ID, CREWS, STAR_MULT } = require('./characterData');

const TICK_MS = 150;
const MAX_TICKS = 160; // ~24s
const MOVE_EVERY = 3;
// Arena compacta estilo Tactics Royale: 5 columnas x 6 filas (3 por jugador).
const BOARD_COLS = 5;
const BOARD_ROWS = 6;

function computeSynergies(board) {
  const counts = {};
  for (const u of board) {
    const p = CHARACTERS_BY_ID[u.pokemonId];
    counts[p.crew] = (counts[p.crew] || 0) + 1;
  }
  const active = {}; // crew -> merged bonus object
  const summary = []; // for UI
  for (const [crew, count] of Object.entries(counts)) {
    const def = CREWS[crew];
    if (!def) continue;
    let tierHit = 0;
    let bonus = {};
    for (const [threshold, b] of Object.entries(def.thresholds)) {
      if (count >= Number(threshold)) {
        tierHit = Number(threshold);
        bonus = b;
      }
    }
    if (tierHit > 0) {
      active[crew] = bonus;
      summary.push({ type: crew, label: def.label, icon: def.icon, desc: def.desc, count, tier: tierHit });
    } else {
      summary.push({ type: crew, label: def.label, icon: def.icon, desc: def.desc, count, tier: 0 });
    }
  }
  return { active, summary };
}

function instantiateTeam(board, side, synergyActive) {
  return board.map((u, idx) => {
    const p = CHARACTERS_BY_ID[u.pokemonId];
    const starMult = STAR_MULT[u.star] || 1;
    const crewBonus = synergyActive[p.crew] || {};
    const allMult = crewBonus.allMult || 1;
    const hp = Math.round(p.hp * starMult * (crewBonus.hpMult || 1) * allMult);
    const atk = Math.round(p.atk * starMult * (crewBonus.atkMult || 1) * allMult);
    const def = Math.round(p.def * starMult * (crewBonus.defMult || 1) * allMult);
    let x = u.x;
    let y = u.y;
    // side B (top of arena) occupies rows 0-3 as-is; side A (bottom) mirrored to rows 4-7
    if (side === 'A') {
      y = BOARD_ROWS - 1 - u.y;
    }
    return {
      uid: `${side}-${idx}-${u.pokemonId}`,
      side,
      pokemonId: p.id,
      name: p.name,
      type: p.crew,
      star: u.star,
      captain: !!p.captain,
      x,
      y,
      hp,
      maxHp: hp,
      atk,
      def,
      range: p.range,
      atkSpeed: Math.round(p.atkSpeed / (crewBonus.speedMult || 1)),
      shieldMax: Math.round(hp * (crewBonus.shieldPct || 0)),
      shield: Math.round(hp * (crewBonus.shieldPct || 0)),
      regenPct: crewBonus.regenPct || 0,
      dodgeChance: crewBonus.dodgeChance || 0,
      chainChance: crewBonus.chainChance || 0,
      chainPct: crewBonus.chainPct || 0,
      stunChance: crewBonus.stunChance || 0,
      burnPct: crewBonus.burnPct || 0,
      burnTicks: crewBonus.burnTicks || 0,
      healOnKillPct: crewBonus.healOnKillPct || 0,
      // La quemadura NO se acumula: volver a aplicarla refresca la duracion y
      // se queda con la mas intensa. (Acumular sin limite hacia que un solo
      // personaje de fuego fundiese a cualquiera en segundos.)
      burn: null, // { remaining, dmgPerTick }
      stunnedUntil: -1,
      lastAttackTick: -999,
      lastMoveTick: -999,
      alive: true,
      // Habilidad y su barra de mana
      ability: p.ability || null,
      mana: 0,
      maxMana: p.ability ? p.ability.mana : 0,
    };
  });
}

const MANA_PER_ATTACK = 10;
const MANA_PER_HIT_TAKEN = 3;

// Aplica quemadura refrescando la existente en vez de acumular otra encima.
function applyBurn(unit, pct, ticks) {
  const dmgPerTick = Math.round(unit.maxHp * pct);
  if (!unit.burn || unit.burn.remaining <= 0) {
    unit.burn = { remaining: ticks, dmgPerTick };
    return;
  }
  unit.burn.remaining = Math.max(unit.burn.remaining, ticks);
  unit.burn.dmgPerTick = Math.max(unit.burn.dmgPerTick, dmgPerTick);
}

function gainMana(unit, amount) {
  if (!unit.ability || !unit.alive) return;
  unit.mana = Math.min(unit.maxMana, unit.mana + amount);
}

/**
 * Lanza la habilidad del personaje. Los efectos se resuelven aqui para que el
 * log de combate lleve ya el resultado y el cliente solo tenga que animarlo.
 */
function castAbility(unit, all, log, tick, target) {
  const ab = unit.ability;
  if (!ab) return;
  const eff = ab.effect;
  const enemies = all.filter((o) => o.alive && o.side !== unit.side);
  const allies = all.filter((o) => o.alive && o.side === unit.side);
  unit.mana = 0;

  log.push({ t: tick, type: 'ability', uid: unit.uid, name: ab.name, x: unit.x, y: unit.y });

  // A quien alcanza segun el tipo de efecto
  let victims = [];
  if (eff.type === 'damage_single' || eff.type === 'execute') {
    if (target && target.alive) victims = [target];
  } else if (eff.type === 'damage_aoe') {
    const center = target && target.alive ? target : null;
    if (center) {
      const r = eff.radius || 1;
      victims = enemies.filter((o) => dist(o, center) <= r);
    }
  } else if (eff.type === 'damage_all') {
    victims = enemies;
  }

  let totalDealt = 0;
  for (const v of victims) {
    let mult = eff.mult || 1;
    if (eff.type === 'execute') {
      // remata: cuanta menos vida le queda al objetivo, mas dano recibe
      const missing = 1 - v.hp / v.maxHp;
      mult += (eff.bonus || 0) * missing;
    }
    const dmg = Math.max(1, Math.round(unit.atk * mult - v.def * 0.35));
    const before = v.hp + v.shield;
    applyDamage(v, dmg, log, tick);
    totalDealt += before - (v.hp + v.shield);
    log.push({ t: tick, type: 'abilityHit', uid: v.uid, source: unit.uid, damage: dmg, hp: v.hp, shield: v.shield });

    if (eff.stun) {
      v.stunnedUntil = tick + eff.stun;
      log.push({ t: tick, type: 'stun', uid: v.uid });
    }
    if (eff.burn && v.alive) {
      applyBurn(v, eff.burn.pct, eff.burn.ticks);
    }
  }

  // Robo de vida proporcional al dano realmente infligido
  if (eff.drain && totalDealt > 0) {
    const heal = Math.round(totalDealt * eff.drain);
    unit.hp = Math.min(unit.maxHp, unit.hp + heal);
    log.push({ t: tick, type: 'heal', uid: unit.uid, amount: heal, hp: unit.hp });
  }

  // Efectos de apoyo
  if (eff.type === 'heal_team') {
    for (const a of allies) {
      const heal = Math.round(a.maxHp * eff.pct);
      a.hp = Math.min(a.maxHp, a.hp + heal);
      log.push({ t: tick, type: 'heal', uid: a.uid, amount: heal, hp: a.hp });
    }
  }
  if (eff.type === 'heal_self') {
    const heal = Math.round(unit.maxHp * eff.pct);
    unit.hp = Math.min(unit.maxHp, unit.hp + heal);
    log.push({ t: tick, type: 'heal', uid: unit.uid, amount: heal, hp: unit.hp });
  }
  if (eff.type === 'shield_team') {
    for (const a of allies) {
      a.shield += Math.round(a.maxHp * eff.pct);
      log.push({ t: tick, type: 'shielded', uid: a.uid, shield: a.shield });
    }
  }
  if (eff.type === 'shield_self' || eff.selfShieldPct) {
    const pct = eff.selfShieldPct || eff.pct;
    unit.shield += Math.round(unit.maxHp * pct);
    log.push({ t: tick, type: 'shielded', uid: unit.uid, shield: unit.shield });
  }
  if (eff.type === 'buff_atk_team') {
    for (const a of allies) a.atk = Math.round(a.atk * eff.mult);
  }
  if (eff.selfAtkMult) unit.atk = Math.round(unit.atk * eff.selfAtkMult);
  if (eff.selfDodge) unit.dodgeChance = Math.min(0.85, unit.dodgeChance + eff.selfDodge);
}

function dist(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function findNearestEnemy(unit, all) {
  let best = null;
  let bestDist = Infinity;
  for (const o of all) {
    if (!o.alive || o.side === unit.side) continue;
    const d = dist(unit, o);
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return { target: best, distance: bestDist };
}

function isOccupied(all, x, y, self) {
  for (const o of all) {
    if (o !== self && o.alive && o.x === x && o.y === y) return true;
  }
  return false;
}

/**
 * Da un paso hacia el objetivo respetando que solo cabe una unidad por
 * casilla. Prueba primero el paso ideal y, si esta ocupado, alternativas que
 * tambien acercan (rodear por un lado) antes de rendirse y quedarse quieta.
 * Devuelve null si no hay ningun hueco al que avanzar.
 */
function stepToward(unit, target, all) {
  const dx = Math.sign(target.x - unit.x);
  const dy = Math.sign(target.y - unit.y);
  const candidates = [];
  if (dx !== 0 && dy !== 0) candidates.push({ x: unit.x + dx, y: unit.y + dy });
  if (dx !== 0) candidates.push({ x: unit.x + dx, y: unit.y });
  if (dy !== 0) candidates.push({ x: unit.x, y: unit.y + dy });
  // rodeos: acercarse por un lateral cuando el camino directo esta bloqueado
  if (dy !== 0) {
    candidates.push({ x: unit.x + 1, y: unit.y + dy });
    candidates.push({ x: unit.x - 1, y: unit.y + dy });
  }
  if (dx !== 0) {
    candidates.push({ x: unit.x + dx, y: unit.y + 1 });
    candidates.push({ x: unit.x + dx, y: unit.y - 1 });
  }

  for (const c of candidates) {
    if (c.x < 0 || c.x >= BOARD_COLS || c.y < 0 || c.y >= BOARD_ROWS) continue;
    if (isOccupied(all, c.x, c.y, unit)) continue;
    return c;
  }
  return null;
}

function applyDamage(unit, dmg, log, tick) {
  let remaining = dmg;
  if (unit.shield > 0) {
    const absorbed = Math.min(unit.shield, remaining);
    unit.shield -= absorbed;
    remaining -= absorbed;
  }
  unit.hp = Math.max(0, unit.hp - remaining);
  if (unit.hp <= 0 && unit.alive) {
    unit.alive = false;
    log.push({ t: tick, type: 'death', uid: unit.uid });
  }
}

/**
 * Simula un combate completo entre dos tableros (board = [{pokemonId,star,x,y}]).
 * Devuelve { log, winner: 'A'|'B'|'draw', survivorsA, survivorsB, synergiesA, synergiesB }
 */
function simulateBattle(boardA, boardB) {
  const synA = computeSynergies(boardA);
  const synB = computeSynergies(boardB);
  const teamA = instantiateTeam(boardA, 'A', synA.active);
  const teamB = instantiateTeam(boardB, 'B', synB.active);
  const all = [...teamA, ...teamB];

  const log = [];
  for (const u of all) {
    // OJO: no reutilizar la clave "type" aqui dentro (ya es el tipo de evento
    // 'spawn'); antes se pisaba con el tipo/tripulacion del personaje y los
    // eventos de aparicion nunca se reconocian en el cliente.
    log.push({ t: 0, type: 'spawn', uid: u.uid, side: u.side, pokemonId: u.pokemonId, name: u.name, star: u.star, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, shield: u.shield, maxMana: u.maxMana });
  }

  let winner = 'draw';
  let endTick = MAX_TICKS;

  for (let tick = 0; tick <= MAX_TICKS; tick++) {
    const aliveA = all.filter((u) => u.side === 'A' && u.alive);
    const aliveB = all.filter((u) => u.side === 'B' && u.alive);
    if (aliveA.length === 0 || aliveB.length === 0) {
      winner = aliveA.length === 0 && aliveB.length === 0 ? 'draw' : aliveA.length > 0 ? 'A' : 'B';
      endTick = tick;
      break;
    }

    // DOT / regen every 6 ticks (~0.9s)
    if (tick % 6 === 0 && tick > 0) {
      for (const u of all) {
        if (!u.alive) continue;
        if (u.regenPct > 0) {
          const heal = Math.round(u.maxHp * u.regenPct);
          u.hp = Math.min(u.maxHp, u.hp + heal);
          log.push({ t: tick, type: 'heal', uid: u.uid, amount: heal, hp: u.hp });
        }
        if (u.burn && u.burn.remaining > 0) {
          u.burn.remaining -= 6;
          applyDamage(u, u.burn.dmgPerTick, log, tick);
          log.push({ t: tick, type: 'burn', uid: u.uid, damage: u.burn.dmgPerTick, hp: u.hp });
        }
      }
    }

    for (const unit of all) {
      if (!unit.alive) continue;
      if (unit.stunnedUntil >= tick) continue;
      const { target, distance } = findNearestEnemy(unit, all);
      if (!target) continue;

      if (distance <= unit.range) {
        // Con la barra llena lanza su habilidad en lugar de atacar
        if (unit.ability && unit.mana >= unit.maxMana) {
          castAbility(unit, all, log, tick, target);
          continue;
        }
        if (tick - unit.lastAttackTick >= unit.atkSpeed) {
          unit.lastAttackTick = tick;
          const dodged = Math.random() < target.dodgeChance;
          gainMana(unit, MANA_PER_ATTACK);
          if (dodged) {
            log.push({ t: tick, type: 'dodge', uid: target.uid, attacker: unit.uid, mana: unit.mana });
          } else {
            const dmg = Math.max(1, Math.round(unit.atk - target.def * 0.5));
            applyDamage(target, dmg, log, tick);
            gainMana(target, MANA_PER_HIT_TAKEN);
            log.push({ t: tick, type: 'attack', uid: unit.uid, target: target.uid, damage: dmg, hp: target.hp, shield: target.shield, mana: unit.mana, tMana: target.mana });
            if (unit.burnPct > 0 && target.alive) {
              applyBurn(target, unit.burnPct, unit.burnTicks);
            }
            if (!target.alive && unit.healOnKillPct > 0) {
              const heal = Math.round(unit.maxHp * unit.healOnKillPct);
              unit.hp = Math.min(unit.maxHp, unit.hp + heal);
              log.push({ t: tick, type: 'heal', uid: unit.uid, amount: heal, hp: unit.hp });
            }
            if (unit.chainChance > 0 && Math.random() < unit.chainChance) {
              const others = all.filter((o) => o.side !== unit.side && o.alive && o.uid !== target.uid);
              if (others.length) {
                const chainTarget = others[Math.floor(Math.random() * others.length)];
                const chainDmg = Math.max(1, Math.round(dmg * unit.chainPct));
                applyDamage(chainTarget, chainDmg, log, tick);
                log.push({ t: tick, type: 'chain', uid: unit.uid, target: chainTarget.uid, damage: chainDmg, hp: chainTarget.hp });
                if (unit.stunChance > 0 && Math.random() < unit.stunChance) {
                  chainTarget.stunnedUntil = tick + 8;
                  log.push({ t: tick, type: 'stun', uid: chainTarget.uid });
                }
              }
            }
          }
        }
      } else if (tick - unit.lastMoveTick >= MOVE_EVERY) {
        unit.lastMoveTick = tick;
        const next = stepToward(unit, target, all);
        // next puede ser null si todas las casillas utiles estan ocupadas:
        // la unidad espera su turno en vez de amontonarse sobre otra.
        if (next) {
          unit.x = next.x;
          unit.y = next.y;
          log.push({ t: tick, type: 'move', uid: unit.uid, x: unit.x, y: unit.y });
        }
      }
    }
  }

  if (winner === 'draw' && endTick === MAX_TICKS) {
    const hpA = all.filter((u) => u.side === 'A' && u.alive).reduce((s, u) => s + u.hp, 0);
    const hpB = all.filter((u) => u.side === 'B' && u.alive).reduce((s, u) => s + u.hp, 0);
    winner = hpA === hpB ? 'draw' : hpA > hpB ? 'A' : 'B';
  }

  const survivorsA = all.filter((u) => u.side === 'A' && u.alive);
  const survivorsB = all.filter((u) => u.side === 'B' && u.alive);
  log.push({ t: endTick + 1, type: 'end', winner });

  return {
    log,
    winner,
    durationMs: (endTick + 1) * TICK_MS,
    survivorsA: survivorsA.map((u) => ({ pokemonId: u.pokemonId, star: u.star })),
    survivorsB: survivorsB.map((u) => ({ pokemonId: u.pokemonId, star: u.star })),
    synergiesA: synA.summary,
    synergiesB: synB.summary,
  };
}

module.exports = { simulateBattle, computeSynergies, TICK_MS, BOARD_COLS, BOARD_ROWS };
