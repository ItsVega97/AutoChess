'use strict';

/**
 * Ranking de jugadores: partidas ganadas y jugadas, por nombre de pirata.
 *
 * Sin base de datos ni cuentas: se guarda en un JSON en disco y la identidad es
 * el nombre que pones al entrar, así que es un marcador de la comunidad, no un
 * sistema competitivo — dos personas con el mismo nombre comparten fila.
 *
 * OJO en Render (plan gratuito): el disco es efímero, o sea que el archivo se
 * pierde en cada despliegue o reinicio del servicio. Para que sobreviva hace
 * falta un disco persistente (planes de pago) o una base de datos externa.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'rankings.json');
const MAX_JUGADORES = 500; // tope para que el archivo no crezca sin control

let tabla = new Map(); // nombre -> { name, wins, games, best, lastAt }
let guardadoPendiente = null;

function cargar() {
  try {
    const bruto = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (Array.isArray(bruto)) {
      for (const e of bruto) {
        if (e && typeof e.name === 'string') {
          tabla.set(e.name, {
            name: e.name,
            wins: Number(e.wins) || 0,
            games: Number(e.games) || 0,
            best: Number(e.best) || 0,
            lastAt: Number(e.lastAt) || 0,
          });
        }
      }
    }
  } catch (e) { /* no hay archivo todavia: se empieza vacio */ }
}
cargar();

// Guardado diferido: varias partidas pueden acabar a la vez y no hace falta
// escribir el archivo por cada una.
function guardar() {
  if (guardadoPendiente) return;
  guardadoPendiente = setTimeout(() => {
    guardadoPendiente = null;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const lista = [...tabla.values()].sort((a, b) => b.wins - a.wins || b.games - a.games);
      // Escritura atomica: si el proceso muere a medias no deja un JSON roto
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(lista.slice(0, MAX_JUGADORES)));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      console.error('No se pudo guardar el ranking:', e.message);
    }
  }, 1000);
}

/**
 * Apunta el resultado de una partida de un jugador humano.
 * `place` es el puesto en la mesa (1 = ganador); en 1v1 es 1 o 2.
 */
function recordResult(name, { won, place }) {
  const limpio = String(name || '').trim().slice(0, 16);
  if (!limpio) return;
  const fila = tabla.get(limpio) || { name: limpio, wins: 0, games: 0, best: 0, lastAt: 0 };
  fila.games += 1;
  if (won) fila.wins += 1;
  const puesto = Number(place) || (won ? 1 : 0);
  if (puesto > 0 && (fila.best === 0 || puesto < fila.best)) fila.best = puesto;
  fila.lastAt = Date.now();
  tabla.set(limpio, fila);

  if (tabla.size > MAX_JUGADORES) {
    // si se llena, se van los que menos han jugado y hace mas tiempo
    const sobra = [...tabla.values()]
      .sort((a, b) => a.wins - b.wins || a.lastAt - b.lastAt)
      .slice(0, tabla.size - MAX_JUGADORES);
    for (const f of sobra) tabla.delete(f.name);
  }
  guardar();
}

// Los mejores por victorias; a igualdad, quien haya jugado menos partidas
function top(n = 50) {
  return [...tabla.values()]
    .sort((a, b) => b.wins - a.wins || a.games - b.games || b.lastAt - a.lastAt)
    .slice(0, n)
    .map((f, i) => ({ rank: i + 1, name: f.name, wins: f.wins, games: f.games, best: f.best }));
}

module.exports = { recordResult, top };
