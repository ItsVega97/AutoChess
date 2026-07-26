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

app.get('/api/units', (req, res) => {
  const banderas = listCrewFlags();
  const crews = {};
  for (const [slug, def] of Object.entries(CREWS)) {
    crews[slug] = banderas[slug] ? { ...def, flag: banderas[slug] } : def;
  }
  res.json({
    characters: CHARACTERS,
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

// Ranking publico: lo ve cualquiera, sin cuentas. La identidad es el nombre de
// pirata con el que juegas.
app.get('/api/rankings', (req, res) => res.json({ players: rankings.top(50) }));

const rooms = new Map(); // roomId -> GameRoom
const socketRoom = new Map(); // socketId -> roomId
const sessions = new Map(); // token -> { roomId, side }
// Una cola por modo: 1v1 necesita 2 jugadores y "4 piratas" necesita 4.
const queues = { '1v1': [], '4p': [] };
const NOMBRES_BOT = ['CPU Rival', 'CPU Nakama', 'CPU Marine', 'CPU Corsario'];

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
  socket.on('findMatch', safe(({ name, mode }) => {
    const safeName = String(name || 'Entrenador').slice(0, 16);
    const modo = mode === '4p' ? '4p' : '1v1';
    const hacenFalta = modo === '4p' ? 4 : 2;
    // Si estaba buscando en el otro modo, se le saca de alli
    for (const q of Object.values(queues)) {
      const i = q.findIndex((e) => e.socketId === socket.id);
      if (i !== -1) q.splice(i, 1);
    }
    queues[modo].push({ socketId: socket.id, name: safeName });
    socket.emit('queued', { mode: modo, waiting: queues[modo].length, needed: hacenFalta });
    // Avisamos a los que esperan de cuantos van
    for (const e of queues[modo]) {
      const s2 = io.sockets.sockets.get(e.socketId);
      if (s2) s2.emit('queued', { mode: modo, waiting: queues[modo].length, needed: hacenFalta });
    }
    if (queues[modo].length >= hacenFalta) {
      const grupo = queues[modo].splice(0, hacenFalta);
      createRoom(grupo.map((g) => ({ id: g.socketId, name: g.name })));
    }
  }));

  // En la cola de 4 piratas: si ya hay dos o mas esperando, cualquiera de
  // ellos puede arrancar la partida y se rellenan los huecos con bots.
  socket.on('fillWithBots', safe(() => {
    const cola = queues['4p'];
    if (!cola.some((e) => e.socketId === socket.id)) return;
    if (cola.length < 2) return;
    const humanos = cola.splice(0, 4);
    const jugadores = humanos.map((h) => ({ id: h.socketId, name: h.name }));
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

  socket.on('playAI', safe(({ name, mode }) => {
    const safeName = String(name || 'Entrenador').slice(0, 16);
    const total = mode === '4p' ? 4 : 2;
    const jugadores = [{ id: socket.id, name: safeName }];
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
