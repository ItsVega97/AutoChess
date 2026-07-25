'use strict';

/**
 * Carga de los modelos 3D de los personajes (public/models/<tripulacion>/<id>.glb).
 *
 * Lo usan tanto la escena de combate (fichas en la cubierta) como los retratos
 * de las tarjetas y la Wiki Pirata, asi que vive aparte: un solo indice, una
 * sola descarga por personaje y una sola precarga compartida.
 */

import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const gltfLoader = new GLTFLoader();
const modelFiles = new Map();   // charId -> ArrayBuffer | null (null = no hay modelo)
const modelPending = new Map(); // charId -> Promise<ArrayBuffer|null>

export const MODEL_HEIGHT = 1.15; // alto al que se normaliza cada modelo

// El servidor nos dice de una sola vez que personajes tienen modelo subido y
// con que ruta exacta pedirlo, asi no lanzamos 40 peticiones que en su mayoria
// no existen. Si el endpoint no esta (servidor antiguo), probamos la ruta por
// defecto directamente.
let modelIndex = null;
export function fetchModelIndex() {
  if (!modelIndex) {
    modelIndex = fetch('api/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && d.models && typeof d.models === 'object' ? d.models : null))
      .catch(() => null);
  }
  return modelIndex;
}

function modelUrl(char) {
  const porDefecto = `models/${char.crew}/${char.id}.glb`;
  return fetchModelIndex().then((mapa) => {
    if (!mapa) return porDefecto;
    return mapa[`${char.crew}/${char.id}`.toLowerCase()] || null;
  });
}

// Descarga el .glb una sola vez por personaje. Si no existe se recuerda el
// fallo (null) y no se vuelve a pedir.
export function fetchModelFile(char) {
  if (modelFiles.has(char.id)) return Promise.resolve(modelFiles.get(char.id));
  if (modelPending.has(char.id)) return modelPending.get(char.id);

  const p = modelUrl(char)
    .then((url) => (url ? fetch(url) : null))
    .then((r) => (r && r.ok ? r.arrayBuffer() : null))
    // un .glb empieza por "glTF": si llega otra cosa (una pagina de error, por
    // ejemplo) lo descartamos antes de intentar parsearlo
    .then((buf) => (buf && buf.byteLength > 12 && new DataView(buf).getUint32(0, true) === 0x46546c67 ? buf : null))
    .catch(() => null)
    .then((buf) => {
      modelFiles.set(char.id, buf);
      modelPending.delete(char.id);
      return buf;
    });
  modelPending.set(char.id, p);
  return p;
}

/**
 * Devuelve una instancia nueva del modelo, ya centrada y escalada a
 * MODEL_HEIGHT con los pies en el origen: { root, animations } o null.
 * Cada ficha necesita su propia copia (esqueletos y animaciones no se pueden
 * compartir), asi que se parsea el mismo buffer una vez por ficha.
 */
export function instantiateModel(char) {
  return fetchModelFile(char).then((buf) => {
    if (!buf) return null;
    return new Promise((resolve) => {
      gltfLoader.parse(
        buf.slice(0),
        '',
        (gltf) => {
          const raiz = gltf.scene;
          const caja = new THREE.Box3().setFromObject(raiz);
          const tam = caja.getSize(new THREE.Vector3());
          const centro = caja.getCenter(new THREE.Vector3());
          const escala = tam.y > 0.0001 ? MODEL_HEIGHT / tam.y : 1;
          raiz.scale.setScalar(escala);
          raiz.position.set(-centro.x * escala, -caja.min.y * escala, -centro.z * escala);

          const envoltorio = new THREE.Group();
          envoltorio.add(raiz);
          resolve({ root: envoltorio, animations: gltf.animations || [] });
        },
        () => resolve(null)
      );
    });
  });
}

// Precarga. Un modelo pesa ~1 MB: si se pide justo cuando compras al personaje,
// la ficha tarda un momento en aparecer. Asi que en cuanto entras a la partida
// se van bajando todos en segundo plano, de dos en dos para no ahogar la
// conexion, y los que ya tienes delante se piden aparte y sin esperar cola.
let precargando = false;
export function preloadModels() {
  if (precargando) return;
  precargando = true;
  fetchModelIndex().then((mapa) => {
    if (!mapa) return;
    const cola = Object.keys(mapa).map((k) => {
      const corte = k.indexOf('/');
      return { crew: k.slice(0, corte), id: k.slice(corte + 1) };
    });
    let enVuelo = 0;
    const siguiente = () => {
      while (enVuelo < 2 && cola.length) {
        enVuelo++;
        fetchModelFile(cola.shift()).then(() => { enVuelo--; siguiente(); });
      }
    };
    siguiente();
  });
}

export function warmModels(chars) {
  for (const char of chars) {
    if (char && char.id && !modelFiles.has(char.id) && !modelPending.has(char.id)) fetchModelFile(char);
  }
}
