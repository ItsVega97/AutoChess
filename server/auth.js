'use strict';

/**
 * Inicio de sesion con Google, sin dependencias.
 *
 * El navegador hace el login con Google Identity Services y nos manda un
 * "credential", que es un JWT firmado por Google. Aqui se comprueba la firma
 * contra las claves publicas de Google (se descargan una vez y se cachean) y
 * que el token sea para nuestra aplicacion y no haya caducado.
 *
 * Despues se entrega un token de sesion propio, que es lo que el cliente
 * guarda y manda en cada peticion. Vive en memoria: si se reinicia el servidor
 * hay que volver a entrar, pero la cuenta y los puntos siguen ahi.
 */

const crypto = require('crypto');
const https = require('https');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const EMISORES = ['https://accounts.google.com', 'accounts.google.com'];
const SESION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function configurado() {
  return !!CLIENT_ID;
}

// ---------------- Claves publicas de Google ----------------
let claves = { at: 0, porId: {} };
function bajarClaves() {
  // se refrescan cada hora; si falla, se sigue con las que haya
  if (Date.now() - claves.at < 3600000 && Object.keys(claves.porId).length) {
    return Promise.resolve(claves.porId);
  }
  return new Promise((resolve, reject) => {
    https.get(CERTS_URL, (res) => {
      let cuerpo = '';
      res.on('data', (t) => { cuerpo += t; });
      res.on('end', () => {
        try {
          const json = JSON.parse(cuerpo);
          const porId = {};
          for (const jwk of json.keys || []) porId[jwk.kid] = jwk;
          if (!Object.keys(porId).length) throw new Error('sin claves');
          claves = { at: Date.now(), porId };
          resolve(porId);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function base64url(txt) {
  return Buffer.from(txt.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Comprueba el credential de Google y devuelve { sub, email, name, picture }.
 * Lanza si no cuadra algo.
 */
async function verificarCredential(credential) {
  if (!CLIENT_ID) throw new Error('El servidor no tiene configurado GOOGLE_CLIENT_ID.');
  const partes = String(credential || '').split('.');
  if (partes.length !== 3) throw new Error('Token mal formado.');
  const cabecera = JSON.parse(base64url(partes[0]).toString('utf8'));
  const cuerpo = JSON.parse(base64url(partes[1]).toString('utf8'));

  if (cabecera.alg !== 'RS256') throw new Error('Firma no soportada.');
  const porId = await bajarClaves();
  const jwk = porId[cabecera.kid];
  if (!jwk) throw new Error('Clave de Google desconocida.');

  const clave = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${partes[0]}.${partes[1]}`),
    clave,
    base64url(partes[2]),
  );
  if (!ok) throw new Error('La firma del token no es valida.');

  if (!EMISORES.includes(cuerpo.iss)) throw new Error('Emisor inesperado.');
  if (cuerpo.aud !== CLIENT_ID) throw new Error('El token no es de esta aplicacion.');
  if (!cuerpo.exp || cuerpo.exp * 1000 < Date.now()) throw new Error('Token caducado.');
  if (!cuerpo.sub) throw new Error('Token sin identidad.');

  return { sub: cuerpo.sub, email: cuerpo.email || '', name: cuerpo.name || '', picture: cuerpo.picture || '' };
}

// ---------------- Sesiones propias ----------------
const sesiones = new Map(); // token -> { userId, exp }

function crearSesion(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sesiones.set(token, { userId, exp: Date.now() + SESION_MS });
  return token;
}

function usuarioDeSesion(token) {
  const s = sesiones.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { sesiones.delete(token); return null; }
  return s.userId;
}

function cerrarSesion(token) {
  sesiones.delete(token);
}

module.exports = { configurado, CLIENT_ID, verificarCredential, crearSesion, usuarioDeSesion, cerrarSesion };
