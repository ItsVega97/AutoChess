'use strict';

const crypto = require('crypto');
const { CHARACTERS_BY_ID, MAX_STAR } = require('./characterData');
const { teamSizeForRound, rollShop, goldIncome, roundDamage, sellPrice, SHOP_SIZE } = require('./economy');
const { simulateBattle, computeSynergies } = require('./battle');
const { recordResult } = require('./rankings');

const PREP_MS = 30000;
const RESULT_MS = 6000;
const RECONNECT_GRACE_MS = 30000;
const START_HP = 12;
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
    maxTeam: 1,       // cuantas tropas caben en la cubierta: +1 por combate, hasta 6
    lastOpponent: null, // para no repetir rival dos rondas seguidas
    lastBye: 0,         // ronda en la que descanso por ultima vez
    winStreak: 0,
    lossStreak: 0,
    shop: new Array(SHOP_SIZE).fill(null),
    bench: new Array(BENCH_SIZE).fill(null),
    board: [], // {uid,pokemonId,star,x,y}
    alive: true,
    connected: true,
  };
}

const LADOS = ['A', 'B', 'C', 'D'];

class GameRoom {
  /**
   * `jugadores` es una lista de 2 o 4 { id, name, isBot }. Con 4 se juega al
   * estilo Tactics Royale: cada ronda te toca un rival distinto y vas cayendo
   * hasta que solo queda uno en pie.
   */
  constructor(io, jugadores) {
    this.id = `room-${++roomCounter}-${Date.now()}`;
    this.io = io;
    this.sides = LADOS.slice(0, jugadores.length);
    this.players = {};
    this.sideBySocket = {};
    this.reconnectTimers = {};
    jugadores.forEach((j, i) => {
      const side = LADOS[i];
      this.players[side] = newPlayer(j.id, j.name, j.isBot);
      this.sideBySocket[j.id] = side;
      this.reconnectTimers[side] = null;
    });
    this.round = 0;
    this.phase = 'lobby';
    this.timeLeft = 0;
    this.unitCounter = 0;
    this.timer = null;
    this.ended = false;
    this.pairs = [];        // [[ladoX, ladoY], ...] emparejamientos de esta ronda
    this.byeSide = null;    // quien descansa cuando el numero de vivos es impar
    this.lastFights = {};   // side -> resultado de su ultimo combate
    this.lastSynergies = {};// side -> sinergias con las que peleo
    this.placements = {};   // side -> puesto final (4 = primero en caer)
    this.onEnded = null;    // callback asignado por index.js para limpiar mapas externos
  }

  get mode() {
    return this.sides.length >= 4 ? '4p' : '1v1';
  }

  aliveSides() {
    return this.sides.filter((s) => this.players[s].alive);
  }

  // Rival de este lado en la ronda actual (null si descansa)
  opponentOf(side) {
    for (const [x, y] of this.pairs) {
      if (x === side) return y;
      if (y === side) return x;
    }
    return null;
  }

  // Emparejamientos de la ronda: al azar, evitando repetir el rival de la
  // ronda anterior mientras haya alternativa. Si sobran impares, uno descansa
  // (el que lleve mas rondas sin descansar).
  makePairs() {
    const vivos = this.aliveSides();
    this.pairs = [];
    this.byeSide = null;
    if (vivos.length < 2) return;

    let mejor = null;
    for (let intento = 0; intento < 12; intento++) {
      const mezcla = vivos.slice();
      for (let i = mezcla.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mezcla[i], mezcla[j]] = [mezcla[j], mezcla[i]];
      }
      let descansa = null;
      if (mezcla.length % 2 === 1) {
        // descansa quien lleve mas tiempo sin hacerlo
        mezcla.sort((a, b) => (this.players[a].lastBye || 0) - (this.players[b].lastBye || 0));
        descansa = mezcla.shift();
      }
      const parejas = [];
      for (let i = 0; i < mezcla.length; i += 2) parejas.push([mezcla[i], mezcla[i + 1]]);
      const repite = parejas.some(([x, y]) => this.players[x].lastOpponent === y);
      if (!repite) { mejor = { parejas, descansa }; break; }
      if (!mejor) mejor = { parejas, descansa };
    }
    this.pairs = mejor.parejas;
    this.byeSide = mejor.descansa;
    if (this.byeSide) this.players[this.byeSide].lastBye = this.round;
    for (const [x, y] of this.pairs) {
      this.players[x].lastOpponent = y;
      this.players[y].lastOpponent = x;
    }
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
    this.makePairs();
    for (const side of this.sides) {
      const p = this.players[side];
      if (!p.alive) continue;
      p.round = this.round;
      p.maxTeam = teamSizeForRound(this.round);
      // La tienda NO se renueva entre rondas: lo que no compraste sigue ahi.
      // Solo cambia al comprar (o la primera vez, que hay que llenarla).
      if (this.round === 1) p.shop = rollShop();
      const streak = Math.max(p.winStreak, p.lossStreak);
      if (this.round > 1) p.gold += goldIncome(p.gold, streak);
    }
    this.broadcastState();
    for (const side of this.sides) {
      if (this.players[side].isBot && this.players[side].alive) this.runBotTurn(side);
    }
    this.timer = setInterval(() => {
      this.timeLeft -= 1000;
      // La ronda dura siempre lo mismo: no hay boton de "listo" con el que un
      // jugador pueda adelantar el combate a los demas.
      if (this.timeLeft <= 0) {
        this.clearTimer();
        this.runBattlePhase();
      } else {
        this.broadcastTick();
      }
    }, 1000);
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
  }

  findFreeCell(player) {
    for (let y = 0; y < BOARD_ROWS_PLAYER; y++) {
      for (let x = 0; x < BOARD_COLS; x++) {
        if (!player.board.some((u) => u.x === x && u.y === y)) return { x, y };
      }
    }
    return null;
  }

  // Comprar se puede en cualquier momento de la partida, tambien mientras se
  // resuelve el combate: lo comprado va al banquillo y entra a jugar en la
  // ronda siguiente. Colocar y vender siguen siendo cosa de la preparacion.
  buyUnit(side, slotIdx, skipEmit) {
    const p = this.players[side];
    if (this.phase === 'gameover' || !p.alive) return;
    const pokemonId = p.shop[slotIdx];
    if (!pokemonId) return;
    const def = CHARACTERS_BY_ID[pokemonId];
    if (p.gold < def.cost) return;
    const benchIdx = p.bench.findIndex((s) => s === null);
    if (benchIdx === -1) return;
    p.gold -= def.cost;
    p.bench[benchIdx] = { uid: this.nextUid(), pokemonId, star: 1 };
    // Al estilo Tactics Royale: comprar renueva la tienda entera, no deja el
    // hueco vacio. Es la unica forma de renovarla: no hay boton de reroll.
    p.shop = rollShop();
    this.runMerges(p);
    if (!skipEmit) this.broadcastState();
  }

  sellUnit(side, uid) {
    const p = this.players[side];
    if (this.phase !== 'prep' || !p.alive) return;
    const benchIdx = p.bench.findIndex((u) => u && u.uid === uid);
    if (benchIdx !== -1) {
      const unit = p.bench[benchIdx];
      p.gold += sellPrice(CHARACTERS_BY_ID[unit.pokemonId].cost, unit.star);
      p.bench[benchIdx] = null;
      this.broadcastState();
      return;
    }
    const boardIdx = p.board.findIndex((u) => u.uid === uid);
    if (boardIdx !== -1) {
      const unit = p.board[boardIdx];
      p.gold += sellPrice(CHARACTERS_BY_ID[unit.pokemonId].cost, unit.star);
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

  runBattlePhase() {
    this.phase = 'battle';
    this.lastFights = {};
    // Que el HUD sepa que ya se esta peleando (antes se quedaba en
    // "Preparacion" durante todo el combate).
    this.broadcastState();
    let duracion = 0;

    // Un combate por pareja. Cada jugador recibe SOLO el log del suyo, y con
    // el lado que le toca en el ('A' o 'B'), que en 4 jugadores cambia cada
    // ronda segun con quien le emparejen.
    for (const [x, y] of this.pairs) {
      const px = this.players[x];
      const py = this.players[y];
      const result = simulateBattle(px.board, py.board);
      duracion = Math.max(duracion, result.durationMs);
      this.lastFights[x] = { result, lado: 'A', rival: y };
      this.lastFights[y] = { result, lado: 'B', rival: x };
      this.lastSynergies[x] = result.synergiesA;
      this.lastSynergies[y] = result.synergiesB;

      for (const [side, lado] of [[x, 'A'], [y, 'B']]) {
        const sock = this.io.sockets.sockets.get(this.players[side].id);
        if (!sock) continue;
        sock.emit('battleStart', {
          log: result.log,
          durationMs: result.durationMs,
          round: this.round,
          youAre: lado,
          opponentName: this.players[side === x ? y : x].name,
        });
      }
    }

    // Quien no pelea esta ronda (le toca descansar, o su rival ha abandonado)
    // tiene que enterarse, o se queda esperando un combate que no llega
    for (const side of this.aliveSides()) {
      if (this.pairs.some(([x, y]) => x === side || y === side)) continue;
      const sock = this.io.sockets.sockets.get(this.players[side].id);
      if (sock) sock.emit('roundBye', { round: this.round });
    }

    this.timer = setTimeout(() => this.applyBattleResult(), Math.max(1200, duracion) + 800);
  }

  applyBattleResult() {
    this.roundInfo = {}; // side -> como le fue a el

    for (const [x, y] of this.pairs) {
      const px = this.players[x];
      const py = this.players[y];
      const { result } = this.lastFights[x];

      if (result.winner === 'A' || result.winner === 'B') {
        const ganador = result.winner === 'A' ? x : y;
        const perdedor = result.winner === 'A' ? y : x;
        const supervivientes = result.winner === 'A' ? result.survivorsA : result.survivorsB;
        const dmg = roundDamage(supervivientes);
        this.players[ganador].winStreak++; this.players[ganador].lossStreak = 0;
        this.players[perdedor].lossStreak++; this.players[perdedor].winStreak = 0;
        this.players[perdedor].hp = Math.max(0, this.players[perdedor].hp - dmg);
        this.roundInfo[ganador] = { result: 'win', damage: dmg, opponentName: this.players[perdedor].name };
        this.roundInfo[perdedor] = { result: 'loss', damage: dmg, opponentName: this.players[ganador].name };
      } else {
        this.roundInfo[x] = { result: 'draw', damage: 0, opponentName: py.name };
        this.roundInfo[y] = { result: 'draw', damage: 0, opponentName: px.name };
      }
    }
    // Descansan: el que le tocaba y el que se quedo sin rival por abandono
    for (const side of this.aliveSides()) {
      if (this.pairs.some(([x, y]) => x === side || y === side)) continue;
      this.roundInfo[side] = { result: 'bye', damage: 0, opponentName: null };
    }

    // Eliminados de esta ronda: el ultimo en caer queda por delante
    const caidos = [];
    for (const side of this.sides) {
      const p = this.players[side];
      if (p.alive && p.hp <= 0) { p.alive = false; caidos.push(side); }
    }
    if (caidos.length) {
      const puesto = this.aliveSides().length + caidos.length;
      for (const side of caidos) this.placements[side] = puesto;
    }

    this.phase = 'result';
    this.broadcastState();

    // A quien acaba de caer se le da su puesto y deja de jugar
    for (const side of caidos) {
      const sock = this.io.sockets.sockets.get(this.players[side].id);
      if (sock) sock.emit('gameOver', { won: false, draw: false, place: this.placements[side], total: this.sides.length });
    }

    if (this.aliveSides().length <= 1) {
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
    const vivos = this.aliveSides();
    const winnerSide = vivos.length === 1 ? vivos[0] : null;
    if (winnerSide) this.placements[winnerSide] = 1;

    // Al ranking solo van las personas: los bots no cuentan
    for (const side of this.sides) {
      const p = this.players[side];
      if (p.isBot || this.puntuado) continue;
      recordResult(p.name, { won: side === winnerSide, place: this.placements[side] || null });
    }
    this.puntuado = true;

    for (const side of this.sides) {
      // A los eliminados ya se les aviso en su momento
      if (!this.players[side].alive && this.placements[side]) continue;
      const sock = this.io.sockets.sockets.get(this.players[side].id);
      if (sock) {
        sock.emit('gameOver', {
          won: side === winnerSide,
          draw: winnerSide === null,
          place: this.placements[side] || null,
          total: this.sides.length,
        });
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
      synergies: computeSynergies(p.board).summary,
    };
  }

  broadcastState() {
    for (const side of this.sides) {
      const p = this.players[side];
      const sock = this.io.sockets.sockets.get(p.id);
      if (!sock) continue;
      const rival = this.opponentOf(side);
      sock.emit('state', {
        phase: this.phase,
        round: this.round,
        timeLeft: this.timeLeft,
        mode: this.mode,
        you: this.publicPlayerView(side),
        opponent: rival ? {
          name: this.players[rival].name,
          hp: this.players[rival].hp,
          maxTeam: this.players[rival].maxTeam,
          alive: this.players[rival].alive,
        } : null,
        // Marcador de la sala (en 1v1 son dos, en 4 jugadores los cuatro)
        table: this.sides.map((s2) => ({
          name: this.players[s2].name,
          hp: this.players[s2].hp,
          alive: this.players[s2].alive,
          you: s2 === side,
          opponent: s2 === rival,
        })),
        lastRoundInfo: (this.roundInfo && this.roundInfo[side]) || null,
      });
    }
  }

  broadcastTick() {
    for (const side of this.sides) {
      const sock = this.io.sockets.sockets.get(this.players[side].id);
      if (!sock) continue;
      const rival = this.opponentOf(side);
      sock.emit('tick', { timeLeft: this.timeLeft });
    }
  }

  // Un jugador humano pierde la conexion: no acabamos la partida al instante,
  // le damos una ventana para reconectar (emit 'rejoin' con su token) antes
  // de darla por perdida. Las rondas del servidor siguen corriendo mientras tanto.
  handleDisconnect(socketId) {
    const side = this.sideOf(socketId);
    if (!side || this.ended) return;
    this.players[side].connected = false;
    const rival = this.opponentOf(side);
    if (rival && !this.players[rival].isBot) {
      const sock = this.io.sockets.sockets.get(this.players[rival].id);
      if (sock) sock.emit('opponentDisconnected', { graceMs: RECONNECT_GRACE_MS });
    }
    if (this.reconnectTimers[side]) clearTimeout(this.reconnectTimers[side]);
    this.reconnectTimers[side] = setTimeout(() => {
      if (!this.players[side].connected && !this.ended) this.finalizeDisconnect(side);
    }, RECONNECT_GRACE_MS);
  }

  // Si no vuelve, se le da por eliminado y la partida SIGUE con el resto: al
  // que se va se le trata como a cualquier otro caido. Solo se acaba cuando ya
  // no queda con quien pelear, y entonces por la via normal (endGame), para que
  // el superviviente vea su victoria en vez de que le echen al menu.
  finalizeDisconnect(side) {
    if (this.ended) return;
    const p = this.players[side];
    const estabaVivo = p.alive;
    if (estabaVivo) {
      p.alive = false;
      p.hp = 0;
      this.placements[side] = this.aliveSides().length + 1;
      // si se va en mitad de su combate, ese combate deja de contar
      this.pairs = this.pairs.filter(([x, y]) => x !== side && y !== side);
    }

    // Aviso informativo al resto (los que ya estaban eliminados no cuentan como
    // abandono: su marcha no cambia nada para los demas)
    if (estabaVivo) {
      for (const s2 of this.sides) {
        if (s2 === side || this.players[s2].isBot) continue;
        const sock = this.io.sockets.sockets.get(this.players[s2].id);
        if (sock) sock.emit('playerLeft', { name: p.name });
      }
    }

    const humanosVivos = this.aliveSides().filter((s) => !this.players[s].isBot);
    if (humanosVivos.length === 0) {
      // no queda ninguna persona jugando: se cierra la sala sin mas
      this.clearTimer();
      this.ended = true;
      if (this.onEnded) this.onEnded();
      return;
    }
    if (this.aliveSides().length <= 1) {
      this.clearTimer();
      this.endGame();
      return;
    }
    this.broadcastState();
  }
}

module.exports = GameRoom;
