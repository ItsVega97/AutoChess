'use strict';

/**
 * Retratos de los personajes sacados de su propio modelo 3D.
 *
 * No hay imagenes 2D de los personajes, pero si modelos: renderizamos cada uno
 * una sola vez en un lienzo pequeno y reutilizamos el PNG resultante en la
 * tienda, el banquillo y la Wiki. Un personaje sin modelo devuelve null y se
 * queda con sus iniciales de siempre.
 */

import * as THREE from '../vendor/three.module.min.js';
import { instantiateModel, MODEL_HEIGHT } from './models.js';

const TAM = 192;               // lado del retrato en pixeles
const cache = new Map();       // charId -> dataURL | null
const pendientes = new Map();  // charId -> Promise

let render = null;
let escena = null;
let camara = null;

function prepara() {
  if (render) return;
  render = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  render.setPixelRatio(1);
  render.setSize(TAM, TAM);
  render.outputColorSpace = THREE.SRGBColorSpace;

  escena = new THREE.Scene();
  // Luz parecida a la de la cubierta, para que el retrato y la ficha peguen
  escena.add(new THREE.HemisphereLight('#dff0ff', '#4a5a6a', 1.15));
  const sol = new THREE.DirectionalLight('#fff3d6', 1.5);
  sol.position.set(2, 4, 3);
  escena.add(sol);
  const relleno = new THREE.DirectionalLight('#bcd8ff', 0.5);
  relleno.position.set(-3, 1, 2);
  escena.add(relleno);

  camara = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
}

/**
 * Devuelve una promesa con el dataURL del retrato del personaje, o null si no
 * tiene modelo. El encuadre es de medio cuerpo, que es lo que se reconoce a
 * tamano de icono.
 */
export function getThumb(char) {
  if (cache.has(char.id)) return Promise.resolve(cache.get(char.id));
  if (pendientes.has(char.id)) return pendientes.get(char.id);

  const p = instantiateModel(char).then((res) => {
    if (!res) { cache.set(char.id, null); return null; }
    prepara();

    escena.add(res.root);
    // Encuadre: de la cintura para arriba, ligeramente de tres cuartos
    const alto = MODEL_HEIGHT;
    res.root.rotation.y = -0.35;
    camara.position.set(0.42, alto * 0.92, 1.18);
    camara.lookAt(0, alto * 0.8, 0);
    camara.updateProjectionMatrix();

    render.render(escena, camara);
    const url = render.domElement.toDataURL('image/png');

    escena.remove(res.root);
    disponer(res.root);
    cache.set(char.id, url);
    pendientes.delete(char.id);
    return url;
  }).catch(() => {
    cache.set(char.id, null);
    pendientes.delete(char.id);
    return null;
  });

  pendientes.set(char.id, p);
  return p;
}

// Si ya esta hecho lo damos al momento, para pintar sin parpadeo al redibujar
export function getThumbSync(char) {
  return cache.get(char.id) || null;
}

function disponer(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
