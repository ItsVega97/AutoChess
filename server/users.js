'use strict';

/**
 * Cuentas de jugador y sus puntos de ranking.
 *
 * La identidad viene de Google (el "sub" del token, que no cambia nunca).
 * Cada cuenta guarda el nombre de pirata y el icono que eligio la primera vez,
 * y sus puntos: +20 por ganar una partida y -15 por perderla.
 *
 * Se guarda en data/users.json. OJO: en el plan gratuito de Render el disco es
 * efimero, asi que las cuentas se pierden en cada despliegue o reinicio. Para
 * que aguanten hace falta un disco persistente o una base de datos.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'users.json');

const PUNTOS_VICTORIA = 20;
const PUNTOS_DERROTA = -15;

// Divisiones por puntos, de menor a mayor
const DIVISIONES = [
  { id: 'novato', label: 'Novato', min: 0, max: 1000, color: '#3f8b3f', icon: '🏴‍☠️' },
  { id: 'capitan', label: 'Capitán', min: 1000, max: 2000, color: '#2f6bb5', icon: '🕹️' },
  { id: 'shichibukai', label: 'Shichibukai', min: 2000, max: 3000, color: '#6b4c9a', icon: '✳️' },
  { id: 'yonkou', label: 'Yonkou', min: 3000, max: 4000, color: '#a83232', icon: '💀' },
  { id: 'reypirata', label: 'Rey Pirata', min: 4000, max: Infinity, color: '#8a6a1f', icon: '👑' },
];

function divisionDe(puntos) {
  const p = Math.max(0, puntos || 0);
  for (let i = DIVISIONES.length - 1; i >= 0; i--) {
    if (p >= DIVISIONES[i].min) return DIVISIONES[i];
  }
  return DIVISIONES[0];
}

let datos = { users: {} };
try {
  datos = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!datos || typeof datos !== 'object' || typeof datos.users !== 'object') datos = { users: {} };
} catch (e) { /* primera vez: se crea al guardar */ }

// Escritura agrupada: si caen varias partidas seguidas no se escribe el archivo
// una vez por cada una.
let pendiente = null;
function guardar() {
  if (pendiente) return;
  pendiente = setTimeout(() => {
    pendiente = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
      fs.renameSync(tmp, FILE); // atomico: o esta el de antes o el nuevo
    } catch (e) {
      console.error('No se pudieron guardar las cuentas:', e.message);
    }
  }, 400);
}

function vista(u) {
  if (!u) return null;
  const div = divisionDe(u.points);
  return {
    id: u.id,
    name: u.name || '',
    icon: u.icon || null,
    points: Math.max(0, u.points || 0),
    wins: u.wins || 0,
    games: u.games || 0,
    division: { id: div.id, label: div.label, color: div.color },
    needsProfile: !u.name,
  };
}

// Entra alguien con su cuenta de Google: si es la primera vez se crea, y se
// queda pendiente de elegir nombre e icono.
function upsertFromGoogle({ sub, email, picture }) {
  let u = datos.users[sub];
  if (!u) {
    u = datos.users[sub] = {
      id: sub, email: email || '', googlePicture: picture || '',
      name: '', icon: null, points: 0, wins: 0, games: 0,
      createdAt: Date.now(),
    };
  }
  u.lastSeen = Date.now();
  guardar();
  return u;
}

function get(id) {
  return datos.users[id] || null;
}

// Nombre e icono. El nombre no se puede repetir entre cuentas.
function setProfile(id, { name, icon }) {
  const u = datos.users[id];
  if (!u) return { error: 'sin cuenta' };
  const limpio = String(name || '').trim().slice(0, 16);
  if (limpio.length < 2) return { error: 'El nombre tiene que tener al menos 2 letras.' };
  const cogido = Object.values(datos.users)
    .some((o) => o.id !== id && (o.name || '').toLowerCase() === limpio.toLowerCase());
  if (cogido) return { error: 'Ese nombre de pirata ya está cogido.' };
  u.name = limpio;
  if (icon) u.icon = String(icon).slice(0, 40);
  guardar();
  return { user: u };
}

// Resultado de una partida: +20 si ganas, -15 si no. Los puntos no bajan de 0.
function recordMatch(id, won) {
  const u = datos.users[id];
  if (!u) return null;
  u.games = (u.games || 0) + 1;
  if (won) u.wins = (u.wins || 0) + 1;
  u.points = Math.max(0, (u.points || 0) + (won ? PUNTOS_VICTORIA : PUNTOS_DERROTA));
  guardar();
  return u;
}

// Tabla: solo cuentas que ya han elegido nombre, de mas a menos puntos
function top(n = 50) {
  return Object.values(datos.users)
    .filter((u) => u.name)
    .sort((a, b) => (b.points || 0) - (a.points || 0) || (b.wins || 0) - (a.wins || 0))
    .slice(0, n)
    .map((u, i) => ({ ...vista(u), rank: i + 1 }));
}

module.exports = {
  DIVISIONES, PUNTOS_VICTORIA, PUNTOS_DERROTA,
  divisionDe, upsertFromGoogle, get, setProfile, recordMatch, top, vista,
};
