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
  // Cuanto se queda en pantalla una ficha muerta. Tiene que dar para que se
  // vea la caida entera (scene3d la ajusta a 1,5 s) antes de desvanecerse.
  const MUERTE_MS = 1800;
  // Parte del hueco entre ataques que ocupa el golpe. El mismo numero que usa
  // scene3d para estirar o encoger la animacion: si se tocan, se tocan los dos.
  const PARTE_GOLPE = 0.7;
  // Respiro al acabar el combate: los caidos terminan de desvanecerse y los que
  // quedan en pie se quedan en reposo un rato antes de volver a preparacion.
  // La sala da 6 s de fase de resultado (RESULT_MS en server/GameRoom.js), asi
  // que esto tiene que quedarse por debajo.
  const DESCANSO_MS = 5000;

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
    encajarMenu();
    if (!tooltipHidden()) placeInfoPanel();
  }

  // ---------------- Encaje de las pantallas ilustradas ----------------
  // El inicio y la wiki son una ilustracion con los controles de verdad puestos
  // encima, todo en pixeles del dibujo. Aqui solo se decide a que tamano y en
  // que sitio se ve: se llena la pantalla, pero sin pasarse de lo que dejaria
  // fuera el titulo o el ultimo boton.
  // cx/cy y ancho/alto son el trozo que SI o SI tiene que verse entero.
  const LIENZOS = {
    'menu-lienzo': { w: 1024, h: 1536, cx: 537, cy: 765, ancho: 725, alto: 1420 },
    'wiki-lienzo': { w: 1024, h: 1536, cx: 521, cy: 697, ancho: 972, alto: 1365 },
    'login-lienzo': { w: 1024, h: 1536, cx: 512, cy: 730, ancho: 700, alto: 1220 },
    'perfil-lienzo': { w: 1024, h: 1536, cx: 512, cy: 730, ancho: 700, alto: 1220 },
    'rank-lienzo': { w: 1024, h: 1536, cx: 512, cy: 775, ancho: 800, alto: 1380 },
  };
  function encajarLienzo(id) {
    const lienzo = document.getElementById(id);
    const arte = LIENZOS[id];
    if (!lienzo || !arte) return;
    const w = window.innerWidth;
    const medidas = [window.innerHeight, document.documentElement.clientHeight];
    if (window.visualViewport) medidas.push(window.visualViewport.height);
    const h = Math.min(...medidas.filter((n) => n > 0));

    const escala = Math.min(
      Math.max(w / arte.w, h / arte.h),
      w / arte.ancho,
      h / arte.alto,
    );
    const dw = arte.w * escala;
    const dh = arte.h * escala;
    let ox = w / 2 - arte.cx * escala;
    let oy = h / 2 - arte.cy * escala;
    // si el dibujo da de sobra, que no asome el fondo por los bordes
    if (dw > w) ox = Math.min(0, Math.max(w - dw, ox));
    if (dh > h) oy = Math.min(0, Math.max(h - dh, oy));
    lienzo.style.transform = `translate(${Math.round(ox)}px, ${Math.round(oy)}px) scale(${escala})`;
    // hasta aqui el lienzo esta oculto: el HTML se pinta antes de que corra
    // este modulo (va diferido) y si no se veia un fogonazo a tamano real
    lienzo.classList.add('encajado');
  }
  function encajarMenu() {
    for (const id of Object.keys(LIENZOS)) encajarLienzo(id);
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
        pintarIconosPerfil();
        pintarCuentaEnMenu();
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
  // Tabla de jugadores con cuenta, ordenados por puntos. Las divisiones y la
  // cabecera vienen pintadas en la ilustracion: aqui solo se dibujan las filas
  // encima de las de ejemplo.
  // Cara redonda de un jugador: su carta de personaje si eligio una, y si no
  // la inicial de su nombre.
  function caraJugador(j) {
    const cara = el('div', 'r-cara');
    const carta = j.icon && charDb[j.icon] && charDb[j.icon].card;
    if (carta) {
      const img = new Image();
      img.src = carta;
      img.alt = '';
      img.loading = 'lazy';
      cara.appendChild(img);
    } else {
      cara.textContent = (j.name || '?').charAt(0).toUpperCase();
    }
    return cara;
  }

  // 4250 -> "4.250"
  function conMiles(n) {
    return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function filaRanking(j, esMio) {
    const fila = el('div', `r-fila${esMio ? ' yo' : ''}`);
    const chapas = { 1: 'oro', 2: 'plata', 3: 'bronce' };
    const chapa = chapas[j.rank];
    fila.appendChild(chapa
      ? el('div', `r-pos medalla ${chapa}`, `<span>${j.rank}</span>`)
      : el('div', 'r-pos', j.rank ? String(j.rank) : '—'));
    fila.appendChild(caraJugador(j));
    // textContent: el nombre lo escribe el jugador
    const nombre = el('div', 'r-nombre');
    nombre.textContent = j.name;
    fila.appendChild(nombre);
    const div = el('div', 'r-div');
    div.textContent = (j.division && j.division.label ? j.division.label : '').toUpperCase();
    if (j.division && j.division.color) div.style.background = j.division.color;
    fila.appendChild(div);
    fila.appendChild(el('div', 'r-pts', conMiles(j.points)));
    return fila;
  }

  function cargarRankings() {
    const wrap = document.getElementById('rankings-list');
    wrap.innerHTML = '';
    wrap.appendChild(el('div', 'r-vacio', 'Cargando la lista de piratas...'));
    fetch('api/rankings', { headers: cabeceras() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const lista = (d && d.players) || [];
        wrap.innerHTML = '';
        if (!lista.length) {
          wrap.appendChild(el('div', 'r-vacio',
            'Todavía no hay piratas en la tabla.<br>Inicia sesión, gana una partida y estrénala tú.'));
          return;
        }
        const mio = cuenta && cuenta.id;
        for (const j of lista) wrap.appendChild(filaRanking(j, j.id === mio));
        // si el que mira no entra en el top, se le pone al final para que vea
        // sus puntos igualmente
        if (d.me && !lista.some((j) => j.id === d.me.id)) {
          wrap.appendChild(filaRanking(d.me, true));
        }
      })
      .catch(() => {
        wrap.innerHTML = '';
        wrap.appendChild(el('div', 'r-vacio', 'No se pudo cargar el ranking.'));
      });
  }

  // ---------------- Wiki Pirata ----------------
  // Dos columnas, como en la ilustracion: la lista de tripulaciones a la
  // izquierda y, al tocar una, su combo y sus cinco fichas a la derecha.
  let wikiElegida = null;

  function renderWiki() {
    const lista = document.getElementById('wiki-crews');
    if (!lista) return;
    lista.innerHTML = '';
    const slugs = Object.keys(crewDb);
    for (const slug of slugs) {
      const def = crewDb[slug];
      const fila = el('button', 'w-fila');
      fila.appendChild(el('span', 'w-emblema', crewIcon(slug)));
      fila.appendChild(el('span', 'w-fila-nombre', def.label));
      fila.appendChild(el('span', 'w-flecha', '▾'));
      fila.dataset.crew = slug;
      fila.addEventListener('click', () => pintarDetalleWiki(slug));
      lista.appendChild(fila);
    }
    pintarDetalleWiki(wikiElegida && crewDb[wikiElegida] ? wikiElegida : slugs[0]);
  }

  function pintarDetalleWiki(slug) {
    const def = crewDb[slug];
    const wrap = document.getElementById('wiki-detalle');
    if (!def || !wrap) return;
    wikiElegida = slug;
    document.querySelectorAll('.w-fila').forEach((f) => {
      f.classList.toggle('activa', f.dataset.crew === slug);
    });

    wrap.innerHTML = '';
    wrap.scrollTop = 0;

    const titulo = el('div', 'w-titulo');
    titulo.appendChild(el('span', 'w-emblema', crewIcon(slug)));
    titulo.appendChild(el('span', '', def.label));
    wrap.appendChild(titulo);

    const pergamino = el('div', 'w-pergamino');
    pergamino.appendChild(el('p', '', def.desc || ''));
    for (const t of def.tiers || []) {
      const nivel = el('div', 'w-nivel');
      nivel.appendChild(el('span', 'w-nivel-n', `👥 ${t.n} miembros`));
      nivel.appendChild(el('span', 'w-nivel-b', t.text));
      pergamino.appendChild(nivel);
    }
    wrap.appendChild(pergamino);

    wrap.appendChild(el('div', 'w-separador', '· Miembros de la tripulación ·'));

    for (const m of def.members || []) {
      const p = charDb[m.id];
      if (!p) continue;
      const ficha = el('div', `w-miembro${p.captain ? ' captain' : ''}`);
      const retrato = el('div', 'w-retrato');
      retrato.appendChild(makeAvatarEl(p));
      ficha.appendChild(retrato);

      const datos = el('div', 'w-datos');
      const nombre = el('div', 'w-nombre');
      nombre.appendChild(el('span', '', `${p.captain ? '👑 ' : ''}${p.name}`));
      nombre.appendChild(el('span', 'w-coste', `🪙 ${p.cost}`));
      datos.appendChild(nombre);
      datos.appendChild(el('div', 'w-stats',
        `<span>❤️ ${p.hp}</span><span>⚔️ ${p.atk}</span><span>🛡️ ${p.def}</span><span>🎯 ${p.range}</span>`));
      if (p.ability) {
        const hab = el('div', 'w-hab');
        hab.appendChild(el('div', 'w-hab-cab',
          `<b>⚡ ${p.ability.name}</b><span>${p.ability.mana} maná</span>`));
        hab.appendChild(el('div', 'w-hab-desc', p.ability.desc));
        datos.appendChild(hab);
      }
      ficha.appendChild(datos);
      wrap.appendChild(ficha);
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

  // ---------------- Cuenta de jugador ----------------
  // Se entra con Google y la cuenta guarda el nombre de pirata, el icono y los
  // puntos de ranking (+20 por ganar, -15 por perder). Tambien se puede jugar
  // sin cuenta: entonces no se puntua y el nombre lo pone uno a mano.
  let config = null;
  let cuenta = null;
  let authToken = localStorage.getItem('nr-token') || '';
  let iconoElegido = null;

  function cabeceras(extra) {
    const h = extra ? { ...extra } : {};
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
  }
  function guardarToken(t) {
    authToken = t || '';
    if (authToken) localStorage.setItem('nr-token', authToken);
    else localStorage.removeItem('nr-token');
    socket.emit('auth', { token: authToken });
  }

  // Carta que se usa como cara del jugador
  function iconoUrl(id) {
    return (id && charDb[id] && charDb[id].card) || '';
  }

  function pintarCuentaEnMenu() {
    const img = document.getElementById('menu-icono');
    const salir = document.getElementById('btn-logout');
    if (!img || !salir) return;
    if (cuenta && cuenta.name) {
      // con cuenta el nombre manda el servidor, asi que aqui solo se enseña
      nameInput.value = cuenta.name;
      nameInput.readOnly = true;
      salir.classList.remove('hidden');
      const url = iconoUrl(cuenta.icon);
      if (url) { img.src = url; img.classList.remove('hidden'); } else img.classList.add('hidden');
    } else {
      nameInput.readOnly = false;
      salir.classList.add('hidden');
      img.classList.add('hidden');
    }
  }

  // A donde va cada uno segun como esté su cuenta
  function aplicarCuenta(u) {
    cuenta = u || null;
    if (cuenta && cuenta.needsProfile) { abrirPerfil(); return; }
    pintarCuentaEnMenu();
    show('screen-menu');
  }

  function avisoLogin(txt) {
    const aviso = document.getElementById('login-aviso');
    aviso.textContent = txt;
    aviso.classList.remove('hidden');
    document.getElementById('google-btn-box').classList.add('hidden');
  }

  // El script de Google se carga aparte y puede tardar (o no llegar, si la red
  // lo bloquea): se espera un poco y, si no aparece, se avisa y queda la
  // entrada sin cuenta.
  function conGsi(fn, intentos = 40) {
    if (window.google && window.google.accounts && window.google.accounts.id) { fn(); return; }
    if (intentos <= 0) { avisoLogin('No se pudo cargar el inicio de sesión de Google. Puedes entrar sin cuenta.'); return; }
    setTimeout(() => conGsi(fn, intentos - 1), 250);
  }

  function montarGoogle() {
    if (!config || !config.googleEnabled) {
      avisoLogin('El inicio de sesión con Google todavía no está configurado en el servidor. Puedes entrar sin cuenta.');
      return;
    }
    conGsi(() => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: entrarConGoogle,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.renderButton(document.getElementById('google-btn'), {
        type: 'standard', theme: 'filled_blue', size: 'large',
        text: 'signin_with', shape: 'rectangular', locale: 'es', width: 400,
      });
    });
  }

  function entrarConGoogle(resp) {
    fetch('api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp && resp.credential }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d && d.error);
        guardarToken(d.token);
        aplicarCuenta(d.user);
      })
      .catch((e) => avisoLogin(e.message || 'No se pudo iniciar sesión. Inténtalo otra vez.'));
  }

  document.getElementById('btn-login-guest').addEventListener('click', () => {
    guardarToken('');
    cuenta = null;
    nameInput.value = localStorage.getItem('pcr-name') || '';
    pintarCuentaEnMenu();
    show('screen-menu');
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    fetch('api/logout', { method: 'POST', headers: cabeceras() }).catch(() => {});
    guardarToken('');
    cuenta = null;
    nameInput.value = '';
    pintarCuentaEnMenu();
    show('screen-login');
  });

  // ---------------- Ficha de pirata (nombre e icono) ----------------
  const perfilNombre = document.getElementById('input-perfil-name');
  const perfilError = document.getElementById('perfil-error');
  const perfilOk = document.getElementById('btn-perfil-ok');

  function abrirPerfil() {
    show('screen-perfil');
    perfilError.classList.add('hidden');
    perfilOk.disabled = false;
    perfilNombre.value = (cuenta && cuenta.name) || '';
    if (cuenta && cuenta.icon) iconoElegido = cuenta.icon;
    pintarIconosPerfil();
  }

  function pintarIconosPerfil() {
    const wrap = document.getElementById('perfil-iconos');
    if (!wrap) return;
    const lista = Object.values(charDb).filter((c) => c.card);
    if (!lista.length) {
      wrap.innerHTML = '';
      wrap.appendChild(el('div', 'r-vacio', 'Cargando piratas...'));
      return;
    }
    if (!iconoElegido || !charDb[iconoElegido]) iconoElegido = lista[0].id;
    wrap.innerHTML = '';
    for (const c of lista) {
      const b = el('button', `p-icono${c.id === iconoElegido ? ' sel' : ''}`);
      b.type = 'button';
      b.title = c.name;
      const img = new Image();
      img.src = c.card;
      img.alt = c.name;
      img.loading = 'lazy';
      b.appendChild(img);
      b.addEventListener('click', () => { iconoElegido = c.id; pintarIconosPerfil(); });
      wrap.appendChild(b);
    }
  }

  perfilOk.addEventListener('click', () => {
    const nombre = (perfilNombre.value || '').trim();
    if (nombre.length < 2) {
      perfilError.textContent = 'Escribe un nombre de al menos 2 letras.';
      perfilError.classList.remove('hidden');
      return;
    }
    perfilError.classList.add('hidden');
    perfilOk.disabled = true;
    fetch('api/profile', {
      method: 'POST',
      headers: cabeceras({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: nombre, icon: iconoElegido }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        perfilOk.disabled = false;
        if (!ok) {
          perfilError.textContent = (d && d.error) || 'No se pudo guardar.';
          perfilError.classList.remove('hidden');
          return;
        }
        cuenta = d.user;
        pintarCuentaEnMenu();
        show('screen-menu');
      })
      .catch(() => {
        perfilOk.disabled = false;
        perfilError.textContent = 'No se pudo guardar. Revisa la conexión.';
        perfilError.classList.remove('hidden');
      });
  });

  // Arranque: se mira si ya habia una sesion guardada y se decide que pantalla
  // toca (login, elegir nombre, o directamente el menu).
  function arrancarSesion() {
    fetch('api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { config = c; montarGoogle(); })
      .catch(() => avisoLogin('No se pudo hablar con el servidor. Puedes entrar sin cuenta.'));

    if (!authToken) { show('screen-login'); return; }
    socket.emit('auth', { token: authToken });
    fetch('api/me', { headers: cabeceras() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !d.user) { guardarToken(''); show('screen-login'); return; }
        aplicarCuenta(d.user);
      })
      .catch(() => show('screen-login'));
  }
  arrancarSesion();
  // Puertas de entrada para las pruebas automaticas: sin cuenta de Google de
  // verdad no hay forma de llegar a estas pantallas desde fuera.
  window.__cuentaTest = { abrirPerfil, aplicarCuenta, cargarRankings, show };

  document.getElementById('btn-play-online').addEventListener('click', () => {
    const name = (nameInput.value || 'Pirata').trim().slice(0, 16);
    localStorage.setItem('pcr-name', name);
    searchingOnline = true;
    searchingName = name;
    socket.emit('findMatch', { name, mode: modoElegido, authToken });
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
    socket.emit('playAI', { name, mode: modoElegido, authToken });
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    location.reload();
  });

  const btnBots = document.getElementById('btn-fill-bots');
  socket.on('queued', ({ waiting, needed, mode } = {}) => {
    const t = document.getElementById('queue-text');
    // texto corto: el cartel va encima del boton y no da para mas
    if (t && needed) t.textContent = `Buscando... ${waiting}/${needed}`;
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
    if (authToken) socket.emit('auth', { token: authToken });
    if (sessionToken) {
      socket.emit('rejoin', { token: sessionToken });
    } else if (searchingOnline) {
      socket.emit('findMatch', { name: searchingName, mode: modoElegido, authToken });
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

  // Alguien ha abandonado. La partida sigue: se le trata como a cualquier otro
  // eliminado, asi que basta con avisar. Si era el ultimo rival, el servidor
  // manda ademas el 'gameOver' de siempre.
  socket.on('playerLeft', ({ name } = {}) => {
    mostrarBanner(`${name || 'Un pirata'} ha abandonado la partida.`, 3500);
  });

  // Aviso suelto arriba. Va en su propio cartel y no en el de la ronda, que lo
  // reescribe cada vez que llega estado del servidor.
  function mostrarBanner(texto, ms) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = texto;
    toast.classList.remove('hidden');
    clearTimeout(mostrarBanner.t);
    mostrarBanner.t = setTimeout(() => toast.classList.add('hidden'), ms || 3000);
  }

  socket.on('gameOver', ({ won, draw }) => {
    document.getElementById('end-title').textContent = draw ? 'Empate' : won ? 'Victoria' : 'Derrota';
    const sub = document.getElementById('end-subtitle');
    sub.textContent = '';
    show('screen-end');
    // Con cuenta, la partida suma o resta puntos de ranking: se pide el total
    // nuevo para enseñarlo aqui mismo.
    if (!authToken || !cuenta) return;
    const signo = won ? `+${config ? config.puntos.victoria : 20}` : `${config ? config.puntos.derrota : -15}`;
    sub.textContent = `${signo} pts de ránking`;
    fetch('api/me', { headers: cabeceras() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !d.user) return;
        cuenta = d.user;
        sub.textContent = `${signo} pts · ${cuenta.points} en total · ${cuenta.division.label}`;
      })
      .catch(() => {});
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
    // Vuelve a pintar tienda y banquillo con el estado que haya: sirve para
    // probar la maquetacion sin depender de lo que salga en la tienda.
    window.__repintarTest = () => { renderShop(myState.you); renderBench(myState.you); };
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
    // Con carta ilustrada nos quedamos con la cara, que es lo que se reconoce
    // en un avatar redondo pequeno (wiki, fantasma de arrastre...).
    if (p.card) {
      const wrap = el('div', `unit-avatar unit-avatar-img uc-cara${p.captain ? ' captain' : ''}`);
      const img = el('img');
      img.src = `/${p.card}`;
      img.alt = p.name;
      img.onerror = () => {
        wrap.classList.remove('unit-avatar-img', 'uc-cara');
        wrap.textContent = p.initials;
      };
      wrap.appendChild(img);
      return wrap;
    }
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

  // Contenido de una tarjeta: si el personaje tiene carta ilustrada la usamos
  // tal cual (el dibujo ya trae marco, nombre y coste). Si no, la tarjeta
  // generada de siempre.
  function fillCard(card, p, opciones = {}) {
    if (p.card) {
      card.classList.add('has-art');
      const img = el('img', 'uc-art');
      img.src = `/${p.card}`;
      img.alt = `${p.name} (${p.cost} de oro)`;
      img.draggable = false;
      img.onerror = () => {
        card.classList.remove('has-art');
        card.innerHTML = '';
        rellenoGenerado(card, p, opciones);
      };
      card.appendChild(img);
      return;
    }
    rellenoGenerado(card, p, opciones);
  }

  function rellenoGenerado(card, p, opciones) {
    card.classList.add(`uc-crew-${p.crew}`);
    if (opciones.coste) card.appendChild(el('div', 'uc-cost', p.cost));
    if (p.captain) card.appendChild(el('div', 'captain-badge', '👑'));
    card.appendChild(makeAvatarEl(p));
    if (opciones.nombre) card.appendChild(el('div', 'uc-name', p.name));
  }

  // ---------------- Tienda ----------------
  function renderShop(you) {
    const wrap = document.getElementById('shop');
    wrap.innerHTML = '';
    const fila = el('div', 'shop-inner');
    you.shop.forEach((pid, idx) => {
      if (!pid) {
        fila.appendChild(el('div', 'unit-card empty', '<div class="uc-sold">vendido</div>'));
        return;
      }
      const p = charDb[pid];
      if (!p) return;
      // Se puede comprar tambien durante el combate: lo que compres espera en
      // el banquillo y entra en la ronda siguiente.
      const affordable = you.gold >= p.cost && you.bench.some((s) => s === null)
        && myState.phase !== 'gameover';
      const card = el('div', `unit-card${p.captain ? ' captain' : ''}${affordable ? '' : ' locked'}`);
      fillCard(card, p, { coste: true, nombre: true });
      card.addEventListener('click', () => {
        if (!affordable) return;
        socket.emit('buyUnit', { slot: idx });
      });
      // Sin tooltip en la tienda a proposito: al aparecer tapaba las cartas de
      // al lado y estorbaba justo cuando estas eligiendo que comprar.
      fila.appendChild(card);
    });
    wrap.appendChild(fila);
  }

  // ---------------- Banquillo ----------------
  // Huecos dibujados en el barril del banquillo (public/img/ui/bench.png),
  // medidos sobre la propia imagen y expresados en % del marco.
  const HUECOS_BANQUILLO = [
    [20.02, 29.25], [32.03, 41.31], [44.09, 53.32],
    [56.10, 65.47], [68.25, 77.63], [80.36, 89.54],
  ];
  const HUECO_Y = [27.98, 79.25];

  function renderBench(you) {
    const wrap = document.getElementById('bench');
    wrap.innerHTML = '';
    you.bench.forEach((unit, idx) => {
      const hueco = HUECOS_BANQUILLO[idx];
      if (!hueco) return;
      const slot = el('div', 'bench-slot');
      slot.style.left = `${hueco[0]}%`;
      slot.style.width = `${hueco[1] - hueco[0]}%`;
      slot.style.top = `${HUECO_Y[0]}%`;
      slot.style.height = `${HUECO_Y[1] - HUECO_Y[0]}%`;
      wrap.appendChild(slot);
      if (!unit) return;
      const p = charDb[unit.pokemonId];
      if (!p) return;
      const card = el('div', `bench-unit${p.captain ? ' captain' : ''}`);
      fillCard(card, p, {});
      card.appendChild(el('div', 'stars', '⭐'.repeat(unit.star)));
      card.dataset.uid = unit.uid;
      if (selectedUnit && selectedUnit.uid === unit.uid) card.classList.add('selected');
      card.addEventListener('click', () => toggleSelect(unit.uid, 'bench'));
      slot.appendChild(card);
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
        papelera.innerHTML = `<span class="sz-txt">${precio} 🪙</span>`;
        papelera.classList.add('armada');
        papelera.title = `Vender ${ch.name} por ${precio} 🪙`;
      } else hideTooltip();
    } else {
      papelera.innerHTML = '<span class="sz-txt">Vender</span>';
      papelera.classList.remove('armada');
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
    // Las fichas del rival no las hemos visto nunca: se piden ya, al empezar el
    // combate, para que no aparezcan a mitad de la pelea.
    if (scene) {
      const enJuego = [];
      for (const ev of log) {
        if (ev.type === 'spawn' && charDb[ev.pokemonId]) enJuego.push(charDb[ev.pokemonId]);
      }
      scene.warmModels(enJuego);
    }
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
        if (u) { u.golpeAt = now; u.objetivo = e.target; }
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
        if (u) { u.mana = 0; u.golpeAt = now; }
        if (u && scene) {
          const p = battleToRender(u.x, u.y);
          scene.addAbilityBurst(p.col, p.row);
          scene.addFloatingText(p.col, p.row, e.name, '#ffd23f', true);
        }
        break;
      }
      case 'abilityHit': {
        const t = battleUnits.get(e.uid);
        // La habilidad tambien orienta a quien la lanza. Si golpea a varios se
        // queda mirando al ultimo, que a este tamano da igual.
        const lanzador = battleUnits.get(e.source);
        if (lanzador) lanzador.objetivo = e.uid;
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

  /**
   * Hacia donde mira una ficha, en radianes y en pasos de 45º.
   *
   * Se orienta al rival al que esta pegando, no hacia donde camina: si se
   * orientase por el movimiento, al avanzar a la mitad contraria se daria media
   * vuelta en mitad del combate. Sin objetivo todavia (nada mas empezar) se
   * devuelve undefined y la escena usa el valor por bando de siempre.
   *
   * El modelo con rotacion 0 mira hacia la camara, o sea hacia las filas de
   * abajo; con PI mira al fondo. De ahi que el angulo salga de atan2(dx, dy)
   * con dy medido en filas de render, no al reves.
   */
  const PASO_GIRO = Math.PI / 4; // ocho direcciones
  function mirandoA(u, col, row) {
    if (!u.objetivo) return undefined;
    const obj = battleUnits.get(u.objetivo);
    if (!obj) return undefined;
    const p = battleToRender(obj.toX, obj.toY);
    const dx = p.col - col;
    const dy = p.row - row;
    if (!dx && !dy) return undefined;
    return Math.round(Math.atan2(dx, dy) / PASO_GIRO) * PASO_GIRO;
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
        // Hay que darle tiempo a caerse antes de desvanecerla: la ficha se ve
        // el doble de tiempo que antes, y solo se difumina en el ultimo tramo.
        const age = now - (u.deathAt || now);
        if (age > MUERTE_MS) continue;
        fade = Math.max(0, 1 - Math.max(0, age - MUERTE_MS * 0.55) / (MUERTE_MS * 0.45));
      }
      let px = u.toX, py = u.toY;
      const andando = u.moveStart && now - u.moveStart < u.moveDur;
      if (andando) {
        const f = (now - u.moveStart) / u.moveDur;
        px = u.fromX + (u.toX - u.fromX) * f;
        py = u.fromY + (u.toY - u.fromY) * f;
      }
      const ch = charDb[u.pokemonId];
      if (!ch) continue;
      // El golpe manda sobre el paso: si ataca mientras se movia, se ve pegar.
      // La ventana dura lo mismo que la animacion (scene3d la ajusta con esta
      // misma cuenta), asi que el golpe se ve entero y no cortado.
      const ventanaGolpe = (ch.atkSpeed || 7) * TICK_MS * PARTE_GOLPE;
      const golpeando = u.alive && u.golpeAt && now - u.golpeAt < ventanaGolpe;
      const { col, row } = battleToRender(px, py);
      units.push({
        uid,
        char: { ...ch, star: u.star },
        col, row,
        // Hacia donde mira: al rival al que esta pegando, en pasos de 45º. Sin
        // objetivo (al empezar el combate) se cae al valor por bando.
        facing: mirandoA(u, col, row),
        mine: u.side === battleSide,
        selected: false,
        showHp: u.alive,
        hpFrac: u.hp / u.maxHp,
        mana: u.mana,
        maxMana: u.maxMana,
        opacity: fade,
        accion: !u.alive ? 'death' : golpeando ? 'attack' : andando ? 'walk' : 'idle',
      });
    }
    if (scene) scene.syncUnits(units);

    const doneEvents = battleIdx >= battleLog.length;
    const lastEventTime = battleLog.length ? battleLog[battleLog.length - 1].t * TICK_MS : 0;
    // A partir del ultimo evento y hasta que se acaba el descanso, los que
    // siguen en pie se quedan en reposo: no hay nada mas que reproducir.
    window.__descansandoTest = doneEvents;
    if (doneEvents && elapsed > lastEventTime + DESCANSO_MS) {
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
      // Nada de bajarse los 40 modelos aqui: son ~40 MB y en una partida se
      // ven doce como mucho. Cada modelo se pide cuando hace falta, y en
      // renderState se adelantan los de la tienda, el banquillo y la cubierta,
      // que son los que estas a punto de ver.
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
