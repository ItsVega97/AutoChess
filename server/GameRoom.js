'use strict';

const crypto = require('crypto');
const { CHARACTERS_BY_ID, MAX_STAR } = require('./characterData');
const { teamSizeForRound, shopTierForRound, rollShop, goldIncome, roundDamage, SHOP_SIZE } = require('./economy');
const { simulateBattle, computeSynergies } = require('./battle');

const PREP_MS = 30000;
const RESULT_MS = 6000;
const RECONNECT_GRACE_MS = 30000;
const START_HP = 20;
const START_GOLD = 10;
const BENCH_SIZE = 6;
// Tablero compacto estilo Tactics Royale: 5 columnas y 3 filas por jugador
// (5x6 en total al enfrentar las dos mitades).
const BOARD_COLS = 5;
const BOARD_ROWS_PLAYER = 3;

let roomCounter = 0;

function newPlayer(id, name, isBot) {
  return {
    id,
    name,
    isBot: !!isBot,
    token: isBot ? null : crypto.randomBytes(12).toString('hex'),
    hp: START_HP,
    gold: START_GOLD,
    round: 0,
    maxTeam: 1,   // cuantas tropas caben en la cubierta: +1 por combate, hasta 6
    shopTier: 1,  // calidad de la tienda, sube por su cuenta cada dos rondas
    winStreak: 0,
    lossStreak: 0,
    shop: new Array(SHOP_SIZE).fill(null),
    bench: new Array(BENCH_SIZE).fill(null),
    board: [], // {uid,pokemonId,star,x,y}
    alive: true,
    ready: false,
    connected: true,
  };
}

class GameRoom {
  constructor(io, pA, pB) {
    this.id = `room-${++roomCounter}-${Date.now()}`;
    this.io = io;
    this.players = {
      A: newPlayer(pA.id, pA.name, pA.isBot),
      B: newPlayer(pB.id, pB.name, pB.isBot),
    };
    this.sideBySocket = { [pA.id]: 'A', [pB.id]: 'B' };
    this.round = 0;
    this.phase = 'lobby';
    this.timeLeft = 0;
    this.unitCounter = 0;
    this.timer = null;
    this.ended = false;
    this.lastSynergies = { A: [], B: [] };
    this.reconnectTimers = { A: null, B: null };
    this.onEnded = null; // callback asignado por index.js para limpiar mapas externos
  }

  sideOf(socketId) {
    return this.sideBySocket[socketId];
  }

  rebind(side, newSocketId) {
    const oldId = this.players[side].id;
    delete this.sideBySocket[oldId];
    this.sideBySocket[newSocketId] = side;
    this.players[side].id = newSocketId;
    this.players[side].connected = true;
    if (this.reconnectTimers[side]) {
      clearTimeout(this.reconnectTimers[side]);
      this.reconnectTimers[side] = null;
    }
  }

  other(side) {
    return side === 'A' ? 'B' : 'A';
  }

  nextUid() {
    return `u${++this.unitCounter}`;
  }

  start() {
    this.round = 1;
    this.beginPrep();
    // Reenvio de seguridad: si el primer 'state' se pierde justo cuando el
    // cliente todavia esta terminando de procesar 'matchFound' (tipico en
    // moviles saliendo de segundo plano), esto lo repara sin que el jugador
    // tenga que hacer nada.
    setTimeout(() => { if (!this.ended) this.broadcastState(); }, 1500);
  }

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  beginPrep() {
    this.clearTimer();
    this.phase = 'prep';
    this.timeLeft = PREP_MS;
    for (const side of ['A', 'B']) {
      const p = this.players[side];
      if (!p.alive) continue;
      p.round = this.round;
      p.maxTeam = teamSizeForRound(this.round);
      p.shopTier = shopTierForRound(this.round);
      p.shop = rollShop(p.shopTier);
      p.ready = false;
      const streak = Math.max(p.winStreak, p.lossStreak);
      if (this.round > 1) p.gold += goldIncome(p.gold, streak);
    }
    this.broadcastState();
    for (const side of ['A', 'B']) {
      if (this.players[side].isBot) this.runBotTurn(side);
    }
    this.timer = setInterval(() => {
      this.timeLeft -= 1000;
      if (this.timeLeft <= 0 || this.checkBothReady()) {
        this.clearTimer();
        this.runBattlePhase();
      } else {
        this.broadcastTick();
      }
    }, 1000);
  }

  checkBothReady() {
    const a = this.players.A;
    const b = this.players.B;
    return (a.ready || !a.alive) && (b.ready || !b.alive);
  }

  runBotTurn(side) {
    const bot = this.players[side];
    if (!bot.alive) return;
    // Buy anything affordable while there's bench space
    let guard = 0;
    while (guard++ < 20) {
      const emptyBench = bot.bench.findIndex((s) => s === null);
      if (emptyBench === -1) break;
      const slotIdx = bot.shop.findIndex((id) => id && CHARACTERS_BY_ID[id].cost <= bot.gold);
      if (slotIdx === -1) break;
      this.buyUnit(side, slotIdx, true);
    }
    // Place bench units onto the board up to capacity
    const cap = bot.maxTeam;
    for (let i = 0; i < bot.bench.length && bot.board.length < cap; i++) {
      const unit = bot.bench[i];
      if (!unit) continue;
      const cell = this.findFreeCell(bot);
      if (!cell) break;
      this.moveToBoard(side, unit.uid, cell.x, cell.y, true);
    }
    if (bot.gold >= 4 && Math.random() < 0.35) {
      this.reroll(side, true);
    }
    bot.ready = true;
  }

  findFreeCell(player) {
    for (let y = 0; y < BOARD_ROWS_PLAYER; y++) {
      for (let x = 0; x < BOARD_COLS; x++) {
        if (!player.board.some((u) => u.x === x && u.y === y)) return { x, y };
      }
    }
    return null;
  }

  buyUnit(side, slotIdx, skipEmit) {
    const p = this.players[side];
    if (this.phase !== 'prep' || !p.alive) return;
    const pokemonId = p.shop[slotIdx];
    if (!pokemonId) return;
    const def = CHARACTERS_BY_ID[pokemonId];
    if (p.gold < def.cost) return;
    const benchIdx = p.bench.findIndex((s) => s === null);
    if (benchIdx === -1) return;
    p.gold -= def.cost;
    p.bench[benchIdx] = { uid: this.nextUid(), pokemonId, star: 1 };
    // Al estilo Tactics Royale: comprar renueva la tienda entera, no deja el
    // hueco vacio. La tirada es gratis, el reroll manual sigue costando oro.
    p.shop = rollShop(p.shopTier);
    this.runMerges(p);
    if (!skipEmit) this.broadcastState();
  }

  sellUnit(side, uid) {
    const p = this.players[side];
    if (this.phase !== 'prep' || !p.alive) return;
    const benchIdx = p.bench.findIndex((u) => u && u.uid === uid);
    if (benchIdx !== -1) {
      const unit = p.bench[benchIdx];
      p.gold += CHARACTERS_BY_ID[unit.pokemonId].cost * unit.star;
      p.bench[benchIdx] = null;
      this.broadcastState();
      return;
    }
    const boardIdx = p.board.findIndex((u) => u.uid === uid);
    if (boardIdx !== -1) {
      const unit = p.board[boardIdx];
      p.gold += CHARACTERS_BY_ID[unit.pokemonId].cost * unit.star;
      p.board.splice(boardIdx, 1);
      this.broadcastState();
    }
  }

  moveToBoard(side, uid, x, y, skipEmit) {
    const p = this.players[side];
    if (this.phase !== 'prep' || !p.alive) return;
    x = Math.max(0, Math.min(BOARD_COLS - 1, x));
    y = Math.max(0, Math.min(BOARD_ROWS_PLAYER - 1, y));
    const occupantIdx = p.board.findIndex((u) => u.x === x && u.y === y);
    const benchIdx = p.bench.findIndex((u) => u && u.uid === uid);
    const boardIdx = p.board.findIndex((u) => u.uid === uid);

    let unit;
    if (benchIdx !== -1) {
      const cap = p.maxTeam;
      if (occupantIdx === -1 && p.board.length >= cap) return;
      unit = p.bench[benchIdx];
      p.bench[benchIdx] = null;
    } else if (boardIdx !== -1) {
      unit = p.board[boardIdx];
      p.board.splice(boardIdx, 1);
    } else {
      return;
    }

    if (occupantIdx !== -1) {
      const occupant = p.board[occupantIdx];
      p.board.splice(occupantIdx, 1);
      if (benchIdx !== -1) {
        const freeBench = p.bench.findIndex((s) => s === null);
        if (freeBench !== -1) p.bench[freeBench] = occupant;
      } else {
        occupant.x = 0;
        occupant.y = 0; // fallback, shouldn't normally hit
        const freeBench2 = p.bench.findIndex((s) => s === null);
        if (freeBench2 !== -1) p.bench[freeBench2] = occupant;
      }
    }

    unit.x = x;
    unit.y = y;
    p.board.push(unit);
    this.runMerges(p);
    if (!skipEmit) this.broadcastState();
  }

  moveToBench(side, uid, skipEmit) {
    const p = this.players[side];
    if (this.phase !== 'prep' || !p.alive) return;
    const boardIdx = p.board.findIndex((u) => u.uid === uid);
    if (boardIdx === -1) return;
    const freeBench = p.bench.findIndex((s) => s === null);
    if (freeBench === -1) return;
    const [unit] = p.board.splice(boardIdx, 1);
    p.bench[freeBench] = unit;
    if (!skipEmit) this.broadcastState();
  }

  reroll(side, skipEmit) {
    const p = this.players[side];
    if (this.phase !== 'prep' || !p.alive) return;
    if (p.gold < 2) return;
    p.gold -= 2;
    p.shop = rollShop(p.shopTier);
    if (!skipEmit) this.broadcastState();
  }

  runMerges(p) {
    let changed = true;
    while (changed) {
      changed = false;
      const all = [
        ...p.bench.map((u, i) => (u ? { unit: u, where: 'bench', idx: i } : null)).filter(Boolean),
        ...p.board.map((u, i) => ({ unit: u, where: 'board', idx: i })),
      ];
      const groups = {};
      for (const entry of all) {
        if (entry.unit.star >= MAX_STAR) continue;
        const key = `${entry.unit.pokemonId}|${entry.unit.star}`;
        (groups[key] = groups[key] || []).push(entry);
      }
      for (const key of Object.keys(groups)) {
        const group = groups[key];
        if (group.length >= 2) {
          const pair = group.slice(0, 2);
          const boardEntry = pair.find((e) => e.where === 'board');
          const pokemonId = pair[0].unit.pokemonId;
          const newStar = pair[0].unit.star + 1;
          for (const e of pair) {
            if (e.where === 'bench') p.bench[e.idx] = null;
          }
          const boardUids = pair.filter((e) => e.where === 'board').map((e) => e.unit.uid);
          p.board = p.board.filter((u) => !boardUids.includes(u.uid));
          const merged = { uid: this.nextUid(), pokemonId, star: newStar };
          if (boardEntry) {
            merged.x = boardEntry.unit.x;
            merged.y = boardEntry.unit.y;
            p.board.push(merged);
          } else {
            const freeBench = p.bench.findIndex((s) => s === null);
            if (freeBench !== -1) p.bench[freeBench] = merged;
            else p.board.push({ ...merged, x: 0, y: 0 });
          }
          changed = true;
          break;
        }
      }
    }
  }

  setReady(side) {
    const p = this.players[side];
    if (this.phase !== 'prep') return;
    p.ready = true;
    this.broadcastState();
    if (this.checkBothReady()) {
      this.clearTimer();
      this.runBattlePhase();
    }
  }

  runBattlePhase() {
    this.phase = 'battle';
    const a = this.players.A;
    const b = this.players.B;
    const result = simulateBattle(a.board, b.board);
    this.lastResult = result;
    this.lastSynergies = { A: result.synergiesA, B: result.synergiesB };

    this.io.to(this.id).emit('battleStart', {
      log: result.log,
      durationMs: result.durationMs,
      round: this.round,
    });

    this.timer = setTimeout(() => this.applyBattleResult(result), result.durationMs + 800);
  }

  applyBattleResult(result) {
    const a = this.players.A;
    const b = this.players.B;

    if (result.winner === 'A') {
      a.winStreak++; a.lossStreak = 0;
      b.lossStreak++; b.winStreak = 0;
      const dmg = roundDamage(this.round, result.survivorsA.map((u) => ({ cost: CHARACTERS_BY_ID[u.pokemonId].cost, star: u.star })));
      b.hp = Math.max(0, b.hp - dmg);
      this.lastRoundInfo = { winnerSide: 'A', damage: dmg };
    } else if (result.winner === 'B') {
      b.winStreak++; b.lossStreak = 0;
      a.lossStreak++; a.winStreak = 0;
      const dmg = roundDamage(this.round, result.survivorsB.map((u) => ({ cost: CHARACTERS_BY_ID[u.pokemonId].cost, star: u.star })));
      a.hp = Math.max(0, a.hp - dmg);
      this.lastRoundInfo = { winnerSide: 'B', damage: dmg };
    } else {
      this.lastRoundInfo = { winnerSide: null, damage: 0 };
    }

    if (a.hp <= 0) a.alive = false;
    if (b.hp <= 0) b.alive = false;

    this.phase = 'result';
    this.broadcastState();

    if (!a.alive || !b.alive) {
      this.timer = setTimeout(() => this.endGame(), RESULT_MS);
    } else {
      this.timer = setTimeout(() => {
        this.round++;
        this.beginPrep();
      }, RESULT_MS);
    }
  }

  endGame() {
    this.phase = 'gameover';
    const a = this.players.A;
    const b = this.players.B;
    const winnerSide = a.alive ? 'A' : b.alive ? 'B' : null;
    for (const side of ['A', 'B']) {
      const sock = this.io.sockets.sockets.get(this.players[side].id);
      if (sock) {
        sock.emit('gameOver', { won: side === winnerSide, draw: winnerSide === null });
      }
    }
    this.ended = true;
    this.clearTimer();
    if (this.onEnded) this.onEnded();
  }

  publicPlayerView(side) {
    const p = this.players[side];
    return {
      id: p.id,
      name: p.name,
      hp: p.hp,
      gold: p.gold,
      maxTeam: p.maxTeam,
      round: p.round,
      winStreak: p.winStreak,
      lossStreak: p.lossStreak,
      shop: p.shop,
      bench: p.bench,
      board: p.board,
      alive: p.alive,
      ready: p.ready,
      synergies: computeSynergies(p.board).summary,
    };
  }

  broadcastState() {
    for (const side of ['A', 'B']) {
      const p = this.players[side];
      const sock = this.io.sockets.sockets.get(p.id);
      if (!sock) continue;
      sock.emit('state', {
        phase: this.phase,
        round: this.round,
        timeLeft: this.timeLeft,
        you: this.publicPlayerView(side),
        opponent: {
          name: this.players[this.other(side)].name,
          hp: this.players[this.other(side)].hp,
          maxTeam: this.players[this.other(side)].maxTeam,
          alive: this.players[this.other(side)].alive,
          ready: this.players[this.other(side)].ready,
        },
        lastRoundInfo: this.lastRoundInfo || null,
      });
    }
  }

  broadcastTick() {
    for (const side of ['A', 'B']) {
      const sock = this.io.sockets.sockets.get(this.players[side].id);
      if (sock) sock.emit('tick', { timeLeft: this.timeLeft, opponentReady: this.players[this.other(side)].ready });
    }
  }

  // Un jugador humano pierde la conexion: no acabamos la partida al instante,
  // le damos una ventana para reconectar (emit 'rejoin' con su token) antes
  // de darla por perdida. Las rondas del servidor siguen corriendo mientras tanto.
  handleDisconnect(socketId) {
    const side = this.sideOf(socketId);
    if (!side || this.ended) return;
    this.players[side].connected = false;
    const other = this.other(side);
    const otherP = this.players[other];
    if (!otherP.isBot) {
      const sock = this.io.sockets.sockets.get(otherP.id);
      if (sock) sock.emit('opponentDisconnected', { graceMs: RECONNECT_GRACE_MS });
    }
    if (this.reconnectTimers[side]) clearTimeout(this.reconnectTimers[side]);
    this.reconnectTimers[side] = setTimeout(() => {
      if (!this.players[side].connected && !this.ended) this.finalizeDisconnect(side);
    }, RECONNECT_GRACE_MS);
  }

  finalizeDisconnect(side) {
    if (this.ended) return;
    const other = this.other(side);
    const sock = this.io.sockets.sockets.get(this.players[other].id);
    if (sock && !this.players[other].isBot) sock.emit('opponentLeft');
    this.clearTimer();
    this.ended = true;
    if (this.onEnded) this.onEnded();
  }
}

module.exports = GameRoom;
