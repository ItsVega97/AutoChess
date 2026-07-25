'use strict';

import { createScene } from './scene3d.js';

(() => {
  const socket = io();

  // ---------------- Estado global ----------------
  let charDb = {}; // id -> personaje
  let crewDb = {}; // crew slug -> {label icon desc}
  let boardCols = 5;
  let boardRows = 6;
  let rowsPerPlayer = 3;
  let mySide = null;
  let myState = null; // ultimo payload 'state'
  let scene = null;

  let battleActive = false;
  let battleUnits = new Map(); // uid -> estado de render
  let battleLog = [];
  let battleIdx = 0;
  let battleStartTs = 0;
  const TICK_MS = 150;

  // ---------------- Utilidades UI ----------------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (id === 'screen-game' && scene) setTimeout(() => scene.resize(), 30);
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /**
   * Conversion de coordenadas.
   *
   * El servidor habla en dos espacios distintos:
   *  - preparacion: (x, y) dentro de TU mitad, con y=0 en tu fila de delante.
   *  - combate: (x, y) absolutos del tablero completo, donde el lado B ocupa
   *    las filas de arriba y el A las de abajo.
   *
   * La escena 3D siempre dibuja "tu mitad cerca de la camara", asi que aqui
   * traducimos ambos espacios a coordenadas de render (fila 0 = fondo/enemigo).
   */
  function prepToRender(x, y) {
    return { col: x, row: boardRows - 1 - y };
  }
  function renderToPrep(col, row) {
    return { x: col, y: boardRows - 1 - row };
  }
  function battleToRender(x, y) {
    // El lado A ya viene en las filas de abajo; el B hay que voltearlo para
    // que cada jugador se vea a si mismo en la parte cercana.
    return { col: x, row: mySide === 'B' ? boardRows - 1 - y : y };
  }
  function isMyHalfRow(row) {
    return row >= boardRows - rowsPerPlayer;
  }

  // ---------------- Carga inicial de datos ----------------
  function loadCharDb(attempt = 1) {
    fetch('/api/units')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        charDb = Object.fromEntries(data.characters.map((c) => [c.id, c]));
        crewDb = data.crews;
        if (data.board) {
          boardCols = data.board.cols;
          boardRows = data.board.rows;
          rowsPerPlayer = data.board.rowsPerPlayer;
          if (scene) scene.setBoard(boardCols, boardRows);
        }
        renderComboPreview();
        if (myState) { renderShop(myState.you); renderBench(myState.you); refreshBoard(); }
      })
      .catch((err) => {
        console.error('No se pudieron cargar los datos de personajes, reintentando...', err);
        if (attempt <= 5) setTimeout(() => loadCharDb(attempt + 1), 1000 * attempt);
      });
  }
  loadCharDb();

  function renderComboPreview() {
    const wrap = document.getElementById('combo-icons');
    wrap.innerHTML = '';
    for (const [crew, def] of Object.entries(crewDb)) {
      wrap.appendChild(el('div', 'ci', `${def.icon} ${def.label}`));
    }
  }

  // ---------------- Menu ----------------
  const nameInput = document.getElementById('input-name');
  nameInput.value = localStorage.getItem('pcr-name') || '';

  let searchingOnline = false;
  let searchingName = null;

  document.getElementById('btn-play-online').addEventListener('click', () => {
    const name = (nameInput.value || 'Pirata').trim().slice(0, 16);
    localStorage.setItem('pcr-name', name);
    searchingOnline = true;
    searchingName = name;
    socket.emit('findMatch', { name });
    document.getElementById('queue-status').classList.remove('hidden');
  });

  document.getElementById('btn-cancel-queue').addEventListener('click', () => {
    searchingOnline = false;
    socket.emit('cancelFindMatch');
    document.getElementById('queue-status').classList.add('hidden');
  });

  document.getElementById('btn-play-ai').addEventListener('click', () => {
    const name = (nameInput.value || 'Pirata').trim().slice(0, 16);
    localStorage.setItem('pcr-name', name);
    socket.emit('playAI', { name });
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    location.reload();
  });

  socket.on('queued', () => {});

  let sessionToken = null;
  let enteredGame = false;
  socket.on('matchFound', ({ you, opponentName, token }) => {
    const wasAlreadyInGame = enteredGame;
    mySide = you;
    searchingOnline = false;
    if (token) sessionToken = token;
    document.getElementById('queue-status').classList.add('hidden');
    document.getElementById('hud-opp-name').textContent = opponentName;
    document.getElementById('hud-my-name').textContent = nameInput.value || 'Tú';
    document.getElementById('reconnect-overlay').classList.add('hidden');
    if (wasAlreadyInGame) {
      show('screen-game');
    } else {
      enteredGame = false;
      document.getElementById('loading-opponent').textContent = `Rival: ${opponentName}`;
      show('screen-loading');
    }
  });

  socket.on('connect', () => {
    if (sessionToken) {
      socket.emit('rejoin', { token: sessionToken });
    } else if (searchingOnline) {
      socket.emit('findMatch', { name: searchingName });
    }
  });

  socket.on('disconnect', () => {
    if (document.getElementById('screen-game').classList.contains('active') && sessionToken) {
      document.getElementById('reconnect-overlay').classList.remove('hidden');
    }
  });

  socket.on('rejoinFailed', () => {
    if (sessionToken) {
      alert('No se pudo recuperar la partida (probablemente terminó). Vuelves al menú.');
      location.reload();
    }
  });

  socket.on('opponentDisconnected', () => {
    const nameEl = document.getElementById('hud-opp-name');
    if (!nameEl.textContent.includes('(desconectado)')) {
      nameEl.textContent = `${nameEl.textContent} (desconectado)`;
    }
  });

  socket.on('opponentReconnected', () => {
    const nameEl = document.getElementById('hud-opp-name');
    nameEl.textContent = nameEl.textContent.replace(' (desconectado)', '');
  });

  socket.on('opponentLeft', () => {
    alert('Tu rival se ha desconectado y no ha vuelto. Vuelves al menú.');
    location.reload();
  });

  socket.on('gameOver', ({ won, draw }) => {
    document.getElementById('end-title').textContent = draw ? 'Empate' : won ? '¡Victoria!' : 'Derrota';
    document.getElementById('end-subtitle').textContent = draw
      ? 'La partida ha terminado en tablas.'
      : won
      ? '¡Te has convertido en el Rey de los Piratas!'
      : 'Tu tripulación ha caído. ¡Vuelve a zarpar!';
    show('screen-end');
  });

  // ---------------- Estado de partida ----------------
  socket.on('state', (payload) => {
    try {
      renderState(payload);
    } catch (err) {
      console.error('Error renderizando el estado de la partida:', err);
    }
  });

  function renderState(payload) {
    myState = payload;
    if (!enteredGame) {
      enteredGame = true;
      show('screen-game');
    }
    document.getElementById('hud-phase').textContent =
      { prep: 'Preparación', battle: 'Combate', result: 'Resultado', lobby: 'Cargando' }[payload.phase] || payload.phase;
    document.getElementById('hud-round').textContent = payload.round;
    document.getElementById('hud-timer').textContent = Math.max(0, Math.ceil(payload.timeLeft / 1000));
    document.getElementById('hud-my-hp').textContent = payload.you.hp;
    document.getElementById('hud-my-gold').textContent = payload.you.gold;
    document.getElementById('hud-my-level').textContent = payload.you.level;
    document.getElementById('hud-opp-hp').textContent = payload.opponent.hp;
    document.getElementById('hud-opp-level').textContent = payload.opponent.level;

    renderShop(payload.you);
    renderBench(payload.you);
    renderSynergies(payload.you.synergies);

    const readyBtn = document.getElementById('btn-ready');
    readyBtn.disabled = payload.phase !== 'prep' || payload.you.ready;
    readyBtn.textContent = payload.you.ready ? '⏳ Esperando...' : '✅ Listo';
    document.getElementById('btn-reroll').disabled = payload.phase !== 'prep' || payload.you.gold < 2;

    const banner = document.getElementById('battle-banner');
    if (payload.phase === 'result' && payload.lastRoundInfo) {
      const info = payload.lastRoundInfo;
      if (info.winnerSide === null) {
        banner.textContent = 'Empate en el combate. Nadie recibe daño.';
      } else {
        const iWon = info.winnerSide === mySide;
        banner.textContent = iWon
          ? `¡Ganaste el combate! Tu rival pierde ${info.damage} de vida.`
          : `Perdiste el combate. Pierdes ${info.damage} de vida.`;
      }
      banner.classList.remove('hidden');
    } else if (payload.phase === 'prep') {
      banner.classList.add('hidden');
    }

    if (!battleActive) refreshBoard();
  }

  socket.on('tick', ({ timeLeft }) => {
    document.getElementById('hud-timer').textContent = Math.max(0, Math.ceil(timeLeft / 1000));
  });

  document.getElementById('btn-ready').addEventListener('click', () => socket.emit('ready'));
  document.getElementById('btn-reroll').addEventListener('click', () => socket.emit('reroll'));

  // ---------------- Avatares 2D (tienda / banquillo) ----------------
  function makeAvatarEl(p) {
    if (p.portrait) {
      const wrap = el('div', `unit-avatar unit-avatar-img${p.captain ? ' captain' : ''}`);
      const img = el('img');
      img.src = `/img/characters/${p.portrait}`;
      img.alt = p.name;
      img.onerror = () => {
        wrap.classList.remove('unit-avatar-img');
        wrap.textContent = p.initials;
      };
      wrap.appendChild(img);
      return wrap;
    }
    const avatar = el('div', 'unit-avatar', p.initials);
    if (p.captain) avatar.classList.add('captain');
    return avatar;
  }

  // ---------------- Tienda ----------------
  function renderShop(you) {
    const wrap = document.getElementById('shop');
    wrap.innerHTML = '';
    you.shop.forEach((pid, idx) => {
      if (!pid) {
        wrap.appendChild(el('div', 'unit-card locked', '<div class="uc-sold">vendido</div>'));
        return;
      }
      const p = charDb[pid];
      if (!p) return;
      const affordable = you.gold >= p.cost && you.bench.some((s) => s === null) && myState.phase === 'prep';
      const card = el('div', `unit-card uc-crew-${p.crew}${p.captain ? ' captain' : ''}${affordable ? '' : ' locked'}`);
      card.appendChild(el('div', 'uc-cost', p.cost));
      if (p.captain) card.appendChild(el('div', 'captain-badge', '👑'));
      card.appendChild(makeAvatarEl(p));
      card.appendChild(el('div', 'uc-name', p.name));
      card.addEventListener('click', () => {
        if (!affordable) return;
        socket.emit('buyUnit', { slot: idx });
      });
      card.addEventListener('mouseenter', (e) => showTooltip(e, p));
      card.addEventListener('mousemove', (e) => moveTooltip(e));
      card.addEventListener('mouseleave', hideTooltip);
      wrap.appendChild(card);
    });
  }

  // ---------------- Banquillo ----------------
  function renderBench(you) {
    const wrap = document.getElementById('bench');
    wrap.innerHTML = '';
    you.bench.forEach((unit) => {
      if (!unit) {
        wrap.appendChild(el('div', 'bench-slot'));
        return;
      }
      const p = charDb[unit.pokemonId];
      if (!p) return;
      const card = el('div', `bench-unit uc-crew-${p.crew}${p.captain ? ' captain' : ''}`);
      card.appendChild(makeAvatarEl(p));
      card.appendChild(el('div', 'stars', '⭐'.repeat(unit.star)));
      card.dataset.uid = unit.uid;
      if (selectedUnit && selectedUnit.uid === unit.uid) card.classList.add('selected');
      card.addEventListener('click', () => toggleSelect(unit.uid, 'bench'));
      card.addEventListener('mouseenter', (e) => showTooltip(e, p, unit.star));
      card.addEventListener('mousemove', (e) => moveTooltip(e));
      card.addEventListener('mouseleave', hideTooltip);
      wrap.appendChild(card);
    });
  }

  // ---------------- Sinergias (tripulaciones) ----------------
  function renderSynergies(list) {
    const wrap = document.getElementById('synergy-list');
    wrap.innerHTML = '';
    const sorted = [...list].sort((a, b) => b.count - a.count);
    for (const s of sorted) {
      const row = el('div', `syn-row${s.tier > 0 ? ' active' : ''}`);
      row.appendChild(el('div', 'syn-icon', s.icon));
      const info = el('div', 'syn-info');
      info.appendChild(el('div', '', `<b>${s.label}</b>`));
      const tierLabel = s.tier === 5 ? ' · ¡TRIPULACIÓN COMPLETA!' : s.tier ? ` · nivel ${s.tier === 4 ? 'II' : 'I'}` : '';
      info.appendChild(el('div', 'syn-count', `${s.count}/5${tierLabel}`));
      row.appendChild(info);
      row.title = s.desc;
      wrap.appendChild(row);
    }
  }

  // ---------------- Tooltip ----------------
  const tooltip = document.getElementById('tooltip');
  function showTooltip(e, p, star) {
    tooltip.innerHTML = `<h4>${p.captain ? '👑 ' : ''}${p.name} ${star ? '⭐'.repeat(star) : ''}</h4>
      <div class="row"><span>Tripulación</span><span>${crewDb[p.crew]?.icon || ''} ${crewDb[p.crew]?.label || p.crew}</span></div>
      <div class="row"><span>Coste</span><span>${p.cost} 🪙</span></div>
      <div class="row"><span>Vida</span><span>${p.hp}</span></div>
      <div class="row"><span>Ataque</span><span>${p.atk}</span></div>
      <div class="row"><span>Defensa</span><span>${p.def}</span></div>
      <div class="row"><span>Alcance</span><span>${p.range}</span></div>
      ${p.ability ? `<div class="tt-ability">
        <div class="tt-ability-name">⚡ ${p.ability.name} <span class="tt-mana">${p.ability.mana} maná</span></div>
        <div class="tt-ability-desc">${p.ability.desc}</div>
      </div>` : ''}`;
    tooltip.classList.remove('hidden');
    moveTooltip(e);
  }
  // Coloca el tooltip junto al cursor pero sin salirse de la pantalla: si no
  // cabe debajo o a la derecha, lo pasa al otro lado.
  function moveTooltip(e) {
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    const r = tooltip.getBoundingClientRect();
    const pad = 12;
    let x = e.clientX + 16;
    let y = e.clientY + 16;
    if (x + r.width + pad > window.innerWidth) x = e.clientX - r.width - 16;
    if (y + r.height + pad > window.innerHeight) y = e.clientY - r.height - 16;
    tooltip.style.left = `${Math.max(pad, x)}px`;
    tooltip.style.top = `${Math.max(pad, y)}px`;
  }
  function hideTooltip() {
    tooltip.classList.add('hidden');
  }

  // ---------------- Seleccionar y colocar ----------------
  // En 3D el arrastre no aporta nada (y va mal en movil): se juega tocando la
  // ficha y despues la casilla destino.
  let selectedUnit = null; // { uid, origin }

  function toggleSelect(uid, origin) {
    if (!myState || myState.phase !== 'prep' || battleActive) return;
    if (selectedUnit && selectedUnit.uid === uid) setSelected(null);
    else setSelected({ uid, origin });
  }

  function setSelected(sel) {
    selectedUnit = sel;
    document.querySelectorAll('.bench-unit').forEach((elm) => {
      elm.classList.toggle('selected', !!selectedUnit && elm.dataset.uid === selectedUnit.uid);
    });
    refreshBoard();
  }

  // Casillas libres de tu mitad, resaltadas al tener una ficha seleccionada
  function highlightCells() {
    if (!selectedUnit || !myState) return [];
    const out = [];
    for (let y = 0; y < rowsPerPlayer; y++) {
      for (let x = 0; x < boardCols; x++) {
        if (myState.you.board.some((u) => u.x === x && u.y === y)) continue;
        out.push(prepToRender(x, y));
      }
    }
    return out;
  }

  // ---------------- Sincronizacion del tablero 3D ----------------
  function refreshBoard() {
    if (!scene || !myState) return;
    if (battleActive) return;
    const units = [];
    for (const u of myState.you.board) {
      const ch = charDb[u.pokemonId];
      if (!ch) continue;
      const { col, row } = prepToRender(u.x, u.y);
      units.push({
        uid: u.uid,
        char: { ...ch, star: u.star },
        col, row,
        selected: !!selectedUnit && selectedUnit.uid === u.uid,
        showHp: false,
      });
    }
    scene.syncUnits(units);
    scene.setHighlights(highlightCells());
  }

  // ---------------- Animacion de combate ----------------
  socket.on('battleStart', ({ log }) => {
    battleLog = log;
    battleIdx = 0;
    battleUnits = new Map();
    battleActive = true;
    battleStartTs = performance.now();
    if (scene) scene.setHighlights([]);
    setSelected(null);
    document.getElementById('battle-banner').classList.add('hidden');
    requestAnimationFrame(battleFrame);
  });

  function applyBattleEvent(e) {
    const now = performance.now();
    switch (e.type) {
      case 'spawn':
        battleUnits.set(e.uid, {
          side: e.side, pokemonId: e.pokemonId, star: e.star,
          x: e.x, y: e.y, fromX: e.x, fromY: e.y, toX: e.x, toY: e.y,
          moveStart: 0, moveDur: 1,
          hp: e.hp, maxHp: e.maxHp,
          mana: 0, maxMana: e.maxMana || 0,
          alive: true,
        });
        break;
      case 'move': {
        const u = battleUnits.get(e.uid);
        if (!u) break;
        u.fromX = u.x; u.fromY = u.y;
        u.toX = e.x; u.toY = e.y;
        u.moveStart = now;
        u.moveDur = 380;
        u.x = e.x; u.y = e.y;
        break;
      }
      case 'attack': {
        const u = battleUnits.get(e.uid);
        const t = battleUnits.get(e.target);
        if (u && e.mana !== undefined) u.mana = e.mana;
        if (t && e.tMana !== undefined) t.mana = e.tMana;
        if (t) t.hp = e.hp;
        if (u && t && scene) {
          const a = battleToRender(u.x, u.y);
          const b = battleToRender(t.x, t.y);
          scene.addAttackBeam(a.col, a.row, b.col, b.row);
          scene.addFloatingText(b.col, b.row, `-${e.damage}`, '#ff8080');
        }
        break;
      }
      case 'chain': {
        const t = battleUnits.get(e.target);
        if (t) {
          t.hp = e.hp;
          const b = battleToRender(t.x, t.y);
          if (scene) scene.addFloatingText(b.col, b.row, `-${e.damage}⚡`, '#ffe36e');
        }
        break;
      }
      case 'burn': {
        const t = battleUnits.get(e.uid);
        if (t) {
          t.hp = e.hp;
          const b = battleToRender(t.x, t.y);
          if (scene) scene.addFloatingText(b.col, b.row, `-${e.damage}🔥`, '#ff9a4c');
        }
        break;
      }
      case 'heal': {
        const t = battleUnits.get(e.uid);
        if (t) {
          t.hp = e.hp;
          const b = battleToRender(t.x, t.y);
          if (scene) scene.addFloatingText(b.col, b.row, `+${e.amount}`, '#6dffa8');
        }
        break;
      }
      case 'dodge': {
        const a = battleUnits.get(e.attacker);
        if (a && e.mana !== undefined) a.mana = e.mana;
        const t = battleUnits.get(e.uid);
        if (t && scene) {
          const b = battleToRender(t.x, t.y);
          scene.addFloatingText(b.col, b.row, 'ESQUIVA', '#b6d8ff');
        }
        break;
      }
      case 'stun': {
        const t = battleUnits.get(e.uid);
        if (t && scene) {
          const b = battleToRender(t.x, t.y);
          scene.addFloatingText(b.col, b.row, 'ATURDIDO', '#c4a8ff');
        }
        break;
      }
      case 'ability': {
        const u = battleUnits.get(e.uid);
        if (u) u.mana = 0;
        if (u && scene) {
          const p = battleToRender(u.x, u.y);
          scene.addAbilityBurst(p.col, p.row);
          scene.addFloatingText(p.col, p.row, e.name, '#ffd23f');
        }
        break;
      }
      case 'abilityHit': {
        const t = battleUnits.get(e.uid);
        if (t) {
          t.hp = e.hp;
          const p = battleToRender(t.x, t.y);
          if (scene) scene.addFloatingText(p.col, p.row, `-${e.damage}`, '#ffb347');
        }
        break;
      }
      case 'shielded':
        break;
      case 'death': {
        const u = battleUnits.get(e.uid);
        if (u) { u.alive = false; u.deathAt = now; }
        break;
      }
      default:
        break;
    }
  }

  function battleFrame(now) {
    if (!battleActive) return;
    const elapsed = now - battleStartTs;
    while (battleIdx < battleLog.length && battleLog[battleIdx].t * TICK_MS <= elapsed) {
      applyBattleEvent(battleLog[battleIdx]);
      battleIdx++;
    }

    const units = [];
    for (const [uid, u] of battleUnits) {
      let fade = 1;
      if (!u.alive) {
        const age = now - (u.deathAt || now);
        if (age > 500) continue;
        fade = Math.max(0, 1 - age / 500);
      }
      let px = u.toX, py = u.toY;
      if (u.moveStart && now - u.moveStart < u.moveDur) {
        const f = (now - u.moveStart) / u.moveDur;
        px = u.fromX + (u.toX - u.fromX) * f;
        py = u.fromY + (u.toY - u.fromY) * f;
      }
      const ch = charDb[u.pokemonId];
      if (!ch) continue;
      const { col, row } = battleToRender(px, py);
      units.push({
        uid,
        char: { ...ch, star: u.star },
        col, row,
        selected: false,
        showHp: u.alive,
        hpFrac: u.hp / u.maxHp,
        mana: u.mana,
        maxMana: u.maxMana,
        opacity: fade,
      });
    }
    if (scene) scene.syncUnits(units);

    const doneEvents = battleIdx >= battleLog.length;
    const lastEventTime = battleLog.length ? battleLog[battleLog.length - 1].t * TICK_MS : 0;
    if (doneEvents && elapsed > lastEventTime + 700) {
      battleActive = false;
      refreshBoard();
      return;
    }
    requestAnimationFrame(battleFrame);
  }

  // ---------------- Arranque de la escena 3D ----------------
  function initScene() {
    const container = document.getElementById('board-3d');
    if (!container) return;
    try {
      scene = createScene(container);
      scene.setBoard(boardCols, boardRows);
    } catch (err) {
      console.error('No se pudo iniciar la escena 3D:', err);
      container.innerHTML = '<div class="webgl-error">Tu navegador no ha podido iniciar el modo 3D (WebGL).</div>';
      return;
    }

    // Tocar una casilla: coloca la ficha seleccionada, o selecciona la que haya
    container.addEventListener('pointerdown', (e) => {
      if (!myState || myState.phase !== 'prep' || battleActive) return;
      const cell = scene.pickCell(e.clientX, e.clientY);
      if (!cell || !isMyHalfRow(cell.row)) return;
      const { x, y } = renderToPrep(cell.col, cell.row);
      const occupant = myState.you.board.find((u) => u.x === x && u.y === y);
      if (selectedUnit) {
        socket.emit('placeOnBoard', { uid: selectedUnit.uid, x, y });
        setSelected(null);
      } else if (occupant) {
        setSelected({ uid: occupant.uid, origin: 'board' });
      }
    });
  }

  // Tocar el banquillo (fuera de una ficha) devuelve la seleccionada al banquillo
  document.getElementById('bench').addEventListener('click', (e) => {
    if (!selectedUnit) return;
    if (e.target.closest('.bench-unit')) return;
    if (selectedUnit.origin === 'board') {
      socket.emit('benchUnit', { uid: selectedUnit.uid });
      setSelected(null);
    }
  });

  document.getElementById('sell-zone').addEventListener('click', () => {
    if (!selectedUnit) return;
    socket.emit('sellUnit', { uid: selectedUnit.uid });
    setSelected(null);
  });

  initScene();
})();
