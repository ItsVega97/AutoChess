'use strict';

/**
 * Escenario 3D del combate: la cubierta de un barco pirata en alta mar.
 *
 * El resto del juego (game.js) le habla en "coordenadas de render": columna
 * 0..cols-1 y fila 0..rows-1, donde la fila 0 es la mitad enemiga (al fondo)
 * y la ultima fila es la tuya (cerca de la camara). Asi este modulo no
 * necesita saber de que lado juega cada uno.
 */

import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const TILE = 1.0;          // tamano de casilla en unidades del mundo
const DECK_MARGIN = 1.15;  // cubierta extra alrededor del tablero

// Colores de cada tripulacion (mismos tonos que la interfaz 2D)
const CREW_COLORS = {
  strawhat: '#e8542f',
  whitebeard: '#3d7dc9',
  bigmom: '#e35fc0',
  beast: '#8b5cf6',
  redhair: '#d1293f',
  blackbeard: '#5c5468',
  roger: '#e8b94a',
  baroque: '#e8862f',
};

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#7ec8f0');
  scene.fog = new THREE.Fog('#7ec8f0', 34, 88);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // ---------------- Luces ----------------
  scene.add(new THREE.HemisphereLight('#cfeaff', '#3b6b4a', 1.05));
  const sun = new THREE.DirectionalLight('#fff3d6', 1.25);
  sun.position.set(6, 12, 5);
  scene.add(sun);

  // ---------------- Mar ----------------
  const oceanGeo = new THREE.PlaneGeometry(120, 120, 24, 24);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanMat = new THREE.MeshStandardMaterial({ color: '#1d6fb8', roughness: 0.55, metalness: 0.1 });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.position.y = -1.4;
  scene.add(ocean);
  const oceanBase = Float32Array.from(oceanGeo.attributes.position.array);

  // Grupo que contiene barco + tablero, centrado en el origen
  const world = new THREE.Group();
  scene.add(world);

  let cols = 5;
  let rows = 6;
  const tiles = [];
  let tileGroup = null;
  let shipGroup = null;

  // Convierte coordenadas de render (col,row) a posicion en el mundo
  function cellToWorld(col, row) {
    return {
      x: (col - (cols - 1) / 2) * TILE,
      z: (row - (rows - 1) / 2) * TILE,
    };
  }

  // ---------------- Construccion del barco ----------------
  function buildShip() {
    if (shipGroup) {
      world.remove(shipGroup);
      disposeTree(shipGroup);
    }
    shipGroup = new THREE.Group();

    const deckW = cols * TILE + DECK_MARGIN * 2;
    const deckD = rows * TILE + DECK_MARGIN * 2;

    // Casco: caja ancha que se estrecha hacia abajo (con la proa apuntando al fondo)
    const hullMat = new THREE.MeshStandardMaterial({ color: '#6b3f22', roughness: 0.85 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(deckW, 1.5, deckD), hullMat);
    hull.position.y = -0.85;
    shipGroup.add(hull);

    const hullBottom = new THREE.Mesh(new THREE.BoxGeometry(deckW * 0.72, 0.9, deckD * 0.78), hullMat);
    hullBottom.position.y = -1.75;
    shipGroup.add(hullBottom);

    // Proa (triangulo al fondo) para que se lea como un barco
    const bowShape = new THREE.Shape();
    bowShape.moveTo(-deckW / 2, 0);
    bowShape.lineTo(deckW / 2, 0);
    bowShape.lineTo(0, -2.2);
    bowShape.lineTo(-deckW / 2, 0);
    const bowGeo = new THREE.ExtrudeGeometry(bowShape, { depth: 1.5, bevelEnabled: false });
    bowGeo.rotateX(Math.PI / 2);
    const bow = new THREE.Mesh(bowGeo, hullMat);
    bow.position.set(0, -0.1, -deckD / 2);
    shipGroup.add(bow);

    // Cubierta de tablones: franjas alternas de madera
    const plankLight = new THREE.MeshStandardMaterial({ color: '#c99a5b', roughness: 0.9 });
    const plankDark = new THREE.MeshStandardMaterial({ color: '#b9873f', roughness: 0.9 });
    const plankCount = Math.round(deckD / 0.55);
    const plankD = deckD / plankCount;
    for (let i = 0; i < plankCount; i++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(deckW, 0.18, plankD * 0.94),
        i % 2 === 0 ? plankLight : plankDark
      );
      plank.position.set(0, -0.09, -deckD / 2 + plankD * (i + 0.5));
      shipGroup.add(plank);
    }

    // Barandilla perimetral
    const railMat = new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.8 });
    const postGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.55, 6);
    const addRail = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.09), railMat);
      bar.position.set((x1 + x2) / 2, 0.42, (z1 + z2) / 2);
      bar.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      shipGroup.add(bar);
      const posts = Math.max(2, Math.round(len / 0.9));
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        const post = new THREE.Mesh(postGeo, railMat);
        post.position.set(x1 + (x2 - x1) * t, 0.18, z1 + (z2 - z1) * t);
        shipGroup.add(post);
      }
    };
    const hw = deckW / 2 - 0.12;
    const hd = deckD / 2 - 0.12;
    addRail(-hw, -hd, -hw, hd);
    addRail(hw, -hd, hw, hd);
    addRail(-hw, hd, hw, hd); // popa (detras del jugador)

    // Mastil con vela y bandera pirata, plantado detras de la proa
    const mastMat = new THREE.MeshStandardMaterial({ color: '#7a4a24', roughness: 0.8 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 5.2, 8), mastMat);
    mast.position.set(0, 2.5, -hd - 1.0);
    shipGroup.add(mast);

    const yard = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.12, 0.12), mastMat);
    yard.position.set(0, 3.85, -hd - 1.0);
    shipGroup.add(yard);

    const sailMat = new THREE.MeshStandardMaterial({
      color: '#f4ead6', roughness: 1, side: THREE.DoubleSide,
    });
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.4, 6, 4), sailMat);
    // ondula ligeramente la vela para que no parezca un cartel plano
    const sp = sail.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      sp.setZ(i, Math.sin(sp.getX(i) * 1.5) * 0.18);
    }
    sp.needsUpdate = true;
    sail.geometry.computeVertexNormals();
    sail.position.set(0, 2.6, -hd - 0.95);
    shipGroup.add(sail);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.66),
      new THREE.MeshStandardMaterial({ map: makeJollyRogerTexture(), side: THREE.DoubleSide, roughness: 1 })
    );
    flag.position.set(0.5, 4.75, -hd - 1.0);
    shipGroup.add(flag);

    // Props: barriles y cajas en las esquinas de la cubierta
    const barrelMat = new THREE.MeshStandardMaterial({ color: '#8a5a2e', roughness: 0.85 });
    const crateMat = new THREE.MeshStandardMaterial({ color: '#a9793c', roughness: 0.9 });
    const props = [
      [-hw + 0.55, hd - 0.6, 'barrel'],
      [hw - 0.55, hd - 0.6, 'crate'],
      [-hw + 0.5, -hd + 0.7, 'crate'],
      [hw - 0.5, -hd + 0.7, 'barrel'],
    ];
    for (const [px, pz, kind] of props) {
      let m;
      if (kind === 'barrel') {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.68, 10), barrelMat);
        m.position.set(px, 0.34, pz);
      } else {
        m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.62), crateMat);
        m.position.set(px, 0.27, pz);
        m.rotation.y = Math.random() * 0.6;
      }
      shipGroup.add(m);
    }

    world.add(shipGroup);
  }

  // ---------------- Casillas del tablero ----------------
  function buildTiles() {
    if (tileGroup) {
      world.remove(tileGroup);
      disposeTree(tileGroup);
    }
    tiles.length = 0;
    tileGroup = new THREE.Group();
    const geo = new THREE.BoxGeometry(TILE * 0.9, 0.06, TILE * 0.9);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const mine = row >= rows / 2;
        const mat = new THREE.MeshStandardMaterial({
          color: mine ? '#3f8f5a' : '#a04747',
          transparent: true,
          opacity: 0.5,
          roughness: 0.7,
        });
        const tile = new THREE.Mesh(geo, mat);
        const { x, z } = cellToWorld(col, row);
        tile.position.set(x, 0.04, z);
        tile.userData = { col, row, mine, baseColor: mine ? '#3f8f5a' : '#a04747' };
        tileGroup.add(tile);
        tiles.push(tile);
      }
    }
    world.add(tileGroup);
  }

  // ---------------- Camara ----------------
  // Franjas de pantalla tapadas por la interfaz superpuesta (HUD arriba,
  // tienda abajo). El tablero se encuadra en el hueco que queda libre.
  let insetTop = 0;
  let insetBottom = 0;
  function setInsets(top, bottom) {
    insetTop = top || 0;
    insetBottom = bottom || 0;
    placeCamera();
  }

  // Vista en angulo desde detras de tu mitad, estilo Tactics Royale.
  // La distancia se calcula para que el tablero llene el hueco visible tanto en
  // moviles (altos y estrechos) como en escritorio (anchos y bajos).
  function placeCamera() {
    const boardW = cols * TILE;
    const boardD = rows * TILE;
    const fov = (camera.fov * Math.PI) / 180;
    const w = renderer.domElement.clientWidth || 1;
    const h = renderer.domElement.clientHeight || 1;

    // Alto realmente disponible una vez descontada la interfaz
    const freeH = Math.max(120, h - insetTop - insetBottom);
    const freeAspect = w / freeH;

    const halfW = boardW / 2 + 1.4;          // margen lateral para el casco
    const halfH = (boardD / 2 + 1.2) * 0.92; // el tablero se ve escorzado
    const needed = Math.max(halfH, halfW / freeAspect);
    // El encuadre se calcula sobre freeH pero se renderiza en h: hay que
    // compensar para que el tablero conserve el tamano pensado.
    const dist = (needed / Math.tan(fov / 2)) * (h / freeH);

    const pitch = (44 * Math.PI) / 180;
    camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist + boardD * 0.12);
    camera.lookAt(0, 1.1, -0.5);

    // Desplaza el encuadre para centrarlo en el hueco libre en vez de en el
    // centro del lienzo, asi la cubierta no queda debajo de la tienda.
    const centroLibre = insetTop + freeH / 2;
    const desplazamiento = centroLibre - h / 2;
    camera.setViewOffset(w, h, 0, -desplazamiento, w, h);
    camera.updateProjectionMatrix();
  }

  function setBoard(nextCols, nextRows) {
    cols = nextCols;
    rows = nextRows;
    buildShip();
    buildTiles();
    placeCamera();
  }

  // ---------------- Fichas (standees) ----------------
  // Cada ficha es una peana 3D con un panel vertical que muestra el retrato
  // del personaje (o su cartel de iniciales si aun no hay imagen).
  const tokens = new Map(); // uid -> { group, panelMat, ... }
  const textureCache = new Map(); // charId -> THREE.CanvasTexture
  const portraitImages = new Map(); // charId -> HTMLImageElement

  const baseGeo = new THREE.CylinderGeometry(0.38, 0.42, 0.12, 16);
  const ringGeo = new THREE.TorusGeometry(0.39, 0.05, 8, 20);
  const panelGeo = new THREE.PlaneGeometry(0.92, 1.15);
  const shadowGeo = new THREE.CircleGeometry(0.38, 16);
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28 });
  shadowGeo.rotateX(-Math.PI / 2);

  // La textura incluye las estrellas, asi que la cache va por personaje Y nivel
  function getCharTexture(char) {
    const key = `${char.id}|${char.star || 0}`;
    const cached = textureCache.get(key);
    if (cached) return cached;
    const tex = new THREE.CanvasTexture(drawCharCanvas(char, portraitImages.get(char.id)));
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(key, tex);

    // Si tiene retrato, lo cargamos y regeneramos las texturas al llegar
    if (char.portrait && !portraitImages.has(char.id)) {
      const img = new Image();
      img.onload = () => {
        portraitImages.set(char.id, img);
        // hay una textura por nivel de estrella: hay que refrescarlas todas
        for (const [k, t] of textureCache) {
          if (!k.startsWith(`${char.id}|`)) continue;
          const star = Number(k.split('|')[1]) || 0;
          t.image = drawCharCanvas({ ...char, star }, img);
          t.needsUpdate = true;
        }
      };
      img.onerror = () => portraitImages.set(char.id, null); // se queda el cartel de iniciales
      img.src = `/img/characters/${char.portrait}`;
      portraitImages.set(char.id, undefined); // marca "cargando"
    }
    return tex;
  }

  // ---------------- Modelos 3D opcionales ----------------
  // Si existe public/models/<tripulacion>/<id>.glb se usa en lugar del cartel.
  // Se intenta una sola vez por personaje; si no esta (404) o falla, se queda
  // el cartel para siempre y no se vuelve a pedir.
  const gltfLoader = new GLTFLoader();
  const modelFiles = new Map();   // charId -> ArrayBuffer | null (null = no hay modelo)
  const modelPending = new Map(); // charId -> Promise<ArrayBuffer|null>
  const mixers = new Set();       // animaciones activas, una por ficha con modelo
  const MODEL_HEIGHT = 1.15;      // alto objetivo, similar al del cartel

  // El servidor nos dice de una sola vez que personajes tienen modelo subido y
  // con que ruta exacta pedirlo, asi no lanzamos 40 peticiones que en su
  // mayoria no existen. Si el endpoint no esta (servidor antiguo), probamos la
  // ruta por defecto directamente.
  let modelIndex = null;
  function fetchModelIndex() {
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

  // Precarga. Un modelo pesa ~1 MB: si se pide justo cuando compras al
  // personaje, la ficha tarda un momento en aparecer. Asi que en cuanto entras
  // a la partida se van bajando todos en segundo plano, de dos en dos para no
  // ahogar la conexion, y los que ya estan en la tienda o en tu equipo se piden
  // aparte y sin esperar cola.
  let precargando = false;
  function preloadModels() {
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

  // Los personajes que ya tienes delante van primero
  function warmModels(chars) {
    for (const char of chars) {
      if (char && char.id && !modelFiles.has(char.id) && !modelPending.has(char.id)) fetchModelFile(char);
    }
  }

  // Descarga el .glb una sola vez por personaje. Si no existe se recuerda el
  // fallo (null) y no se vuelve a pedir: esa ficha se queda con su cartel.
  function fetchModelFile(char) {
    if (modelFiles.has(char.id)) return Promise.resolve(modelFiles.get(char.id));
    if (modelPending.has(char.id)) return modelPending.get(char.id);

    const p = modelUrl(char)
      .then((url) => (url ? fetch(url) : null))
      .then((r) => (r && r.ok ? r.arrayBuffer() : null))
      // un .glb empieza por "glTF": si llega otra cosa (una pagina de error,
      // por ejemplo) lo descartamos antes de intentar parsearlo
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

  // Cada ficha necesita su propia copia (esqueletos y animaciones no se pueden
  // compartir), asi que parseamos el mismo buffer una vez por ficha.
  function instantiateModel(char) {
    return fetchModelFile(char).then((buf) => {
      if (!buf) return null;
      return new Promise((resolve) => {
        gltfLoader.parse(
          buf.slice(0),
          '',
          (gltf) => {
            const raiz = gltf.scene;
            // El modelo puede venir a cualquier escala y con el origen en
            // cualquier sitio: lo centramos y lo ajustamos al alto de casilla.
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

  // Instancias ya parseadas que han quedado libres, por personaje. Entre ronda
  // y ronda las fichas se destruyen y se vuelven a crear: reutilizarlas evita
  // volver a parsear el .glb (y el parpadeo del cartel mientras tanto).
  const modelPool = new Map();
  function takeFromPool(char) {
    const libres = modelPool.get(char.id);
    return libres && libres.length ? libres.pop() : null;
  }
  function returnToPool(char, res) {
    let libres = modelPool.get(char.id);
    if (!libres) modelPool.set(char.id, (libres = []));
    if (libres.length < 8) libres.push(res); // tope por si acaso
    else disposeTree(res.root);
  }

  // Sustituye el cartel de una ficha por su modelo 3D cuando este disponible
  function attachModel(tok, char) {
    // Si ya hay una instancia libre la ponemos en el mismo momento, sin esperar
    const libre = takeFromPool(char);
    if (libre) { useModel(tok, char, libre); return; }
    instantiateModel(char).then((res) => {
      if (!res) return;                                   // no hay modelo: se queda el cartel
      if (!tok.group.parent) { returnToPool(char, res); return; } // la ficha ya no existe
      useModel(tok, char, res);
    });
  }

  function useModel(tok, char, res) {
    tok.instancia = res;
    tok.char = char;
    setModelOpacity(res.root, 1); // pudo quedar a medias de un desvanecido
    tok.fade = 1;
    tok.group.add(res.root);
    tok.model = res.root;
    tok.model.rotation.y = tok.facing || 0; // orientacion ya calculada en syncUnits

    // El modelo va solo sobre la cubierta: fuera el cartel y fuera la peana.
    // Se queda la sombra para que no parezca que flota, y el aro dorado del
    // capitan bajado a ras de suelo.
    tok.panel.visible = false;
    tok.base.visible = false;
    if (tok.ring) tok.ring.position.y = 0.03;

    // El cartel llevaba el nombre y las estrellas dibujados: con modelo hay
    // que ponerlos aparte para seguir sabiendo quien es y de que nivel va.
    tok.badge = makeNameBadge(char, tok.star);
    tok.group.add(tok.badge);

    if (res.animations.length) {
      const mixer = new THREE.AnimationMixer(res.root);
      mixer.clipAction(res.animations[0]).play();
      tok.mixer = mixer;
      mixers.add(mixer);
    }
  }

  function releaseModel(tok) {
    if (tok.mixer) {
      tok.mixer.stopAllAction();
      mixers.delete(tok.mixer);
      tok.mixer = null;
    }
    // El modelo se guarda para la siguiente ficha del mismo personaje en vez de
    // destruirlo: hay que sacarlo del grupo antes de que se libere el resto.
    if (tok.instancia) {
      tok.group.remove(tok.instancia.root);
      returnToPool(tok.char, tok.instancia);
      tok.instancia = null;
      tok.model = null;
    }
    // La etiqueta comparte textura entre fichas iguales: hay que sacarla del
    // grupo antes de destruirlo para que no se lleve la textura por delante.
    if (tok.badge) {
      tok.group.remove(tok.badge);
      tok.badge.material.dispose();
      tok.badge = null;
    }
  }

  // Etiqueta flotante con el nombre y las estrellas, para las fichas que usan
  // modelo 3D: al no tener el cartel, es lo unico que dice quien es y de que
  // nivel va.
  const labelTextures = new Map();
  const LABEL_W = 256;
  const LABEL_H = 64;
  function labelTexture(name, star, crew) {
    const n = Math.max(1, star || 1);
    const key = `${name}|${n}`;
    const cached = labelTextures.get(key);
    if (cached) return cached;

    const c = document.createElement('canvas');
    c.width = LABEL_W; c.height = LABEL_H;
    const g = c.getContext('2d');
    const estrellas = '★'.repeat(n);

    // Todo en una linea: "Nombre ★★". La letra encoge si el nombre es largo
    // o si lleva muchas estrellas, para que la chapa no crezca sin control.
    let size = 30;
    const medir = () => {
      g.font = `bold ${size}px system-ui, sans-serif`;
      const wn = g.measureText(`${name} `).width;
      g.font = `bold ${size - 4}px system-ui, sans-serif`;
      return { wn, we: g.measureText(estrellas).width };
    };
    let m = medir();
    while (m.wn + m.we > LABEL_W - 30 && size > 15) {
      size -= 2;
      m = medir();
    }

    const anchoTexto = m.wn + m.we;
    const anchoCaja = Math.min(LABEL_W - 4, anchoTexto + 26);
    const x0 = (LABEL_W - anchoCaja) / 2;
    const y0 = (LABEL_H - 44) / 2;

    g.fillStyle = 'rgba(9,20,38,0.84)';
    roundRect(g, x0, y0, anchoCaja, 44, 13);
    g.fill();
    g.strokeStyle = CREW_COLORS[crew] || 'rgba(255,255,255,.5)';
    g.lineWidth = 3;
    roundRect(g, x0, y0, anchoCaja, 44, 13);
    g.stroke();

    // El texto se dibuja de izquierda a derecha desde el centro de la chapa
    const xIni = (LABEL_W - anchoTexto) / 2;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = `bold ${size}px system-ui, sans-serif`;
    g.fillText(`${name} `, xIni, LABEL_H / 2 + 1);
    g.fillStyle = '#ffd23f';
    g.font = `bold ${size - 4}px system-ui, sans-serif`;
    g.fillText(estrellas, xIni + m.wn, LABEL_H / 2 + 1);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    labelTextures.set(key, tex);
    return tex;
  }

  // Alto de la chapa en unidades de mundo y altura a la que flota: justo
  // encima de la cabeza del modelo (MODEL_HEIGHT) y por debajo de las barras
  // de vida y mana, que van a 1.62 y 1.49.
  const LABEL_SCALE = 0.9;
  function makeNameBadge(char, star) {
    const alto = LABEL_SCALE * (LABEL_H / LABEL_W);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(char.name, star, char.crew), transparent: true, depthTest: false,
    }));
    sprite.scale.set(LABEL_SCALE, alto, 1);
    sprite.position.set(0, MODEL_HEIGHT + alto / 2 + 0.08, 0);
    sprite.renderOrder = 4;
    return sprite;
  }

  function makeToken(char) {
    const group = new THREE.Group();

    const crewColor = CREW_COLORS[char.crew] || '#3a6ea8';
    const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({
      color: crewColor, roughness: 0.5, metalness: 0.15,
    }));
    base.position.y = 0.06;
    group.add(base);

    let ring = null;
    if (char.captain) {
      ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({
        color: '#ffd23f', roughness: 0.3, metalness: 0.7,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.13;
      group.add(ring);
    }

    const panelMat = new THREE.MeshBasicMaterial({
      map: getCharTexture(char), transparent: true, side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.y = 0.7;
    group.add(panel);

    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.012;
    group.add(shadow);

    // Barra de vida (solo visible en combate)
    const hpBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.1),
      new THREE.MeshBasicMaterial({ color: '#1a1a1a', transparent: true, opacity: 0.75 })
    );
    hpBack.position.y = 1.62;
    hpBack.visible = false;
    group.add(hpBack);

    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.07),
      new THREE.MeshBasicMaterial({ color: '#3ddc84' })
    );
    hpFill.position.set(0, 1.62, 0.01);
    hpFill.visible = false;
    group.add(hpFill);

    // Barra de mana, justo debajo de la de vida
    const manaBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.07),
      new THREE.MeshBasicMaterial({ color: '#0b1a33', transparent: true, opacity: 0.8 })
    );
    manaBack.position.y = 1.49;
    manaBack.visible = false;
    group.add(manaBack);

    const manaFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.045),
      new THREE.MeshBasicMaterial({ color: '#4dc3ff' })
    );
    manaFill.position.set(0, 1.49, 0.01);
    manaFill.visible = false;
    group.add(manaFill);

    world.add(group);
    const tok = {
      group, panel, base, ring, hpBack, hpFill, manaBack, manaFill, panelMat,
      star: char.star || 1, model: null, mixer: null, badge: null,
    };
    // Si el personaje tiene un .glb subido, sustituye al cartel al llegar
    attachModel(tok, char);
    return tok;
  }

  /**
   * Sincroniza las fichas visibles. `units` es la lista completa de lo que
   * debe verse ahora mismo; lo que no aparezca se elimina.
   * Cada unidad: { uid, char, col, row, selected, hpFrac, showHp, opacity }
   * (col/row pueden ser decimales para interpolar movimiento en combate)
   */
  function syncUnits(units) {
    const seen = new Set();
    for (const u of units) {
      seen.add(u.uid);
      let tok = tokens.get(u.uid);
      if (!tok) {
        tok = makeToken(u.char);
        tok.star = u.char.star;
        tokens.set(u.uid, tok);
      } else if (tok.star !== u.char.star) {
        // subio de estrella conservando el uid: hay que rehacer el cartel
        tok.star = u.char.star;
        tok.panelMat.map = getCharTexture(u.char);
        tok.panelMat.needsUpdate = true;
        if (tok.badge) tok.badge.material.map = labelTexture(u.char.name, tok.star, u.char.crew);
      }
      const { x, z } = cellToWorld(u.col, u.row);
      tok.group.position.set(x, 0, z);
      tok.group.visible = true;

      const op = u.opacity === undefined ? 1 : u.opacity;
      tok.panelMat.opacity = op;
      tok.base.material.opacity = op;
      tok.base.material.transparent = op < 1;

      // El panel siempre mira a la camara para que se lea bien el personaje
      tok.panel.quaternion.copy(camera.quaternion);

      // Cada bando mira hacia el contrario (la fila 0 es la mitad enemiga)
      tok.facing = u.row >= rows / 2 ? Math.PI : 0;
      if (tok.model) {
        tok.model.rotation.y = tok.facing;
        if (tok.fade !== op) {
          tok.fade = op;
          setModelOpacity(tok.model, op);
        }
      }
      if (tok.badge) tok.badge.material.opacity = op;

      if (u.showHp) {
        tok.hpBack.visible = true;
        tok.hpFill.visible = true;
        tok.hpBack.quaternion.copy(camera.quaternion);
        tok.hpFill.quaternion.copy(camera.quaternion);
        const frac = Math.max(0, Math.min(1, u.hpFrac));
        tok.hpFill.scale.x = frac || 0.0001;
        // escalar encoge desde el centro: desplazamos para que se vacie por la derecha
        tok.hpFill.position.set(-(1 - frac) * 0.34, 1.62, 0.01);
        tok.hpFill.material.color.set(frac > 0.5 ? '#3ddc84' : frac > 0.25 ? '#ffd23f' : '#ff5d6c');
      } else {
        tok.hpBack.visible = false;
        tok.hpFill.visible = false;
      }

      // Barra de mana: solo tiene sentido si el personaje tiene habilidad
      if (u.showHp && u.maxMana > 0) {
        tok.manaBack.visible = true;
        tok.manaFill.visible = true;
        tok.manaBack.quaternion.copy(camera.quaternion);
        tok.manaFill.quaternion.copy(camera.quaternion);
        const mf = Math.max(0, Math.min(1, (u.mana || 0) / u.maxMana));
        tok.manaFill.scale.x = mf || 0.0001;
        tok.manaFill.position.set(-(1 - mf) * 0.34, 1.49, 0.01);
        // al llenarse parpadea en dorado: la habilidad esta a punto de salir
        tok.manaFill.material.color.set(mf >= 1 ? '#ffd23f' : '#4dc3ff');
      } else {
        tok.manaBack.visible = false;
        tok.manaFill.visible = false;
      }

      // Realce de seleccion: la ficha flota un poco
      tok.group.position.y = u.selected ? 0.22 : 0;
    }
    for (const [uid, tok] of tokens) {
      if (!seen.has(uid)) {
        releaseModel(tok);
        world.remove(tok.group);
        disposeTree(tok.group);
        tokens.delete(uid);
      }
    }
  }

  // Desvanecido de un modelo (al morir la ficha). Cada ficha parsea su propio
  // .glb, asi que sus materiales son suyos y se pueden tocar sin efectos
  // secundarios en las demas.
  function setModelOpacity(modelo, op) {
    modelo.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.transparent = op < 1;
        m.opacity = op;
      }
    });
  }

  // ---------------- Resaltado de casillas ----------------
  function setHighlights(cells) {
    const key = new Set((cells || []).map((c) => `${c.col},${c.row}`));
    for (const tile of tiles) {
      const on = key.has(`${tile.userData.col},${tile.userData.row}`);
      tile.material.color.set(on ? '#ffd23f' : tile.userData.baseColor);
      tile.material.opacity = on ? 0.72 : 0.5;
      tile.position.y = on ? 0.07 : 0.04;
    }
  }

  // ---------------- Onda expansiva al lanzar una habilidad ----------------
  const bursts = [];
  const burstGeo = new THREE.RingGeometry(0.3, 0.45, 24);
  burstGeo.rotateX(-Math.PI / 2);
  function addAbilityBurst(col, row) {
    const mesh = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({
      color: '#ffd23f', transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    const { x, z } = cellToWorld(col, row);
    mesh.position.set(x, 0.1, z);
    world.add(mesh);
    bursts.push({ mesh, born: performance.now() });
  }

  function updateBursts(now) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      const age = (now - b.born) / 550;
      if (age >= 1) {
        world.remove(b.mesh);
        b.mesh.material.dispose();
        bursts.splice(i, 1);
        continue;
      }
      const s = 1 + age * 3.2;
      b.mesh.scale.set(s, s, s);
      b.mesh.material.opacity = 1 - age;
    }
  }

  // ---------------- Textos flotantes (dano, curacion...) ----------------
  const floats = [];
  function addFloatingText(col, row, text, color, wide) {
    // Los nombres de habilidad son largos: el lienzo se ensancha y la fuente se
    // encoge hasta que el texto cabe entero (antes se cortaba a media palabra).
    const canvas = document.createElement('canvas');
    canvas.width = wide ? 512 : 256;
    canvas.height = 128;
    const c = canvas.getContext('2d');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let size = wide ? 56 : 68;
    const maxW = canvas.width - 24;
    c.font = `bold ${size}px sans-serif`;
    while (c.measureText(text).width > maxW && size > 16) {
      size -= 3;
      c.font = `bold ${size}px sans-serif`;
    }
    c.lineWidth = Math.max(5, size * 0.15);
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText(text, canvas.width / 2, 64);
    c.fillStyle = color;
    c.fillText(text, canvas.width / 2, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    const { x, z } = cellToWorld(col, row);
    sprite.position.set(x, 1.85, z);
    sprite.scale.set(wide ? 2.2 : 1.1, 0.55, 1);
    world.add(sprite);
    floats.push({ sprite, born: performance.now(), tex });
  }

  function updateFloats(now) {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      const age = (now - f.born) / 900;
      if (age >= 1) {
        world.remove(f.sprite);
        f.sprite.material.map.dispose();
        f.sprite.material.dispose();
        floats.splice(i, 1);
        continue;
      }
      f.sprite.position.y = 1.85 + age * 0.9;
      f.sprite.material.opacity = 1 - age;
    }
  }

  // ---------------- Rayos de ataque ----------------
  const beams = [];
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true });
  function addAttackBeam(fromCol, fromRow, toCol, toRow) {
    const a = cellToWorld(fromCol, fromRow);
    const b = cellToWorld(toCol, toRow);
    const start = new THREE.Vector3(a.x, 0.62, a.z);
    const end = new THREE.Vector3(b.x, 0.62, b.z);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    if (len < 0.001) return;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 6), beamMat.clone());
    mesh.position.copy(start).add(dir.clone().multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    world.add(mesh);
    beams.push({ mesh, born: performance.now() });
  }

  function updateBeams(now) {
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      const age = (now - b.born) / 200;
      if (age >= 1) {
        world.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        beams.splice(i, 1);
        continue;
      }
      b.mesh.material.opacity = 1 - age;
    }
  }

  // ---------------- Seleccion de casilla (raycasting) ----------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pickCell(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(tiles, false);
    if (!hits.length) return null;
    const { col, row } = hits[0].object.userData;
    return { col, row };
  }

  // ---------------- Bucle de render ----------------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera(); // el encuadre depende de la proporcion de la pantalla
  }

  let running = true;
  const clock = new THREE.Clock();
  const mixerClock = new THREE.Clock(); // aparte: getDelta() consume el tiempo
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const now = performance.now();
    const t = clock.getElapsedTime();

    // animaciones de los modelos 3D que las traigan
    const dt = mixerClock.getDelta();
    if (mixers.size) for (const m of mixers) m.update(dt);

    // oleaje suave del mar
    const arr = oceanGeo.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = oceanBase[i];
      const bz = oceanBase[i + 2];
      arr[i + 1] = Math.sin(bx * 0.22 + t * 0.9) * 0.22 + Math.cos(bz * 0.3 + t * 0.7) * 0.18;
    }
    oceanGeo.attributes.position.needsUpdate = true;

    // balanceo muy leve del barco, para dar sensacion de estar en el mar
    world.rotation.z = Math.sin(t * 0.55) * 0.012;
    world.rotation.x = Math.cos(t * 0.42) * 0.008;

    updateFloats(now);
    updateBeams(now);
    updateBursts(now);
    renderer.render(scene, camera);
  }

  function dispose() {
    running = false;
    mixers.clear();
    for (const libres of modelPool.values()) for (const res of libres) disposeTree(res.root);
    modelPool.clear();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  setBoard(cols, rows);
  resize();
  animate();
  window.addEventListener('resize', resize);

  return {
    setBoard, syncUnits, setHighlights, pickCell, setInsets,
    addFloatingText, addAttackBeam, addAbilityBurst, resize, dispose,
    preloadModels, warmModels,
    get cols() { return cols; },
    get rows() { return rows; },
    get tokens() { return tokens; }, // solo para pruebas automatizadas
  };
}

// ---------------- Utilidades de dibujo ----------------

// "Cartel de se busca" del personaje: retrato si lo hay, si no sus iniciales
// sobre el color de su tripulacion. Se usa como textura del panel vertical.
function drawCharCanvas(char, portraitImg) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  const c = canvas.getContext('2d');
  const crewColor = CREW_COLORS[char.crew] || '#3a6ea8';

  // Fondo tipo pergamino con marco de madera
  c.fillStyle = '#f0dfb4';
  roundRect(c, 6, 6, 244, 308, 14);
  c.fill();
  c.lineWidth = 10;
  c.strokeStyle = char.captain ? '#ffd23f' : '#6b4423';
  roundRect(c, 6, 6, 244, 308, 14);
  c.stroke();

  // Zona del retrato
  const px = 26, py = 34, pw = 204, ph = 204;
  c.save();
  roundRect(c, px, py, pw, ph, 10);
  c.clip();
  if (portraitImg && portraitImg.complete && portraitImg.naturalWidth) {
    // recorte tipo "cover" para no deformar la imagen
    const s = Math.max(pw / portraitImg.naturalWidth, ph / portraitImg.naturalHeight);
    const dw = portraitImg.naturalWidth * s;
    const dh = portraitImg.naturalHeight * s;
    c.drawImage(portraitImg, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
  } else {
    c.fillStyle = crewColor;
    c.fillRect(px, py, pw, ph);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.font = '900 92px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(char.initials, px + pw / 2, py + ph / 2 + 4);
  }
  c.restore();

  // Corona para los capitanes
  if (char.captain) {
    c.font = '44px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('👑', 128, 40);
  }

  // Estrellas del personaje, en una banda oscura sobre el retrato: hay que
  // poder ver de un vistazo el nivel de cada ficha tambien durante el combate.
  const star = char.star || 0;
  if (star > 0) {
    const sw = 30 * star + 14;
    const sx = 128 - sw / 2;
    c.fillStyle = 'rgba(20,16,10,0.82)';
    roundRect(c, sx, 208, sw, 38, 10);
    c.fill();
    c.strokeStyle = '#ffd23f';
    c.lineWidth = 2.5;
    roundRect(c, sx, 208, sw, 38, 10);
    c.stroke();
    c.fillStyle = '#ffd23f';
    c.font = '900 26px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('★'.repeat(star), 128, 228);
  }

  // Banda inferior con el nombre
  c.fillStyle = crewColor;
  roundRect(c, 20, 250, 216, 50, 8);
  c.fill();
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  let fontSize = 30;
  c.font = `900 ${fontSize}px sans-serif`;
  while (c.measureText(char.name).width > 196 && fontSize > 12) {
    fontSize -= 2;
    c.font = `900 ${fontSize}px sans-serif`;
  }
  c.fillText(char.name, 128, 276);

  return canvas;
}

function makeJollyRogerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 86;
  const c = canvas.getContext('2d');
  c.fillStyle = '#12100f';
  c.fillRect(0, 0, 128, 86);
  c.font = '52px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('☠️', 64, 45);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
