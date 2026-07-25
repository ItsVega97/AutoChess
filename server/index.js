'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { CHARACTERS, CREWS } = require('./characterData');
const { BOARD_COLS, BOARD_ROWS } = require('./battle');
const GameRoom = require('./GameRoom');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Tolerante ante redes flojas (wifi/movil): evita cerrar la conexion por
  // pequenos cortes de latencia mientras se simula una ronda de combate.
  pingInterval: 20000,
  pingTimeout: 60000,
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/units', (req, res) => {
  res.json({
    characters: CHARACTERS,
    crews: CREWS,
    board: { cols: BOARD_COLS, rows: BOARD_ROWS, rowsPerPlayer: BOARD_ROWS / 2 },
  });
});

// Modelos 3D disponibles. El cliente pregunta una sola vez que personajes
// tienen .glb subido, asi no va pidiendo 40 archivos que casi nunca existen.
// Se recalcula cada 30s: basta con dejar el archivo en su carpeta.
const MODELS_DIR = path.join(__dirname, '..', 'public', 'models');
let modelsCache = { at: 0, ids: [] };
function listModels() {
  if (Date.now() - modelsCache.at < 30000) return modelsCache.ids;
  const ids = [];
  try {
    for (const crew of fs.readdirSync(MODELS_DIR, { withFileTypes: true })) {
      if (!crew.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(MODELS_DIR, crew.name))) {
        if (f.toLowerCase().endsWith('.glb')) ids.push(`${crew.name}/${f.slice(0, -4)}`);
      }
    }
  } catch (e) { /* sin carpeta de modelos: se juega con las fichas planas */ }
  modelsCache = { at: Date.now(), ids };
  return ids;
}
app.get('/api/models', (req, res) => res.json({ models: listModels() }));

const rooms = new Map(); // roomId -> GameRoom
const socketRoom = new Map(); // socketId -> roomId
const sessions = new Map(); // token -> { roomId, side }
const queue = []; // { socketId, name }

function safe(fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (e) {
      console.error('Error en manejador de socket:', e);
    }
  };
}

function createRoom(pA, pB) {
  const room = new GameRoom(io, pA, pB);
  rooms.set(room.id, room);
  room.onEnded = () => {
    rooms.delete(room.id);
    if (room.players.A.token) sessions.delete(room.players.A.token);
    if (room.players.B.token) sessions.delete(room.players.B.token);
  };

  for (const side of ['A', 'B']) {
    const p = side === 'A' ? pA : pB;
    if (p.isBot) continue;
    socketRoom.set(p.id, room.id);
    sessions.set(room.players[side].token, { roomId: room.id, side });
    const sock = io.sockets.sockets.get(p.id);
    if (sock) sock.join(room.id);
  }

  const sockA = io.sockets.sockets.get(pA.id);
  if (sockA) sockA.emit('matchFound', { you: 'A', opponentName: pB.name, token: room.players.A.token });
  if (!pB.isBot) {
    const sockB = io.sockets.sockets.get(pB.id);
    if (sockB) sockB.emit('matchFound', { you: 'B', opponentName: pA.name, token: room.players.B.token });
  }
  room.start();
  return room;
}

function getRoom(socketId) {
  const roomId = socketRoom.get(socketId);
  return roomId ? rooms.get(roomId) : null;
}

io.on('connection', (socket) => {
  socket.on('findMatch', safe(({ name }) => {
    const safeName = String(name || 'Entrenador').slice(0, 16);
    if (queue.some((q) => q.socketId === socket.id)) return;
    queue.push({ socketId: socket.id, name: safeName });
    socket.emit('queued');
    if (queue.length >= 2) {
      const pA = queue.shift();
      const pB = queue.shift();
      createRoom({ id: pA.socketId, name: pA.name }, { id: pB.socketId, name: pB.name });
    }
  }));

  socket.on('cancelFindMatch', safe(() => {
    const idx = queue.findIndex((q) => q.socketId === socket.id);
    if (idx !== -1) queue.splice(idx, 1);
  }));

  socket.on('playAI', safe(({ name }) => {
    const safeName = String(name || 'Entrenador').slice(0, 16);
    createRoom({ id: socket.id, name: safeName }, { id: `bot-${socket.id}`, name: 'CPU Rival', isBot: true });
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

    const other = room.other(entry.side);
    const otherPlayer = room.players[other];
    if (!otherPlayer.isBot) {
      const otherSock = io.sockets.sockets.get(otherPlayer.id);
      if (otherSock) otherSock.emit('opponentReconnected');
    }
    socket.emit('matchFound', { you: entry.side, opponentName: otherPlayer.name, token });
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

  socket.on('reroll', safe(() => {
    const room = getRoom(socket.id);
    if (!room) return;
    room.reroll(room.sideOf(socket.id));
  }));

  socket.on('ready', safe(() => {
    const room = getRoom(socket.id);
    if (!room) return;
    room.setReady(room.sideOf(socket.id));
  }));

  socket.on('leaveRoom', safe(() => cleanup(socket.id)));

  socket.on('disconnect', safe(() => {
    const idx = queue.findIndex((q) => q.socketId === socket.id);
    if (idx !== -1) queue.splice(idx, 1);
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
  console.log(`AutoChess Pokemon server escuchando en http://localhost:${PORT}`);
});
