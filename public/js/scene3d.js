'use strict';

/**
 * Escenario del combate: la cubierta del barco es la ILUSTRACION de fondo, y el
 * tablero se calca sobre las casillas que ya vienen pintadas en ella.
 *
 * Como funciona:
 *  - La imagen (public/img/scene/deck.png) va de fondo del contenedor con un
 *    tamano y una posicion que calcula este modulo, no un `cover` a secas, para
 *    saber exactamente donde cae cada pixel del dibujo.
 *  - Encima va un lienzo WebGL transparente donde se dibujan las fichas y los
 *    efectos, con camara ortografica en pixeles de pantalla.
 *  - La correspondencia "casilla del juego -> punto del dibujo" es una
 *    homografia sacada de las 4 esquinas de la rejilla pintada, medidas sobre
 *    la imagen. Asi las fichas caen clavadas en su casilla, con la perspectiva
 *    del dibujo, sin tener que adivinar con que camara se ilustro.
 *
 * game.js le sigue hablando en "coordenadas de render": columna 0..cols-1 y
 * fila 0..rows-1, con la fila 0 al fondo (mitad enemiga).
 */

import * as THREE from '../vendor/three.module.min.js';
import { instantiateModel, preloadModels, warmModels, pickClips, MODEL_HEIGHT } from './models.js';

// La ilustracion y las 4 esquinas de su rejilla 5x6, en pixeles de la imagen
// original. Si se cambia el dibujo hay que volver a medirlas.
const ART = {
  src: 'img/scene/deck.png',
  w: 1122,
  h: 1402,
  tl: [326, 540],   // esquina exterior de la casilla de arriba a la izquierda
  tr: [817, 540],
  br: [884, 898],   // esquina exterior de la casilla de abajo a la derecha
  bl: [254, 898],
  // color medio del borde de arriba y del de abajo del dibujo: con ellos se
  // continua la imagen cuando sobra pantalla y no se ve la juntura
  cielo: '#1c7ce4',
  mar: '#032c5c',
};

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

// ---------------- Homografia del cuadrado unidad a la rejilla dibujada ----------------
function homografiaDesdeCuadrado(q) {
  const [x0, y0] = q.tl, [x1, y1] = q.tr, [x2, y2] = q.br, [x3, y3] = q.bl;
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h, 1,
  ];
}
function aplicarH(H, u, v) {
  const w = H[6] * u + H[7] * v + H[8];
  return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w];
}
function invertirH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  return [
    e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d,
  ];
}

const H_ARTE = homografiaDesdeCuadrado(ART);
const H_ARTE_INV = invertirH(H_ARTE);

export function createScene(container) {
  // ---------------- Fondo: la ilustracion ----------------
  // La ilustracion, y detras un degradado cielo-mar que continua el dibujo por
  // arriba y por abajo cuando sobra pantalla. Los cortes del degradado se
  // colocan justo en los bordes del dibujo (ver calcularEncaje) y con el color
  // medio de esos bordes, para que no se note la juntura.
  container.style.backgroundImage =
    `url('${ART.src}'), linear-gradient(180deg, ${ART.cielo} 0%, ${ART.mar} 100%)`;
  container.style.backgroundRepeat = 'no-repeat, no-repeat';
  container.style.backgroundColor = ART.mar;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -20000, 20000);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';

  // Luz parecida a la del dibujo: sol calido desde la izquierda
  scene.add(new THREE.HemisphereLight('#e8f4ff', '#6b5334', 1.05));
  const sol = new THREE.DirectionalLight('#fff2d0', 1.5);
  sol.position.set(-0.4, 1, 0.7);
  scene.add(sol);
  const relleno = new THREE.DirectionalLight('#bcd8ff', 0.4);
  relleno.position.set(0.7, 0.35, 0.6);
  scene.add(relleno);

  // Contraluz. Es lo que mas hace por que las fichas se lean a 55 pixeles:
  // dos luces desde detras dibujan un filo claro por el borde del personaje y
  // lo despegan de la cubierta, que es marron y verdosa y se los come. Van por
  // detras (z negativa), asi que solo se ven en el contorno.
  const filoCalido = new THREE.DirectionalLight('#ffe2a8', 1.7);
  filoCalido.position.set(-0.75, 0.8, -1);
  scene.add(filoCalido);
  const filoFrio = new THREE.DirectionalLight('#bcdcff', 1.25);
  filoFrio.position.set(0.85, 0.55, -1);
  scene.add(filoFrio);

  const world = new THREE.Group();
  scene.add(world);

  let cols = 5;
  let rows = 6;
  let ancho = 1;
  let alto = 1;
  let insetTop = 0;
  let insetBottom = 0;
  let fit = { escala: 1, ox: 0, oy: 0 }; // como se coloca el dibujo en el lienzo

  const tokens = new Map();
  const mixers = new Set();

  // ---------------- Encaje de la ilustracion ----------------
  // Se ve el dibujo ENTERO: se mete dentro del lienzo sin recortar nada
  // (contain), y se coloca centrado en la franja libre entre el HUD y la barra
  // de abajo, sin salirse de la pantalla. Lo que sobra a los lados o arriba y
  // abajo lo tapa el degradado de cielo y mar del fondo.
  // Cuando sobra sitio por abajo (en movil el dibujo lo limita el ancho) se
  // baja para que el casco quede por detras del banquillo y la tienda, como
  // en el mockup, en vez de flotar con un trozo de mar entre medias.
  const SESGO_ABAJO = 0.55; // cuanto de esa holgura se aprovecha
  const MARGEN_REJILLA = 6; // px que se dejan libres bajo la ultima fila

  function calcularEncaje() {
    const libreAlto = Math.max(80, alto - insetTop - insetBottom);
    const escala = Math.min(ancho / ART.w, alto / ART.h);
    const dibujoW = ART.w * escala;
    const dibujoH = ART.h * escala;

    const centroRejillaY = (ART.tl[1] + ART.tr[1] + ART.br[1] + ART.bl[1]) / 4;
    const rejillaAbajo = Math.max(ART.bl[1], ART.br[1]);
    let ox = (ancho - dibujoW) / 2;
    // centramos la rejilla en la franja libre y luego lo metemos en pantalla
    let oy = insetTop + libreAlto / 2 - centroRejillaY * escala;
    // ...y la bajamos mientras la ultima fila siga viendose entera
    const oyTope = alto - insetBottom - MARGEN_REJILLA - rejillaAbajo * escala;
    if (oyTope > oy) oy += (oyTope - oy) * SESGO_ABAJO;
    oy = Math.max(Math.min(oy, alto - dibujoH), 0);
    if (dibujoH > alto) oy = 0;

    fit = { escala, ox, oy };
    container.style.backgroundSize = `${Math.round(dibujoW)}px ${Math.round(dibujoH)}px, 100% 100%`;
    container.style.backgroundPosition = `${Math.round(ox)}px ${Math.round(oy)}px, 0 0`;
    // El degradado se queda plano hasta donde empieza el dibujo y desde donde
    // acaba: asi el cielo de arriba y el mar de abajo enlazan sin escalon.
    const arriba = Math.round(oy);
    const abajo = Math.round(oy + dibujoH);
    container.style.backgroundImage =
      `url('${ART.src}'), linear-gradient(180deg, ${ART.cielo} 0px, ${ART.cielo} ${arriba}px, ` +
      `${ART.mar} ${abajo}px, ${ART.mar} 100%)`;
  }

  // Punto del dibujo -> pixel de pantalla
  function arteAPantalla(p) {
    return [p[0] * fit.escala + fit.ox, p[1] * fit.escala + fit.oy];
  }
  // Vertice de la rejilla (en fracciones de casilla) -> pixel de pantalla
  function celdaAPantalla(col, row) {
    return arteAPantalla(aplicarH(H_ARTE, col / cols, row / rows));
  }
  function centroCelda(col, row) {
    return celdaAPantalla(col + 0.5, row + 0.5);
  }
  function anchoCelda(col, row) {
    const a = celdaAPantalla(col, row + 0.5);
    const b = celdaAPantalla(col + 1, row + 0.5);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  // Pixel de pantalla -> casilla (null si cae fuera del tablero)
  function pantallaACelda(px, py) {
    const x = (px - fit.ox) / fit.escala;
    const y = (py - fit.oy) / fit.escala;
    const [u, v] = aplicarH(H_ARTE_INV, x, y);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return {
      col: Math.min(cols - 1, Math.max(0, Math.floor(u * cols))),
      row: Math.min(rows - 1, Math.max(0, Math.floor(v * rows))),
    };
  }
  // En Three la Y va hacia arriba; en pantalla hacia abajo
  function aMundo(p) { return [p[0], alto - p[1]]; }

  // ---------------- Resaltado de casillas ----------------
  // Se pinta el poligono exacto de la casilla dibujada, con su perspectiva
  const highlightGroup = new THREE.Group();
  world.add(highlightGroup);
  let ultimoHighlight = [];

  function setHighlights(cells) {
    ultimoHighlight = cells || [];
    pintarHighlights();
  }

  function pintarHighlights() {
    for (const hijo of [...highlightGroup.children]) {
      highlightGroup.remove(hijo);
      hijo.geometry.dispose();
      hijo.material.dispose();
    }
    for (const c of ultimoHighlight) {
      const p = [
        celdaAPantalla(c.col, c.row),
        celdaAPantalla(c.col + 1, c.row),
        celdaAPantalla(c.col + 1, c.row + 1),
        celdaAPantalla(c.col, c.row + 1),
      ].map(aMundo);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([
        p[0][0], p[0][1], 0, p[1][0], p[1][1], 0, p[2][0], p[2][1], 0,
        p[0][0], p[0][1], 0, p[2][0], p[2][1], 0, p[3][0], p[3][1], 0,
      ], 3));
      // OJO con el side: al voltear la Y (pantalla -> mundo) se invierte el
      // orden de los vertices y el poligono queda de espaldas a la camara.
      const malla = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: '#ffe57a', transparent: true, opacity: 0.5,
        depthTest: false, side: THREE.DoubleSide,
      }));
      malla.renderOrder = -1;
      highlightGroup.add(malla);
    }
  }

  // ---------------- Fichas ----------------
  const textureCache = new Map();
  const portraitImages = new Map();

  function getCharTexture(char) {
    const key = `${char.id}|${char.star || 0}`;
    const cached = textureCache.get(key);
    if (cached) return cached;
    const tex = aTextura(drawCharCanvas(char, portraitImages.get(char.id)));
    textureCache.set(key, tex);

    if (char.portrait && !portraitImages.has(char.id)) {
      const img = new Image();
      img.onload = () => {
        portraitImages.set(char.id, img);
        for (const [k, t] of textureCache) {
          if (!k.startsWith(`${char.id}|`)) continue;
          const star = Number(k.split('|')[1]) || 0;
          t.image = drawCharCanvas({ ...char, star }, img);
          t.needsUpdate = true;
        }
      };
      img.src = `/img/characters/${char.portrait}`;
    }
    return tex;
  }

  // Instancias de modelo ya parseadas y libres: entre ronda y ronda las fichas
  // se destruyen y se recrean, y reutilizarlas evita volver a parsear el .glb.
  const modelPool = new Map();
  function takeFromPool(char) {
    const libres = modelPool.get(char.id);
    return libres && libres.length ? libres.pop() : null;
  }
  function returnToPool(char, res) {
    let libres = modelPool.get(char.id);
    if (!libres) modelPool.set(char.id, (libres = []));
    if (libres.length < 8) libres.push(res);
    else disposeTree(res.root);
  }

  function attachModel(tok, char) {
    const libre = takeFromPool(char);
    if (libre) { useModel(tok, char, libre); return; }
    instantiateModel(char).then((res) => {
      if (!res) return;
      if (!tok.group.parent) { returnToPool(char, res); return; }
      useModel(tok, char, res);
    });
  }

  function useModel(tok, char, res) {
    tok.instancia = res;
    tok.char = char;
    darPunch(res.root);
    setModelOpacity(res.root, 1);
    tok.fade = 1;
    res.root.rotation.y = tok.facing || 0;
    tok.modelo = res.root;
    tok.pivote.add(res.root);
    // Con modelo no hace falta el cartel, pero si una chapa con el nombre
    tok.panel.visible = false;
    if (!tok.badge) {
      tok.badge = makeNameBadge(char, tok.star);
      tok.pivote.add(tok.badge);
    }
    if (res.animations.length) {
      const mixer = new THREE.AnimationMixer(res.root);
      const clips = pickClips(res.animations);
      tok.acciones = {};
      for (const nombre of Object.keys(clips)) {
        const clip = clips[nombre];
        if (!clip) continue;
        const accion = mixer.clipAction(clip);
        accion.timeScale = ritmo(nombre, clip, char);
        tok.acciones[nombre] = accion;
      }
      tok.accionActual = null;
      tok.accionNombre = null;
      tok.mixer = mixer;
      mixers.add(mixer);
      ponerAccion(tok, tok.accionPedida || 'idle');
    }
    colocarToken(tok);
  }

  /**
   * A que ritmo va cada animacion.
   *
   * El golpe se ajusta a la cadencia de ataque de la ficha. El motor deja
   * `atkSpeed` ticks de 150 ms entre golpe y golpe (de 6 a 9 segun el
   * personaje, ver server/characterData.js), asi que el que pega mas rapido
   * tiene que verse pegando mas rapido: antes se aplastaban todos a 0,62 s
   * fijos y Sanji y Barbablanca golpeaban igual. Se deja algo de aire
   * (PARTE_GOLPE < 1) para que el golpe termine antes del siguiente y no se
   * encadenen sin respirar.
   *
   * Andar y reposo van por debajo de 1 a proposito: las animaciones de Mixamo
   * son de persona a tamano real y a 55 pixeles se ven nerviosas.
   */
  const TICK_MS = 150;            // el mismo tick que server/battle.js
  const PARTE_GOLPE = 0.7;        // cuanto del hueco entre ataques ocupa el golpe
  const ATK_SPEED_POR_DEFECTO = 7;
  const VEL_ANDAR = 0.75;
  const VEL_REPOSO = 0.85;

  function ritmo(nombre, clip, char) {
    if (nombre === 'walk') return VEL_ANDAR;
    if (nombre === 'idle') return VEL_REPOSO;
    if (nombre !== 'attack') return 1;
    const ticks = (char && char.atkSpeed) || ATK_SPEED_POR_DEFECTO;
    const objetivo = (ticks * TICK_MS / 1000) * PARTE_GOLPE; // segundos
    if (!clip.duration || !objetivo) return 1;
    // Con topes: un clip muy corto estirado a camara lenta queda peor que uno
    // que no encaje del todo.
    return Math.min(4, Math.max(0.4, clip.duration / objetivo));
  }

  // Cambia de animacion con una mezcla corta, para que no salte de golpe
  function ponerAccion(tok, nombre) {
    tok.accionPedida = nombre;
    if (!tok.acciones) return;
    const nueva = tok.acciones[nombre] || tok.acciones.idle;
    if (!nueva || tok.accionActual === nueva) return;
    const vieja = tok.accionActual;
    nueva.reset();
    nueva.enabled = true;
    nueva.setEffectiveWeight(1);
    nueva.play();
    if (vieja) nueva.crossFadeFrom(vieja, nombre === 'attack' ? 0.08 : 0.18, false);
    tok.accionActual = nueva;
    tok.accionNombre = nombre;
  }

  function releaseModel(tok) {
    if (tok.mixer) {
      tok.mixer.stopAllAction();
      mixers.delete(tok.mixer);
      tok.mixer = null;
    }
    tok.acciones = null;
    tok.accionActual = null;
    tok.accionNombre = null;
    if (tok.instancia) {
      tok.pivote.remove(tok.instancia.root);
      returnToPool(tok.char, tok.instancia);
      tok.instancia = null;
      tok.modelo = null;
    }
    // La chapa comparte textura entre fichas iguales: hay que sacarla del grupo
    // antes de destruirlo para que no se lleve la textura por delante.
    if (tok.badge) {
      tok.pivote.remove(tok.badge);
      tok.badge.material.dispose();
      tok.badge = null;
    }
  }

  // Chapa con el nombre y las estrellas, para las fichas con modelo
  const labelTextures = new Map();
  const LABEL_W = 256;
  const LABEL_H = 64;
  function labelTexture(name, star, crew) {
    const n = Math.max(1, star || 1);
    const key = `${name}|${n}`;
    const cached = labelTextures.get(key);
    if (cached) return cached;

    const c = lienzo(LABEL_W, LABEL_H);
    const g = c.getContext('2d');
    const estrellas = '★'.repeat(n);
    let size = 30;
    const medir = () => {
      g.font = `bold ${size}px system-ui, sans-serif`;
      const wn = g.measureText(`${name} `).width;
      g.font = `bold ${size - 4}px system-ui, sans-serif`;
      return { wn, we: g.measureText(estrellas).width };
    };
    let m = medir();
    while (m.wn + m.we > LABEL_W - 30 && size > 15) { size -= 2; m = medir(); }

    const anchoTexto = m.wn + m.we;
    const anchoCaja = Math.min(LABEL_W - 4, anchoTexto + 26);
    const x0 = (LABEL_W - anchoCaja) / 2;
    const y0 = (LABEL_H - 44) / 2;
    g.fillStyle = 'rgba(9,20,38,0.86)';
    roundRect(g, x0, y0, anchoCaja, 44, 13);
    g.fill();
    g.strokeStyle = CREW_COLORS[crew] || 'rgba(255,255,255,.5)';
    g.lineWidth = 3;
    roundRect(g, x0, y0, anchoCaja, 44, 13);
    g.stroke();

    const xIni = (LABEL_W - anchoTexto) / 2;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = `bold ${size}px system-ui, sans-serif`;
    g.fillText(`${name} `, xIni, LABEL_H / 2 + 1);
    g.fillStyle = '#ffd23f';
    g.font = `bold ${size - 4}px system-ui, sans-serif`;
    g.fillText(estrellas, xIni + m.wn, LABEL_H / 2 + 1);

    const tex = aTextura(c);
    labelTextures.set(key, tex);
    return tex;
  }

  function makeNameBadge(char, star) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(char.name, star, char.crew), transparent: true, depthTest: false,
    }));
    sprite.scale.set(1.05, 1.05 * (LABEL_H / LABEL_W), 1);
    sprite.position.set(0, MODEL_HEIGHT + 0.14, 0);
    sprite.renderOrder = 7;
    return sprite;
  }

  // Mancha de sombra: negra y opaca en el centro, que se apaga hacia el borde.
  // Se dibuja una sola vez y la comparten todas las fichas.
  const OPACIDAD_SOMBRA = 0.62;
  let _sombraTex = null;
  function texturaSombra() {
    if (_sombraTex) return _sombraTex;
    const N = 128;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    // el nucleo se mantiene opaco un tercio del radio: eso es lo que da la
    // sensacion de contacto, y a partir de ahi se difumina
    grad.addColorStop(0.00, 'rgba(20,13,5,1)');
    grad.addColorStop(0.35, 'rgba(20,13,5,0.92)');
    grad.addColorStop(0.70, 'rgba(20,13,5,0.35)');
    grad.addColorStop(1.00, 'rgba(20,13,5,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
    _sombraTex = new THREE.CanvasTexture(c);
    _sombraTex.colorSpace = THREE.SRGBColorSpace;
    return _sombraTex;
  }

  /**
   * Sube saturacion y contraste del modelo ya iluminado.
   *
   * Las texturas que salen de un generador 3D vienen apagadas, de foto, y a 55
   * pixeles sobre una cubierta marron se convierten en un borron pardo. Los
   * juegos del genero tiran de color plano y saturado, con la silueta muy
   * separada del fondo. Se hace en el fragment shader, al final del todo, para
   * que pille tambien lo que aporta la luz.
   */
  const SATURACION = 1.28;
  const CONTRASTE = 1.12;
  function darPunch(raiz) {
    raiz.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!mat || mat.userData.conPunch) continue;
        mat.userData.conPunch = true;
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
             float lum = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
             gl_FragColor.rgb = mix( vec3( lum ), gl_FragColor.rgb, ${SATURACION.toFixed(2)} );
             gl_FragColor.rgb = clamp( ( gl_FragColor.rgb - 0.5 ) * ${CONTRASTE.toFixed(2)} + 0.5, 0.0, 1.0 );`
          );
        };
        // el shader ya compilado no se entera solo del cambio
        mat.needsUpdate = true;
      }
    });
  }

  function makeToken(char) {
    const group = new THREE.Group();
    // El grupo se coloca en pixeles; dentro, un pivote escalado deja que el
    // modelo viva en sus propias unidades y aqui solo se ajuste el tamano
    // segun la fila (perspectiva del dibujo).
    const pivote = new THREE.Group();
    group.add(pivote);

    // Sombra de contacto. Un disco plano se ve como una pegatina; con un
    // degradado (oscuro y cerrado bajo los pies, difuminado hacia fuera) la
    // ficha se ancla a la cubierta en vez de parecer que flota.
    const sombra = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: texturaSombra(), transparent: true, opacity: OPACIDAD_SOMBRA, depthTest: false, depthWrite: false,
      })
    );
    sombra.scale.set(0.82, 0.40, 1);
    sombra.position.y = 0.02;
    sombra.renderOrder = 2;
    pivote.add(sombra);

    // Cartel del personaje: lo que se ve mientras no tenga modelo 3D
    const panelMat = new THREE.MeshBasicMaterial({
      map: getCharTexture(char), transparent: true, side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), panelMat);
    panel.position.y = 0.56;
    panel.renderOrder = 4;
    pivote.add(panel);

    const barra = (color, anchoB, altoB, y, orden) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(anchoB, altoB),
        new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false })
      );
      m.position.set(0, y, 0.02);
      m.visible = false;
      m.renderOrder = orden;
      pivote.add(m);
      return m;
    };
    const hpBack = barra('#12161f', 0.8, 0.12, 1.45, 5);
    const hpFill = barra('#3ddc84', 0.74, 0.085, 1.45, 6);
    const manaBack = barra('#0b1a33', 0.8, 0.085, 1.32, 5);
    const manaFill = barra('#4dc3ff', 0.74, 0.05, 1.32, 6);

    world.add(group);
    const tok = {
      group, pivote, panel, panelMat, sombra,
      hpBack, hpFill, manaBack, manaFill,
      star: char.star || 1, modelo: null, mixer: null, badge: null, instancia: null,
      acciones: null, accionActual: null, accionNombre: null, accionPedida: 'idle',
      col: 0, row: 0, facing: 0, selected: false, fade: 1,
    };
    attachModel(tok, char);
    return tok;
  }

  // Coloca la ficha: posicion en pixeles del centro de su casilla, tamano segun
  // la fila y profundidad para que las de delante tapen a las de atras.
  function colocarToken(tok) {
    const [mx, my] = aMundo(centroCelda(tok.col, tok.row));
    const escala = (anchoCelda(tok.col, tok.row) * 1.32) / MODEL_HEIGHT;
    tok.group.position.set(mx, my, tok.row * 60);
    tok.pivote.scale.setScalar(escala);
    tok.pivote.position.y = tok.selected ? escala * MODEL_HEIGHT * 0.16 : 0;
  }

  /**
   * Sincroniza las fichas visibles. Cada unidad:
   * { uid, char, col, row, mine, selected, showHp, hpFrac, mana, maxMana, opacity }
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
        tok.star = u.char.star;
        tok.panelMat.map = getCharTexture(u.char);
        tok.panelMat.needsUpdate = true;
        if (tok.badge) tok.badge.material.map = labelTexture(u.char.name, tok.star, u.char.crew);
      }

      tok.col = u.col;
      tok.row = u.row;
      tok.selected = !!u.selected;
      // Cada bando mira al contrario, vaya por donde vaya durante el combate.
      // Los modelos vienen mirando al +Z (hacia la camara), asi que los mios
      // se giran media vuelta para encarar el fondo.
      tok.facing = (u.mine === undefined ? u.row >= rows / 2 : u.mine) ? Math.PI : 0;
      if (tok.modelo) tok.modelo.rotation.y = tok.facing;
      // reposo / andando / golpeando, segun lo que este haciendo en el combate
      ponerAccion(tok, u.accion || 'idle');
      colocarToken(tok);
      tok.group.visible = true;

      const op = u.opacity === undefined ? 1 : u.opacity;
      tok.panelMat.opacity = op;
      tok.sombra.material.opacity = OPACIDAD_SOMBRA * op;
      if (tok.modelo && tok.fade !== op) {
        tok.fade = op;
        setModelOpacity(tok.modelo, op);
      }
      if (tok.badge) tok.badge.material.opacity = op;

      if (u.showHp) {
        const frac = Math.max(0, Math.min(1, u.hpFrac));
        tok.hpBack.visible = true;
        tok.hpFill.visible = true;
        tok.hpFill.scale.x = frac || 0.0001;
        tok.hpFill.position.x = -(1 - frac) * 0.37;
        tok.hpFill.material.color.set(frac > 0.5 ? '#3ddc84' : frac > 0.25 ? '#ffd23f' : '#ff5d6c');
      } else {
        tok.hpBack.visible = false;
        tok.hpFill.visible = false;
      }

      if (u.showHp && u.maxMana > 0) {
        const mf = Math.max(0, Math.min(1, (u.mana || 0) / u.maxMana));
        tok.manaBack.visible = true;
        tok.manaFill.visible = true;
        tok.manaFill.scale.x = mf || 0.0001;
        tok.manaFill.position.x = -(1 - mf) * 0.37;
        tok.manaFill.material.color.set(mf >= 1 ? '#ffd23f' : '#4dc3ff');
      } else {
        tok.manaBack.visible = false;
        tok.manaFill.visible = false;
      }
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

  function setModelOpacity(modelo, op) {
    modelo.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.transparent = op < 1;
        m.opacity = op;
      }
    });
  }

  // ---------------- Efectos ----------------
  const floats = [];
  function addFloatingText(col, row, text, color, wide) {
    const w = wide ? 512 : 256;
    const c = lienzo(w, 128);
    const g = c.getContext('2d');
    let size = wide ? 54 : 74;
    g.font = `bold ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > w - 20 && size > 20) {
      size -= 4;
      g.font = `bold ${size}px system-ui, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(text, w / 2, 64);
    g.fillStyle = color || '#ffffff';
    g.fillText(text, w / 2, 64);

    const base = anchoCelda(col, row);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: aTextura(c), transparent: true, depthTest: false,
    }));
    const escala = base * (wide ? 2.0 : 1.1);
    sprite.scale.set(escala, escala * 0.5, 1);
    const [mx, my] = aMundo(centroCelda(col, row));
    const y0 = my + base * 1.5;
    sprite.position.set(mx, y0, 12000);
    sprite.renderOrder = 20;
    world.add(sprite);
    floats.push({ sprite, t0: performance.now(), dur: 900, y0, subida: base * 0.8 });
  }

  function updateFloats(now) {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      const k = (now - f.t0) / f.dur;
      if (k >= 1) {
        world.remove(f.sprite);
        f.sprite.material.map.dispose();
        f.sprite.material.dispose();
        floats.splice(i, 1);
        continue;
      }
      f.sprite.position.y = f.y0 + f.subida * k;
      f.sprite.material.opacity = 1 - k * k;
    }
  }

  const beams = [];
  function addAttackBeam(fromCol, fromRow, toCol, toRow) {
    const base = anchoCelda(fromCol, fromRow);
    const a = aMundo(centroCelda(fromCol, fromRow));
    const b = aMundo(centroCelda(toCol, toRow));
    const alturaGolpe = base * 0.6;
    a[1] += alturaGolpe;
    b[1] += alturaGolpe;
    const largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (largo < 1) return;
    const malla = new THREE.Mesh(
      new THREE.PlaneGeometry(largo, Math.max(2, base * 0.055)),
      new THREE.MeshBasicMaterial({ color: '#fff0b8', transparent: true, opacity: 0.9, depthTest: false })
    );
    malla.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 11000);
    malla.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
    malla.renderOrder = 15;
    world.add(malla);
    beams.push({ malla, t0: performance.now(), dur: 190 });
  }

  function updateBeams(now) {
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      const k = (now - b.t0) / b.dur;
      if (k >= 1) {
        world.remove(b.malla);
        b.malla.geometry.dispose();
        b.malla.material.dispose();
        beams.splice(i, 1);
        continue;
      }
      b.malla.material.opacity = 0.9 * (1 - k);
    }
  }

  const bursts = [];
  function addAbilityBurst(col, row) {
    const base = anchoCelda(col, row);
    const [mx, my] = aMundo(centroCelda(col, row));
    const anillo = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 32),
      new THREE.MeshBasicMaterial({
        color: '#ffd23f', transparent: true, opacity: 0.95,
        side: THREE.DoubleSide, depthTest: false,
      })
    );
    // aplastado, para que se lea como un circulo tumbado en la cubierta
    anillo.scale.set(base, base * 0.42, 1);
    anillo.position.set(mx, my, 10000);
    anillo.renderOrder = 12;
    world.add(anillo);
    bursts.push({ anillo, t0: performance.now(), dur: 480, base });
  }

  function updateBursts(now) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      const k = (now - b.t0) / b.dur;
      if (k >= 1) {
        world.remove(b.anillo);
        b.anillo.geometry.dispose();
        b.anillo.material.dispose();
        bursts.splice(i, 1);
        continue;
      }
      const s = b.base * (1 + k * 2.2);
      b.anillo.scale.set(s, s * 0.42, 1);
      b.anillo.material.opacity = 0.95 * (1 - k);
    }
  }

  // ---------------- Interfaz del modulo ----------------
  function recolocarTodo() {
    for (const tok of tokens.values()) colocarToken(tok);
    pintarHighlights();
  }

  function setInsets(top, bottom) {
    insetTop = top || 0;
    insetBottom = bottom || 0;
    calcularEncaje();
    recolocarTodo();
  }

  function setBoard(nextCols, nextRows) {
    cols = nextCols;
    rows = nextRows;
    calcularEncaje();
    recolocarTodo();
  }

  function pickCell(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    return pantallaACelda(clientX - r.left, clientY - r.top);
  }

  function resize() {
    ancho = container.clientWidth || 1;
    alto = container.clientHeight || 1;
    renderer.setSize(ancho, alto, false);
    camera.left = 0;
    camera.right = ancho;
    camera.top = alto;
    camera.bottom = 0;
    camera.updateProjectionMatrix();
    calcularEncaje();
    recolocarTodo();
  }

  let running = true;
  const relojMixers = new THREE.Clock();
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = relojMixers.getDelta();
    if (mixers.size) for (const m of mixers) m.update(dt);
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
    // Utilidades para las pruebas: donde cae cada casilla y como esta encajado
    // el dibujo de fondo.
    __debug: {
      esquinaCelda: (col, row) => celdaAPantalla(col, row),
      centroCelda: (col, row) => centroCelda(col, row),
      anchoCelda: (col, row) => anchoCelda(col, row),
      encaje: () => ({ ...fit, ancho, alto }),
      resaltados: () => highlightGroup.children.length,
    },
  };
}

// ---------------- Utilidades de dibujo ----------------

function lienzo(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function aTextura(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// "Cartel de se busca" del personaje: retrato si lo hay, si no sus iniciales
function drawCharCanvas(char, portraitImg) {
  const canvas = lienzo(256, 320);
  const c = canvas.getContext('2d');
  const crewColor = CREW_COLORS[char.crew] || '#3a6ea8';

  c.fillStyle = '#f0e2c0';
  roundRect(c, 6, 6, 244, 308, 14);
  c.fill();
  c.strokeStyle = crewColor;
  c.lineWidth = 8;
  roundRect(c, 6, 6, 244, 308, 14);
  c.stroke();

  const px = 20, py = 20, pw = 216, ph = 220;
  c.save();
  roundRect(c, px, py, pw, ph, 10);
  c.clip();
  if (portraitImg) {
    const escala = Math.max(pw / portraitImg.width, ph / portraitImg.height);
    const w = portraitImg.width * escala;
    const h = portraitImg.height * escala;
    c.drawImage(portraitImg, px + (pw - w) / 2, py + (ph - h) / 2, w, h);
  } else {
    c.fillStyle = crewColor;
    c.fillRect(px, py, pw, ph);
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.font = 'bold 96px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(char.initials || '?', px + pw / 2, py + ph / 2);
  }
  c.restore();

  const star = char.star || 0;
  if (star > 0) {
    const sw = 30 * star + 14;
    const sx = 128 - sw / 2;
    c.fillStyle = 'rgba(20,16,10,.85)';
    roundRect(c, sx, 208, sw, 38, 10);
    c.fill();
    c.strokeStyle = '#ffd23f';
    c.lineWidth = 3;
    roundRect(c, sx, 208, sw, 38, 10);
    c.stroke();
    c.fillStyle = '#ffd23f';
    c.font = 'bold 26px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('★'.repeat(star), 128, 228);
  }

  c.fillStyle = crewColor;
  roundRect(c, 20, 250, 216, 50, 8);
  c.fill();
  c.fillStyle = '#fff';
  c.font = 'bold 30px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  let nombre = char.name || '';
  while (c.measureText(nombre).width > 200 && nombre.length > 3) {
    nombre = `${nombre.slice(0, -2)}…`;
  }
  c.fillText(nombre, 128, 276);

  return canvas;
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
