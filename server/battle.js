'use strict';

const { POKEMON_BY_ID, SYNERGIES, STAR_MULT } = require('./pokemonData');

const TICK_MS = 150;
const MAX_TICKS = 160; // ~24s
const MOVE_EVERY = 3;
const BOARD_COLS = 8;
const BOARD_ROWS = 8;

function computeSynergies(board) {
  const counts = {};
  for (const u of board) {
    const p = POKEMON_BY_ID[u.pokemonId];
    counts[p.type] = (counts[p.type] || 0) + 1;
  }
  const active = {}; // type -> merged bonus object
  const summary = []; // for UI
  for (const [type, count] of Object.entries(counts)) {
    const def = SYNERGIES[type];
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
      active[type] = bonus;
      summary.push({ type, label: def.label, icon: def.icon, desc: def.desc, count, tier: tierHit });
    } else {
      summary.push({ type, label: def.label, icon: def.icon, desc: def.desc, count, tier: 0 });
    }
  }
  return { active, summary };
}

function instantiateTeam(board, side, synergyActive) {
  return board.map((u, idx) => {
    const p = POKEMON_BY_ID[u.pokemonId];
    const starMult = STAR_MULT[u.star] || 1;
    const typeBonus = synergyActive[p.type] || {};
    const allMult = typeBonus.allMult || 1;
    const hp = Math.round(p.hp * starMult * (typeBonus.hpMult || 1) * allMult);
    const atk = Math.round(p.atk * starMult * (typeBonus.atkMult || 1) * allMult);
    const def = Math.round(p.def * starMult * (typeBonus.defMult || 1) * allMult);
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
      type: p.type,
      star: u.star,
      x,
      y,
      hp,
      maxHp: hp,
      atk,
      def,
      range: p.range,
      atkSpeed: Math.round(p.atkSpeed / (typeBonus.speedMult || 1)),
      shieldMax: Math.round(hp * (typeBonus.shieldPct || 0)),
      shield: Math.round(hp * (typeBonus.shieldPct || 0)),
      regenPct: typeBonus.regenPct || 0,
      dodgeChance: typeBonus.dodgeChance || 0,
      chainChance: typeBonus.chainChance || 0,
      chainPct: typeBonus.chainPct || 0,
      stunChance: typeBonus.stunChance || 0,
      burnPct: typeBonus.burnPct || 0,
      burnTicks: typeBonus.burnTicks || 0,
      healOnKillPct: typeBonus.healOnKillPct || 0,
      burnStacks: [], // {remaining, dmgPerTick}
      stunnedUntil: -1,
      lastAttackTick: -999,
      lastMoveTick: -999,
      alive: true,
    };
  });
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

function stepToward(unit, target) {
  const dx = Math.sign(target.x - unit.x);
  const dy = Math.sign(target.y - unit.y);
  return { x: clamp(unit.x + dx, 0, BOARD_COLS - 1), y: clamp(unit.y + dy, 0, BOARD_ROWS - 1) };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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
    log.push({ t: 0, type: 'spawn', uid: u.uid, side: u.side, pokemonId: u.pokemonId, name: u.name, type: u.type, star: u.star, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, shield: u.shield });
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
        if (u.burnStacks.length) {
          let totalBurn = 0;
          u.burnStacks = u.burnStacks.filter((b) => b.remaining > 0);
          for (const b of u.burnStacks) {
            totalBurn += b.dmgPerTick;
            b.remaining -= 6;
          }
          if (totalBurn > 0) {
            applyDamage(u, totalBurn, log, tick);
            log.push({ t: tick, type: 'burn', uid: u.uid, damage: totalBurn, hp: u.hp });
          }
        }
      }
    }

    for (const unit of all) {
      if (!unit.alive) continue;
      if (unit.stunnedUntil >= tick) continue;
      const { target, distance } = findNearestEnemy(unit, all);
      if (!target) continue;

      if (distance <= unit.range) {
        if (tick - unit.lastAttackTick >= unit.atkSpeed) {
          unit.lastAttackTick = tick;
          const dodged = Math.random() < target.dodgeChance;
          if (dodged) {
            log.push({ t: tick, type: 'dodge', uid: target.uid, attacker: unit.uid });
          } else {
            const dmg = Math.max(1, Math.round(unit.atk - target.def * 0.5));
            applyDamage(target, dmg, log, tick);
            log.push({ t: tick, type: 'attack', uid: unit.uid, target: target.uid, damage: dmg, hp: target.hp, shield: target.shield });
            if (unit.burnPct > 0 && target.alive) {
              target.burnStacks.push({ remaining: unit.burnTicks, dmgPerTick: Math.round(target.maxHp * unit.burnPct) });
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
                  chainTarget.stunnedUntil = tick + 5;
                  log.push({ t: tick, type: 'stun', uid: chainTarget.uid });
                }
              }
            }
          }
        }
      } else if (tick - unit.lastMoveTick >= MOVE_EVERY) {
        unit.lastMoveTick = tick;
        const next = stepToward(unit, target);
        unit.x = next.x;
        unit.y = next.y;
        log.push({ t: tick, type: 'move', uid: unit.uid, x: unit.x, y: unit.y });
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
