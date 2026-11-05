'use strict';

/* ==========================================================
   No solo las rosas decaen · 21 de diciembre
   Cartel interactivo sobre enfermedades neurodegenerativas.

   Eventos de ratón:
   · mouseenter (cartel)  → empieza la decadencia del cerebro-rosa: el fondo
                            se oscurece, aparecen ojos y el cartel tiembla.
   · mouseleave (cartel)  → la decadencia se pausa y se recupera un poco.
   · mousemove  (cartel)  → el cerebro gira hacia el cursor, las capas
                            se desplazan (paralaje) y las letras cercanas
                            al cursor se deshojan antes.
   · mouseenter (letra)   → la letra se hincha, brilla y suelta pétalos.
   · mouseleave (letra)   → la letra vuelve a su estado inicial.
   ========================================================== */

/* ---------- Configuración ---------- */

const POSTER_W = 848;
const POSTER_H = 1200;

const CONFIG = {
  decayDuration: 5,     // segundos de hover para marchitarse del todo
  recoverSpeed: 0.08,   // recuperación por segundo cuando el ratón sale
  recoverMax: 0.18,     // máximo que puede recuperarse desde el peor punto
  witherPause: 0.6,     // segundos con el cerebro marchito antes de rebrotar
  regrowDuration: 3.5,  // segundos que tarda en volver a brotar
  returnTransition: 'shatter', // vuelta al inicio: 'shatter' (cristal roto) o 'regrow' (rebrote)
  shatterDuration: 2.6, // segundos que tardan en caer los cristales
  stareDuration: 2,     // segundos que el ojo grande mira al frente antes de romperse el cristal
  fallPool: 300,        // pétalos 3D cayendo a la vez como máximo
  letterPetals: 12,     // pétalos 2D que suelta una letra al marchitarse entera
  maxFlatPetals: 700,
};

const BRAIN_SCALE = 1.15;
const PETAL_SPACING = 8;  // un pétalo por celda de 8 × 8 × 8 del modelo
const BRAIN_BASE_ROT_Y = -Math.PI / 2 + 0.5;
const STEM_TOP_Y = -110;

const COLORS = {
  roseDeep: new THREE.Color('#ff2a6d'),
  roseLight: new THREE.Color('#ffb3c9'),
  wilt: new THREE.Color('#5e3634'),
  dead: new THREE.Color('#2b1d1a'),
  sprout: new THREE.Color('#9ad66f'),
  stem: new THREE.Color('#3d7d3a'),
  stemDead: new THREE.Color('#3b2a1e'),
};

// Colores de las letras (RGB para mezclarlos en CSS)
const LETTER_ROSE = [255, 92, 143];
const LETTER_WILT = [150, 112, 118];

// Estados de cada pétalo del cerebro
const ATTACHED = 0;
const GONE = 1;
const REGROWING = 2;

/* ---------- Referencias al DOM ---------- */

const poster = document.getElementById('poster');
const sceneLayer = document.getElementById('sceneLayer');
const metaLayer = document.getElementById('metaLayer');
const titleLayer = document.getElementById('titleLayer');
const titleEl = document.getElementById('title');
const brainCanvas = document.getElementById('brainCanvas');
const petalCanvas = document.getElementById('petalCanvas');
const petalCtx = petalCanvas.getContext('2d');
const darkLayer = document.getElementById('darkLayer');
const eyeCanvas = document.getElementById('eyeCanvas');
const eyeCtx = eyeCanvas.getContext('2d');
const shatterCanvas = document.getElementById('shatterCanvas');
const stareCanvas = document.getElementById('stareCanvas');
const stareCtx = stareCanvas.getContext('2d');

/* ---------- Estado global ---------- */

const state = {
  phase: 'bloom',     // 'bloom' (florecido / decayendo) · 'withered' · 'regrow' · 'shatter'
  pendingShatter: false,
  jolt: 0,            // sacudida fuerte al romperse el cristal
  stare: 0,           // segundos que lleva abierto el ojo grande (0 = no hay ojo)
  phaseTime: 0,
  decay: 0,           // 0 = rosa sana · 1 = marchita
  peakDecay: 0,
  regrow: 0,          // progreso del rebrote 0..1
  darkness: 0,        // 0 = fondo granate · 1 = negro, ojos abiertos y temblor
  brainScreen: { x: POSTER_W / 2, y: POSTER_H * 0.6 },
  hovering: false,
  scale: 1,
  pointer: { x: POSTER_W / 2, y: POSTER_H / 2, nx: 0, ny: 0 },
  smooth: { nx: 0, ny: 0 },
  titleOffset: { x: 0, y: 0 },
  time: 0,
};

const letters = [];
const letterByEl = new Map();
const flatPetals = [];
const eyes = [];

/* ---------- Utilidades ---------- */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mixRGB(a, b, t, alpha = 1) {
  const r = Math.round(lerp(a[0], b[0], t));
  const g = Math.round(lerp(a[1], b[1], t));
  const bl = Math.round(lerp(a[2], b[2], t));
  return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
}

// Convierte unos valores en su posición relativa (0..1) para repartirlos de forma uniforme
function rankNormalize(values) {
  const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b]);
  const out = new Float32Array(values.length);
  order.forEach((index, rank) => {
    out[index] = rank / (values.length - 1);
  });
  return out;
}

/* ==========================================================
   1. ESCALADO DEL CARTEL
   ========================================================== */

function fitPoster() {
  state.scale = Math.min(window.innerWidth / POSTER_W, window.innerHeight / POSTER_H, 1);
  poster.style.transform = `scale(${state.scale})`;
}

// Pasa coordenadas de pantalla a coordenadas internas del cartel (848 × 1200)
function toPosterCoords(clientX, clientY) {
  const rect = poster.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / state.scale,
    y: (clientY - rect.top) / state.scale,
  };
}

/* ==========================================================
   2. TITULAR: una caja por letra
   ========================================================== */

function buildTitle() {
  const lines = titleEl.dataset.lines.split('|');
  titleEl.textContent = '';
  titleEl.setAttribute('aria-label', lines.join(' '));

  lines.forEach((line) => {
    const lineEl = document.createElement('span');
    lineEl.className = 'title__line';
    lineEl.setAttribute('aria-hidden', 'true');

    [...line].forEach((char) => {
      if (char === ' ') {
        const space = document.createElement('span');
        space.className = 'title__space';
        lineEl.appendChild(space);
        return;
      }

      const letterEl = document.createElement('span');
      letterEl.className = 'letter';
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = char;
      letterEl.appendChild(glyph);
      lineEl.appendChild(letterEl);

      const letter = {
        el: letterEl,
        glyph,
        offset: rand(0, 0.4),       // cuándo empieza a deshojarse
        regrowAt: rand(0.15, 0.5),  // cuándo se repuebla en el rebrote
        droop: rand(4, 16),
        tilt: rand(-9, 9),
        value: 0,                   // 0 = gruesa · 1 = fina y marchita
        lastValue: -1,
        shed: 0,
        absorb: 0,
        x: 0, y: 0, w: 0, h: 0,
      };
      letters.push(letter);
      letterByEl.set(letterEl, letter);

      letterEl.addEventListener('mouseenter', handleLetterEnter);
      letterEl.addEventListener('mouseleave', handleLetterLeave);
    });

    titleEl.appendChild(lineEl);
  });
}

// Fija el ancho de cada letra con su versión gruesa para que no "baile" al adelgazar
function measureLetters() {
  const posterRect = poster.getBoundingClientRect();
  letters.forEach((letter) => {
    const rect = letter.el.getBoundingClientRect();
    letter.x = (rect.left - posterRect.left) / state.scale - state.titleOffset.x;
    letter.y = (rect.top - posterRect.top) / state.scale - state.titleOffset.y;
    letter.h = rect.height / state.scale;
    if (letter.w === 0) {
      letter.w = rect.width / state.scale;
      letter.el.style.width = `${letter.w}px`;
    }
  });
}

function letterCenter(letter) {
  return {
    x: letter.x + letter.w / 2 + state.titleOffset.x,
    y: letter.y + letter.h * 0.55 + state.titleOffset.y,
  };
}

function applyLetterStyle(letter) {
  const v = letter.value;
  if (Math.abs(v - letter.lastValue) < 0.001) return;
  letter.lastValue = v;

  const wght = Math.round(900 - 800 * v);
  const wdth = Math.round(112 - 30 * v);

  letter.glyph.style.fontVariationSettings = `"wght" ${wght}, "wdth" ${wdth}`;
  letter.glyph.style.color = mixRGB(LETTER_ROSE, LETTER_WILT, smoothstep(0, 1, v));
  letter.glyph.style.transform = `translateY(${(v * letter.droop).toFixed(1)}px) rotate(${(v * letter.tilt).toFixed(2)}deg)`;
  letter.glyph.style.opacity = (1 - 0.25 * v).toFixed(3);
}

function updateLetters(dt) {
  letters.forEach((letter) => {
    let target;

    if (state.phase === 'regrow') {
      target = 1 - smoothstep(letter.regrowAt, letter.regrowAt + 0.45, state.regrow);
    } else if (state.phase === 'withered') {
      target = 1;
    } else {
      target = clamp((state.decay - letter.offset) / 0.55, 0, 1);

      // Las letras cercanas al cursor se deshojan antes
      if (state.hovering && letter.w > 0) {
        const c = letterCenter(letter);
        const dist = Math.hypot(state.pointer.x - c.x, state.pointer.y - c.y);
        target = Math.min(1, target + Math.max(0, 1 - dist / 170) * 0.3);
      }
    }

    const previous = letter.value;
    letter.value += (target - letter.value) * Math.min(1, dt * 8);
    const delta = letter.value - previous;

    if (delta > 0) {
      letter.shed += delta * CONFIG.letterPetals;
      while (letter.shed >= 1) {
        letter.shed -= 1;
        spawnFlatPetal(letter, 'fall');
      }
    } else if (delta < 0 && state.phase === 'regrow') {
      letter.absorb += -delta * CONFIG.letterPetals * 0.6;
      while (letter.absorb >= 1) {
        letter.absorb -= 1;
        spawnFlatPetal(letter, 'absorb');
      }
    }

    applyLetterStyle(letter);
  });
}

/* ==========================================================
   3. PÉTALOS 2D (se desprenden de las letras)
   ========================================================== */

function setupPetalCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  petalCanvas.width = POSTER_W * dpr;
  petalCanvas.height = POSTER_H * dpr;
  petalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawnFlatPetal(letter, mode) {
  if (letter.w === 0 || flatPetals.length >= CONFIG.maxFlatPetals) return;

  const x = letter.x + state.titleOffset.x + rand(0.15, 0.85) * letter.w;
  const y = letter.y + state.titleOffset.y + rand(0.25, 0.85) * letter.h;

  if (mode === 'fall') {
    flatPetals.push({
      mode,
      x, y,
      vx: rand(-30, 30),
      vy: rand(-50, 0),
      rot: rand(0, Math.PI * 2),
      vrot: rand(-3, 3),
      flip: rand(0, Math.PI * 2),
      vflip: rand(3, 7),
      size: rand(9, 16),
      life: 0,
      maxLife: rand(2.2, 3.4),
      // Vuelo: balanceo lateral, viento y velocidad de caída propios
      freq: rand(2, 3.5),
      phase: rand(0, Math.PI * 2),
      amp: rand(40, 80),
      wind: rand(-15, 15),
      fall: rand(100, 160),
      color: mixRGB(LETTER_ROSE, LETTER_WILT, clamp(letter.value + rand(-0.15, 0.15), 0, 1)),
    });
  } else {
    const angle = rand(0, Math.PI * 2);
    const radius = rand(60, 130);
    flatPetals.push({
      mode,
      sx: x + Math.cos(angle) * radius,
      sy: y + Math.abs(Math.sin(angle)) * radius,
      tx: x,
      ty: y,
      x, y,
      rot: rand(0, Math.PI * 2),
      vrot: rand(-4, 4),
      flip: rand(0, Math.PI * 2),
      vflip: rand(3, 7),
      size: rand(8, 13),
      life: 0,
      maxLife: rand(0.45, 0.7),
      color: mixRGB(LETTER_ROSE, [255, 200, 215], Math.random()),
    });
  }
}

// Ráfaga de pétalos al pasar el ratón por una letra
function burstLetter(letter, amount) {
  for (let i = 0; i < amount; i++) {
    spawnFlatPetal(letter, 'fall');
    const petal = flatPetals[flatPetals.length - 1];
    if (petal) {
      petal.vx = rand(-90, 90);
      petal.vy = rand(-140, -40);
    }
  }
}

// Pétalo de rosa: base estrecha abajo, borde redondeado con muesca arriba.
// La forma se crea una sola vez y se reutiliza en todos los pétalos.
const PETAL_PATH = new Path2D();
PETAL_PATH.moveTo(0, 1);
PETAL_PATH.bezierCurveTo(-0.3, 0.8, -0.75, 0.2, -0.62, -0.45);
PETAL_PATH.bezierCurveTo(-0.52, -0.95, -0.15, -1.02, 0, -0.82);
PETAL_PATH.bezierCurveTo(0.15, -1.02, 0.52, -0.95, 0.62, -0.45);
PETAL_PATH.bezierCurveTo(0.75, 0.2, 0.3, 0.8, 0, 1);

// El degradado de cada pétalo se crea una vez, al nacer, y no en cada frame
function getPetalFill(p) {
  if (!p.fill) {
    p.fill = petalCtx.createLinearGradient(0, 1, 0, -1);
    p.fill.addColorStop(0, 'rgba(60, 10, 25, 0.9)');
    p.fill.addColorStop(0.55, p.color);
  }
  return p.fill;
}

function updateFlatPetals(dt) {
  const dpr = petalCanvas.width / POSTER_W;
  petalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  petalCtx.clearRect(0, 0, POSTER_W, POSTER_H);

  for (let i = flatPetals.length - 1; i >= 0; i--) {
    const p = flatPetals[i];
    p.life += dt;
    p.rot += p.vrot * dt;
    p.flip += p.vflip * dt;

    let alpha;
    let size = p.size;

    if (p.mode === 'fall') {
      // Como una hoja: se balancea y cae más despacio en los extremos del balanceo
      const swing = Math.sin(p.life * p.freq + p.phase);
      p.vx = lerp(p.vx, p.wind + swing * p.amp, Math.min(1, dt * 3));
      p.vy = lerp(p.vy, p.fall * (1 - 0.75 * Math.abs(swing)), Math.min(1, dt * 2));
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alpha = 1 - smoothstep(p.maxLife * 0.7, p.maxLife, p.life);
    } else {
      const t = clamp(p.life / p.maxLife, 0, 1);
      const e = easeOutCubic(t);
      p.x = lerp(p.sx, p.tx, e);
      p.y = lerp(p.sy, p.ty, e);
      alpha = Math.sin(Math.PI * t);
      size *= 1 - t * 0.7;
    }

    if (p.life >= p.maxLife || p.y > POSTER_H + 20) {
      // Quitar sin desplazar el array: el último ocupa su lugar
      flatPetals[i] = flatPetals[flatPetals.length - 1];
      flatPetals.pop();
      continue;
    }

    petalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    petalCtx.globalAlpha = alpha;
    petalCtx.translate(p.x, p.y);
    petalCtx.rotate(p.rot);
    petalCtx.scale(size * (0.25 + 0.75 * Math.abs(Math.cos(p.flip))), size);
    petalCtx.fillStyle = getPetalFill(p);
    petalCtx.fill(PETAL_PATH);
  }
  petalCtx.globalAlpha = 1;
}

/* ==========================================================
   4. ESCENA 3D: el cerebro-rosa
   ========================================================== */

let renderer, scene, camera, pivot, brain;
let petalMesh, fallMesh, skeleton, stem, leaves;
let petals;      // datos de cada pétalo del cerebro
const fallPool = [];
let fallCount = 0;   // pétalos cayendo ahora mismo
const brainWorldQuat = new THREE.Quaternion();

function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas: brainCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(POSTER_W, POSTER_H, false);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, POSTER_W / POSTER_H, 1, 3000);
  camera.position.set(0, 0, 820);

  scene.add(new THREE.HemisphereLight(0xffd6e2, 0x2a0a14, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-300, 420, 500);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff4f8a, 0.9);
  rim.position.set(260, -80, -420);
  scene.add(rim);

  // El pivote está en la punta del tallo: desde ahí el cerebro "cabecea" al marchitarse
  pivot = new THREE.Group();
  pivot.position.set(0, STEM_TOP_Y, 0);
  scene.add(pivot);

  brain = new THREE.Group();
  brain.position.y = 62;
  brain.scale.setScalar(BRAIN_SCALE);
  brain.rotation.y = BRAIN_BASE_ROT_Y;
  pivot.add(brain);

  createBrainPetals();
  createFallingPetals();
  createStem();
}

// Pétalo de rosa: base estrecha en el origen, borde redondeado con muesca hacia +Y,
// cóncavo hacia +Z y con la punta curvada hacia fuera. Más oscuro en la base.
function createPetalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.35, 0.12, -0.8, 0.55, -0.68, 1.02);
  shape.bezierCurveTo(-0.58, 1.38, -0.18, 1.42, 0, 1.28);
  shape.bezierCurveTo(0.18, 1.42, 0.58, 1.38, 0.68, 1.02);
  shape.bezierCurveTo(0.8, 0.55, 0.35, 0.12, 0, 0);

  const geometry = new THREE.ShapeGeometry(shape, 10);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, 0.7 * x * x + 0.3 * y * y - 0.12 * Math.pow(Math.max(y - 0.9, 0), 2) * 10);
    const shade = 0.5 + 0.5 * smoothstep(0, 1.2, y);
    colors.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createBrainPetals() {
  const raw = window.BRAIN_POINTS;
  const rawCount = raw.length / 3;

  // Centro y semiejes del modelo
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rawCount; i++) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], raw[i * 3 + k]);
      max[k] = Math.max(max[k], raw[i * 3 + k]);
    }
  }
  const center = min.map((m, k) => (m + max[k]) / 2);
  const half = min.map((m, k) => (max[k] - m) / 2);

  // Muestreo en rejilla: un solo pétalo por celda para que sean menos y más grandes
  const picked = [];
  const cells = new Set();
  for (let i = 0; i < rawCount; i++) {
    const key = [0, 1, 2].map((k) => Math.floor((raw[i * 3 + k] - min[k]) / PETAL_SPACING)).join(',');
    if (!cells.has(key)) {
      cells.add(key);
      picked.push(i);
    }
  }
  const count = picked.length;

  petals = {
    count,
    base: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    rot: new Float32Array(count * 9),
    quat: new Float32Array(count * 4),
    size: new Float32Array(count),
    color: new Float32Array(count * 3),
    state: new Uint8Array(count),
    grow: new Float32Array(count),
    threshold: null,
    sprout: null,
  };

  const decayOrder = new Float32Array(count);
  const sproutOrder = new Float32Array(count);
  const n = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const Z = new THREE.Vector3(0, 0, 1);
  const X = new THREE.Vector3(1, 0, 0);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const j = picked[i];
    const x = raw[j * 3] - center[0];
    const y = raw[j * 3 + 1] - center[1];
    const z = raw[j * 3 + 2] - center[2];
    petals.base.set([x, y, z], i * 3);

    // Normal aproximada de un elipsoide (el cerebro es alargado)
    n.set(x / (half[0] * half[0]), y / (half[1] * half[1]), z / (half[2] * half[2])).normalize();
    petals.normal.set([n.x, n.y, n.z], i * 3);

    // Orientación: tangente a la superficie, punta levantada como en una rosa
    q.setFromUnitVectors(Z, n);
    qSpin.setFromAxisAngle(Z, rand(0, Math.PI * 2));
    qTilt.setFromAxisAngle(X, rand(0.5, 1.05));
    q.multiply(qSpin).multiply(qTilt);
    petals.quat.set([q.x, q.y, q.z, q.w], i * 4);

    m.makeRotationFromQuaternion(q);
    const e = m.elements;
    petals.rot.set([e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]], i * 9);

    petals.size[i] = rand(9, 13);

    color.copy(COLORS.roseDeep).lerp(COLORS.roseLight, Math.pow(Math.random(), 1.5) * 0.85);
    petals.color.set([color.r, color.g, color.b], i * 3);

    // Orden de caída: a "cachos" (ruido) y de arriba abajo
    const heightN = (y + half[1]) / (2 * half[1]);
    const patch = Math.sin(x * 0.07 + 1.3) * Math.sin(y * 0.09 + 0.4) * Math.sin(z * 0.06 + 2.1)
      + 0.5 * Math.sin(x * 0.15 + z * 0.11);
    decayOrder[i] = 0.5 * patch + 0.3 * Math.random() + 0.35 * heightN;

    // Orden de rebrote: desde abajo (el tallo) hacia arriba
    sproutOrder[i] = 0.75 * heightN + 0.25 * Math.random();
  }

  // Los primeros en caer tienen umbral bajo; todos han caído al llegar a 0.9
  petals.threshold = rankNormalize(decayOrder).map((r) => 0.04 + 0.86 * (1 - r));
  petals.sprout = rankNormalize(sproutOrder).map((r) => r * 0.82);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  petalMesh = new THREE.InstancedMesh(createPetalGeometry(), material, count);
  petalMesh.frustumCulled = false;
  petalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) {
    petalMesh.setColorAt(i, color.setRGB(1, 1, 1));
  }
  brain.add(petalMesh);

  // "Esqueleto": la nube de puntos original, visible cuando caen los pétalos
  const skeletonPositions = new Float32Array(rawCount * 3);
  for (let i = 0; i < rawCount; i++) {
    for (let k = 0; k < 3; k++) skeletonPositions[i * 3 + k] = raw[i * 3 + k] - center[k];
  }
  const skeletonGeometry = new THREE.BufferGeometry();
  skeletonGeometry.setAttribute('position', new THREE.BufferAttribute(skeletonPositions, 3));
  skeleton = new THREE.Points(skeletonGeometry, new THREE.PointsMaterial({
    color: 0xc79aa6,
    size: 1.3,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  }));
  brain.add(skeleton);
}

function createFallingPetals() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  fallMesh = new THREE.InstancedMesh(createPetalGeometry(), material, CONFIG.fallPool);
  fallMesh.frustumCulled = false;
  fallMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < CONFIG.fallPool; i++) {
    fallMesh.setColorAt(i, white);
    fallPool.push({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      axis: new THREE.Vector3(),
      spin: 0,
      size: 1,
      life: 0,
      sway: 0,
      color: new THREE.Color(),
    });
  }
  // Después de crear los colores (setColorAt reserva memoria según count):
  // solo se dibujan los pétalos que están cayendo
  fallMesh.count = 0;
  scene.add(fallMesh);
}

// Hoja de papiroflexia: dos triángulos plegados por el nervio central
function createOrigamiLeafGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, -0.45, 0.55, 0.3, 0, 1.4, 0,
    0, 0, 0, 0, 1.4, 0, 0.45, 0.55, 0.3,
  ]), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createStem() {
  // Tallo de papiroflexia: tramos rectos (tensión 0), sección cuadrada y sombreado plano
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(74, -270, 0),
    new THREE.Vector3(46, -242, 10),
    new THREE.Vector3(30, -212, 14),
    new THREE.Vector3(36, -180, 8),
    new THREE.Vector3(32, -150, -2),
    new THREE.Vector3(14, -122, -6),
    new THREE.Vector3(0, STEM_TOP_Y + 10, 0),
  ], false, 'catmullrom', 0);
  const segments = 24;
  const radial = 4;
  const geometry = new THREE.TubeGeometry(curve, segments, 2.6, radial, false);

  // Se estrecha hacia arriba: escalamos cada anillo respecto a su centro
  const pos = geometry.attributes.position;
  const center = new THREE.Vector3();
  for (let j = 0; j <= segments; j++) {
    curve.getPointAt(j / segments, center);
    const taper = lerp(1.35, 0.7, j / segments);
    for (let k = 0; k <= radial; k++) {
      const v = j * (radial + 1) + k;
      pos.setXYZ(
        v,
        center.x + (pos.getX(v) - center.x) * taper,
        center.y + (pos.getY(v) - center.y) * taper,
        center.z + (pos.getZ(v) - center.z) * taper,
      );
    }
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.stem.clone(),
    roughness: 0.9,
    flatShading: true,
  });
  stem = new THREE.Mesh(geometry, material);
  stem.userData = { segments, indicesPerSegment: radial * 6 };
  scene.add(stem);

  // Dos hojas plegadas a lo largo del tallo
  const leafGeometry = createOrigamiLeafGeometry();
  leaves = [0.4, 0.66].map((t, i) => {
    const leaf = new THREE.Mesh(leafGeometry, new THREE.MeshStandardMaterial({
      color: COLORS.stem.clone(),
      roughness: 0.9,
      flatShading: true,
      side: THREE.DoubleSide,
    }));
    leaf.position.copy(curve.getPoint(t));
    leaf.rotation.set(0.25, i === 0 ? 0.5 : -0.5, i === 0 ? -1.0 : 1.0);
    leaf.userData = { t, size: 24 };
    scene.add(leaf);
    return leaf;
  });
}

// Pasa un pétalo del cerebro a la lista de pétalos que caen
function detachPetal(i, scale, color) {
  if (Math.random() < 0.75 || fallCount >= CONFIG.fallPool) return; // solo cae uno de cada cuatro
  const slot = fallPool[fallCount++];

  const b = i * 3;
  const nx = petals.normal[b];
  const ny = petals.normal[b + 1];
  const nz = petals.normal[b + 2];

  slot.life = 0;
  slot.sway = rand(0, Math.PI * 2);
  slot.pos.set(petals.base[b] + nx, petals.base[b + 1] + ny, petals.base[b + 2] + nz)
    .applyMatrix4(brain.matrixWorld);
  slot.vel.set(nx, ny, nz).applyQuaternion(brainWorldQuat).multiplyScalar(rand(15, 40));
  slot.vel.x += rand(-10, 10);
  slot.vel.y += rand(0, 20);
  slot.quat.set(petals.quat[i * 4], petals.quat[i * 4 + 1], petals.quat[i * 4 + 2], petals.quat[i * 4 + 3]);
  slot.quat.premultiply(brainWorldQuat);
  slot.axis.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
  slot.spin = rand(1, 2.5);
  // Vuelo: balanceo lateral, viento y velocidad de caída propios
  slot.freq = rand(1.6, 2.8);
  slot.amp = rand(25, 50);
  slot.wind = rand(-12, 12);
  slot.fall = rand(30, 55);
  slot.size = petals.size[i] * scale * BRAIN_SCALE;
  slot.color.copy(color);
}

const tmpColor = new THREE.Color();

function updateBrainPetals(dt) {
  const mat = petalMesh.instanceMatrix.array;
  const col = petalMesh.instanceColor.array;
  const { base, normal, rot, size, color, state: st, grow, threshold, sprout } = petals;
  const decay = state.decay;
  const petalT = (state.regrow - 0.22) / 0.78;

  for (let i = 0; i < petals.count; i++) {
    let s = 0;        // escala visible 0..1
    let wilt = 0;     // marchitez 0..1
    let green = 0;    // brote verde 0..1

    if (state.phase === 'shatter') {
      s = 1;   // bajo el cristal roto el cerebro ya está entero y rosa
    } else if (state.phase === 'regrow') {
      s = smoothstep(sprout[i], sprout[i] + 0.14, petalT);
      // El verde tiene que haber desaparecido del todo al terminar el rebrote
      green = 1 - smoothstep(sprout[i] + 0.04, Math.min(sprout[i] + 0.3, 1), petalT);
    } else if (state.phase === 'bloom') {
      const t = threshold[i];
      // Sin decadencia no hay marchitez, aunque el pétalo sea de los primeros en caer
      wilt = smoothstep(Math.max(t - 0.22, 0), t, decay);

      if (st[i] !== GONE && decay >= t) {
        const current = st[i] === REGROWING ? easeOutCubic(Math.min(grow[i], 1)) : 1;
        tmpColor.setRGB(color[i * 3], color[i * 3 + 1], color[i * 3 + 2]).lerp(COLORS.wilt, 0.9);
        detachPetal(i, current * 0.6, tmpColor);
        st[i] = GONE;
      } else if (st[i] === GONE && decay < t - 0.015) {
        st[i] = REGROWING;
        grow[i] = 0;
      }

      if (st[i] === ATTACHED) {
        s = 1 - 0.4 * wilt;
      } else if (st[i] === REGROWING) {
        grow[i] += dt / 0.45;
        s = easeOutCubic(Math.min(grow[i], 1)) * (1 - 0.4 * wilt);
        if (grow[i] >= 1) st[i] = ATTACHED;
      }
    }

    // Matriz: rotación fija × escala, desplazada por la normal (se hunde al marchitarse)
    const sc = Math.max(size[i] * s, 0.0001);
    const lift = 1 - wilt * 4;
    const o = i * 16;
    const r = i * 9;
    const b = i * 3;
    mat[o] = rot[r] * sc;          mat[o + 1] = rot[r + 1] * sc;  mat[o + 2] = rot[r + 2] * sc;   mat[o + 3] = 0;
    mat[o + 4] = rot[r + 3] * sc;  mat[o + 5] = rot[r + 4] * sc;  mat[o + 6] = rot[r + 5] * sc;   mat[o + 7] = 0;
    mat[o + 8] = rot[r + 6] * sc;  mat[o + 9] = rot[r + 7] * sc;  mat[o + 10] = rot[r + 8] * sc;  mat[o + 11] = 0;
    mat[o + 12] = base[b] + normal[b] * lift;
    mat[o + 13] = base[b + 1] + normal[b + 1] * lift;
    mat[o + 14] = base[b + 2] + normal[b + 2] * lift;
    mat[o + 15] = 1;

    // Color: rosa → marrón al marchitarse, verde al brotar
    tmpColor.setRGB(color[b], color[b + 1], color[b + 2]);
    if (wilt > 0) tmpColor.lerp(COLORS.wilt, wilt);
    if (green > 0) tmpColor.lerp(COLORS.sprout, green);
    col[b] = tmpColor.r;
    col[b + 1] = tmpColor.g;
    col[b + 2] = tmpColor.b;
  }

  petalMesh.instanceMatrix.needsUpdate = true;
  petalMesh.instanceColor.needsUpdate = true;
}

const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpSpin = new THREE.Quaternion();

// Los pétalos activos ocupan siempre las primeras posiciones del array (0..fallCount-1):
// así solo se recorren y dibujan los que están cayendo
function updateFallingPetals(dt) {
  for (let i = 0; i < fallCount; i++) {
    const p = fallPool[i];
    p.life += dt;

    if (p.pos.y < -250 || p.life >= 3.2) {
      // Intercambia con el último activo y vuelve a procesar esta posición
      fallPool[i] = fallPool[fallCount - 1];
      fallPool[fallCount - 1] = p;
      fallCount--;
      i--;
      continue;
    }

    // Como una hoja: se balancea de lado a lado y cae más despacio en los extremos;
    // el impulso inicial hacia fuera se va convirtiendo poco a poco en este planeo
    const swing = Math.sin(p.life * p.freq + p.sway);
    const k = Math.min(1, dt * 2.5);
    p.vel.x = lerp(p.vel.x, p.wind + swing * p.amp, k);
    p.vel.z = lerp(p.vel.z, Math.cos(p.life * p.freq * 0.7 + p.sway) * p.amp * 0.4, k);
    p.vel.y = lerp(p.vel.y, -p.fall * (1 - 0.75 * Math.abs(swing)), k);
    p.pos.addScaledVector(p.vel, dt);
    tmpSpin.setFromAxisAngle(p.axis, p.spin * (0.5 + Math.abs(swing)) * dt);
    p.quat.multiply(tmpSpin);

    const fade = 1 - smoothstep(2.2, 3.2, p.life);
    tmpScale.setScalar(Math.max(p.size * fade, 0.0001));
    tmpMatrix.compose(p.pos, p.quat, tmpScale);
    fallMesh.setMatrixAt(i, tmpMatrix);
    tmpColor.copy(p.color).lerp(COLORS.dead, Math.min(p.life / 2, 1) * 0.8);
    fallMesh.setColorAt(i, tmpColor);
  }

  if (fallCount > 0 || fallMesh.count > 0) {
    fallMesh.instanceMatrix.needsUpdate = true;
    fallMesh.instanceColor.needsUpdate = true;
  }
  fallMesh.count = fallCount;
}

function updateStem() {
  let growth;
  let dead;

  if (state.phase === 'bloom') {
    growth = 1 - smoothstep(0.88, 1, state.decay);
    dead = smoothstep(0.35, 0.95, state.decay);
  } else if (state.phase === 'withered') {
    growth = 0;
    dead = 1;
  } else {
    growth = smoothstep(0, 0.32, state.regrow);
    dead = 0;
  }

  const { segments, indicesPerSegment } = stem.userData;
  stem.geometry.setDrawRange(0, Math.floor(segments * growth) * indicesPerSegment);
  stem.material.color.copy(COLORS.stem).lerp(COLORS.stemDead, dead);

  leaves.forEach((leaf) => {
    const g = smoothstep(leaf.userData.t, leaf.userData.t + 0.15, growth);
    leaf.scale.setScalar(Math.max(leaf.userData.size * g, 0.0001));
    leaf.material.color.copy(COLORS.stem).lerp(COLORS.stemDead, dead);
  });

  // El esqueleto se ve más cuanto más desnudo está el cerebro
  const bare = state.phase === 'withered' ? 1
    : state.phase === 'regrow' ? 1 - smoothstep(0.3, 1, state.regrow)
      : smoothstep(0.2, 0.9, state.decay);
  skeleton.material.opacity = 0.12 + 0.4 * bare;
}

function updateBrainMotion(dt) {
  const k = Math.min(1, dt * 3);
  state.smooth.nx = lerp(state.smooth.nx, state.hovering ? state.pointer.nx : 0, k);
  state.smooth.ny = lerp(state.smooth.ny, state.hovering ? state.pointer.ny : 0, k);

  const idle = Math.sin(state.time * 0.35) * 0.25;
  brain.rotation.y = BRAIN_BASE_ROT_Y + idle + state.smooth.nx * 0.7;
  brain.rotation.x = state.smooth.ny * 0.35;

  // La "cabeza" de la rosa cabecea hacia delante al marchitarse
  let droop = 0;
  if (state.phase === 'bloom') droop = smoothstep(0.25, 0.9, state.decay);
  else if (state.phase === 'withered') droop = 1;
  else droop = 1 - smoothstep(0.1, 0.5, state.regrow);
  pivot.rotation.z = -droop * 0.32;
  pivot.rotation.x = droop * 0.22;

  brain.updateMatrixWorld(true);
  brain.getWorldQuaternion(brainWorldQuat);
}

/* ==========================================================
   5. CICLO: florecer → marchitarse → rebrotar
   ========================================================== */

function setPhase(phase) {
  state.phase = phase;
  state.phaseTime = 0;

  if (phase === 'bloom') {
    state.decay = 0;
    state.peakDecay = 0;
    state.regrow = 0;
    petals.state.fill(ATTACHED);
  }
}

function updateCycle(dt) {
  state.phaseTime += dt;

  if (state.phase === 'bloom') {
    if (state.hovering) {
      state.decay += dt / CONFIG.decayDuration;
      state.peakDecay = Math.max(state.peakDecay, state.decay);
    } else {
      state.decay = Math.max(0, state.decay - CONFIG.recoverSpeed * dt, state.peakDecay - CONFIG.recoverMax);
    }
    if (state.decay >= 1) {
      state.decay = 1;
      setPhase('withered');
    }
  } else if (state.phase === 'withered') {
    if (CONFIG.returnTransition === 'shatter') {
      // Tras la pausa aparece el ojo grande; al terminar su mirada se rompe el cristal
      // (justo después de dibujar este frame, ver animate)
      const stareTime = state.phaseTime - CONFIG.witherPause;
      state.stare = stareTime > 0 ? stareTime : 0;
      if (stareTime >= CONFIG.stareDuration && !state.pendingShatter) state.pendingShatter = true;
    } else if (state.phaseTime >= CONFIG.witherPause) {
      setPhase('regrow');
    }
  } else if (state.phase === 'shatter') {
    if (state.phaseTime >= CONFIG.shatterDuration) {
      setPhase('bloom');
      clearShards();
    }
  } else {
    state.regrow = Math.min(1, state.phaseTime / CONFIG.regrowDuration);
    if (state.regrow >= 1) setPhase('bloom');
  }
}

/* ==========================================================
   6. PARALAJE
   ========================================================== */

function updateParallax() {
  const { nx, ny } = state.smooth;
  state.titleOffset.x = -nx * 14;
  state.titleOffset.y = -ny * 10;

  titleLayer.style.transform = `translate(${state.titleOffset.x.toFixed(2)}px, ${state.titleOffset.y.toFixed(2)}px)`;
  metaLayer.style.transform = `translate(${(nx * 5).toFixed(2)}px, ${(ny * 4).toFixed(2)}px)`;
  sceneLayer.style.transform = `translate(${(nx * 10).toFixed(2)}px, ${(ny * 8).toFixed(2)}px)`;
}

/* ==========================================================
   6b. FONDO: oscuridad, ojos turbios y temblor
   ========================================================== */

function setupEyeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  [eyeCanvas, stareCanvas].forEach((c) => {
    c.width = POSTER_W * dpr;
    c.height = POSTER_H * dpr;
  });
  eyeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stareCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Zonas del cartel donde puede aparecer un ojo (rangos de x e y del centro y anchura máxima):
// alrededor del titular y del cerebro, sin taparlos, repartidas por todo el cartel
const EYE_ZONES = [
  { x: [770, 800], y: [170, 250], maxW: 90 },    // arriba a la derecha
  { x: [770, 800], y: [380, 480], maxW: 90 },    // derecha, junto al titular
  { x: [60, 100], y: [560, 680], maxW: 100 },    // izquierda del cerebro, arriba
  { x: [750, 790], y: [600, 740], maxW: 110 },   // derecha del cerebro, arriba
  { x: [60, 110], y: [800, 920], maxW: 110 },    // izquierda del cerebro, abajo
  { x: [740, 790], y: [840, 940], maxW: 110 },   // derecha del cerebro, abajo
  { x: [120, 250], y: [1040, 1140], maxW: 130 }, // abajo a la izquierda
  { x: [340, 460], y: [1080, 1150], maxW: 120 }, // abajo en el centro
  { x: [660, 770], y: [1040, 1140], maxW: 130 }, // abajo a la derecha
];

// Coloca un ojo en cada zona, con posición y tamaño variables dentro de ella
function createEyes() {
  EYE_ZONES.forEach((zone) => {
    const w = rand(60, zone.maxW);
    const x = rand(zone.x[0], zone.x[1]);
    const y = rand(zone.y[0], zone.y[1]);

    // Venas: curvas desde el borde hacia el iris (en unidades relativas al ojo)
    const veins = [];
    for (let v = 0; v < 5; v++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x0 = side * rand(0.6, 0.95);
      const y0 = rand(-0.4, 0.4);
      veins.push([x0, y0, x0 * 0.7, y0 + rand(-0.5, 0.5), x0 * rand(0.25, 0.45), y0 * 0.3]);
    }

    eyes.push({
      x, y, w,
      h: w * 0.38,
      lid: rand(0.5, 1),                   // párpado superior caído
      opacity: rand(0.9, 1),
      look: { x: 0, y: 0 },
      shake: { x: 0, y: 0 },
      twitch: { x: 0, y: 0 },
      nextTwitch: rand(0.5, 3),
      blink: 0,
      nextBlink: rand(1, 5),
      veins,
      seed: rand(0, 100),
    });
  });

  // Orden de aparición aleatorio (salen en sitios distintos);
  // el primero no aparece hasta que el fondo está oscuro
  eyes.sort(() => Math.random() - 0.5);
  eyes.forEach((eye, i) => {
    eye.appearAt = 0.3 + (i / eyes.length) * 0.5;
  });
}

function updateDarkness() {
  if (state.phase === 'bloom') state.darkness = smoothstep(0.08, 0.85, state.decay);
  else if (state.phase === 'withered') state.darkness = 1;
  else state.darkness = 1 - smoothstep(0.05, 0.6, state.regrow);

  darkLayer.style.opacity = (state.darkness * 0.95).toFixed(3);
}

// Posición del cerebro en pantalla: hacia ahí miran los ojos
const tmpVec = new THREE.Vector3();
function updateBrainScreen() {
  brain.getWorldPosition(tmpVec).project(camera);
  state.brainScreen.x = (tmpVec.x + 1) / 2 * POSTER_W;
  state.brainScreen.y = (1 - tmpVec.y) / 2 * POSTER_H;
}

// Mirada colectiva: cada pocos segundos todos los ojos miran al cursor (al espectador)
const glance = { active: 0, next: rand(3, 6) };

// Dibuja la forma del ojo (almendra con el párpado superior caído)
function eyeShapePath(ctx, w, h, lid) {
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.quadraticCurveTo(0, -h * 1.35 * lid, w / 2, 0);
  ctx.quadraticCurveTo(0, h * 1.35, -w / 2, 0);
  ctx.closePath();
}

function drawEye(eye, visible, alpha, offsetX, offsetY) {
  const { w } = eye;
  const h = eye.h * visible * (1 - eye.blink);   // se abren al aparecer y parpadean
  if (h < 0.5) return;

  const ctx = eyeCtx;
  ctx.save();
  ctx.translate(eye.x + eye.shake.x + eye.twitch.x + offsetX, eye.y + eye.shake.y + eye.twitch.y + offsetY);
  ctx.globalAlpha = alpha;

  // Blanco del ojo casi negro, enfermo
  eyeShapePath(ctx, w, h, eye.lid);
  const sclera = ctx.createRadialGradient(-w * 0.08, 0, 0, 0, 0, w / 2);
  sclera.addColorStop(0, '#f4f2ee');
  sclera.addColorStop(0.6, '#c9c5be');
  sclera.addColorStop(1, '#1a1817');
  ctx.fillStyle = sclera;
  ctx.fill();
  ctx.clip();

  // Venas rojo oscuro
  ctx.strokeStyle = 'rgba(130, 18, 24, 0.75)';
  ctx.lineWidth = 0.9;
  eye.veins.forEach(([x0, y0, cx, cy, x1, y1]) => {
    ctx.beginPath();
    ctx.moveTo(x0 * w / 2, y0 * h);
    ctx.quadraticCurveTo(cx * w / 2, cy * h, x1 * w / 2, y1 * h);
    ctx.stroke();
  });

  // Iris negro con la pupila dilatada que late
  const pulse = 1 + Math.sin(state.time * 3 + eye.seed) * 0.06;
  const r = eye.h * 1.25 * pulse;   // más grande porque su borde se funde con el blanco
  const ix = eye.look.x * (w / 2 - r * 0.5);
  const iy = eye.look.y * eye.h * 0.45;
  ctx.globalAlpha = Math.min(1, alpha * 1.5);   // el iris tapa siempre el eco que hay detrás
  const iris = ctx.createRadialGradient(ix, iy, 0, ix, iy, r);
  // Pupila negra y borde difuminado que se funde con el blanco
  iris.addColorStop(0, '#000');
  iris.addColorStop(0.5, '#000');
  iris.addColorStop(0.72, 'rgba(8, 8, 8, 0.92)');
  iris.addColorStop(0.88, 'rgba(30, 28, 28, 0.45)');
  iris.addColorStop(1, 'rgba(60, 58, 56, 0)');
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(ix, iy, r, 0, Math.PI * 2);
  ctx.fill();

  // Brillos tenues
  ctx.fillStyle = 'rgba(235, 230, 230, 0.7)';
  ctx.beginPath();
  ctx.arc(ix - r * 0.28, iy - r * 0.32, r * 0.07, 0, Math.PI * 2);
  ctx.arc(ix + r * 0.1, iy - r * 0.36, r * 0.045, 0, Math.PI * 2);
  ctx.fill();

  // Sombra del párpado
  ctx.globalAlpha = alpha * 0.35;
  const shade = ctx.createLinearGradient(0, -h * 1.35 * eye.lid, 0, h * 0.2);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = shade;
  ctx.fillRect(-w / 2, -h * 1.4, w, h * 1.6);

  ctx.restore();
}

function updateGlance(dt) {
  glance.next -= dt;
  if (glance.next <= 0 && state.hovering && state.darkness > 0.3) {
    glance.active = rand(0.6, 1.1);
    glance.next = rand(3.5, 7);
  }
  glance.active = Math.max(0, glance.active - dt);
}

function updateEyes(dt) {
  eyeCtx.clearRect(0, 0, POSTER_W, POSTER_H);
  updateGlance(dt);
  if (state.darkness <= 0) return;

  const tremor = 0.8 + state.darkness * 2.2;
  const flicker = state.darkness > 0.6;

  eyes.forEach((eye) => {
    const visible = smoothstep(eye.appearAt, eye.appearAt + 0.2, state.darkness);
    if (visible <= 0) return;

    // Parpadeo ocasional
    eye.nextBlink -= dt;
    if (eye.nextBlink <= 0) {
      eye.blinkTime = 0;
      eye.nextBlink = rand(2.5, 7);
    }
    if (eye.blinkTime !== undefined) {
      eye.blinkTime += dt;
      eye.blink = Math.sin(Math.PI * clamp(eye.blinkTime / 0.22, 0, 1));
      if (eye.blinkTime >= 0.22) eye.blinkTime = undefined;
    }

    // Temblor propio + tirones bruscos que se recuperan rápido
    eye.shake.x = (Math.random() - 0.5) * tremor;
    eye.shake.y = (Math.random() - 0.5) * tremor;
    eye.nextTwitch -= dt;
    if (eye.nextTwitch <= 0) {
      eye.twitch.x = rand(-10, 10);
      eye.twitch.y = rand(-5, 5);
      eye.nextTwitch = rand(1, 4);
    }
    eye.twitch.x *= 1 - Math.min(1, dt * 12);
    eye.twitch.y *= 1 - Math.min(1, dt * 12);

    // Mirada: al cerebro, todos a la vez al cursor durante la mirada colectiva,
    // o al frente mientras mira el ojo grande
    let target = glance.active > 0 ? state.pointer : state.brainScreen;
    if (state.stare > 0) target = eye;
    const dx = target.x - eye.x;
    const dy = target.y - eye.y;
    const len = Math.hypot(dx, dy) || 1;
    const saccade = (Math.random() - 0.5) * 0.12;
    const k = glance.active > 0 ? 1 : Math.min(1, dt * 6);
    eye.look.x = lerp(eye.look.x, clamp(dx / len + saccade, -1, 1), k);
    eye.look.y = lerp(eye.look.y, clamp(dy / len + saccade, -1, 1), k);

    // Luz que falla: el ojo se apaga del todo un instante (nunca queda a medias)
    if (flicker && Math.random() < 0.03) return;
    const alpha = eye.opacity * visible;

    // Eco fantasma desplazado (visión doble) y después el ojo
    const echo = 3 + Math.sin(state.time * 9 + eye.seed) * 3;
    drawEye(eye, visible, alpha * 0.3, echo, -echo * 0.4);
    drawEye(eye, visible, alpha, 0, 0);
  });
}

// Ojo grande (recreación del ojo de referencia) donde estaba el cerebro, mirando al frente
const STARE_EYE_W = 400;
// El ojo se pinta primero en un lienzo aparte y luego se recorta con una máscara
// irregular: así el blanco se funde con el negro de forma desigual, como en la referencia
const stareBuffer = document.createElement('canvas');
const stareBufCtx = stareBuffer.getContext('2d');
const stareMask = document.createElement('canvas');
const stareMaskCtx = stareMask.getContext('2d');

// Capas de la máscara: almendras algo desplazadas y con distinto desenfoque.
// Sumadas, el centro queda opaco y el borde se desvanece de forma desigual
// (más extendido abajo a la izquierda, más corto arriba a la derecha).
const STARE_MASK_LAYERS = [
  { sw: 1.0, sh: 1.0, dx: 0, dy: 0, blur: 6, alpha: 0.7 },
  { sw: 0.9, sh: 0.82, dx: -12, dy: 6, blur: 14, alpha: 0.5 },
  { sw: 1.05, sh: 0.92, dx: -18, dy: 10, blur: 24, alpha: 0.35 },
  { sw: 0.78, sh: 0.7, dx: -6, dy: 2, blur: 10, alpha: 0.6 },
  { sw: 0.96, sh: 1.08, dx: 10, dy: -4, blur: 20, alpha: 0.25 },
];

// "Mordiscos" de sombra a lo largo del contorno (más en el párpado superior)
const STARE_BITES = Array.from({ length: 10 }, (_, i) => ({
  t: rand(0.12, 0.92),               // posición a lo largo del párpado
  top: i < 7,
  r: i < 7 ? rand(12, 26) : rand(8, 16),
  alpha: i < 7 ? rand(0.25, 0.5) : rand(0.15, 0.3),
  inset: rand(0.9, 1.05),            // cuánto se mete hacia dentro del ojo
}));

// Desplazamiento horizontal de la mirada: centrada mientras se abre y después
// alterna izquierda / derecha cada 0,55 s con un salto rápido, como quien mira
// primero un ojo y luego el otro de la persona que tiene delante
function stareGazeX(w) {
  const hold = 0.55;
  const t = state.stare - 0.5;
  if (t <= 0) return 0;
  const step = Math.floor(t / hold);
  const side = (n) => (n < 0 ? 0 : (n % 2 === 0 ? -1 : 1)) * w * 0.035;
  const jump = smoothstep(0, 0.09, (t % hold) / hold);
  return lerp(side(step - 1), side(step), jump);
}

function buildStareMask(x, y, w, h, open, dpr) {
  if (stareMask.width !== stareBuffer.width) {
    stareMask.width = stareBuffer.width;
    stareMask.height = stareBuffer.height;
  }
  const m = stareMaskCtx;
  m.setTransform(dpr, 0, 0, dpr, 0, 0);
  m.globalCompositeOperation = 'source-over';
  m.globalAlpha = 1;
  m.filter = 'none';
  m.clearRect(0, 0, POSTER_W, POSTER_H);
  m.save();
  m.translate(x, y);
  m.fillStyle = '#000';

  STARE_MASK_LAYERS.forEach((l) => {
    m.filter = `blur(${l.blur}px)`;
    m.globalAlpha = l.alpha;
    m.save();
    m.translate(l.dx, l.dy * open);
    eyeAlmondPath(m, w * l.sw, h * l.sh);
    m.fill();
    m.restore();
  });

  // Mordiscos: la oscuridad se come trozos del contorno
  m.globalCompositeOperation = 'destination-out';
  m.filter = 'blur(8px)';
  STARE_BITES.forEach((b) => {
    // Punto sobre la curva del párpado (bezier cuadrática simétrica)
    const bx = -w / 2 + b.t * w;
    const by = (b.top ? -1 : 1) * 2 * b.t * (1 - b.t) * h * b.inset;
    m.globalAlpha = b.alpha;
    m.beginPath();
    m.arc(bx, by, b.r * (0.6 + 0.4 * open), 0, Math.PI * 2);
    m.fill();
  });
  m.restore();
}

function eyeAlmondPath(ctx, w, h) {
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.quadraticCurveTo(0, -h, w / 2, 0);
  ctx.quadraticCurveTo(0, h, -w / 2, 0);
  ctx.closePath();
}

function drawStareEye(open, alpha) {
  const w = STARE_EYE_W;
  const h = w * 0.45 * open;   // alto del ojo abierto
  if (h < 1) return;

  if (stareBuffer.width !== stareCanvas.width) {
    stareBuffer.width = stareCanvas.width;
    stareBuffer.height = stareCanvas.height;
  }
  const dpr = stareBuffer.width / POSTER_W;
  const ctx = stareBufCtx;

  // Pequeño temblor y respiración de la pupila
  const t = state.time;
  const x = state.brainScreen.x + state.smooth.nx * 10 + Math.sin(t * 41) * 0.6;
  const y = state.brainScreen.y + state.smooth.ny * 8 + Math.sin(t * 37 + 1) * 0.6;
  const pupil = 1 + Math.sin(t * 2.2) * 0.03;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, POSTER_W, POSTER_H);
  ctx.save();
  ctx.translate(x, y);
  ctx.filter = 'blur(1.5px)';   // aspecto turbio de la referencia

  // Blanco gris claro, más luminoso a la izquierda y apagado en las comisuras
  const sclera = ctx.createRadialGradient(-w * 0.14, -h * 0.05, 0, 0, 0, w * 0.55);
  sclera.addColorStop(0, '#e2dfdf');
  sclera.addColorStop(0.5, '#b4b0b0');
  sclera.addColorStop(0.85, '#5a5757');
  sclera.addColorStop(1, '#141313');
  ctx.fillStyle = sclera;
  ctx.fillRect(-w * 0.55, -h - 20, w * 1.1, h * 2 + 40);

  // Sombra del párpado superior (más marcada a la derecha) y luz abajo a la izquierda
  const lid = ctx.createRadialGradient(w * 0.12, -h * 0.75, 0, w * 0.12, -h * 0.75, w * 0.34);
  lid.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  lid.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = lid;
  ctx.fillRect(-w * 0.55, -h - 20, w * 1.1, h * 2 + 40);
  const glow = ctx.createRadialGradient(-w * 0.26, h * 0.3, 0, -w * 0.26, h * 0.3, w * 0.22);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-w * 0.55, -h - 20, w * 1.1, h * 2 + 40);

  // Iris grande: núcleo negro y anillo gris oscuro que se funde con el blanco.
  // Mira alternando entre los dos ojos de quien lo ve (salto rápido y pausa)
  // y la pupila tiembla un poco.
  const r = w * 0.24 * pupil;
  const tremorX = (Math.random() - 0.5) * 1.8;
  const tremorY = (Math.random() - 0.5) * 1.4;
  const ix = w * 0.02 + stareGazeX(w) + tremorX;
  const iy = tremorY;
  const iris = ctx.createRadialGradient(ix, iy, 0, ix, iy, r);
  iris.addColorStop(0, '#000');
  iris.addColorStop(0.7, '#020202');
  iris.addColorStop(0.86, '#2e2d2d');
  iris.addColorStop(0.95, 'rgba(70, 68, 68, 0.6)');
  iris.addColorStop(1, 'rgba(90, 88, 88, 0)');
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(ix, iy, r, 0, Math.PI * 2);
  ctx.fill();

  // Dos brillos juntos en la parte alta de la pupila
  ctx.filter = 'blur(1px)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.arc(ix - r * 0.16, iy - r * 0.36, r * 0.055, 0, Math.PI * 2);
  ctx.arc(ix + r * 0.14, iy - r * 0.36, r * 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Chispa de luz en el lagrimal derecho
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.arc(w * 0.4, h * 0.04, w * 0.012, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Máscara irregular: solo queda lo que cae dentro de ella
  buildStareMask(x, y, w, h, open, dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.filter = 'none';
  ctx.drawImage(stareMask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  stareCtx.globalAlpha = alpha;
  stareCtx.drawImage(stareBuffer, 0, 0, POSTER_W, POSTER_H);
  stareCtx.globalAlpha = 1;
}

let stareDrawn = false;

function updateStare() {
  if (state.stare <= 0) {
    if (stareDrawn) {
      stareCtx.clearRect(0, 0, POSTER_W, POSTER_H);
      stareDrawn = false;
    }
    return;
  }
  // Se abre en medio segundo y se queda fijo mirando al frente
  const open = easeOutCubic(smoothstep(0, 0.55, state.stare));
  const alpha = smoothstep(0, 0.3, state.stare);
  stareCtx.clearRect(0, 0, POSTER_W, POSTER_H);
  drawStareEye(open, alpha);
  stareDrawn = true;
}

// Temblor leve del cartel, más intenso cuanto más oscuro (y un golpe fuerte al romperse)
function updateShake(dt) {
  state.jolt *= 1 - Math.min(1, dt * 5);
  const amount = smoothstep(0.35, 1, state.darkness) * 2.5 + state.jolt * 14;
  const t = state.time;
  const dx = (Math.sin(t * 47.3) + Math.sin(t * 31.7 + 1.3)) * 0.5 * amount;
  const dy = (Math.sin(t * 39.1 + 0.7) + Math.sin(t * 53.9)) * 0.5 * amount;
  poster.style.transform = `scale(${state.scale}) translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
}

/* ==========================================================
   6c. VUELTA AL INICIO: la pantalla se rompe como un cristal
   Se congela una imagen del cartel marchito, se parte en cristales
   desde el punto de impacto y, mientras caen, debajo todo ya ha vuelto
   a la normalidad. Los cristales se dibujan en la GPU con un shader de
   "liquid glass" adaptado de liquidGL (MIT © NaughtyDuk,
   https://github.com/naughtyduk/liquidGL): bisel, refracción,
   aberración cromática y brillo especular.
   ========================================================== */

const snapshot = document.createElement('canvas');
const snapCtx = snapshot.getContext('2d');
const shards = [];
const impact = { x: 0, y: 0 };
let shatterRenderer, shatterScene, shatterCamera, snapTexture, glassMaterial;

const GLASS_VERTEX = `
  attribute vec2 aOrig;
  attribute vec2 aDir;
  attribute float aInner;
  varying vec2 vOrig;
  varying vec2 vDir;
  varying float vInner;
  void main() {
    vOrig = aOrig;
    vDir = aDir;
    vInner = aInner;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLASS_FRAGMENT = `
  uniform sampler2D uSnap;
  uniform vec2 uSize;
  uniform float uCrack;
  uniform float uFlash;
  uniform vec2 uImpact;
  varying vec2 vOrig;
  varying vec2 vDir;
  varying float vInner;

  void main() {
    // Bisel: 1 en el borde del cristal y 0 hacia el centro (edgeFactor de liquidGL)
    float edge = 1.0 - smoothstep(0.0, 0.32, vInner);
    vec2 dir = normalize(vDir + vec2(0.0001));

    // Refracción suave en todo el trozo y fuerte en el bisel (edge * refraction + edge^n * bevelDepth)
    float amount = (edge * 0.005 + pow(edge, 6.0) * 0.025) * uCrack;
    vec2 offset = vec2(dir.x, -dir.y) * amount;
    vec2 uv = vec2(vOrig.x / uSize.x, 1.0 - vOrig.y / uSize.y) - offset;

    // Aberración cromática: rojo y azul se separan a ambos lados del vector de refracción
    vec2 chroma = offset * 0.8 * uCrack;
    vec3 col;
    col.r = texture2D(uSnap, uv - chroma).r;
    col.g = texture2D(uSnap, uv).g;
    col.b = texture2D(uSnap, uv + chroma).b;

    // Brillo especular: borde iluminado desde arriba a la izquierda y una franja diagonal
    float light = max(dot(dir, normalize(vec2(-0.6, -0.8))), 0.0);
    float rim = pow(edge, 10.0) * (0.15 + 0.5 * light);
    float sheen = 0.06 * smoothstep(0.12, 0.0, abs(fract((vOrig.x + vOrig.y) * 0.0016) - 0.5));
    col += (rim + sheen + pow(edge, 4.0) * 0.025) * uCrack;

    // Destello en el punto de impacto
    col += uFlash * exp(-length(vOrig - uImpact) / 90.0);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function setupShatterCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  snapshot.width = POSTER_W * dpr;
  snapshot.height = POSTER_H * dpr;

  shatterRenderer = new THREE.WebGLRenderer({ canvas: shatterCanvas, antialias: true, alpha: true });
  shatterRenderer.setPixelRatio(dpr);
  shatterRenderer.setSize(POSTER_W, POSTER_H, false);
  shatterRenderer.setClearColor(0x000000, 0);

  shatterScene = new THREE.Scene();
  // Cámara ortográfica en píxeles del cartel (y hacia abajo = negativa)
  shatterCamera = new THREE.OrthographicCamera(0, POSTER_W, 0, -POSTER_H, -10, 10);

  snapTexture = new THREE.CanvasTexture(snapshot);
  snapTexture.minFilter = THREE.LinearFilter;
  snapTexture.generateMipmaps = false;

  glassMaterial = new THREE.ShaderMaterial({
    vertexShader: GLASS_VERTEX,
    fragmentShader: GLASS_FRAGMENT,
    uniforms: {
      uSnap: { value: snapTexture },
      uSize: { value: new THREE.Vector2(POSTER_W, POSTER_H) },
      uCrack: { value: 0 },
      uFlash: { value: 0 },
      uImpact: { value: new THREE.Vector2() },
    },
    side: THREE.DoubleSide,
  });
}

// Dibuja en un canvas lo que se ve ahora mismo (fondo, ojos, cerebro, titular y pétalos)
function buildSnapshot() {
  const dpr = snapshot.width / POSTER_W;
  const ctx = snapCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#040203';
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  ctx.filter = 'blur(0.6px)';
  ctx.drawImage(eyeCanvas, 0, 0, POSTER_W, POSTER_H);
  ctx.filter = 'none';

  // El canvas WebGL se copia justo después de renderizar
  renderer.render(scene, camera);
  ctx.drawImage(brainCanvas, state.smooth.nx * 10, state.smooth.ny * 8, POSTER_W, POSTER_H);
  ctx.drawImage(stareCanvas, 0, 0, POSTER_W, POSTER_H);

  // Las letras del titular, tal y como están (finas, caídas e inclinadas)
  const posterRect = poster.getBoundingClientRect();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  letters.forEach((letter) => {
    const r = letter.glyph.getBoundingClientRect();
    const v = letter.value;
    ctx.save();
    ctx.translate(
      (r.left - posterRect.left + r.width / 2) / state.scale,
      (r.top - posterRect.top + r.height / 2) / state.scale,
    );
    ctx.rotate((v * letter.tilt * Math.PI) / 180);
    ctx.font = `${Math.round(900 - 800 * v)} 122px Archivo, sans-serif`;
    ctx.fontStretch = v > 0.5 ? 'semi-condensed' : 'normal';
    ctx.globalAlpha = parseFloat(letter.glyph.style.opacity || '1');
    ctx.fillStyle = letter.glyph.style.color || '#ff5c8f';
    ctx.fillText(letter.glyph.textContent, 0, 0);
    ctx.restore();
  });

  ctx.drawImage(petalCanvas, 0, 0, POSTER_W, POSTER_H);
  snapTexture.needsUpdate = true;
}

// Geometría de un cristal: abanico de triángulos desde su centro.
// aInner = 1 en el centro y 0 en el borde (para el bisel); aDir apunta hacia el borde.
function createShardGeometry(points, cx, cy) {
  const positions = [];
  const orig = [];
  const dirs = [];
  const inner = [];
  const pushVertex = (x, y, isCentre) => {
    positions.push(x - cx, -(y - cy), 0);
    orig.push(x, y);
    dirs.push(x - cx, y - cy);
    inner.push(isCentre ? 1 : 0);
  };
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    pushVertex(cx, cy, true);
    pushVertex(p[0], p[1], false);
    pushVertex(q[0], q[1], false);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aOrig', new THREE.Float32BufferAttribute(orig, 2));
  geometry.setAttribute('aDir', new THREE.Float32BufferAttribute(dirs, 2));
  geometry.setAttribute('aInner', new THREE.Float32BufferAttribute(inner, 1));
  return geometry;
}

function addShard(points) {
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const outside = Math.max(...xs) < 0 || Math.min(...xs) > POSTER_W
    || Math.max(...ys) < 0 || Math.min(...ys) > POSTER_H;
  if (outside) return;

  const dx = cx - impact.x;
  const dy = cy - impact.y;
  const dist = Math.hypot(dx, dy) || 1;
  const mesh = new THREE.Mesh(createShardGeometry(points, cx, cy), glassMaterial);
  mesh.frustumCulled = false;
  shatterScene.add(mesh);

  shards.push({
    mesh,
    cx, cy,
    dirX: dx / dist,
    dirY: dy / dist,
    x: 0, y: 0, rot: 0,
    vx: (dx / dist) * rand(30, 150),
    vy: rand(-140, -20),
    vrot: rand(-2.5, 2.5),
    delay: 0.25 + (dist / 900) * 0.35 + rand(0, 0.12),  // cerca del impacto caen antes
  });
}

function clearShards() {
  shards.forEach((s) => {
    shatterScene.remove(s.mesh);
    s.mesh.geometry.dispose();
  });
  shards.length = 0;
  shatterRenderer.render(shatterScene, shatterCamera);   // deja el canvas vacío
}

// Grietas radiales desde el impacto + anillos irregulares → unos 100 trozos de cristal
function createShards() {
  clearShards();
  const rays = 12;
  const rings = [0, 40, 110, 210, 340, 520, 760, 1100, 1700];
  const angles = [];
  for (let j = 0; j < rays; j++) angles.push((j / rays) * Math.PI * 2 + rand(-0.2, 0.2));
  const jitter = rings.map((r, k) => angles.map(() => (k === rings.length - 1 ? 1 : rand(0.82, 1.18))));

  const point = (k, j) => {
    const a = angles[j % rays];
    const r = rings[k] * jitter[k][j % rays];
    return [impact.x + Math.cos(a) * r, impact.y + Math.sin(a) * r];
  };

  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < rays; j++) {
      if (k === 0) {
        addShard([point(0, j), point(1, j), point(1, j + 1)]);
      } else if (Math.random() < 0.35) {
        // A veces el trozo se parte en dos triángulos
        addShard([point(k, j), point(k + 1, j), point(k + 1, j + 1)]);
        addShard([point(k, j), point(k + 1, j + 1), point(k, j + 1)]);
      } else {
        addShard([point(k, j), point(k + 1, j), point(k + 1, j + 1), point(k, j + 1)]);
      }
    }
  }
}

function startShatter() {
  // El cristal se rompe desde el ojo grande
  impact.x = state.brainScreen.x + state.smooth.nx * 10;
  impact.y = state.brainScreen.y + state.smooth.ny * 8;
  buildSnapshot();
  state.stare = 0;
  updateStare();
  createShards();
  glassMaterial.uniforms.uImpact.value.set(impact.x, impact.y);
  state.jolt = 1;

  // Debajo del cristal todo vuelve a la normalidad al instante
  state.phase = 'shatter';
  state.phaseTime = 0;
  state.decay = 0;
  state.peakDecay = 0;
  state.regrow = 1;
  petals.state.fill(ATTACHED);
  fallCount = 0;
  fallMesh.count = 0;
  flatPetals.length = 0;
  letters.forEach((letter) => {
    letter.value = 0;
    letter.lastValue = -1;
    letter.shed = 0;
    letter.absorb = 0;
  });
}

function updateShatter(dt) {
  if (state.phase !== 'shatter') return;

  const t = state.phaseTime;
  const crack = smoothstep(0, 0.2, t);   // las grietas aparecen antes de caer
  glassMaterial.uniforms.uCrack.value = crack;
  glassMaterial.uniforms.uFlash.value = 0.8 * Math.max(0, 1 - t / 0.4);

  shards.forEach((s) => {
    if (t > s.delay) {
      s.vy += 1600 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vrot * dt;
    }
    s.mesh.visible = s.cy + s.y < POSTER_H + 300;

    // Al agrietarse, los trozos se separan un par de píxeles del impacto
    const gap = crack * 2;
    s.mesh.position.set(s.cx + s.x + s.dirX * gap, -(s.cy + s.y + s.dirY * gap), 0);
    s.mesh.rotation.z = -s.rot;
  });

  shatterRenderer.render(shatterScene, shatterCamera);
}

/* ==========================================================
   7. MANEJADORES DE EVENTOS
   ========================================================== */

// mouseenter: el cursor entra en el cartel → empieza a marchitarse
function handlePosterEnter(event) {
  state.hovering = true;
  updatePointer(event);
}

// mouseleave: el cursor sale → se pausa la decadencia y todo vuelve a su sitio
function handlePosterLeave() {
  state.hovering = false;
}

// mousemove: guarda la posición del cursor para rotación, paralaje y letras
function handlePosterMove(event) {
  updatePointer(event);
}

function updatePointer(event) {
  const p = toPosterCoords(event.clientX, event.clientY);
  state.pointer.x = p.x;
  state.pointer.y = p.y;
  state.pointer.nx = clamp((p.x / POSTER_W) * 2 - 1, -1, 1);
  state.pointer.ny = clamp((p.y / POSTER_H) * 2 - 1, -1, 1);
}

// mouseenter en una letra: se hincha, brilla y suelta una ráfaga de pétalos
function handleLetterEnter(event) {
  const letter = letterByEl.get(event.currentTarget);
  letter.el.style.transform = `translateY(-10px) scale(1.16) rotate(${rand(-7, 7).toFixed(1)}deg)`;
  letter.el.style.filter = 'drop-shadow(0 0 18px rgba(255, 92, 143, 0.7)) brightness(1.25)';
  burstLetter(letter, 12);
  if (state.phase === 'bloom') letter.value = Math.min(1, letter.value + 0.08);
}

// mouseleave en una letra: recupera su apariencia inicial
function handleLetterLeave(event) {
  const letter = letterByEl.get(event.currentTarget);
  letter.el.style.transform = '';
  letter.el.style.filter = '';
}

/* ==========================================================
   8. BUCLE DE ANIMACIÓN E INICIO
   ========================================================== */

const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;

  updateCycle(dt);
  updateBrainMotion(dt);
  updateBrainPetals(dt);
  updateFallingPetals(dt);
  updateStem();
  updateDarkness();
  updateBrainScreen();
  updateEyes(dt);
  updateStare();
  updateShake(dt);
  updateParallax();
  updateLetters(dt);
  updateFlatPetals(dt);
  updateShatter(dt);

  renderer.render(scene, camera);
  if (state.pendingShatter) {
    state.pendingShatter = false;
    startShatter();
  }
  requestAnimationFrame(animate);
}

function init() {
  fitPoster();
  buildTitle();
  setupPetalCanvas();
  setupEyeCanvas();
  setupShatterCanvas();
  createEyes();
  initScene();

  poster.addEventListener('mouseenter', handlePosterEnter);
  poster.addEventListener('mouseleave', handlePosterLeave);
  poster.addEventListener('mousemove', handlePosterMove);
  window.addEventListener('resize', () => {
    fitPoster();
    measureLetters();
  });

  // Medimos las letras cuando la tipografía ya está cargada
  document.fonts.ready.then(measureLetters);

  animate();
}

init();
