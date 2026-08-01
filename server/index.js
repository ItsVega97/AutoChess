'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { CHARACTERS, CREWS } = require('./characterData');
const { BOARD_COLS, BOARD_ROWS } = require('./battle');
const GameRoom = require('./GameRoom');
const rankings = require('./rankings');
const users = require('./users');
const auth = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Tolerante ante redes flojas (wifi/movil): evita cerrar la conexion por
  // pequenos cortes de latencia mientras se simula una ronda de combate.
  pingInterval: 20000,
  pingTimeout: 60000,
});

app.use(express.static(path.join(__dirname, '..', 'public')));
// Banderas piratas (Jolly Roger) de cada tripulacion. Si el archivo esta en
// public/img/crews/ se manda su ruta y el cliente la usa en vez del emoji.
const CREWS_DIR = path.join(__dirname, '..', 'public', 'img', 'crews');
let flagsCache = { at: 0, map: {} };
function listCrewFlags() {
  if (Date.now() - flagsCache.at < 30000) return flagsCache.map;
  const map = {};
  try {
    for (const f of fs.readdirSync(CREWS_DIR)) {
      const m = f.match(/^(.+)\.(png|webp|svg|jpg|jpeg)$/i);
      if (m) map[m[1].toLowerCase()] = `img/crews/${f}`;
    }
  } catch (e) { /* sin carpeta: se siguen usando los emojis */ }
  flagsCache = { at: Date.now(), map };
  return map;
}

// Cartas ilustradas de personaje. Basta con dejar <id>.png en public/img/cards/
// (el id del personaje, en minusculas) para que la tienda y el banquillo la
// usen en vez de la tarjeta generada.
const CARDS_DIR = path.join(__dirname, '..', 'public', 'img', 'cards');
let cardsCache = { at: 0, map: {} };
function listCards() {
  if (Date.now() - cardsCache.at < 30000) return cardsCache.map;
  const map = {};
  try {
    for (const f of fs.readdirSync(CARDS_DIR)) {
      const m = f.match(/^(.+)\.(png|webp|jpg|jpeg)$/i);
      if (m) map[m[1].toLowerCase()] = `img/cards/${f}`;
    }
  } catch (e) { /* sin carpeta: se usan las tarjetas generadas */ }
  cardsCache = { at: Date.now(), map };
  return map;
}

app.get('/api/units', (req, res) => {
  const banderas = listCrewFlags();
  const crews = {};
  for (const [slug, def] of Object.entries(CREWS)) {
    crews[slug] = banderas[slug] ? { ...def, flag: banderas[slug] } : def;
  }
  const cartas = listCards();
  res.json({
    characters: CHARACTERS.map((c) => (cartas[c.id] ? { ...c, card: cartas[c.id] } : c)),
    crews,
    board: { cols: BOARD_COLS, rows: BOARD_ROWS, rowsPerPlayer: BOARD_ROWS / 2 },
  });
});

// Modelos 3D disponibles. El cliente pregunta una sola vez que personajes
// tienen .glb subido, asi no va pidiendo 40 archivos que casi nunca existen.
// Se recalcula cada 30s: basta con dejar el archivo en su carpeta.
const MODELS_DIR = path.join(__dirname, '..', 'public', 'models');
// Devuelve { "tripulacion/id": "models/Tripulacion/Id.glb" }: la clave va en
// minusculas para que dé igual como se llame el archivo (Usopp.glb, usopp.GLB)
// y el valor es la ruta real con la que hay que pedirlo.
let modelsCache = { at: 0, map: {} };
function listModels() {
  if (Date.now() - modelsCache.at < 30000) return modelsCache.map;
  const map = {};
  try {
    for (const crew of fs.readdirSync(MODELS_DIR, { withFileTypes: true })) {
      if (!crew.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(MODELS_DIR, crew.name))) {
        if (!f.toLowerCase().endsWith('.glb')) continue;
        const id = f.slice(0, -4).toLowerCase();
        map[`${crew.name.toLowerCase()}/${id}`] = `models/${crew.name}/${f}`;
      }
    }
  } catch (e) { /* sin carpeta de modelos: se juega con las fichas planas */ }
  modelsCache = { at: Date.now(), map };
  return map;
}
app.get('/api/models', (req, res) => res.json({ models: listModels() }));

// ---------------- Cuentas ----------------
app.use(express.json({ limit: '16kb' }));

// Que sabe el cliente antes de nada: si hay login de Google montado y con que
// identificador tiene que pedirlo. Sin GOOGLE_CLIENT_ID el juego sigue
// funcionando, solo que entrando como invitado.
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: auth.CLIENT_ID,
    googleEnabled: auth.configurado(),
    divisiones: users.DIVISIONES.map((d) => ({
      id: d.id, label: d.label, min: d.min, max: d.max === Infinity ? null : d.max, color: d.color,
    })),
    puntos: { victoria: users.PUNTOS_VICTORIA, derrota: users.PUNTOS_DERROTA },
  });
});

// El token de sesion viaja en la cabecera Authorization
function sesionDe(req) {
  const cab = String(req.headers.authorization || '');
  const token = cab.startsWith('Bearer ') ? cab.slice(7) : '';
  const id = token ? auth.usuarioDeSesion(token) : null;
  return { token, id };
}

app.post('/api/auth/google', async (req, res) => {
  try {
    const perfil = await auth.verificarCredential(req.body && req.body.credential);
    const u = users.upsertFromGoogle(perfil);
    res.json({ token: auth.crearSesion(u.id), user: users.vista(u) });
  } catch (e) {
    res.status(401).json({ error: e.message || 'No se pudo iniciar sesión.' });
  }
});

app.get('/api/me', (req, res) => {
  const { id } = sesionDe(req);
  const u = id ? users.get(id) : null;
  if (!u) return res.status(401).json({ error: 'sin sesión' });
  res.json({ user: users.vista(u) });
});

// Nombre de pirata e icono: obligatorio la primera vez, y luego se puede cambiar
app.post('/api/profile', (req, res) => {
  const { id } = sesionDe(req);
  if (!id) return res.status(401).json({ error: 'sin sesión' });
  const r = users.setProfile(id, { name: req.body && req.body.name, icon: req.body && req.body.icon });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ user: users.vista(r.user) });
});

app.post('/api/logout', (req, res) => {
  const { token } = sesionDe(req);
  if (token) auth.cerrarSesion(token);
  res.json({ ok: true });
});

// Ranking: los jugadores con cuenta, ordenados por puntos y con su division.
// Se manda tambien el marcador antiguo (por nombre, sin cuenta) para no perder
// las partidas que se jugaron antes de que existiera el login.
app.get('/api/rankings', (req, res) => {
  const { id } = sesionDe(req);
  const jugadores = users.top(50);
  const yo = id ? users.vista(users.get(id)) : null;
  // si el que pregunta no entra en el top, se le manda aparte con su puesto
  let miPuesto = null;
  if (yo && yo.name && !jugadores.some((j) => j.id === yo.id)) {
    miPuesto = { ...yo, rank: null };
  }
  res.json({ players: jugadores, me: miPuesto || (yo && jugadores.find((j) => j.id === yo.id)) || null, legacy: rankings.top(20) });
});

const rooms = new Map(); // roomId -> GameRoom
const socketRoom = new Map(); // socketId -> roomId
const sessions = new Map(); // token -> { roomId, side }
// Una cola por modo: 1v1 necesita 2 jugadores y "4 piratas" necesita 4.
const queues = { '1v1': [], '4p': [] };
const NOMBRES_BOT = ['CPU Rival', 'CPU Nakama', 'CPU Marine', 'CPU Corsario'];

// Quien es el que juega. Si manda su token de sesion la partida cuenta para su
// cuenta (nombre e icono de ranking incluidos); si no, entra como invitado con
// el nombre que haya escrito y solo suma al marcador antiguo.
function identidad(socket, datos) {
  const id = auth.usuarioDeSesion((datos && datos.authToken) || socket.data.authToken || '');
  const u = id ? users.get(id) : null;
  if (u && u.name) return { userId: u.id, name: u.name };
  return { userId: null, name: String((datos && datos.name) || 'Pirata').slice(0, 16) };
}

function safe(fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (e) {
      console.error('Error en manejador de socket:', e);
    }
  };
}

function createRoom(jugadores) {
  const room = new GameRoom(io, jugadores);
  rooms.set(room.id, room);
  room.onEnded = () => {
    rooms.delete(room.id);
    for (const side of room.sides) {
      const t = room.players[side].token;
      if (t) sessions.delete(t);
    }
  };

  room.sides.forEach((side, i) => {
    const p = jugadores[i];
    if (p.isBot) return;
    socketRoom.set(p.id, room.id);
    sessions.set(room.players[side].token, { roomId: room.id, side });
    const sock = io.sockets.sockets.get(p.id);
    if (sock) sock.join(room.id);
  });

  room.sides.forEach((side, i) => {
    const p = jugadores[i];
    if (p.isBot) return;
    const sock = io.sockets.sockets.get(p.id);
    if (!sock) return;
    sock.emit('matchFound', {
      you: side,
      mode: room.mode,
      token: room.players[side].token,
      // En 4 jugadores el rival cambia cada ronda: aqui va la mesa entera
      opponentName: jugadores.filter((_, j) => j !== i).map((o) => o.name).join(', '),
      table: jugadores.map((o) => o.name),
    });
  });
  room.start();
  return room;
}

function getRoom(socketId) {
  const roomId = socketRoom.get(socketId);
  return roomId ? rooms.get(roomId) : null;
}

io.on('connection', (socket) => {
  // El cliente manda su token nada mas conectar si ha iniciado sesion
  socket.on('auth', safe(({ token }) => { socket.data.authToken = String(token || ''); }));

  socket.on('findMatch', safe((datos) => {
    const { name: safeName, userId } = identidad(socket, datos);
    const modo = datos && datos.mode === '4p' ? '4p' : '1v1';
    const hacenFalta = modo === '4p' ? 4 : 2;
    // Si estaba buscando en el otro modo, se le saca de alli
    for (const q of Object.values(queues)) {
      const i = q.findIndex((e) => e.socketId === socket.id);
      if (i !== -1) q.splice(i, 1);
    }
    queues[modo].push({ socketId: socket.id, name: safeName, userId });
    socket.emit('queued', { mode: modo, waiting: queues[modo].length, needed: hacenFalta });
    // Avisamos a los que esperan de cuantos van
    for (const e of queues[modo]) {
      const s2 = io.sockets.sockets.get(e.socketId);
      if (s2) s2.emit('queued', { mode: modo, waiting: queues[modo].length, needed: hacenFalta });
    }
    if (queues[modo].length >= hacenFalta) {
      const grupo = queues[modo].splice(0, hacenFalta);
      createRoom(grupo.map((g) => ({ id: g.socketId, name: g.name, userId: g.userId })));
    }
  }));

  // En la cola de 4 piratas: si ya hay dos o mas esperando, cualquiera de
  // ellos puede arrancar la partida y se rellenan los huecos con bots.
  socket.on('fillWithBots', safe(() => {
    const cola = queues['4p'];
    if (!cola.some((e) => e.socketId === socket.id)) return;
    if (cola.length < 2) return;
    const humanos = cola.splice(0, 4);
    const jugadores = humanos.map((h) => ({ id: h.socketId, name: h.name, userId: h.userId }));
    for (let i = jugadores.length; i < 4; i++) {
      jugadores.push({ id: `bot-${socket.id}-${i}`, name: NOMBRES_BOT[i - 1], isBot: true });
    }
    createRoom(jugadores);
  }));

  socket.on('cancelFindMatch', safe(() => {
    for (const q of Object.values(queues)) {
      const i = q.findIndex((e) => e.socketId === socket.id);
      if (i !== -1) q.splice(i, 1);
    }
  }));

  socket.on('playAI', safe((datos) => {
    const { name: safeName, userId } = identidad(socket, datos);
    const total = datos && datos.mode === '4p' ? 4 : 2;
    const jugadores = [{ id: socket.id, name: safeName, userId }];
    for (let i = 1; i < total; i++) {
      jugadores.push({ id: `bot-${socket.id}-${i}`, name: NOMBRES_BOT[i - 1], isBot: true });
    }
    createRoom(jugadores);
  }));

  // Reconexion: el cliente guarda el token recibido en 'matchFound' y lo
  // reenvia aqui tras un corte de red para recuperar su sitio en la partida.
  socket.on('rejoin', safe(({ token }) => {
    const entry = sessions.get(token);
    if (!entry) { socket.emit('rejoinFailed'); return; }
    const room = rooms.get(entry.roomId);
    if (!room || room.ended) { socket.emit('rejoinFailed'); return; }

    room.rebind(entry.side, socket.id);
    socketRoom.set(socket.id, room.id);
    socket.join(room.id);

    const rival = room.opponentOf(entry.side);
    if (rival && !room.players[rival].isBot) {
      const otherSock = io.sockets.sockets.get(room.players[rival].id);
      if (otherSock) otherSock.emit('opponentReconnected');
    }
    socket.emit('matchFound', {
      you: entry.side,
      mode: room.mode,
      token,
      opponentName: rival ? room.players[rival].name : '',
      table: room.sides.map((s2) => room.players[s2].name),
    });
    room.broadcastState();
  }));

  socket.on('buyUnit', safe(({ slot }) => {
    const room = getRoom(socket.id);
    if (!room) return;
    room.buyUnit(room.sideOf(socket.id), slot);
  }));

  socket.on('sellUnit', safe(({ uid }) => {
    const room = getRoom(socket.id);
    if (!room) return;
    room.sellUnit(room.sideOf(socket.id), uid);
  }));

  socket.on('placeOnBoard', safe(({ uid, x, y }) => {
    const room = getRoom(socket.id);
    if (!room) return;
    room.moveToBoard(room.sideOf(socket.id), uid, x, y);
  }));

  socket.on('benchUnit', safe(({ uid }) => {
    const room = getRoom(socket.id);
    if (!room) return;
    room.moveToBench(room.sideOf(socket.id), uid);
  }));

  socket.on('leaveRoom', safe(() => cleanup(socket.id)));

  socket.on('disconnect', safe(() => {
    for (const q of Object.values(queues)) {
      const i = q.findIndex((e) => e.socketId === socket.id);
      if (i !== -1) q.splice(i, 1);
    }
    cleanup(socket.id);
  }));

  // Al desconectar solo se deja de enrutar esta conexion; la sala sigue
  // viva un rato por si el jugador reconecta (ver GameRoom.handleDisconnect).
  function cleanup(socketId) {
    const room = getRoom(socketId);
    if (room) room.handleDisconnect(socketId);
    socketRoom.delete(socketId);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nakama Royale escuchando en http://localhost:${PORT}`);
});
