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
  // Vista en angulo desde detras de tu mitad, estilo Tactics Royale.
  // La distancia se calcula para que el tablero llene la pantalla tanto en
  // moviles (altos y estrechos) como en escritorio (anchos y bajos).
  function placeCamera() {
    const boardW = cols * TILE;
    const boardD = rows * TILE;
    const fov = (camera.fov * Math.PI) / 180;
    const aspect = camera.aspect || 1.6;

    const halfW = boardW / 2 + 1.6;          // margen lateral para el casco
    const halfH = (boardD / 2 + 1.3) * 0.92; // el tablero se ve escorzado
    const needed = Math.max(halfH, halfW / aspect);
    const dist = needed / Math.tan(fov / 2);

    // Un angulo mas bajo deja ver el mastil, la vela y la linea del horizonte
    const pitch = (44 * Math.PI) / 180;
    camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist + boardD * 0.12);
    camera.lookAt(0, 1.1, -0.5);
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

  function getCharTexture(char) {
    const cached = textureCache.get(char.id);
    if (cached) return cached;
    const tex = new THREE.CanvasTexture(drawCharCanvas(char, portraitImages.get(char.id)));
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(char.id, tex);

    // Si tiene retrato, lo cargamos y regeneramos la textura al llegar
    if (char.portrait && !portraitImages.has(char.id)) {
      const img = new Image();
      img.onload = () => {
        portraitImages.set(char.id, img);
        const t = textureCache.get(char.id);
        if (t) {
          t.image = drawCharCanvas(char, img);
          t.needsUpdate = true;
        }
      };
      img.onerror = () => portraitImages.set(char.id, null); // se queda el cartel de iniciales
      img.src = `/img/characters/${char.portrait}`;
      portraitImages.set(char.id, undefined); // marca "cargando"
    }
    return tex;
  }

  function makeToken(char) {
    const group = new THREE.Group();

    const crewColor = CREW_COLORS[char.crew] || '#3a6ea8';
    const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({
      color: crewColor, roughness: 0.5, metalness: 0.15,
    }));
    base.position.y = 0.06;
    group.add(base);

    if (char.captain) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({
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
    hpBack.position.y = 1.4;
    hpBack.visible = false;
    group.add(hpBack);

    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.07),
      new THREE.MeshBasicMaterial({ color: '#3ddc84' })
    );
    hpFill.position.set(0, 1.4, 0.01);
    hpFill.visible = false;
    group.add(hpFill);

    world.add(group);
    return { group, panel, base, hpBack, hpFill, panelMat };
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
        tokens.set(u.uid, tok);
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

      if (u.showHp) {
        tok.hpBack.visible = true;
        tok.hpFill.visible = true;
        tok.hpBack.quaternion.copy(camera.quaternion);
        tok.hpFill.quaternion.copy(camera.quaternion);
        const frac = Math.max(0, Math.min(1, u.hpFrac));
        tok.hpFill.scale.x = frac || 0.0001;
        // escalar encoge desde el centro: desplazamos para que se vacie por la derecha
        tok.hpFill.position.set(-(1 - frac) * 0.34, 1.4, 0.01);
        tok.hpFill.material.color.set(frac > 0.5 ? '#3ddc84' : frac > 0.25 ? '#ffd23f' : '#ff5d6c');
      } else {
        tok.hpBack.visible = false;
        tok.hpFill.visible = false;
      }

      // Realce de seleccion: la ficha flota un poco
      tok.group.position.y = u.selected ? 0.22 : 0;
    }
    for (const [uid, tok] of tokens) {
      if (!seen.has(uid)) {
        world.remove(tok.group);
        disposeTree(tok.group);
        tokens.delete(uid);
      }
    }
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

  // ---------------- Textos flotantes (dano, curacion...) ----------------
  const floats = [];
  function addFloatingText(col, row, text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const c = canvas.getContext('2d');
    c.font = 'bold 68px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 10;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText(text, 128, 64);
    c.fillStyle = color;
    c.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    const { x, z } = cellToWorld(col, row);
    sprite.position.set(x, 1.3, z);
    sprite.scale.set(1.1, 0.55, 1);
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
      f.sprite.position.y = 1.3 + age * 0.9;
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
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const now = performance.now();
    const t = clock.getElapsedTime();

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
    renderer.render(scene, camera);
  }

  function dispose() {
    running = false;
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  setBoard(cols, rows);
  resize();
  animate();
  window.addEventListener('resize', resize);

  return {
    setBoard, syncUnits, setHighlights, pickCell,
    addFloatingText, addAttackBeam, resize, dispose,
    get cols() { return cols; },
    get rows() { return rows; },
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
