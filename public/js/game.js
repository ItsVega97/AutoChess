'use strict';

(() => {
  const socket = io();

  // ---------------- Estado global ----------------
  let charDb = {}; // id -> personaje
  let crewDb = {}; // crew slug -> {label icon desc}
  let mySide = null;
  let myState = null; // ultimo payload 'state'
  let dragging = null; // { uid, origin: 'bench'|'board' }
  let ghostEl = null;
  let battleActive = false;
  let battleUnits = new Map(); // uid -> render state
  let battleFx = []; // lineas de impacto
  let battleFloats = []; // textos flotantes de dano/curacion
  let battleLog = [];
  let battleIdx = 0;
  let battleStartTs = 0;
  const TICK_MS = 150;

  const CELLS = 8;
  const canvas = document.getElementById('board-canvas');
  const ctx = canvas.getContext('2d');
  const CELL = canvas.width / CELLS;

  // Colores por tripulacion para los avatares dibujados en el tablero
  // (los carteles del banquillo/tienda usan las mismas tonalidades via CSS).
  const CREW_STYLE = {
    strawhat: { fill: '#e8542f', ring: '#8a2a12' },
    whitebeard: { fill: '#3d7dc9', ring: '#173a66' },
    bigmom: { fill: '#e35fc0', ring: '#7a1f66' },
    beast: { fill: '#8b5cf6', ring: '#3d1f7a' },
    redhair: { fill: '#d1293f', ring: '#6e0f1d' },
    blackbeard: { fill: '#5c5468', ring: '#15121c' },
    roger: { fill: '#e8b94a', ring: '#8a6110' },
    baroque: { fill: '#e8862f', ring: '#3a2410' },
  };

  // Cache de retratos para el tablero. Son ficheros propios (mismo origen),
  // asi que a diferencia de un hotlink externo son fiables: si no existe,
  // el error llega rapido y nos quedamos con el cartel de iniciales.
  const portraitCache = new Map();
  function getPortraitImage(filename) {
    let img = portraitCache.get(filename);
    if (!img) {
      img = new Image();
      img.src = `/img/characters/${filename}`;
      img.onload = () => scheduleRedraw();
      portraitCache.set(filename, img);
    }
    return img;
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
  function loadCharDb(attempt = 1) {
    fetch('/api/units')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        charDb = Object.fromEntries(data.characters.map((c) => [c.id, c]));
        crewDb = data.crews;
        renderComboPreview();
        if (myState) { renderShop(myState.you); renderBench(myState.you); scheduleRedraw(); }
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
      // Reconexion a una partida ya en marcha: volvemos directos, sin pantalla de carga.
      show('screen-game');
    } else {
      enteredGame = false;
      document.getElementById('loading-opponent').textContent = `Rival: ${opponentName}`;
      show('screen-loading');
    }
  });

  // Si el socket se cae y socket.io reconecta solo, recuperamos el sitio
  // en la partida con el token guardado (sin perder progreso ni el rival).
  // Si todavia estabamos buscando rival (sin token, sin partida empezada),
  // nos volvemos a apuntar a la cola: si no, el cliente se queda mostrando
  // "buscando" para siempre aunque el servidor ya nos haya sacado de la cola.
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

    if (payload.phase === 'prep' && !battleActive) {
      scheduleRedraw();
    }
  }

  socket.on('tick', ({ timeLeft }) => {
    document.getElementById('hud-timer').textContent = Math.max(0, Math.ceil(timeLeft / 1000));
  });

  document.getElementById('btn-ready').addEventListener('click', () => socket.emit('ready'));
  document.getElementById('btn-reroll').addEventListener('click', () => socket.emit('reroll'));

  // ---------------- Avatares: retrato real si existe, si no cartel de iniciales ----------------
  function makeAvatarEl(p) {
    if (p.portrait) {
      const wrap = el('div', `unit-avatar unit-avatar-img${p.captain ? ' captain' : ''}`);
      const img = el('img');
      img.src = `/img/characters/${p.portrait}`;
      img.alt = p.name;
      img.onerror = () => {
        // el fichero no existe o fallo al cargar: caemos al cartel de iniciales
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
        wrap.appendChild(el('div', 'unit-card locked', '<div style="opacity:.4;padding-top:26px">vendido</div>'));
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
      const card = el('div', `bench-unit uc-crew-${p.crew}${p.captain ? ' captain' : ''}`);
      card.appendChild(makeAvatarEl(p));
      card.appendChild(el('div', 'stars', '⭐'.repeat(unit.star)));
      card.dataset.uid = unit.uid;
      if (selectedUnit && selectedUnit.uid === unit.uid) card.classList.add('selected');
      card.addEventListener('pointerdown', (e) => beginPointer(e, unit.uid, 'bench'));
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

  // ---------------- Colocar unidades: arrastrar (escritorio) o tocar dos veces (movil) ----------------
  // Un mismo gesto de puntero sirve para ambas cosas: si el dedo/raton se
  // mueve mas de DRAG_THRESHOLD px se trata como arrastre; si no se mueve,
  // se trata como un toque que selecciona la unidad (y un segundo toque en
  // el destino la coloca). Funciona igual con raton y con dedo.
  const DRAG_THRESHOLD = 10;
  let pointerStart = null; // { uid, origin, x, y, cellX, cellY }
  let selectedUnit = null; // { uid, origin }

  function findUnitData(uid) {
    if (!myState) return null;
    return myState.you.bench.find((u) => u && u.uid === uid) || myState.you.board.find((u) => u.uid === uid);
  }

  function setSelected(uid, origin) {
    selectedUnit = uid ? { uid, origin } : null;
    document.querySelectorAll('.bench-unit').forEach((elm) => {
      elm.classList.toggle('selected', !!selectedUnit && elm.dataset.uid === selectedUnit.uid);
    });
    scheduleRedraw();
  }

  function beginPointer(e, uid, origin, cellX, cellY) {
    if (!myState || myState.phase !== 'prep' || battleActive) return;
    pointerStart = { uid, origin, x: e.clientX, y: e.clientY, cellX, cellY };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    if (!pointerStart) return;
    const dist = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
    if (!dragging && pointerStart.uid && dist > DRAG_THRESHOLD) {
      // Se ha movido lo suficiente: pasamos de "posible toque" a arrastre de verdad.
      const p = findUnitData(pointerStart.uid);
      if (!p) return;
      dragging = { uid: pointerStart.uid, origin: pointerStart.origin };
      setSelected(null, null);
      const charInfo = charDb[p.pokemonId];
      ghostEl = el('div', 'drag-ghost');
      ghostEl.appendChild(makeAvatarEl(charInfo));
      document.body.appendChild(ghostEl);
    }
    if (dragging) {
      moveGhost(e);
      const sellZone = document.getElementById('sell-zone');
      sellZone.classList.toggle('drop-hover', isOverEl(e, sellZone));
    }
  }

  function moveGhost(e) {
    if (ghostEl) {
      ghostEl.style.left = `${e.clientX}px`;
      ghostEl.style.top = `${e.clientY}px`;
    }
  }

  function isOverEl(e, target) {
    const r = target.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function onPointerUp(e) {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    document.getElementById('sell-zone').classList.remove('drop-hover');

    if (dragging) {
      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
      const sellZone = document.getElementById('sell-zone');
      const benchZone = document.getElementById('bench');
      if (isOverEl(e, sellZone)) {
        socket.emit('sellUnit', { uid: dragging.uid });
      } else if (isOverEl(e, benchZone)) {
        if (dragging.origin === 'board') socket.emit('benchUnit', { uid: dragging.uid });
      } else if (isOverEl(e, canvas)) {
        const cell = cellFromEvent(e);
        if (cell) socket.emit('placeOnBoard', { uid: dragging.uid, x: cell.x, y: cell.y });
      }
      dragging = null;
      pointerStart = null;
      return;
    }

    // No hubo arrastre: es un toque/clic simple -> logica de seleccionar/colocar.
    if (!pointerStart) return;
    const start = pointerStart;
    pointerStart = null;
    if (start.uid) {
      if (selectedUnit && selectedUnit.uid === start.uid) {
        setSelected(null, null); // tocar la misma unidad otra vez la deselecciona
      } else {
        setSelected(start.uid, start.origin);
      }
    } else if (start.origin === 'empty-cell' && selectedUnit) {
      socket.emit('placeOnBoard', { uid: selectedUnit.uid, x: start.cellX, y: start.cellY });
      setSelected(null, null);
    }
  }

  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    const cx = (e.clientX - r.left) * scaleX;
    const cy = (e.clientY - r.top) * scaleY;
    const col = Math.floor(cx / CELL);
    const row = Math.floor(cy / CELL);
    if (row < 4 || row > 7 || col < 0 || col > 7) return null;
    return { x: col, y: 7 - row };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!myState || myState.phase !== 'prep' || battleActive) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    const unit = myState.you.board.find((u) => u.x === cell.x && u.y === cell.y);
    if (unit) beginPointer(e, unit.uid, 'board');
    else beginPointer(e, null, 'empty-cell', cell.x, cell.y);
  });

  // Tocar el banquillo vacio con una unidad seleccionada la manda de vuelta ahi.
  document.getElementById('bench').addEventListener('click', (e) => {
    if (!selectedUnit) return;
    if (e.target.closest('.bench-unit')) return; // eso ya lo gestiona su propio listener
    if (selectedUnit.origin === 'board') {
      socket.emit('benchUnit', { uid: selectedUnit.uid });
      setSelected(null, null);
    }
  });

  // Tocar la zona de venta con una unidad seleccionada la vende.
  document.getElementById('sell-zone').addEventListener('click', () => {
    if (!selectedUnit) return;
    socket.emit('sellUnit', { uid: selectedUnit.uid });
    setSelected(null, null);
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
    if (selectedUnit) {
      // Resalta las celdas vacias de tu zona: ahi se colocaria la unidad seleccionada.
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) {
          if (myState.you.board.some((u) => u.x === x && u.y === y)) continue;
          const row = 7 - y;
          ctx.fillStyle = 'rgba(255,210,63,0.18)';
          ctx.fillRect(x * CELL + 2, row * CELL + 2, CELL - 4, CELL - 4);
        }
      }
    }
    for (const unit of myState.you.board) {
      const col = unit.x;
      const row = 7 - unit.y;
      const isSelected = selectedUnit && selectedUnit.uid === unit.uid;
      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(col * CELL + CELL / 2, row * CELL + CELL / 2, CELL * 0.46, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      drawUnitAvatar(unit.pokemonId, unit.star, col * CELL + CELL / 2, row * CELL + CELL / 2, null, 0, null);
    }
  }

  // Dibuja el avatar de un personaje en el canvas: su retrato real si ya
  // esta cargado, o si no un "cartel de se busca" (circulo con el color de
  // su tripulacion e iniciales) mientras tanto. Capitanes llevan corona y
  // anillo dorado en ambos casos.
  function drawUnitAvatar(pokemonId, star, cx, cy, hpFrac, shieldFrac, sideColor, scale = 1) {
    const p = charDb[pokemonId];
    if (!p) return;
    const size = CELL * 0.82 * scale;
    const style = CREW_STYLE[p.crew] || { fill: '#26407a', ring: '#0e2140' };
    const img = p.portrait ? getPortraitImage(p.portrait) : null;
    const imgReady = !!(img && img.complete && img.naturalWidth);
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

    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    if (imgReady) {
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();
    } else {
      ctx.fillStyle = style.fill;
      ctx.fill();
    }
    ctx.lineWidth = p.captain ? 4 : 2;
    ctx.strokeStyle = p.captain ? '#ffd23f' : style.ring;
    ctx.stroke();

    if (!imgReady) {
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(size * 0.3)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.initials, cx, cy + 1);
      ctx.textBaseline = 'alphabetic';
    }

    if (p.captain) {
      ctx.font = `${Math.round(size * 0.36)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('👑', cx, cy - size * 0.38);
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
      drawUnitAvatar(u.pokemonId, u.star, cx, cy, u.hp / u.maxHp, u.shield > 0 ? u.shield / (u.maxShield || 1) : 0, u.side === 'A' ? 'rgba(90,255,140,1)' : 'rgba(255,90,90,1)');
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
