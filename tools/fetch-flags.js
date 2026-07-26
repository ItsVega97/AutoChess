'use strict';

/**
 * Descarga las banderas piratas (Jolly Roger) de la One Piece Wiki a
 * public/img/crews/.
 *
 *   node tools/fetch-flags.js                 -> las busca solo en la wiki
 *   node tools/fetch-flags.js beast=<url>     -> usa esa URL para esa tripulacion
 *
 * Busca cada bandera con la API de MediaWiki (no hay que saberse la ruta con
 * hash de Fandom) y se queda con el primer archivo cuyo titulo pegue. Si alguna
 * no la encuentra o sale la que no es, se le pasa la URL a mano como arriba:
 * en la wiki, clic derecho sobre la imagen -> "Copiar dirección de la imagen".
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const WIKI = 'https://onepiece.fandom.com/es';
const DESTINO = path.join(__dirname, '..', 'public', 'img', 'crews');

// Palabras con las que buscar la bandera de cada tripulacion en la wiki
const TRIPULACIONES = {
  strawhat: ['Jolly Roger Piratas de Sombrero de Paja', 'Sombrero de Paja bandera'],
  whitebeard: ['Jolly Roger Piratas de Barbablanca', 'Barbablanca bandera'],
  bigmom: ['Jolly Roger Piratas de Big Mom', 'Big Mom bandera'],
  beast: ['Jolly Roger Piratas Bestia', 'Piratas Bestia bandera'],
  redhair: ['Jolly Roger Piratas Pelirrojos', 'Pelirrojos bandera'],
  blackbeard: ['Jolly Roger Piratas de Barbanegra', 'Barbanegra bandera'],
  roger: ['Jolly Roger Piratas de Roger', 'Piratas de Roger bandera'],
  baroque: ['Jolly Roger Baroque Works', 'Baroque Works bandera'],
};

const CABECERAS = {
  // Fandom rechaza peticiones sin User-Agent identificable
  'User-Agent': 'NakamaRoyale/1.0 (descarga puntual de banderas para un proyecto de fan)',
};

function pedir(url, binario = false) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: CABECERAS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(pedir(res.headers.location, binario));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const trozos = [];
      res.on('data', (d) => trozos.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(trozos);
        resolve(binario ? buf : buf.toString('utf8'));
      });
    }).on('error', reject);
  });
}

async function buscarArchivo(consulta) {
  const url = `${WIKI}/api.php?action=query&format=json&list=search&srnamespace=6`
    + `&srlimit=8&srsearch=${encodeURIComponent(consulta)}`;
  const datos = JSON.parse(await pedir(url));
  const resultados = (datos.query && datos.query.search) || [];
  // Preferimos los que mencionen "jolly" o "bandera" en el titulo
  const ordenados = resultados.sort((a, b) => puntua(b.title) - puntua(a.title));
  return ordenados.map((r) => r.title);
}

function puntua(titulo) {
  const t = titulo.toLowerCase();
  let p = 0;
  if (t.includes('jolly')) p += 3;
  if (t.includes('bandera')) p += 2;
  if (/\.(png|svg|webp)$/i.test(t)) p += 1;
  if (t.includes('anime') || t.includes('manga')) p -= 1;
  return p;
}

async function urlDeArchivo(titulo) {
  const url = `${WIKI}/api.php?action=query&format=json&prop=imageinfo&iiprop=url`
    + `&titles=${encodeURIComponent(titulo)}`;
  const datos = JSON.parse(await pedir(url));
  const paginas = (datos.query && datos.query.pages) || {};
  for (const p of Object.values(paginas)) {
    if (p.imageinfo && p.imageinfo[0] && p.imageinfo[0].url) return p.imageinfo[0].url;
  }
  return null;
}

async function main() {
  fs.mkdirSync(DESTINO, { recursive: true });

  // URLs pasadas a mano: tripulacion=url
  const manuales = {};
  for (const arg of process.argv.slice(2)) {
    const i = arg.indexOf('=');
    if (i > 0) manuales[arg.slice(0, i)] = arg.slice(i + 1);
  }

  const fallos = [];
  for (const [crew, consultas] of Object.entries(TRIPULACIONES)) {
    try {
      let url = manuales[crew] || null;
      let titulo = url ? '(URL indicada a mano)' : null;

      if (!url) {
        for (const c of consultas) {
          const titulos = await buscarArchivo(c);
          for (const t of titulos.slice(0, 3)) {
            url = await urlDeArchivo(t);
            if (url) { titulo = t; break; }
          }
          if (url) break;
        }
      }
      if (!url) throw new Error('no se encontro ninguna imagen');

      const datos = await pedir(url.replace(/\/revision\/latest.*$/, ''), true);
      if (datos.length < 200) throw new Error('la descarga vino vacia');
      const ext = (url.match(/\.(png|webp|svg|jpe?g)/i) || ['.png'])[0].toLowerCase();
      const destino = path.join(DESTINO, `${crew}${ext === '.jpeg' ? '.jpg' : ext}`);
      fs.writeFileSync(destino, datos);
      console.log(`OK   ${crew.padEnd(11)} ${(datos.length / 1024).toFixed(0).padStart(4)} KB  <- ${titulo}`);
    } catch (e) {
      fallos.push(crew);
      console.log(`FALLO ${crew.padEnd(10)} ${e.message}`);
    }
  }

  console.log('');
  if (fallos.length) {
    console.log('No se pudieron bajar:', fallos.join(', '));
    console.log('Pasales la URL a mano, por ejemplo:');
    console.log(`  node tools/fetch-flags.js ${fallos[0]}=https://static.wikia.nocookie.net/.../bandera.png`);
  } else {
    console.log('Las 8 banderas estan en public/img/crews/. Recarga el juego y listo.');
  }
  console.log('Revisa que la imagen sea la que toca: la busqueda de la wiki acierta casi siempre, pero no siempre.');
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
