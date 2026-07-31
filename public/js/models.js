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
 * Caja que ocupa el modelo tal y como se va a dibujar.
 *
 * Con esqueleto (SkinnedMesh) no vale mirar la geometria: los vertices que
 * trae el archivo estan en la pose de enlace y el tamano de verdad sale de las
 * matrices de los huesos. Y Box3.setFromObject tampoco, porque calcula la caja
 * antes de que el esqueleto este listo, se la guarda vacia y ya no la vuelve a
 * calcular: la escala salia 1 y la ficha se quedaba de un pixel, invisible.
 * Asi que se actualiza el esqueleto a mano y se recalcula.
 */
function cajaDelModelo(raiz) {
  const caja = new THREE.Box3();
  const trozo = new THREE.Box3();
  raiz.updateMatrixWorld(true);
  raiz.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.skeleton.update();
      o.boundingBox = null;
      o.computeBoundingBox();
      if (!o.boundingBox || o.boundingBox.isEmpty()) return;
      trozo.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
      caja.union(trozo);
      return;
    }
    const geo = o.geometry;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox) return;
    trozo.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
    caja.union(trozo);
  });
  return caja;
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
          // Se mide con la animacion de reposo puesta, que es la pose en la que
          // se va a ver: la pose de enlace que trae el archivo puede estar
          // centrada en el origen o con los brazos en cruz, y entonces la ficha
          // sale flotando o mas baja de la cuenta.
          const clips = pickClips(gltf.animations || []);
          let mezclador = null;
          if (clips.idle) {
            mezclador = new THREE.AnimationMixer(raiz);
            mezclador.clipAction(clips.idle).play();
            mezclador.update(0);
          }
          const caja = cajaDelModelo(raiz);
          if (mezclador) {
            mezclador.stopAllAction();
            mezclador.uncacheRoot(raiz);
          }
          const tam = caja.getSize(new THREE.Vector3());
          const centro = caja.getCenter(new THREE.Vector3());
          // hay modelos que vienen a escala de centimetros: no se descarta por pequeno
          const escala = tam.y > 1e-6 ? MODEL_HEIGHT / tam.y : 1;
          raiz.scale.setScalar(escala);
          raiz.position.set(-centro.x * escala, -caja.min.y * escala, -centro.z * escala);

          // Al animarse, un modelo con esqueleto se sale de la caja que tenia
          // en reposo; si se deja el recorte por camara puede desaparecer justo
          // al golpear. Son pocas fichas en pantalla, no compensa afinarlo.
          raiz.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });

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

/**
 * Reparte las animaciones que trae un .glb en las tres que usa el juego.
 * Los nombres los pone quien exporta el modelo (Mixamo suele mandar cosas como
 * "Walking" o "Punching Bag"), asi que se buscan por palabras clave y no por
 * posicion. Lo que no encaje se queda como reposo, y si solo hay una animacion
 * esa vale para todo.
 */
// Ojo con el orden: "Standing Run Forward" es andar aunque empiece por
// "Standing", asi que andar y golpear se miran antes que el reposo.
const PISTAS = [
  ['walk', /walk|run|caminar|andar|correr|march/i],
  ['attack', /punch|attack|hit|kick|slash|strike|combat|combo|sword|swing|melee|shoot|cast|golpe|ataque|patada|espada|corte/i],
  ['idle', /idle|gesture|breath|stand|reposo|descans|espera/i],
];
export function pickClips(animations) {
  const clips = { idle: null, walk: null, attack: null };
  const sobran = [];
  for (const clip of animations || []) {
    const nombre = clip.name || '';
    const par = PISTAS.find(([k, re]) => !clips[k] && re.test(nombre));
    if (par) clips[par[0]] = clip;
    else sobran.push(clip);
  }
  // Lo que no se ha reconocido se reparte por los huecos que queden: un modelo
  // con tres animaciones casi siempre trae reposo, andar y golpe, aunque las
  // llame de cualquier manera.
  for (const hueco of ['attack', 'walk', 'idle']) {
    if (!clips[hueco] && sobran.length) clips[hueco] = sobran.shift();
  }
  // y si aun falta alguna, se tira de las que haya
  if (!clips.idle) clips.idle = clips.walk || clips.attack || null;
  return clips;
}

export function warmModels(chars) {
  for (const char of chars) {
    if (char && char.id && !modelFiles.has(char.id) && !modelPending.has(char.id)) fetchModelFile(char);
  }
}
