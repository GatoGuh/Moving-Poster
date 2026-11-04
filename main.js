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

/* ---------- Estado global ---------- */

const state = {
  phase: 'bloom',     // 'bloom' (florecido / decayendo) · 'withered' · 'regrow'
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

    if (state.phase === 'regrow') {
      s = smoothstep(sprout[i], sprout[i] + 0.14, petalT);
      green = 1 - smoothstep(sprout[i] + 0.04, sprout[i] + 0.3, petalT);
    } else if (state.phase === 'bloom') {
      const t = threshold[i];
      wilt = smoothstep(t - 0.22, t, decay);

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
    if (state.phaseTime >= CONFIG.witherPause) setPhase('regrow');
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
  eyeCanvas.width = POSTER_W * dpr;
  eyeCanvas.height = POSTER_H * dpr;
  eyeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

    // Mirada: al cerebro, o todos a la vez al cursor durante la mirada colectiva
    const target = glance.active > 0 ? state.pointer : state.brainScreen;
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

// Temblor leve del cartel, más intenso cuanto más oscuro
function updateShake() {
  const amount = smoothstep(0.35, 1, state.darkness) * 2.5;
  const t = state.time;
  const dx = (Math.sin(t * 47.3) + Math.sin(t * 31.7 + 1.3)) * 0.5 * amount;
  const dy = (Math.sin(t * 39.1 + 0.7) + Math.sin(t * 53.9)) * 0.5 * amount;
  poster.style.transform = `scale(${state.scale}) translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
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
  updateShake();
  updateParallax();
  updateLetters(dt);
  updateFlatPetals(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function init() {
  fitPoster();
  buildTitle();
  setupPetalCanvas();
  setupEyeCanvas();
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
