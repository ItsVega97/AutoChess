'use strict';

(() => {
  const socket = io();

  // ---------------- Estado global ----------------
  let pokemonDb = {}; // id -> data
  let synergyDb = {}; // type -> {label icon desc}
  let mySide = null;
  let myState = null; // ultimo payload 'state'
  let dragging = null; // { uid, origin: 'bench'|'board', fromEl }
  let ghostEl = null;
  let battleActive = false;
  let battleUnits = new Map(); // uid -> render state
  let battleFx = []; // {type:'hit'|'chain', from, to, createdAt} / floating text
  let battleFloats = [];
  let battleLog = [];
  let battleIdx = 0;
  let battleStartTs = 0;
  const TICK_MS = 150;

  const CELLS = 8;
  const canvas = document.getElementById('board-canvas');
  const ctx = canvas.getContext('2d');
  const CELL = canvas.width / CELLS;

  const imageCache = new Map();
  const failedImages = new Set();
  function getImage(url) {
    let img = imageCache.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img.onload = () => scheduleRedraw();
      img.onerror = () => { failedImages.add(url); scheduleRedraw(); };
      setTimeout(() => {
        if (!(img.complete && img.naturalWidth)) { failedImages.add(url); scheduleRedraw(); }
      }, 8000);
      imageCache.set(url, img);
    }
    return img;
  }

  function markImgFallback(imgEl, pokemon) {
    let done = false;
    const applyFallback = () => {
      if (done) return;
      done = true;
      imgEl.style.display = 'none';
      const fallback = el('div', 'img-fallback', '🎮');
      fallback.title = pokemon.name;
      imgEl.parentElement.insertBefore(fallback, imgEl);
    };
    imgEl.addEventListener('error', applyFallback, { once: true });
    imgEl.addEventListener('load', () => { done = true; }, { once: true });
    setTimeout(() => {
      if (!(imgEl.complete && imgEl.naturalWidth)) applyFallback();
    }, 8000);
  }

  // ---------------- Utilidades UI ----------------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // ---------------- Carga inicial de datos ----------------
  fetch('/api/pokemon')
    .then((r) => r.json())
    .then((data) => {
      pokemonDb = Object.fromEntries(data.pokemon.map((p) => [p.id, p]));
      synergyDb = data.synergies;
      renderComboPreview();
    });

  function renderComboPreview() {
    const wrap = document.getElementById('combo-icons');
    wrap.innerHTML = '';
    for (const [type, def] of Object.entries(synergyDb)) {
      wrap.appendChild(el('div', 'ci', `${def.icon} ${def.label}`));
    }
  }

  // ---------------- Menu ----------------
  const nameInput = document.getElementById('input-name');
  nameInput.value = localStorage.getItem('pcr-name') || '';

  document.getElementById('btn-play-online').addEventListener('click', () => {
    const name = (nameInput.value || 'Entrenador').trim().slice(0, 16);
    localStorage.setItem('pcr-name', name);
    socket.emit('findMatch', { name });
    document.getElementById('queue-status').classList.remove('hidden');
  });

  document.getElementById('btn-cancel-queue').addEventListener('click', () => {
    socket.emit('cancelFindMatch');
    document.getElementById('queue-status').classList.add('hidden');
  });

  document.getElementById('btn-play-ai').addEventListener('click', () => {
    const name = (nameInput.value || 'Entrenador').trim().slice(0, 16);
    localStorage.setItem('pcr-name', name);
    socket.emit('playAI', { name });
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    location.reload();
  });

  socket.on('queued', () => {});

  let sessionToken = null;
  socket.on('matchFound', ({ you, opponentName, token }) => {
    mySide = you;
    if (token) sessionToken = token;
    document.getElementById('queue-status').classList.add('hidden');
    document.getElementById('hud-opp-name').textContent = opponentName;
    document.getElementById('hud-my-name').textContent = nameInput.value || 'Tú';
    document.getElementById('reconnect-overlay').classList.add('hidden');
    show('screen-game');
  });

  // Si el socket se cae y socket.io reconecta solo, recuperamos el sitio
  // en la partida con el token guardado (sin perder progreso ni el rival).
  socket.on('connect', () => {
    if (sessionToken) socket.emit('rejoin', { token: sessionToken });
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
    document.getElementById('hud-opp-name').textContent = `${document.getElementById('hud-opp-name').textContent} (desconectado)`;
  });

  socket.on('opponentReconnected', () => {
    document.getElementById('hud-opp-name').textContent = document.getElementById('hud-opp-name').textContent.replace(' (desconectado)', '');
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
      ? '¡Has arrasado la liga PokéChess!'
      : 'Tu equipo ha caído. ¡Vuelve a intentarlo!';
    show('screen-end');
  });

  // ---------------- Estado de partida ----------------
  socket.on('state', (payload) => {
    myState = payload;
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

    if (payload.phase === 'prep' && !battleActive) {
      scheduleRedraw();
    }
  });

  socket.on('tick', ({ timeLeft }) => {
    document.getElementById('hud-timer').textContent = Math.max(0, Math.ceil(timeLeft / 1000));
  });

  document.getElementById('btn-ready').addEventListener('click', () => socket.emit('ready'));
  document.getElementById('btn-reroll').addEventListener('click', () => socket.emit('reroll'));

  // ---------------- Tienda ----------------
  function renderShop(you) {
    const wrap = document.getElementById('shop');
    wrap.innerHTML = '';
    you.shop.forEach((pid, idx) => {
      if (!pid) {
        wrap.appendChild(el('div', 'unit-card locked', '<div style="opacity:.4;padding-top:26px">vendido</div>'));
        return;
      }
      const p = pokemonDb[pid];
      if (!p) return;
      const affordable = you.gold >= p.cost && you.bench.some((s) => s === null) && myState.phase === 'prep';
      const card = el('div', `unit-card uc-type-${p.type}${affordable ? '' : ' locked'}`);
      card.appendChild(el('div', 'uc-cost', p.cost));
      const img = el('img');
      img.src = p.sprite;
      markImgFallback(img, p);
      card.appendChild(img);
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
      const p = pokemonDb[unit.pokemonId];
      const card = el('div', `bench-unit uc-type-${p.type}`);
      const img = el('img');
      img.src = p.sprite;
      markImgFallback(img, p);
      card.appendChild(img);
      card.appendChild(el('div', 'stars', '⭐'.repeat(unit.star)));
      card.dataset.uid = unit.uid;
      card.addEventListener('pointerdown', (e) => startDrag(e, unit.uid, 'bench'));
      card.addEventListener('mouseenter', (e) => showTooltip(e, p, unit.star));
      card.addEventListener('mousemove', (e) => moveTooltip(e));
      card.addEventListener('mouseleave', hideTooltip);
      wrap.appendChild(card);
    });
  }

  // ---------------- Sinergias ----------------
  function renderSynergies(list) {
    const wrap = document.getElementById('synergy-list');
    wrap.innerHTML = '';
    const sorted = [...list].sort((a, b) => b.count - a.count);
    for (const s of sorted) {
      const row = el('div', `syn-row${s.tier > 0 ? ' active' : ''}`);
      row.appendChild(el('div', 'syn-icon', s.icon));
      const info = el('div', 'syn-info');
      info.appendChild(el('div', '', `<b>${s.label}</b>`));
      info.appendChild(el('div', 'syn-count', `${s.count} unidad(es)${s.tier ? ` · nivel ${s.tier === 4 ? 'II' : 'I'}` : ''}`));
      row.appendChild(info);
      row.title = s.desc;
      wrap.appendChild(row);
    }
  }

  // ---------------- Tooltip ----------------
  const tooltip = document.getElementById('tooltip');
  function showTooltip(e, p, star) {
    tooltip.innerHTML = `<h4>${p.name} ${star ? '⭐'.repeat(star) : ''}</h4>
      <div class="row"><span>Tipo</span><span>${synergyDb[p.type]?.icon || ''} ${synergyDb[p.type]?.label || p.type}</span></div>
      <div class="row"><span>Coste</span><span>${p.cost} 🪙</span></div>
      <div class="row"><span>Vida</span><span>${p.hp}</span></div>
      <div class="row"><span>Ataque</span><span>${p.atk}</span></div>
      <div class="row"><span>Defensa</span><span>${p.def}</span></div>
      <div class="row"><span>Alcance</span><span>${p.range}</span></div>`;
    tooltip.classList.remove('hidden');
    moveTooltip(e);
  }
  function moveTooltip(e) {
    tooltip.style.left = `${e.clientX + 16}px`;
    tooltip.style.top = `${e.clientY + 16}px`;
  }
  function hideTooltip() {
    tooltip.classList.add('hidden');
  }

  // ---------------- Drag & Drop ----------------
  function startDrag(e, uid, origin) {
    if (!myState || myState.phase !== 'prep') return;
    e.preventDefault();
    const p = findUnitData(uid);
    if (!p) return;
    dragging = { uid, origin };
    ghostEl = el('div', 'drag-ghost');
    const img = el('img');
    img.src = pokemonDb[p.pokemonId].sprite;
    ghostEl.appendChild(img);
    document.body.appendChild(ghostEl);
    moveGhost(e);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  }

  function findUnitData(uid) {
    if (!myState) return null;
    return myState.you.bench.find((u) => u && u.uid === uid) || myState.you.board.find((u) => u.uid === uid);
  }

  function moveGhost(e) {
    if (ghostEl) {
      ghostEl.style.left = `${e.clientX}px`;
      ghostEl.style.top = `${e.clientY}px`;
    }
  }

  function onDragMove(e) {
    moveGhost(e);
    const sellZone = document.getElementById('sell-zone');
    sellZone.classList.toggle('drop-hover', isOverEl(e, sellZone));
  }

  function isOverEl(e, target) {
    const r = target.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function onDragEnd(e) {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    document.getElementById('sell-zone').classList.remove('drop-hover');
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    if (!dragging) return;

    const sellZone = document.getElementById('sell-zone');
    const benchZone = document.getElementById('bench');
    if (isOverEl(e, sellZone)) {
      socket.emit('sellUnit', { uid: dragging.uid });
    } else if (isOverEl(e, benchZone)) {
      if (dragging.origin === 'board') socket.emit('benchUnit', { uid: dragging.uid });
    } else if (isOverEl(e, canvas)) {
      const r = canvas.getBoundingClientRect();
      const scaleX = canvas.width / r.width;
      const scaleY = canvas.height / r.height;
      const cx = (e.clientX - r.left) * scaleX;
      const cy = (e.clientY - r.top) * scaleY;
      const col = Math.floor(cx / CELL);
      const row = Math.floor(cy / CELL);
      if (row >= 4 && row <= 7 && col >= 0 && col <= 7) {
        const localX = col;
        const localY = 7 - row;
        socket.emit('placeOnBoard', { uid: dragging.uid, x: localX, y: localY });
      }
    }
    dragging = null;
  }

  // Permite tambien iniciar arrastre desde una unidad ya colocada en el tablero (canvas)
  canvas.addEventListener('pointerdown', (e) => {
    if (!myState || myState.phase !== 'prep' || battleActive) return;
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    const cx = (e.clientX - r.left) * scaleX;
    const cy = (e.clientY - r.top) * scaleY;
    const col = Math.floor(cx / CELL);
    const row = Math.floor(cy / CELL);
    if (row < 4 || row > 7) return;
    const localX = col;
    const localY = 7 - row;
    const unit = myState.you.board.find((u) => u.x === localX && u.y === localY);
    if (unit) startDrag(e, unit.uid, 'board');
  });

  // ---------------- Render del tablero (fase de preparacion) ----------------
  let redrawQueued = false;
  function scheduleRedraw() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      if (!battleActive) drawPrepBoard();
    });
  }

  function drawGridBase() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < CELLS; row++) {
      for (let col = 0; col < CELLS; col++) {
        const enemyZone = row < 4;
        ctx.fillStyle = enemyZone ? 'rgba(255,90,90,0.07)' : 'rgba(90,255,140,0.08)';
        ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.strokeRect(col * CELL, row * CELL, CELL, CELL);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, 4 * CELL - 1, canvas.width, 2);
  }

  function drawPrepBoard() {
    drawGridBase();
    if (!myState) return;
    for (const unit of myState.you.board) {
      const col = unit.x;
      const row = 7 - unit.y;
      drawUnitSprite(unit.pokemonId, unit.star, col * CELL + CELL / 2, row * CELL + CELL / 2, null, 0, null);
    }
  }

  function drawUnitSprite(pokemonId, star, cx, cy, hpFrac, shieldFrac, sideColor, scale = 1) {
    const p = pokemonDb[pokemonId];
    if (!p) return;
    const size = CELL * 0.82 * scale;
    const img = getImage(p.sprite);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.36, size * 0.32, size * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    if (sideColor) {
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = sideColor;
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (img.complete && img.naturalWidth && !failedImages.has(img.src)) {
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#26407a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `${Math.round(size * 0.5)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(synergyDb[p.type]?.icon || '🎮', cx, cy + 1);
      ctx.textBaseline = 'alphabetic';
    }
    if (star) {
      ctx.font = `${Math.round(size * 0.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 2;
      const txt = '★'.repeat(star);
      ctx.strokeText(txt, cx, cy - size / 2 - 4);
      ctx.fillText(txt, cx, cy - size / 2 - 4);
    }
    if (hpFrac !== null && hpFrac !== undefined) {
      const barW = size * 1.05;
      const barH = 6;
      const bx = cx - barW / 2;
      const by = cy + size / 2 + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = hpFrac > 0.5 ? '#3ddc84' : hpFrac > 0.25 ? '#ffd23f' : '#ff5d6c';
      ctx.fillRect(bx, by, barW * Math.max(0, hpFrac), barH);
      if (shieldFrac > 0) {
        ctx.strokeStyle = '#7fd8ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, barW, barH);
      }
    }
    ctx.restore();
  }

  // ---------------- Animacion de batalla ----------------
  socket.on('battleStart', ({ log, durationMs }) => {
    battleLog = log;
    battleIdx = 0;
    battleUnits = new Map();
    battleFx = [];
    battleFloats = [];
    battleActive = true;
    battleStartTs = performance.now();
    document.getElementById('battle-banner').classList.add('hidden');
    requestAnimationFrame(battleFrame);
  });

  function applyBattleEvent(e) {
    switch (e.type) {
      case 'spawn':
        battleUnits.set(e.uid, {
          side: e.side, pokemonId: e.pokemonId, star: e.star,
          x: e.x, y: e.y, fromX: e.x, fromY: e.y, toX: e.x, toY: e.y,
          moveStart: 0, moveDur: 1,
          hp: e.hp, maxHp: e.maxHp, shield: e.shield, maxShield: e.shield,
          alive: true,
        });
        break;
      case 'move': {
        const u = battleUnits.get(e.uid);
        if (!u) break;
        u.fromX = u.x; u.fromY = u.y;
        u.toX = e.x; u.toY = e.y;
        u.moveStart = performance.now();
        u.moveDur = 420;
        u.x = e.x; u.y = e.y;
        break;
      }
      case 'attack': {
        const u = battleUnits.get(e.uid);
        const t = battleUnits.get(e.target);
        if (t) { t.hp = e.hp; t.shield = e.shield; }
        if (u && t) {
          battleFx.push({ from: { x: u.x, y: u.y }, to: { x: t.x, y: t.y }, createdAt: performance.now() });
          battleFloats.push({ x: t.x, y: t.y, text: `-${e.damage}`, color: '#ff5d6c', createdAt: performance.now() });
        }
        break;
      }
      case 'chain': {
        const t = battleUnits.get(e.target);
        if (t) t.hp = e.hp;
        if (t) battleFloats.push({ x: t.x, y: t.y, text: `-${e.damage}⚡`, color: '#ffe36e', createdAt: performance.now() });
        break;
      }
      case 'burn': {
        const t = battleUnits.get(e.uid);
        if (t) { t.hp = e.hp; battleFloats.push({ x: t.x, y: t.y, text: `-${e.damage}🔥`, color: '#ff8a4c', createdAt: performance.now() }); }
        break;
      }
      case 'heal': {
        const t = battleUnits.get(e.uid);
        if (t) { t.hp = e.hp; battleFloats.push({ x: t.x, y: t.y, text: `+${e.amount}`, color: '#3ddc84', createdAt: performance.now() }); }
        break;
      }
      case 'dodge': {
        const t = battleUnits.get(e.uid);
        if (t) battleFloats.push({ x: t.x, y: t.y, text: 'ESQUIVA', color: '#b6d8ff', createdAt: performance.now() });
        break;
      }
      case 'stun': {
        const t = battleUnits.get(e.uid);
        if (t) battleFloats.push({ x: t.x, y: t.y, text: 'ATURDIDO', color: '#a184ff', createdAt: performance.now() });
        break;
      }
      case 'death': {
        const u = battleUnits.get(e.uid);
        if (u) { u.alive = false; u.deathAt = performance.now(); }
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

    drawGridBase();
    for (const [uid, u] of battleUnits) {
      if (!u.alive) {
        const age = now - (u.deathAt || now);
        if (age > 500) continue;
      }
      let px = u.toX, py = u.toY;
      if (u.moveStart && now - u.moveStart < u.moveDur) {
        const f = (now - u.moveStart) / u.moveDur;
        px = u.fromX + (u.toX - u.fromX) * f;
        py = u.fromY + (u.toY - u.fromY) * f;
      }
      const renderY = mySide === 'B' ? (CELLS - 1) - py : py;
      const cx = px * CELL + CELL / 2;
      const cy = renderY * CELL + CELL / 2;
      const alpha = u.alive ? 1 : Math.max(0, 1 - (now - u.deathAt) / 500);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawUnitSprite(u.pokemonId, u.star, cx, cy, u.hp / u.maxHp, u.shield > 0 ? u.shield / (u.maxShield || 1) : 0, u.side === 'A' ? 'rgba(90,255,140,1)' : 'rgba(255,90,90,1)');
      ctx.restore();
    }

    battleFx = battleFx.filter((fx) => now - fx.createdAt < 150);
    for (const fx of battleFx) {
      ctx.save();
      ctx.globalAlpha = 1 - (now - fx.createdAt) / 150;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      const fy = mySide === 'B' ? (CELLS - 1) - fx.from.y : fx.from.y;
      const ty = mySide === 'B' ? (CELLS - 1) - fx.to.y : fx.to.y;
      ctx.beginPath();
      ctx.moveTo(fx.from.x * CELL + CELL / 2, fy * CELL + CELL / 2);
      ctx.lineTo(fx.to.x * CELL + CELL / 2, ty * CELL + CELL / 2);
      ctx.stroke();
      ctx.restore();
    }

    battleFloats = battleFloats.filter((f) => now - f.createdAt < 800);
    for (const f of battleFloats) {
      const t = (now - f.createdAt) / 800;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = f.color;
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      const fy = mySide === 'B' ? (CELLS - 1) - f.y : f.y;
      ctx.fillText(f.text, f.x * CELL + CELL / 2, fy * CELL + CELL / 2 - 20 - t * 20);
      ctx.restore();
    }

    const doneEvents = battleIdx >= battleLog.length;
    const lastEventTime = battleLog.length ? battleLog[battleLog.length - 1].t * TICK_MS : 0;
    if (doneEvents && elapsed > lastEventTime + 600) {
      battleActive = false;
      scheduleRedraw();
      return;
    }
    requestAnimationFrame(battleFrame);
  }

})();
