#!/usr/bin/env node
'use strict';

/**
 * De Mixamo al juego, en un solo paso.
 *
 * Mixamo te descarga los .fbx sueltos, uno por animacion, y el juego necesita
 * UN .glb con todas dentro. Juntarlos a mano en Blender es un rato por
 * personaje, y son 40. Esto lo hace solo:
 *
 *   1. convierte cada .fbx a .glb (FBX2glTF)
 *   2. coge el que trae el modelo (el que bajaste "With Skin") como base
 *   3. le pega las animaciones de los demas, reenganchando cada pista al
 *      hueso que le toca por NOMBRE (los esqueletos de Mixamo son iguales, pero
 *      cada archivo trae su propia copia; si no se reengancha, la animacion
 *      mueve un esqueleto invisible y la ficha se queda en pose de T)
 *   4. las renombra a Idle / Walking / Punch / Death, que es lo que reconoce
 *      pickClips() en public/js/models.js
 *   5. avisa si alguna viene vacia (Mixamo a veces exporta clips de 2 claves y
 *      0,07 s que no mueven nada: es lo que le paso a Zoro, Rayleigh y Shiryu)
 *   6. optimiza texturas a WebP 1024 y guarda el resultado
 *
 * Uso (la muerte es opcional, las otras tres no):
 *   node tools/mixamo-a-glb.js --idle reposo.fbx --walk andar.fbx \
 *        --attack golpe.fbx --death muerte.fbx \
 *        --salida public/models/redhair/shanks.glb
 *
 * Tambien acepta .glb de entrada, por si tu herramienta ya exporta en ese
 * formato y te saltas la conversion.
 *
 * Hace falta una vez:
 *   npm install --no-save fbx2gltf @gltf-transform/core @gltf-transform/functions
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// ---------------- Dependencias ----------------
let NodeIO, prune, dedup, textureCompress, mergeDocuments, ALL_EXTENSIONS, sharp;
try {
  ({ NodeIO } = require('@gltf-transform/core'));
  ({ prune, dedup, textureCompress, mergeDocuments } = require('@gltf-transform/functions'));
  // Sin esto no se pueden ni leer ni escribir texturas WebP (EXT_texture_webp),
  // que es justo lo que deja el paso de optimizacion
  ({ ALL_EXTENSIONS } = require('@gltf-transform/extensions'));
} catch (e) {
  console.error('Faltan librerias. Instala una vez:\n' +
    '  npm install --no-save fbx2gltf @gltf-transform/core @gltf-transform/functions \\\n' +
    '    @gltf-transform/extensions sharp\n');
  process.exit(1);
}
try { sharp = require('sharp'); } catch (e) { /* sin sharp no se tocan las texturas */ }

function rutaFbx2gltf() {
  try {
    const base = path.dirname(require.resolve('fbx2gltf'));
    const bin = path.join(base, 'bin', os.platform() === 'win32' ? 'Windows_NT'
      : os.platform() === 'darwin' ? 'Darwin' : 'Linux',
      os.platform() === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');
    return fs.existsSync(bin) ? bin : null;
  } catch (e) { return null; }
}

// ---------------- Argumentos ----------------
function leerArgs(argv) {
  const args = { salida: null, modelo: null, clips: {} };
  const alias = {
    idle: 'idle', reposo: 'idle',
    walk: 'walk', andar: 'walk',
    attack: 'attack', golpe: 'attack',
    death: 'death', muerte: 'death',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const clave = a.slice(2).toLowerCase();
    const valor = argv[++i];
    if (clave === 'salida' || clave === 'out') args.salida = valor;
    else if (clave === 'modelo' || clave === 'model') args.modelo = valor;
    else if (alias[clave]) args.clips[alias[clave]] = valor;
    else console.warn(`Opcion desconocida, la ignoro: --${clave}`);
  }
  return args;
}

const DUR_MINIMA = 0.2; // el mismo umbral que usa el juego para descartar clips vacios
// Los nombres que reconoce pickClips() sin ambiguedad
const NOMBRE_FINAL = { idle: 'Idle', walk: 'Walking', attack: 'Punch', death: 'Death' };
const ROLES = ['idle', 'walk', 'attack', 'death'];
const OBLIGATORIOS = ['idle', 'walk', 'attack']; // la muerte es opcional

// ---------------- Conversion ----------------
function aGlb(entrada, tmp) {
  if (entrada.toLowerCase().endsWith('.glb') || entrada.toLowerCase().endsWith('.gltf')) return entrada;
  const bin = rutaFbx2gltf();
  if (!bin) {
    console.error('No encuentro FBX2glTF. Instala: npm install --no-save fbx2gltf');
    process.exit(1);
  }
  const destino = path.join(tmp, `${path.basename(entrada, path.extname(entrada))}.glb`);
  // --binary saca .glb de una pieza; --keep-attribute deja los pesos del esqueleto
  execFileSync(bin, ['--binary', '--input', entrada, '--output', destino], { stdio: 'pipe' });
  return destino;
}

// ---------------- Union de animaciones ----------------
/**
 * Mete en `base` la primera animacion de `extra`, reenganchando cada pista al
 * nodo del esqueleto de `base` que se llame igual.
 */
function pegarAnimacion(base, extra, nombreFinal, porNombre) {
  const nodosAntes = new Set(base.getRoot().listNodes());
  const escenasAntes = new Set(base.getRoot().listScenes());
  const animsAntes = new Set(base.getRoot().listAnimations());

  mergeDocuments(base, extra);

  const nuevas = base.getRoot().listAnimations().filter((a) => !animsAntes.has(a));
  if (!nuevas.length) return null;

  // Nos quedamos con la mas larga: si el archivo trae varias, la buena es esa
  nuevas.sort((a, b) => duracion(b) - duracion(a));
  const elegida = nuevas[0];
  for (const sobra of nuevas.slice(1)) sobra.dispose();

  let reenganchadas = 0;
  let huerfanas = 0;
  for (const canal of elegida.listChannels()) {
    const destino = canal.getTargetNode();
    if (!destino) continue;
    const original = porNombre.get(destino.getName());
    if (original && original !== destino) { canal.setTargetNode(original); reenganchadas++; }
    else if (!original) huerfanas++;
  }
  if (huerfanas) {
    console.warn(`  aviso: ${huerfanas} pistas no encontraron su hueso en el modelo base ` +
      '(¿los dos archivos salen del mismo rig de Mixamo?)');
  }

  elegida.setName(nombreFinal);

  // Fuera YA la escena y el esqueleto duplicados que ha traido el merge. Si se
  // dejan para la limpieza final, en la siguiente vuelta habria dos huesos con
  // el mismo nombre y la animacion se engancharia al duplicado, que luego se
  // borra: la ficha se quedaria clavada en pose de T.
  for (const s of base.getRoot().listScenes()) if (!escenasAntes.has(s)) s.dispose();
  for (const n of base.getRoot().listNodes()) if (!nodosAntes.has(n)) n.dispose();

  return { anim: elegida, reenganchadas };
}

// Los huesos del modelo base, por nombre. Se calcula UNA vez, antes de juntar
// nada, para que nunca apunte a un duplicado.
function mapaDeHuesos(doc) {
  const porNombre = new Map();
  for (const n of doc.getRoot().listNodes()) {
    const nom = n.getName();
    if (nom && !porNombre.has(nom)) porNombre.set(nom, n);
  }
  return porNombre;
}

// Cada archivo que juntamos trae su propio buffer de datos, y un .glb solo
// admite uno: se pasa todo al primero y se tiran los demas.
function unificarBuffers(doc) {
  const buffers = doc.getRoot().listBuffers();
  if (buffers.length < 2) return;
  const principal = buffers[0];
  for (const acc of doc.getRoot().listAccessors()) acc.setBuffer(principal);
  for (const sobra of buffers.slice(1)) sobra.dispose();
}

function duracion(anim) {
  let max = 0;
  for (const s of anim.listSamplers()) {
    const entrada = s.getInput();
    if (!entrada) continue;
    const arr = entrada.getArray();
    if (arr && arr.length) max = Math.max(max, arr[arr.length - 1]);
  }
  return max;
}

// ---------------- Principal ----------------
async function main() {
  const args = leerArgs(process.argv.slice(2));
  const faltan = OBLIGATORIOS.filter((k) => !args.clips[k]);
  if (faltan.length || !args.salida) {
    console.error('Uso:\n  node tools/mixamo-a-glb.js --idle reposo.fbx --walk andar.fbx \\\n' +
      '       --attack golpe.fbx [--death muerte.fbx] \\\n' +
      '       --salida public/models/redhair/shanks.glb\n\n' +
      'Para reaprovechar las animaciones de otro personaje (mismo esqueleto):\n' +
      '  node tools/mixamo-a-glb.js --modelo shanks.glb --idle otro.glb ...\n');
    if (faltan.length) console.error(`Falta: ${faltan.map((f) => `--${f}`).join(', ')}`);
    if (!args.salida) console.error('Falta: --salida');
    process.exit(1);
  }
  for (const [rol, f] of Object.entries(args.clips)) {
    if (!fs.existsSync(f)) { console.error(`No existe el archivo de ${rol}: ${f}`); process.exit(1); }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mixamo-'));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  try {
    console.log('Convirtiendo a glTF...');
    const glbs = {};
    for (const [rol, f] of Object.entries(args.clips)) {
      glbs[rol] = aGlb(f, tmp);
      console.log(`  ${rol.padEnd(6)} ${path.basename(f)}`);
    }

    const docs = {};
    for (const [rol, g] of Object.entries(glbs)) docs[rol] = await io.read(g);

    // Con --modelo, el personaje viene de un archivo aparte y TODAS las
    // animaciones se pegan encima: es el caso de reaprovechar las de otro
    // personaje que se rigeo con el mismo esqueleto.
    let base;
    let rolBase = null;
    const resumen = [];
    if (args.modelo) {
      base = await io.read(aGlb(args.modelo, tmp));
      for (const vieja of base.getRoot().listAnimations()) vieja.dispose();
      console.log(`\nModelo: ${path.basename(args.modelo)} ` +
        `(${base.getRoot().listMeshes().length} mallas, ${base.getRoot().listNodes().length} nodos)`);
    } else {
      // La base es la que trae el modelo (la que bajaste "With Skin").
      // Si hay varias con malla, vale la de reposo.
      const conMalla = Object.keys(docs).filter((r) => docs[r].getRoot().listMeshes().length > 0);
      if (!conMalla.length) {
        console.error('\nNinguno de los archivos trae el modelo.\n' +
          'En Mixamo, descarga UNA de las animaciones con "With Skin", o pasa el\n' +
          'personaje aparte con --modelo.');
        process.exit(1);
      }
      rolBase = conMalla.includes('idle') ? 'idle' : conMalla[0];
      base = docs[rolBase];
      console.log(`\nModelo base: ${rolBase} (${base.getRoot().listMeshes().length} mallas, ` +
        `${base.getRoot().listNodes().length} nodos)`);

      // La animacion que ya venia en la base se queda, solo se renombra
      const suyas = base.getRoot().listAnimations();
      if (suyas.length) {
        suyas.sort((a, b) => duracion(b) - duracion(a));
        suyas[0].setName(NOMBRE_FINAL[rolBase]);
        for (const sobra of suyas.slice(1)) sobra.dispose();
        resumen.push({ rol: rolBase, nombre: NOMBRE_FINAL[rolBase], dur: duracion(suyas[0]) });
      }
    }

    console.log('\nPegando animaciones...');
    const porNombre = mapaDeHuesos(base);
    for (const rol of ROLES) {
      if (!args.clips[rol]) continue;
      if (rol === rolBase) continue;
      const r = pegarAnimacion(base, docs[rol], NOMBRE_FINAL[rol], porNombre);
      if (!r) { console.warn(`  ${rol}: el archivo no trae ninguna animacion`); continue; }
      resumen.push({ rol, nombre: NOMBRE_FINAL[rol], dur: duracion(r.anim) });
      console.log(`  ${rol.padEnd(6)} -> "${NOMBRE_FINAL[rol]}" (${r.reenganchadas} pistas reenganchadas)`);
    }

    console.log('\nLimpiando y optimizando...');
    const pasos = [dedup(), prune()];
    if (sharp) {
      pasos.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }));
    } else {
      console.warn('  (sin sharp instalado: las texturas se quedan como estan)');
    }
    // OJO: nada de quantize. Con modelos con esqueleto la descuantizacion se
    // mete en las matrices de los huesos y la ficha sale a escala absurda.
    await base.transform(...pasos);
    unificarBuffers(base);

    fs.mkdirSync(path.dirname(args.salida), { recursive: true });
    await io.write(args.salida, base);

    // ---------------- Informe ----------------
    const kb = (fs.statSync(args.salida).size / 1024).toFixed(0);
    console.log(`\nListo: ${args.salida} (${kb} KB)\n`);
    console.log('Animaciones:');
    let hayVacias = false;
    for (const r of resumen) {
      const vacia = r.dur < DUR_MINIMA;
      if (vacia) hayVacias = true;
      console.log(`  ${vacia ? 'VACIA' : '  ok '} ${r.nombre.padEnd(10)} ${r.dur.toFixed(2)}s`);
    }
    if (hayVacias) {
      console.log('\nAVISO: alguna animacion dura menos de ' + DUR_MINIMA + 's, o sea que no mueve nada.');
      console.log('Vuelve a Mixamo, comprueba que la vista previa se mueve, y descargala otra vez');
      console.log('con FBX Binary, 30 fps y SIN "keyframe reduction".');
      console.log('El juego la descartara y tirara de otra, asi que la ficha se vera rara.');
      process.exit(2);
    }
    if (resumen.length < OBLIGATORIOS.length) {
      console.log('\nAVISO: faltan animaciones. El juego rellenara los huecos con las que haya.');
    }
    if (!args.clips.death) {
      console.log('\nSin animacion de muerte: la ficha se quedara en reposo al caer.');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error('\nHa fallado:', e.message); process.exit(1); });
