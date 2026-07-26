'use strict';

import { createScene } from './scene3d.js';
import { getThumb, getThumbSync } from './thumbs.js';

(() => {
  const socket = io();

  // ---------------- Estado global ----------------
  let charDb = {}; // id -> personaje
  let crewDb = {}; // crew slug -> {label icon desc}
  let boardCols = 5;
  let boardRows = 6;
  let rowsPerPlayer = 3;
  let mySide = null;
  let battleSide = null; // que lado ('A'/'B') soy en el combate que se reproduce
  let myState = null; // ultimo payload 'state'
  let scene = null;

  let battleActive = false;
  let battleUnits = new Map(); // uid -> estado de render
  let battleLog = [];
  let battleIdx = 0;
  let battleStartTs = 0;
  const TICK_MS = 150;

  // ---------------- Alto real de la pantalla ----------------
  // En moviles 100vh cuenta tambien la franja que tapa la barra del navegador,
  // asi que la pagina acaba siendo mas alta que lo visible y toca hacer scroll.
  // window.innerHeight si da el alto realmente visible: lo publicamos como
  // variable CSS y lo refrescamos cuando cambia (girar el movil, barra que
  // aparece o desaparece...).
  function syncAppHeight() {
    // Nos quedamos con la medida MAS pequena de todas las que da el navegador:
    // cada una miente de una forma distinta segun las barras que tenga puestas,
    // y quedarse corto solo deja un borde de fondo, mientras que pasarse deja
    // la tienda debajo de la barra del navegador y sin poder tocarla.
    const medidas = [window.innerHeight, document.documentElement.clientHeight];
    if (window.visualViewport) medidas.push(window.visualViewport.height);
    const h = Math.min(...medidas.filter((n) => n > 0));
    document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
    if (scene) {
      scene.resize();
      syncSceneInsets();
    }
    if (!tooltipHidden()) placeInfoPanel();
  }

  // Le dice a la escena cuanto ocupan el HUD y la barra inferior para que
  // encuadre la cubierta en el hueco libre y no quede tapada por la tienda.
  function syncSceneInsets() {
    if (!scene) return;
    const hud = document.querySelector('.hud');
    const bottom = document.querySelector('.bottom-ui');
    const top = hud ? hud.getBoundingClientRect().height : 0;
    const bot = bottom ? bottom.getBoundingClientRect().height : 0;
    scene.setInsets(top, bot);
  }
  function tooltipHidden() {
    const t = document.getElementById('tooltip');
    return !t || t.classList.contains('hidden');
  }
  syncAppHeight();
  window.addEventListener('resize', syncAppHeight);
  window.addEventListener('orientationchange', () => setTimeout(syncAppHeight, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncAppHeight);

  // ---------------- Utilidades UI ----------------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.body.classList.toggle('in-game', id === 'screen-game');
    if (id === 'screen-game') {
      syncAppHeight();
      if (scene) setTimeout(() => scene.resize(), 30);
      // Las barras del navegador movil tardan un poco en asentarse al entrar a
      // pantalla completa: volvemos a medir para no quedarnos con un valor viejo.
      setTimeout(syncAppHeight, 300);
      setTimeout(syncAppHeight, 1200);
    }
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
    return { col: x, row: battleSide === 'B' ? boardRows - 1 - y : y };
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
        renderWiki();
        if (myState) { renderShop(myState.you); renderBench(myState.you); refreshBoard(); }
      })
      .catch((err) => {
        console.error('No se pudieron cargar los datos de personajes, reintentando...', err);
        if (attempt <= 5) setTimeout(() => loadCharDb(attempt + 1), 1000 * attempt);
      });
  }
  loadCharDb();

  // Icono de una tripulacion: su Jolly Roger si esta subido, y si no el emoji
  function crewIcon(slug) {
    const def = crewDb[slug];
    if (!def) return '';
    return def.flag
      ? `<img class="crew-flag" src="${def.flag}" alt="" loading="lazy">`
      : (def.icon || '');
  }

  document.getElementById('btn-wiki').addEventListener('click', () => show('screen-wiki'));
  document.getElementById('btn-wiki-back').addEventListener('click', () => show('screen-menu'));
  document.getElementById('btn-rankings').addEventListener('click', () => {
    show('screen-rankings');
    cargarRankings();
  });
  document.getElementById('btn-rankings-back').addEventListener('click', () => show('screen-menu'));

  // ---------------- Ránkings ----------------
  // Marcador publico de victorias. La identidad es el nombre de pirata, sin
  // cuentas: se pide al servidor cada vez que se abre la pantalla.
  function cargarRankings() {
    const wrap = document.getElementById('rankings-list');
    wrap.innerHTML = '<div class="rank-empty">Cargando...</div>';
    fetch('api/rankings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const lista = (d && d.players) || [];
        wrap.innerHTML = '';
        if (!lista.length) {
          wrap.appendChild(el('div', 'rank-empty',
            'Todavía no hay partidas registradas. ¡Gana una y estrena la tabla!'));
          return;
        }
        const yo = (nameInput.value || '').trim();
        const medallas = { 1: '🥇', 2: '🥈', 3: '🥉' };
        for (const j of lista) {
          const fila = el('div', `rank-row${j.rank <= 3 ? ` top${j.rank}` : ''}${j.name === yo ? ' me' : ''}`);
          fila.appendChild(el('div', 'rank-pos', medallas[j.rank] || `${j.rank}º`));
          // textContent, que el nombre lo escribe el jugador
          const nombre = el('div', 'rank-name');
          nombre.textContent = j.name;
          fila.appendChild(nombre);
          fila.appendChild(el('div', 'rank-wins', `${j.wins} 🏆`));
          fila.appendChild(el('div', 'rank-games', `${j.games} partida${j.games === 1 ? '' : 's'}`));
          wrap.appendChild(fila);
        }
      })
      .catch(() => {
        wrap.innerHTML = '';
        wrap.appendChild(el('div', 'rank-empty', 'No se pudo cargar el ranking.'));
      });
  }

  // ---------------- Wiki Pirata (pantalla de inicio) ----------------
  // Una fila por tripulacion; al abrirla se ven sus niveles de combo y la ficha
  // de sus cinco personajes, con su retrato y su habilidad.
  function renderWiki() {
    const wrap = document.getElementById('wiki-crews');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const [slug, def] of Object.entries(crewDb)) {
      const bloque = el('div', 'wiki-crew');

      const cabecera = el('button', 'wiki-crew-head');
      cabecera.innerHTML = `<span class="wc-icon">${crewIcon(slug)}</span>
        <span class="wc-name">${def.label}</span>
        <span class="wc-open">▾</span>`;
      bloque.appendChild(cabecera);

      const cuerpo = el('div', 'wiki-crew-body');
      bloque.appendChild(cuerpo);

      // El contenido se monta la primera vez que se abre: los retratos salen de
      // los modelos 3D y no tiene sentido descargar los 40 al abrir la pagina.
      let montado = false;
      const montar = () => {
        if (montado) return;
        montado = true;
        cuerpo.appendChild(el('p', 'wiki-desc', def.desc || ''));

        const niveles = el('div', 'wiki-tiers');
        for (const t of def.tiers || []) {
          niveles.appendChild(el('div', 'tt-tier', `<b>${t.n}</b> <span>${t.text}</span>`));
        }
        cuerpo.appendChild(niveles);

        const fichas = el('div', 'wiki-members');
        for (const m of def.members || []) {
          const p = charDb[m.id];
          if (!p) continue;
          const ficha = el('div', `wiki-card uc-crew-${slug}${p.captain ? ' captain' : ''}`);
          const cabeza = el('div', 'wiki-card-head');
          cabeza.appendChild(makeAvatarEl(p));
          const titulo = el('div', 'wiki-card-title');
          titulo.appendChild(el('div', 'wiki-card-name', `${p.captain ? '👑 ' : ''}${p.name}`));
          titulo.appendChild(el('div', 'wiki-card-cost', `${p.cost} 🪙`));
          cabeza.appendChild(titulo);
          ficha.appendChild(cabeza);
          ficha.appendChild(el('div', 'wiki-card-stats',
            `❤️ ${p.hp} &nbsp; ⚔️ ${p.atk} &nbsp; 🛡️ ${p.def} &nbsp; 🎯 ${p.range}`));
          if (p.ability) {
            ficha.appendChild(el('div', 'wiki-card-ability',
              `<b>⚡ ${p.ability.name}</b> <span class="tt-mana">${p.ability.mana} maná</span>
               <div class="wiki-card-desc">${p.ability.desc}</div>`));
          }
          fichas.appendChild(ficha);
        }
        cuerpo.appendChild(fichas);
      };

      cabecera.addEventListener('click', () => {
        montar();
        bloque.classList.toggle('open');
      });
      wrap.appendChild(bloque);
    }
  }

  // ---------------- Menu ----------------
  const nameInput = document.getElementById('input-name');
  nameInput.value = localStorage.getItem('pcr-name') || '';

  let searchingOnline = false;
  let searchingName = null;
  let modoElegido = localStorage.getItem('pcr-mode') === '4p' ? '4p' : '1v1';

  function pintarModo() {
    document.querySelectorAll('.mode-opt').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === modoElegido);
    });
  }
  document.querySelectorAll('.mode-opt').forEach((b) => {
    b.addEventListener('click', () => {
      modoElegido = b.dataset.mode;
      localStorage.setItem('pcr-mode', modoElegido);
      pintarModo();
    });
  });
  pintarModo();

  document.getElementById('btn-play-online').addEventListener('click', () => {
    const name = (nameInput.value || 'Pirata').trim().slice(0, 16);
    localStorage.setItem('pcr-name', name);
    searchingOnline = true;
    searchingName = name;
    socket.emit('findMatch', { name, mode: modoElegido });
    document.getElementById('queue-status').classList.remove('hidden');
    document.getElementById('btn-fill-bots').classList.add('hidden');
  });

  document.getElementById('btn-cancel-queue').addEventListener('click', () => {
    searchingOnline = false;
    socket.emit('cancelFindMatch');
    document.getElementById('queue-status').classList.add('hidden');
    document.getElementById('btn-fill-bots').classList.add('hidden');
  });

  document.getElementById('btn-play-ai').addEventListener('click', () => {
    const name = (nameInput.value || 'Pirata').trim().slice(0, 16);
    localStorage.setItem('pcr-name', name);
    socket.emit('playAI', { name, mode: modoElegido });
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    location.reload();
  });

  const btnBots = document.getElementById('btn-fill-bots');
  socket.on('queued', ({ waiting, needed, mode } = {}) => {
    const t = document.getElementById('queue-text');
    if (t && needed) t.textContent = `Buscando piratas... ${waiting}/${needed}`;
    // En 4 piratas, si ya sois dos o mas podeis empezar rellenando con bots
    if (btnBots) {
      const puede = mode === '4p' && waiting >= 2 && waiting < needed;
      btnBots.classList.toggle('hidden', !puede);
      if (puede) btnBots.textContent = `▶️ Empezar ${waiting} + ${needed - waiting} bots`;
    }
  });
  if (btnBots) {
    btnBots.addEventListener('click', () => socket.emit('fillWithBots'));
  }

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
      socket.emit('findMatch', { name: searchingName, mode: modoElegido });
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
    document.getElementById('end-title').textContent = draw ? 'Empate' : won ? 'Victoria' : 'Derrota';
    document.getElementById('end-subtitle').textContent = '';
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
    window.__estadoTest = payload; // ultimo estado recibido, para las pruebas
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
    // Ya no hay "nivel": lo que se indica es cuantas tropas caben en cubierta,
    // en plan "3/4" = tres colocadas de las cuatro que puedes llevar.
    const cupo = document.getElementById('hud-my-level');
    cupo.textContent = `${payload.you.board.length}/${payload.you.maxTeam}`;
    cupo.classList.toggle('lleno', payload.you.board.length >= payload.you.maxTeam);
    const rival = payload.opponent;
    document.getElementById('hud-opp-name').textContent = rival ? rival.name : 'Descansas';
    document.getElementById('hud-opp-hp').textContent = rival ? rival.hp : '-';
    document.getElementById('hud-opp-level').textContent = rival ? rival.maxTeam : '-';
    renderTable(payload.table, payload.mode);

    renderShop(payload.you);
    renderBench(payload.you);
    renderSynergies(payload.you.synergies);
    // el alto de la barra inferior cambia al llenarse la tienda o el banquillo
    syncSceneInsets();

    // Los personajes que tienes delante (tienda, banquillo y cubierta) se
    // adelantan en la cola de descarga de modelos.
    if (scene) {
      const aMano = [
        ...payload.you.shop,
        ...payload.you.bench.filter(Boolean).map((u) => u.pokemonId),
        ...payload.you.board.map((u) => u.pokemonId),
      ].map((id) => charDb[id]).filter(Boolean);
      scene.warmModels(aMano);
    }

    const banner = document.getElementById('battle-banner');
    if (payload.phase === 'result' && payload.lastRoundInfo) {
      const info = payload.lastRoundInfo;
      const rival = info.opponentName ? ` (${info.opponentName})` : '';
      if (info.result === 'draw') banner.textContent = 'Empate en el combate. Nadie recibe daño.';
      else if (info.result === 'bye') banner.textContent = 'Ronda de descanso: esta vez no peleabas.';
      else if (info.result === 'win') banner.textContent = `¡Ganaste el combate${rival}! Pierde ${info.damage} de vida.`;
      else banner.textContent = `Perdiste el combate${rival}. Pierdes ${info.damage} de vida.`;
      banner.classList.remove('hidden');
    } else if (payload.phase === 'prep') {
      banner.classList.add('hidden');
    }

    if (!battleActive) refreshBoard();
  }

  // Marcador de la sala: en 4 jugadores se ve quien sigue vivo y con cuanta
  // vida, con tu fila y la de tu rival de esta ronda marcadas.
  function renderTable(mesa, modo) {
    const wrap = document.getElementById('table-standings');
    if (!wrap) return;
    if (!mesa || modo !== '4p') { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = '';
    for (const j of mesa) {
      const fila = el('div', `ts-row${j.you ? ' me' : ''}${j.opponent ? ' rival' : ''}${j.alive ? '' : ' dead'}`);
      fila.innerHTML = `<span class="ts-name">${j.you ? '➤ ' : ''}${j.name}</span>
        <span class="ts-hp">${j.alive ? `❤️ ${j.hp}` : '☠️'}</span>`;
      wrap.appendChild(fila);
    }
  }

  socket.on('tick', ({ timeLeft }) => {
    document.getElementById('hud-timer').textContent = Math.max(0, Math.ceil(timeLeft / 1000));
  });

  // ---------------- Avatares 2D (tienda / banquillo) ----------------
  function pintarRetrato(avatar, url) {
    avatar.textContent = '';
    avatar.classList.add('unit-avatar-img');
    const img = el('img');
    img.src = url;
    img.alt = '';
    avatar.appendChild(img);
  }

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
    // Sin imagen 2D pero con modelo 3D: usamos un retrato sacado del modelo,
    // que es lo que hace reconocible la tarjeta de un vistazo. Mientras llega
    // (o si el personaje no tiene modelo todavia) se ven sus iniciales.
    const avatar = el('div', 'unit-avatar', p.initials);
    if (p.captain) avatar.classList.add('captain');
    const yaHecho = getThumbSync(p);
    if (yaHecho) pintarRetrato(avatar, yaHecho);
    else getThumb(p).then((url) => { if (url) pintarRetrato(avatar, url); });
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
      // Se puede comprar tambien durante el combate: lo que compres espera en
      // el banquillo y entra en la ronda siguiente.
      const affordable = you.gold >= p.cost && you.bench.some((s) => s === null)
        && myState.phase !== 'gameover';
      const card = el('div', `unit-card uc-crew-${p.crew}${p.captain ? ' captain' : ''}${affordable ? '' : ' locked'}`);
      card.appendChild(el('div', 'uc-cost', p.cost));
      if (p.captain) card.appendChild(el('div', 'captain-badge', '👑'));
      card.appendChild(makeAvatarEl(p));
      card.appendChild(el('div', 'uc-name', p.name));
      card.addEventListener('click', () => {
        if (!affordable) return;
        socket.emit('buyUnit', { slot: idx });
      });
      // Sin tooltip en la tienda a proposito: al aparecer tapaba las cartas de
      // al lado y estorbaba justo cuando estas eligiendo que comprar.
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
      row.appendChild(el('div', 'syn-icon', crewIcon(s.type)));
      const info = el('div', 'syn-info');
      info.appendChild(el('div', '', `<b>${s.label}</b>`));
      const tierLabel = s.tier === 5 ? ' · ¡TRIPULACIÓN COMPLETA!' : s.tier ? ` · nivel ${s.tier === 4 ? 'II' : 'I'}` : '';
      info.appendChild(el('div', 'syn-count', `${s.count}/5${tierLabel}`));
      row.appendChild(info);
      // Tocar la tripulacion enseña que consigues si la completas
      row.addEventListener('click', () => {
        const yaAbierta = row.classList.contains('open');
        setSelected(null);
        if (yaAbierta) { hideTooltip(); return; }
        document.querySelectorAll('.syn-row').forEach((r) => r.classList.remove('open'));
        row.classList.add('open');
        showInfo(crewInfoHtml(s.type, s.count));
      });
      wrap.appendChild(row);
    }
  }

  // ---------------- Panel de informacion ----------------
  // Un unico panel que se ancla sobre el tablero (zona vacia) en vez de seguir
  // al cursor: asi funciona igual con raton y con el dedo, y nunca tapa la
  // tienda ni el banquillo mientras juegas.
  const tooltip = document.getElementById('tooltip');

  // Lo que devuelve venderla: lo que costaron todas las copias que lleva
  // dentro (2 por cada estrella de mas), menos una moneda.
  function sellPrice(cost, star) {
    return Math.max(0, cost * Math.pow(2, Math.max(1, star || 1) - 1) - 1);
  }

  function unitInfoHtml(p, star) {
    return `<h4>${p.captain ? '👑 ' : ''}${p.name} ${star ? '⭐'.repeat(star) : ''}</h4>
      <div class="row"><span>Tripulación</span><span>${crewIcon(p.crew)} ${crewDb[p.crew]?.label || p.crew}</span></div>
      <div class="row"><span>Coste</span><span>${p.cost} 🪙</span></div>
      ${star ? `<div class="row"><span>Se vende por</span><span>${sellPrice(p.cost, star)} 🪙</span></div>` : ''}
      <div class="row"><span>Vida</span><span>${p.hp}</span></div>
      <div class="row"><span>Ataque</span><span>${p.atk}</span></div>
      <div class="row"><span>Defensa</span><span>${p.def}</span></div>
      <div class="row"><span>Alcance</span><span>${p.range}</span></div>
      ${p.ability ? `<div class="tt-ability">
        <div class="tt-ability-name">⚡ ${p.ability.name} <span class="tt-mana">${p.ability.mana} maná</span></div>
        <div class="tt-ability-desc">${p.ability.desc}</div>
      </div>` : ''}`;
  }

  // Lo que consigues llevando esta tripulacion: niveles y habilidades
  function crewInfoHtml(slug, count) {
    const crew = crewDb[slug];
    if (!crew) return '';
    const tiers = (crew.tiers || []).map((t) => {
      const alcanzado = count >= t.n;
      return `<div class="tt-tier${alcanzado ? ' reached' : ''}">
        <b>${t.n}</b> <span>${t.text}</span>
      </div>`;
    }).join('');
    const miembros = (crew.members || []).map((m) => `
      <div class="tt-member">
        <div class="tt-member-name">${m.captain ? '👑 ' : ''}${m.name} <span class="tt-cost">${m.cost}🪙</span></div>
        ${m.ability ? `<div class="tt-member-ability">⚡ ${m.ability.name} — ${m.ability.desc}</div>` : ''}
      </div>`).join('');
    return `<h4>${crewIcon(slug)} ${crew.label} <span class="tt-count">${count}/5</span></h4>
      <div class="tt-tiers">${tiers}</div>
      <div class="tt-members-title">Habilidades de la tripulación</div>
      <div class="tt-members">${miembros}</div>`;
  }

  function showInfo(html) {
    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');
    placeInfoPanel();
  }

  // Lo colocamos en el hueco libre entre el HUD y la barra inferior,
  // pegado a la derecha para no tapar la lista de tripulaciones.
  function placeInfoPanel() {
    const hud = document.querySelector('.hud');
    const bottom = document.querySelector('.bottom-ui');
    const top = hud ? hud.getBoundingClientRect().height : 0;
    const bot = bottom ? bottom.getBoundingClientRect().height : 0;
    const r = tooltip.getBoundingClientRect();
    const pad = 8;
    const maxTop = window.innerHeight - bot - r.height - pad;
    const x = Math.max(pad, window.innerWidth - r.width - pad);
    const y = Math.max(pad, Math.min(top + pad, Math.max(pad, maxTop)));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    tooltip.classList.add('hidden');
    document.querySelectorAll('.syn-row').forEach((r) => r.classList.remove('open'));
  }

  // Tocar el propio panel lo cierra (en movil es lo que uno espera)
  tooltip.addEventListener('click', hideTooltip);

  // ---------------- Seleccionar y colocar ----------------
  // En 3D el arrastre no aporta nada (y va mal en movil): se juega tocando la
  // ficha y despues la casilla destino.
  let selectedUnit = null; // { uid, origin }

  function toggleSelect(uid, origin) {
    if (!myState || myState.phase !== 'prep' || battleActive) return;
    if (selectedUnit && selectedUnit.uid === uid) setSelected(null);
    else setSelected({ uid, origin });
  }

  function findMyUnit(uid) {
    if (!myState) return null;
    return myState.you.bench.find((u) => u && u.uid === uid)
        || myState.you.board.find((u) => u.uid === uid) || null;
  }

  function setSelected(sel) {
    selectedUnit = sel;
    document.querySelectorAll('.bench-unit').forEach((elm) => {
      elm.classList.toggle('selected', !!selectedUnit && elm.dataset.uid === selectedUnit.uid);
    });
    document.querySelectorAll('.syn-row').forEach((r) => r.classList.remove('open'));
    // Al seleccionar una ficha (del banquillo o del tablero) mostramos su info,
    // y la papelera pasa a decir por cuanto se vende.
    const papelera = document.getElementById('sell-zone');
    if (selectedUnit) {
      const unit = findMyUnit(selectedUnit.uid);
      const ch = unit && charDb[unit.pokemonId];
      if (ch) {
        showInfo(unitInfoHtml(ch, unit.star));
        const precio = sellPrice(ch.cost, unit.star);
        papelera.innerHTML = `🗑️ <b>${precio}</b>🪙`;
        papelera.title = `Vender ${ch.name} por ${precio} 🪙`;
      } else hideTooltip();
    } else {
      papelera.innerHTML = '🗑️';
      papelera.title = 'Vender la ficha seleccionada';
      hideTooltip();
    }
    refreshBoard();
  }

  // Casillas libres de tu mitad, resaltadas al tener una ficha seleccionada
  function highlightCells() {
    if (!selectedUnit || !myState) return [];
    // Con el cupo de tropas lleno ya no se puede meter otra desde el banquillo:
    // lo unico que queda es cambiarla por una de las que ya estan, asi que se
    // resaltan esas en vez de los huecos vacios.
    const lleno = selectedUnit.origin === 'bench'
      && myState.you.board.length >= myState.you.maxTeam;
    const out = [];
    for (let y = 0; y < rowsPerPlayer; y++) {
      for (let x = 0; x < boardCols; x++) {
        const ocupada = myState.you.board.some((u) => u.x === x && u.y === y);
        if (ocupada !== lleno) continue;
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
        mine: true,
        selected: !!selectedUnit && selectedUnit.uid === u.uid,
        showHp: false,
      });
    }
    scene.syncUnits(units);
    scene.setHighlights(highlightCells());
  }

  // ---------------- Animacion de combate ----------------
  socket.on('battleStart', ({ log, youAre, opponentName }) => {
    battleSide = youAre || mySide;
    if (opponentName) document.getElementById('hud-opp-name').textContent = opponentName;
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

  // En 4 jugadores, si el numero de vivos es impar uno descansa esa ronda
  socket.on('roundBye', () => {
    const banner = document.getElementById('battle-banner');
    banner.textContent = 'Esta ronda descansas: no te toca rival.';
    banner.classList.remove('hidden');
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
          scene.addFloatingText(p.col, p.row, e.name, '#ffd23f', true);
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
        // Los modelos miran siempre al bando contrario, no hacia donde caminan:
        // si se orientase por la fila, al avanzar a la mitad rival se darian
        // media vuelta en mitad del combate.
        mine: u.side === battleSide,
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
      // Nos traemos los modelos 3D en segundo plano nada mas entrar, para que
      // ninguna ficha tarde en aparecer cuando la compres.
      scene.preloadModels();
      syncSceneInsets();
      // Utilidad para las pruebas automaticas: comprobar que casilla cae bajo
      // un punto de la pantalla (sirve para verificar que el tablero entero
      // queda visible y no debajo de la interfaz).
      window.__pickCellForTest = (x, y) => scene.pickCell(x, y);
      window.__sceneForTest = scene;
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
