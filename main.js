'use strict';

/* ==========================================================
   Que empiece el juego para todos · 21 de diciembre · Fundación ITACA
   Cartel interactivo de sensibilización: donar dinero para comprar
   regalos de Navidad a niños y niñas en riesgo de exclusión.
   De una caja de regalo abierta sale un circuito de coches de
   juguete; cada coche que entra en la caja es un regalo entregado.

   Eventos de ratón:
   · mouseenter (cartel)  → semáforo de salida y los coches arrancan:
                            bajan por el bucle y se meten en la caja.
   · mouseleave (cartel)  → si aún no han salido, se cancela la salida;
                            si ya corren, terminan la carrera y vuelven
                            a la línea de salida sin volver a arrancar.
   · mousemove  (cartel)  → la cámara gira con el cursor y las capas de
                            texto se desplazan (paralaje).
   · mouseenter / mouseleave (mensaje y logos) → el mensaje crece y se
                            ilumina; los logos recuperan su color.
   · mouseenter / mouseleave (pedales laterales) → turbo: se pisa el pedal y el
                            coche de ese color acelera mientras el ratón esté encima.
   · mouseenter / mouseleave (letras del titular) → cada letra salta, se
                            ladea y cambia de color; al salir vuelve con rebote.
   ========================================================== */

/* ---------- Configuración ---------- */

const POSTER_W = 848;
const POSTER_H = 1200;

const CONFIG = {
  countdownStep: 0.42, // segundos entre cada luz roja del semáforo
  goHold: 0.9,         // segundos que se ve la luz verde
  baseSpeed: 8.6,      // velocidad punta de los coches (unidades / s)
  accel: 6.5,          // aceleración en la salida
  insidePause: 0.9,    // segundos con los coches dentro de la caja antes de volver a salir
  climbSpeed: 7.2,     // velocidad al salir de la caja por la subida exterior
  relaunchPause: 0.3,  // espera antes del semáforo al volver a entrar con el ratón
  boostGain: 0.75,     // turbo: cuánto más rápido va un coche con el ratón en su zona lateral
  boostEase: 5,        // rapidez con la que entra y sale el turbo
};

const TRACK = {
  width: 0.8,     // ancho de la pista (dos carriles)
  thickness: 0.07,
  kerb: 0.07,     // ancho del bordillo rojo y blanco
  kerbHeight: 0.045,
  // Circuito simétrico con un looping a cada lado (ver buildPathPoints)
  yTop: 5.0,      // altura de la salida (al fondo)
  yLow: 1.3,      // altura de la punta, dentro de la caja
  legX: 0.66,     // separación de las patas al pasar por la boca de la caja (a cada lado)
  zFront: 0.5,    // punta del circuito (dentro de la caja)
  loop: { cx: 1.7, cz: -3.3, r: 1.1, turns: 1.25 }, // looping de la derecha (el otro es su reflejo)
  flatLen: 1.4,   // tramo llano a cada lado del centro de la salida
  heightCurve: 0.3, // 0 = pendiente constante; 1 = arranca y llega en llano
  startArc: 1.0,  // distancia del principio del circuito al centro de la salida
  samples: 1500,
};

const PARK_S = 0.6;   // posición de los coches aparcados (arco desde el inicio)
const START_S = 1.1;  // línea de salida
const LANE = TRACK.width / 4;

const BOX = { half: 1.3, height: 1.9, wall: 0.06, voidY: 1.4 }; // voidY: fondo oscuro del interior

const COLORS = {
  red: '#e8233f',
  redInner: '#2a060c',
  boxVoid: '#030102',
  gold: '#ffc93c',
  ink: '#f7efe0',
  asphalt: '#2e313a',
  plastic: '#3f4457',
};

const CARS = [
  // Parrilla escalonada: el morado sale un poco por delante para que se vean los dos
  // boostZone: id de la zona lateral que le da turbo (rosa a la izquierda, morado a la derecha)
  { name: 'rosa', color: '#ff5fa8', stripe: '#f7efe0', trail: '#ff8cc6', lane: -LANE, grid: -0.3, boostZone: 'boostLeft' },
  { name: 'morado', color: '#8a4dff', stripe: '#f7efe0', trail: '#b18cff', lane: LANE, grid: 0.12, boostZone: 'boostRight' },
];

const CONFETTI_COLORS = ['#ffc93c', '#e8233f', '#f7efe0', '#1fa8ff', '#3ee07a', '#ff7ab6'];

/* ---------- Referencias al DOM ---------- */

const poster = document.getElementById('poster');
const sceneLayer = document.getElementById('sceneLayer');
const metaLayer = document.getElementById('metaLayer');
const titleLayer = document.getElementById('titleLayer');
const footLayer = document.getElementById('footLayer');
const canvas = document.getElementById('sceneCanvas');
const hintEl = document.getElementById('hint');
const lightEls = Array.from(document.querySelectorAll('.light'));
const messageEl = document.getElementById('message');
const messageClaimEl = messageEl.querySelector('.message__claim');
const giftCountEl = document.getElementById('giftCount');
const partnerEls = Array.from(document.querySelectorAll('.partner'));
const titleEl = document.getElementById('title');

/* ---------- Estado ---------- */

const state = {
  scale: 1,
  hover: false,
  mouse: { x: 0, y: 0 },   // -1 … 1 respecto al centro del cartel
  smooth: { x: 0, y: 0 },
  phase: 'parked',          // parked → countdown → racing → inside → climbing → …
  phaseTime: 99,
  raceTime: 0,
  winner: null,
  gifts: 0,                 // regalos entregados (coches que han entrado en la caja)
  time: 0,
};

/* ---------- Preferencias del dispositivo ---------- */

// «Reducir movimiento» activado en el sistema: menos confeti, nieve quieta, sin paralaje
// ni temblores; la carrera (el contenido del cartel) sigue igual
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Pantalla táctil sin ratón: se juega tocando
const TOUCH_ONLY = window.matchMedia('(hover: none)').matches;

/* ---------- Utilidades ---------- */

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- Escalado del cartel ---------- */

function fitPoster() {
  state.scale = Math.min(window.innerWidth / POSTER_W, window.innerHeight / POSTER_H, 1);
  poster.style.transform = `scale(${state.scale})`;
}

/* ---------- Renderizador, cámara y luces ---------- */

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(POSTER_W, POSTER_H, false);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(28, POSTER_W / POSTER_H, 0.1, 100);
const CAM_BASE = new V3(0, 11.5, 22);
const CAM_LOOK = new V3(-0.1, 4.45, 0);
camera.position.copy(CAM_BASE);
camera.lookAt(CAM_LOOK);

scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a1d3a, 0.75));

const keyLight = new THREE.DirectionalLight(0xfff4e0, 0.95);
keyLight.position.set(4.5, 13, 7);
keyLight.target.position.set(0, 3, 0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -6;
keyLight.shadow.camera.right = 6;
keyLight.shadow.camera.top = 7;
keyLight.shadow.camera.bottom = -5;
keyLight.shadow.camera.near = 2;
keyLight.shadow.camera.far = 30;
keyLight.shadow.bias = -0.0006;
scene.add(keyLight, keyLight.target);

const rimLight = new THREE.DirectionalLight(0x7f9bff, 0.45);
rimLight.position.set(-6, 5, -6);
scene.add(rimLight);

// Brillo cálido que sale del interior de la caja
const boxGlow = new THREE.PointLight(0xffc35a, 0.8, 5, 2);
boxGlow.position.set(0, 1.3, 0);
scene.add(boxGlow);

// Suelo invisible que solo recoge sombras
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShadowMaterial({ opacity: 0.38 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.01; // un pelo por debajo de la base de la caja para que no parpadee
floor.receiveShadow = true;
scene.add(floor);

/* ---------- Texturas dibujadas en canvas ---------- */

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Asfalto con dos ranuras (una por carril) y sus raíles metálicos
const roadTexture = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = COLORS.asphalt;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const v = (38 + Math.random() * 30) | 0;
    g.fillStyle = `rgba(${v},${v},${v + 8},0.55)`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
  }
  g.fillStyle = '#ece6d8';
  g.fillRect(10, 0, 5, h);
  g.fillRect(w - 15, 0, 5, h);
  for (const x of [64, 192]) {
    g.fillStyle = '#c3c7d2';
    g.fillRect(x - 10, 0, 20, h);
    g.fillStyle = '#08090d';
    g.fillRect(x - 4, 0, 8, h);
  }
  g.fillStyle = 'rgba(236,230,216,0.55)';
  g.fillRect(126, 0, 4, h * 0.45);
});

// Bordillo rojo y blanco
const kerbTexture = canvasTexture(4, 64, (g, w, h) => {
  g.fillStyle = COLORS.red;
  g.fillRect(0, 0, w, h / 2);
  g.fillStyle = '#f7efe0';
  g.fillRect(0, h / 2, w, h / 2);
});

// Cuadros de la línea de salida
const checkerTexture = canvasTexture(64, 16, (g, w, h) => {
  const s = 8;
  for (let y = 0; y < h / s; y++) {
    for (let x = 0; x < w / s; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f7efe0';
      g.fillRect(x * s, y * s, s, s);
    }
  }
});
checkerTexture.magFilter = THREE.NearestFilter;

/* ---------- Trazado del circuito ---------- */

// Circuito simétrico con un looping a cada lado, como dos muelles:
// salida arriba, al fondo → curva amplia hacia la derecha → looping de 1¼ vueltas bajando
// → curva suave que entra por la boca de la caja → la punta da la vuelta dentro, bajo el
// fondo oscuro → sale por la boca → looping de la izquierda subiendo → vuelta a la salida.
// La mitad izquierda es el reflejo de la derecha recorrido al revés.
function buildPathPoints() {
  const { yTop, yLow, legX, zFront, loop, heightCurve, flatLen, startArc } = TRACK;
  const half = []; // [x, z] de la mitad derecha, del centro de la salida a la punta
  const arc = (cx, cz, r, a0, a1, n) => {
    for (let i = 1; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      half.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  };

  // Salida: tramo casi recto y luego una curva amplia que baja hacia el looping
  // (la curva es tangente al looping por su lado derecho)
  const bigR = loop.cx + loop.r - 0.35;
  const zTop = loop.cz - bigR;
  half.push([0, zTop], [0.35, zTop]);
  arc(0.35, loop.cz, bigR, -Math.PI / 2, 0, 28);
  // Looping: 1¼ vueltas alrededor de su centro, acabando por delante del looping
  arc(loop.cx, loop.cz, loop.r, 0, Math.PI * 2 * loop.turns, 80);
  // Curva en sentido contrario que deja la pista entrando recta por la boca de la caja
  const exitR = loop.cx - legX;
  const ez = loop.cz + loop.r + exitR;
  arc(loop.cx, ez, exitR, -Math.PI / 2, -Math.PI, 22);
  half.push([legX, -0.55], [legX, -0.1], [legX * 0.62, zFront - 0.12]);

  // Altura según la distancia desde el centro de la salida: llano en la salida, pendiente
  // constante por el looping (cada vuelta baja lo bastante para pasar por debajo) y algo
  // más de pendiente al final para llegar por encima del borde de la caja.
  const d = [0];
  for (let i = 1; i < half.length; i++) {
    d.push(d[i - 1] + Math.hypot(half[i][0] - half[i - 1][0], half[i][1] - half[i - 1][1]));
  }
  const tipD = d[d.length - 1] + Math.hypot(half[half.length - 1][0], half[half.length - 1][1] - zFront);
  const rimD = tipD - 1.5;     // donde pasa por encima de la pared de atrás
  const yRim = BOX.height + 0.2;
  const heightAt = (i) => {
    const di = d[i];
    if (di < rimD) {
      const k = clamp((di - flatLen) / (rimD - flatLen), 0, 1);
      return lerp(yTop, yRim, lerp(k, smoothstep(0, 1, k), heightCurve));
    }
    return lerp(yRim, yLow, smoothstep(0, 1, (di - rimD) / (tipD - rimD)) * 0.5 + (di - rimD) / (tipD - rimD) * 0.5);
  };
  const right = half.map(([x, z], i) => new V3(x, heightAt(i), z));
  const left = right.slice(1).reverse().map((p) => new V3(-p.x, p.y, p.z));
  const pts = right.concat([new V3(0, yLow, zFront)], left);

  // El circuito empieza un poco antes del centro de la salida (lado izquierdo)
  let j = pts.length - 1;
  let acc = 0;
  while (j > 0 && acc < startArc) {
    acc += pts[j].distanceTo(pts[(j + 1) % pts.length]);
    j--;
  }
  return pts.slice(j).concat(pts.slice(0, j));
}

const curve = new THREE.CatmullRomCurve3(buildPathPoints(), true, 'centripetal');
curve.arcLengthDivisions = 3000;
const TRACK_LEN = curve.getLength();
const N = TRACK.samples;

// Marcos (posición, tangente, normal y lateral) con peralte en las curvas
const frames = (() => {
  const up = new V3(0, 1, 0);
  const list = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    list.push({ p, t, n: new V3(), x: new V3(), s: u * TRACK_LEN, bank: 0 });
  }

  const ds = TRACK_LEN / N;
  const k = new V3();
  const target = new V3();
  const toCam = new V3();
  for (let i = 0; i <= N; i++) {
    const f = list[i];
    // La pista se inclina hacia la cámara para que se vea de cara: mucho al fondo, donde
    // si no se vería casi de canto, y poco cerca de la caja.
    toCam.subVectors(CAM_BASE, f.p).normalize();
    const face = lerp(0.2, 0.8, smoothstep(-1.5, -5.5, f.p.z));
    target.copy(up).addScaledVector(toCam, face);
    f.n.copy(target).addScaledVector(f.t, -f.t.dot(target)).normalize();
    f.x.crossVectors(f.n, f.t).normalize();
    // El circuito es cerrado: los vecinos dan la vuelta (el marco N es el mismo que el 0)
    const a = list[(i - 1 + N) % N].t;
    const b = list[(i + 1) % N].t;
    k.subVectors(b, a).divideScalar(2 * ds);
    // Peralte suave en las curvas, y menos abajo, donde se vería la panza de la pista
    const maxBank = lerp(0.08, 0.22, smoothstep(2.0, 3.4, f.p.y));
    f.bank = clamp(k.dot(f.x) * 0.4, -maxBank, maxBank);
  }

  // Suaviza el peralte para que no haya saltos
  for (let pass = 0; pass < 3; pass++) {
    const copy = list.map((f) => f.bank);
    for (let i = 0; i <= N; i++) {
      let sum = 0;
      let count = 0;
      for (let j = -16; j <= 16; j++) {
        const q = copy[(((i + j) % N) + N) % N];
        sum += q;
        count++;
      }
      list[i].bank = sum / count;
    }
  }

  for (const f of list) {
    const c = Math.cos(f.bank);
    const s = Math.sin(f.bank);
    const n = f.n.clone().multiplyScalar(c).addScaledVector(f.x, s).normalize();
    f.n.copy(n);
    f.x.crossVectors(f.n, f.t).normalize();
  }
  return list;
})();

const tmpFrame = { p: new V3(), t: new V3(), n: new V3(), x: new V3() };

function frameAt(s, out = tmpFrame) {
  const w = ((s % TRACK_LEN) + TRACK_LEN) % TRACK_LEN; // circuito cerrado
  const u = (w / TRACK_LEN) * N;
  const i = Math.min(Math.floor(u), N - 1);
  const a = u - i;
  const A = frames[i];
  const B = frames[i + 1];
  out.p.lerpVectors(A.p, B.p, a);
  out.t.lerpVectors(A.t, B.t, a).normalize();
  out.n.lerpVectors(A.n, B.n, a).normalize();
  out.x.crossVectors(out.n, out.t).normalize();
  out.n.crossVectors(out.t, out.x).normalize();
  return out;
}

const basis = new THREE.Matrix4();

// yaw = giro sobre la normal de la pista (Math.PI = el coche mira cuesta arriba)
function placeOnTrack(obj, s, lateral = 0, lift = 0, yaw = 0) {
  const f = frameAt(s);
  obj.position.copy(f.p).addScaledVector(f.x, lateral).addScaledVector(f.n, lift);
  basis.makeBasis(f.x, f.n, f.t);
  obj.quaternion.setFromRotationMatrix(basis);
  if (yaw) obj.rotateY(yaw);
  return f;
}

// ¿Está este punto escondido dentro de la caja (por debajo del borde)?
function insideBox(p) {
  return Math.abs(p.x) < BOX.half && Math.abs(p.z) < BOX.half && p.y < BOX.voidY + 0.1;
}

// Luz que llega a un punto: 1 fuera de la caja; dentro se va fundiendo a negro
// desde el borde hasta el fondo oscuro (voidY)
function boxFade(x, y, z) {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const inside = 1 - smoothstep(BOX.half - 0.15, BOX.half + 0.15, edge);
  const lit = Math.pow(smoothstep(BOX.voidY, BOX.height + 0.08, y), 1.6);
  return lerp(1, lit, inside);
}

// Tramo del circuito que va por dentro de la caja: de S_IN (se meten) a S_OUT (asoman)
const [S_IN, S_OUT] = (() => {
  let i = 0;
  while (i < N && (frames[i].s < START_S || !insideBox(frames[i].p))) i++;
  let j = i;
  while (j < N && insideBox(frames[j].p)) j++;
  return [frames[i].s, frames[j].s];
})();

// Barre un perfil 2D (x lateral, y normal) a lo largo del circuito
function sweepGeometry(profile, { closed = false, uFromX = false, vScale = 1 } = {}) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  const edges = closed ? profile.length : profile.length - 1;

  for (let e = 0; e < edges; e++) {
    const a = profile[e];
    const b = profile[(e + 1) % profile.length];
    let nx = b[1] - a[1];
    let ny = -(b[0] - a[0]);
    const nl = Math.hypot(nx, ny);
    nx /= nl;
    ny /= nl;
    const base = pos.length / 3;

    for (let i = 0; i <= N; i++) {
      const f = frames[i];
      for (let k = 0; k < 2; k++) {
        const p = k ? b : a;
        const vx = f.p.x + f.x.x * p[0] + f.n.x * p[1];
        const vy = f.p.y + f.x.y * p[0] + f.n.y * p[1];
        const vz = f.p.z + f.x.z * p[0] + f.n.z * p[1];
        pos.push(vx, vy, vz);
        const light = boxFade(vx, vy, vz); // fundido a negro dentro de la caja
        col.push(light, light, light);
        nor.push(
          f.x.x * nx + f.n.x * ny,
          f.x.y * nx + f.n.y * ny,
          f.x.z * nx + f.n.z * ny
        );
        uv.push(uFromX ? (p[0] + TRACK.width / 2) / TRACK.width : k, f.s * vScale);
      }
      if (i < N) {
        const j = base + i * 2;
        idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

/* ---------- Circuito ---------- */

const trackGroup = new THREE.Group();
scene.add(trackGroup);

(function buildTrack() {
  const W = TRACK.width / 2;
  const H = TRACK.thickness;
  const K = TRACK.kerb;
  const KH = TRACK.kerbHeight;

  const road = new THREE.Mesh(
    sweepGeometry([[W, 0], [-W, 0]], { uFromX: true, vScale: 1.1 }),
    new THREE.MeshStandardMaterial({ map: roadTexture, roughness: 0.85, vertexColors: true })
  );

  const body = new THREE.Mesh(
    sweepGeometry([[-W, 0], [-W, -H], [W, -H], [W, 0]]),
    new THREE.MeshStandardMaterial({ color: COLORS.plastic, roughness: 0.7, vertexColors: true })
  );

  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture, roughness: 0.6, vertexColors: true });
  const kerbL = new THREE.Mesh(
    sweepGeometry([[-W - K, -H], [-W, -H], [-W, KH], [-W - K, KH]], { closed: true, vScale: 2.6 }),
    kerbMat
  );
  const kerbR = new THREE.Mesh(
    sweepGeometry([[W, -H], [W + K, -H], [W + K, KH], [W, KH]], { closed: true, vScale: 2.6 }),
    kerbMat
  );

  for (const m of [road, body, kerbL, kerbR]) {
    m.castShadow = true;
    m.receiveShadow = true;
    trackGroup.add(m);
  }

  // Línea de salida
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK.width, 0.16),
    new THREE.MeshStandardMaterial({ map: checkerTexture, roughness: 0.8 })
  );
  checkerTexture.repeat.set(1, 1);
  placeOnTrack(line, START_S, 0, 0.003);
  line.rotateX(-Math.PI / 2);
  line.receiveShadow = true;
  trackGroup.add(line);
})();

/* ---------- Pórtico de salida con semáforo ---------- */

const gantryLights = [];

(function buildGantry() {
  // El pórtico va vertical aunque la pista esté inclinada hacia la cámara, así que cada
  // poste baja hasta donde está la pista a su lado (el lado de la cámara queda más bajo)
  const f = frameAt(START_S);
  const up = new V3(0, 1, 0);
  const fwd = new V3(f.t.x, 0, f.t.z).normalize();
  const side = new V3().crossVectors(up, fwd).normalize();
  const surfaceY = (xl) => (f.x.y / f.x.dot(side)) * xl; // altura de la pista a esa distancia lateral

  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: "#f7efe0", roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: "#111522", roughness: 0.6 });
  const span = TRACK.width / 2 + TRACK.kerb / 2; // los postes se apoyan en los bordillos
  const top = 0.72;
  for (const sx of [-1, 1]) {
    const base = surfaceY(sx * span) + TRACK.kerbHeight;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, top - base, 0.05), frameMat);
    post.position.set(sx * span, (top + base) / 2, 0);
    post.castShadow = true;
    g.add(post);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.05, 0.16, 0.08), frameMat);
  bar.position.set(0, top, 0);
  bar.castShadow = true;
  g.add(bar);

  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.04), darkMat);
  panel.position.set(0, top, -0.05);
  g.add(panel);

  // Semáforo vertical pegado al poste del lado de la cámara (lado -x del pórtico)
  const towerX = -span - 0.055;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.14), darkMat);
  tower.position.set(towerX, top - 0.22, 0);
  g.add(tower);

  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: "#2a2f4d", emissive: "#000000", roughness: 0.3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), mat);
    bulb.position.set(towerX - 0.02, top - 0.08 - i * 0.13, 0);
    g.add(bulb);
    gantryLights.push(mat);
  }

  g.position.copy(f.p);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, fwd));
  trackGroup.add(g);
})();

/* ---------- Luces de Navidad a lo largo de la pista ----------
   Una guirnalda por cada bordillo: bombillas de colores con halo, unidas por un cable
   que cae un poco entre bombilla y bombilla. Titilan cada una a su ritmo y se apagan
   al hundirse en la caja (el mismo fundido que la pista).                            */

const xmas = (() => {
  const PALETTE = ['#ffc93c', '#e8233f', '#3ee07a', '#f7efe0', '#1fa8ff', '#ff7ab6'];
  const SPACING = 0.34;
  const offset = TRACK.width / 2 + TRACK.kerb * 0.5;
  const count = Math.floor(TRACK_LEN / SPACING);
  const bulbs = [];
  const wire = [];
  const wireColor = new THREE.Color('#2f5a3c');

  for (const side of [-1, 1]) {
    let prev = null;
    for (let i = 0; i < count; i++) {
      const s = (i + (side > 0 ? 0.5 : 0)) * SPACING;
      const f = frameAt(s);
      const p = f.p.clone().addScaledVector(f.x, side * offset).addScaledVector(f.n, TRACK.kerbHeight + 0.04);
      const sag = f.n.clone().multiplyScalar(-0.035); // cuánto cae el cable entre bombillas
      const fade = boxFade(p.x, p.y, p.z);
      if (fade < 0.04) {
        prev = null; // dentro de la caja no hay guirnalda
        continue;
      }
      if (prev) {
        const mid = prev.p.clone().lerp(p, 0.5).add(sag);
        wire.push([prev.p, mid, prev.fade, (prev.fade + fade) / 2], [mid, p, (prev.fade + fade) / 2, fade]);
      }
      prev = { p, fade };
      // Charco de luz sobre la pista, algo hacia dentro del bordillo
      const pool = f.p.clone().addScaledVector(f.x, side * (offset - 0.1)).addScaledVector(f.n, 0.012);
      bulbs.push({
        p,
        pool,
        basis: new THREE.Matrix4().makeBasis(f.x.clone(), f.n.clone(), f.t.clone()),
        fade,
        base: new THREE.Color(PALETTE[(i + (side > 0 ? 3 : 0)) % PALETTE.length]),
        phase: rand(0, Math.PI * 2),
        speed: rand(1.4, 3.2),
        index: i,
      });
    }
  }

  // Cable
  const wirePos = [];
  const wireCol = [];
  for (const [a, b, fa, fb] of wire) {
    wirePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    wireCol.push(wireColor.r * fa, wireColor.g * fa, wireColor.b * fa, wireColor.r * fb, wireColor.g * fb, wireColor.b * fb);
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePos, 3));
  wireGeo.setAttribute('color', new THREE.Float32BufferAttribute(wireCol, 3));
  trackGroup.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

  // Bombillas (sin sombreado: brillan por sí mismas)
  const bulbMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.04, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    bulbs.length
  );
  const m = new THREE.Matrix4();
  bulbs.forEach((b, i) => {
    m.makeTranslation(b.p.x, b.p.y, b.p.z);
    bulbMesh.setMatrixAt(i, m);
    bulbMesh.setColorAt(i, b.base);
  });
  trackGroup.add(bulbMesh);

  // Halo de cada bombilla
  const haloTexture = canvasTexture(64, 64, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(bulbs.flatMap((b) => [b.p.x, b.p.y, b.p.z]), 3));
  haloGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bulbs.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const halos = new THREE.Points(
    haloGeo,
    new THREE.PointsMaterial({
      size: 0.58,
      map: haloTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  trackGroup.add(halos);

  // Luz que dan las bombillas: un charco de color sobre el asfalto y el bordillo, que
  // titila con su bombilla (mezcla aditiva, así ilumina lo que tiene debajo)
  const poolGeo = new THREE.PlaneGeometry(0.5, 0.5);
  poolGeo.rotateX(-Math.PI / 2); // tumbado: su normal es la de la pista
  const pools = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({
      map: haloTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    bulbs.length
  );
  bulbs.forEach((b, i) => {
    m.copy(b.basis).setPosition(b.pool);
    pools.setMatrixAt(i, m);
    pools.setColorAt(i, b.base);
  });
  pools.renderOrder = 1;
  trackGroup.add(pools);

  return { bulbs, bulbMesh, halos, pools };
})();

const bulbColor = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

// Cada bombilla titila a su ritmo; encima pasa una ola lenta que recorre la guirnalda
function updateXmasLights(time) {
  const haloColors = xmas.halos.geometry.attributes.color;
  xmas.bulbs.forEach((b, i) => {
    const twinkle = 0.5 + 0.5 * Math.sin(time * b.speed + b.phase);
    const chase = REDUCED_MOTION ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3 - b.index * 0.45);
    const glow = (0.55 + 0.4 * twinkle + 0.3 * chase) * b.fade;
    // El centro de la bombilla se acerca al blanco cuanto más brilla
    bulbColor.copy(b.base).multiplyScalar(0.9 + 0.7 * glow).lerp(WHITE, 0.25 * glow * b.fade);
    xmas.bulbMesh.setColorAt(i, bulbColor);
    haloColors.setXYZ(i, b.base.r * glow * 1.15, b.base.g * glow * 1.15, b.base.b * glow * 1.15);
    bulbColor.copy(b.base).multiplyScalar(glow * 0.42);
    xmas.pools.setColorAt(i, bulbColor);
  });
  xmas.bulbMesh.instanceColor.needsUpdate = true;
  xmas.pools.instanceColor.needsUpdate = true;
  haloColors.needsUpdate = true;
}

/* ---------- Vallas publicitarias junto a la pista ----------
   Como en un circuito de verdad: dos vallas de pie en el borde de fuera de la salida,
   siguiendo la curva de la pista y mirando hacia ella (y hacia la cámara). Los logos
   vienen de logos-data.js (data URI) para poder usarlos en WebGL también al abrir el
   cartel como archivo local.                                                          */

// Textura de la valla: marco dorado, fondo de color y logo (con el nombre al lado si se da)
function boardTexture({ logo, crop, caption, background, aspect }) {
  const W = 1024;
  const H = Math.round(W / aspect);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const border = Math.round(H * 0.08);
  const paint = (img) => {
    g.fillStyle = COLORS.gold;
    g.fillRect(0, 0, W, H);
    g.fillStyle = background;
    g.fillRect(border, border, W - border * 2, H - border * 2);
    if (img) {
      const [sx, sy, sw, sh] = crop || [0, 0, img.naturalWidth, img.naturalHeight];
      const pad = H * 0.1;
      const lines = caption || [];
      const fontSize = Math.round(H * 0.3);
      g.font = `800 ${fontSize}px Archivo, "Helvetica Neue", Arial, sans-serif`;
      const textW = lines.length ? Math.max(...lines.map((l) => g.measureText(l).width)) : 0;
      const gap = lines.length ? H * 0.12 : 0;
      const k = Math.min((W - (border + pad) * 2 - textW - gap) / sw, (H - (border + pad) * 2) / sh);
      const dw = sw * k;
      const dh = sh * k;
      const x0 = (W - (dw + gap + textW)) / 2;
      g.drawImage(img, sx, sy, sw, sh, x0, (H - dh) / 2, dw, dh);
      g.fillStyle = COLORS.ink;
      g.textBaseline = 'middle';
      lines.forEach((l, i) => {
        g.fillText(l, x0 + dw + gap, H / 2 + (i - (lines.length - 1) / 2) * fontSize * 1.02);
      });
    }
    texture.needsUpdate = true;
  };
  paint(null);

  // Se pinta cuando están listos el logo y la tipografía del cartel
  const img = new Image();
  const imgReady = new Promise((resolve) => img.addEventListener('load', resolve));
  img.src = logo;
  const fontReady = document.fonts ? document.fonts.load('800 50px Archivo').catch(() => null) : null;
  Promise.all([imgReady, fontReady]).then(() => paint(img));
  return texture;
}

// Valla de s0 a s1, de pie (vertical) sobre el borde exterior de la pista
function makeTrackBoard({ s0, s1, height = 0.3, ...art }) {
  const SAMPLES = 24;
  const out = TRACK.width / 2 + TRACK.kerb + 0.05; // justo por fuera del bordillo y de las luces
  const bottoms = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const f = frameAt(lerp(s0, s1, i / SAMPLES));
    bottoms.push(f.p.clone().addScaledVector(f.x, out).add(new V3(0, TRACK.kerbHeight * 0.5, 0)));
  }
  let length = 0;
  for (let i = 1; i <= SAMPLES; i++) length += bottoms[i].distanceTo(bottoms[i - 1]);

  // Panel: una tira vertical que sigue la curva (u a lo largo, v de abajo arriba)
  const pos = [];
  const uv = [];
  const idx = [];
  bottoms.forEach((b, i) => {
    pos.push(b.x, b.y, b.z, b.x, b.y + height, b.z);
    uv.push(i / SAMPLES, 0, i / SAMPLES, 1);
    if (i < SAMPLES) {
      const j = i * 2;
      idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const board = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: boardTexture({ ...art, aspect: length / height }),
      roughness: 0.55,
      side: THREE.DoubleSide,
    })
  );
  board.castShadow = true;
  trackGroup.add(board);

  // Patas: dos postes oscuros que la sujetan por detrás
  const legMat = new THREE.MeshStandardMaterial({ color: '#1a1d2b', roughness: 0.6 });
  for (const t of [0.12, 0.88]) {
    const b = bottoms[Math.round(t * SAMPLES)];
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, height + 0.06, 0.03), legMat);
    leg.position.set(b.x, b.y + (height - 0.06) / 2, b.z);
    const f = frameAt(lerp(s0, s1, t));
    leg.position.addScaledVector(new V3(f.x.x, 0, f.x.z).normalize(), 0.025);
    trackGroup.add(leg);
  }
  return board;
}

const centreS = TRACK.startArc; // centro de la salida (el pórtico está en START_S)
makeTrackBoard({
  logo: window.LOGOS.planetafp,
  crop: [14, 56, 272, 58], // el archivo tiene mucho margen alrededor del texto
  background: COLORS.ink,
  s0: centreS - 1.85,
  s1: centreS - 0.4,
});
makeTrackBoard({
  logo: window.LOGOS.itaca,
  caption: ['Fundación', 'ITACA'], // una línea por elemento
  background: COLORS.red,
  s0: centreS + 0.4,
  s1: centreS + 1.85,
});

/* ---------- Caja de regalo ---------- */

const boxGroup = new THREE.Group();
scene.add(boxGroup);

const redMat = new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.5 });
const innerMat = new THREE.MeshStandardMaterial({ color: COLORS.redInner, roughness: 0.95 });

// Cara interior de las paredes: granate oscuro arriba que se funde a negro hacia el fondo
const innerWallTexture = canvasTexture(4, 128, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, COLORS.redInner);
  grad.addColorStop(1 - BOX.voidY / BOX.height, '#0a0204');
  grad.addColorStop(1, COLORS.boxVoid);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
});
innerWallTexture.wrapT = THREE.ClampToEdgeWrapping;
const innerWallMat = new THREE.MeshStandardMaterial({ map: innerWallTexture, roughness: 1 });
const goldMat = new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.32, metalness: 0.35 });

(function buildBox() {
  const { half, height, wall } = BOX;

  // Caras de BoxGeometry: +x, -x, +y, -y, +z, -z. La cara interior va en granate oscuro.
  function wallMesh(w, h, d, x, z, innerFace, y0 = 0) {
    const mats = [redMat, redMat, redMat, redMat, redMat, redMat];
    mats[innerFace] = innerWallMat;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    m.position.set(x, y0 + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    boxGroup.add(m);
  }

  wallMesh(half * 2, height, wall, 0, half - wall / 2, 5);    // delante
  wallMesh(half * 2, height, wall, 0, -half + wall / 2, 4);   // detrás
  wallMesh(wall, height, half * 2 - wall * 2, -half + wall / 2, 0, 0); // izquierda
  wallMesh(wall, height, half * 2 - wall * 2, half - wall / 2, 0, 1);  // derecha

  // El fondo va por dentro de las paredes: si fuera igual de ancho que la caja, sus caras
  // laterales coincidirían con las de las paredes y parpadearían (z-fighting)
  const inner = half * 2 - wall * 2;
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(inner, wall, inner), innerMat);
  bottom.position.y = wall / 2 + 0.002;
  bottom.receiveShadow = true;
  boxGroup.add(bottom);

  // Fondo oscuro justo por debajo del borde: la pista se hunde en él y no se ve
  // lo que pasa dentro de la caja
  const voidPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(inner, inner),
    new THREE.MeshBasicMaterial({ color: COLORS.boxVoid })
  );
  voidPlane.rotation.x = -Math.PI / 2;
  voidPlane.position.y = BOX.voidY;
  boxGroup.add(voidPlane);

  // Cinta dorada en el centro de cada lado
  const rw = 0.34;
  const off = half + 0.012;
  for (const [x, z, rot] of [[0, off, 0], [0, -off, 0], [off, 0, Math.PI / 2], [-off, 0, Math.PI / 2]]) {
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(rw, height, 0.02), goldMat);
    ribbon.position.set(x, height / 2, z);
    ribbon.rotation.y = rot;
    ribbon.castShadow = true;
    boxGroup.add(ribbon);
  }
})();

// Tapa apoyada en el lado derecho de la caja, con el lazo hacia el espectador
const lidGroup = new THREE.Group();
const lidPivot = new THREE.Group();
scene.add(lidPivot);
lidPivot.add(lidGroup);

(function buildLid() {
  const s = BOX.half * 2 + 0.16;
  const h = 0.4;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), [redMat, redMat, redMat, innerMat, redMat, redMat]);
  lid.castShadow = true;
  lid.receiveShadow = true;
  lidGroup.add(lid);

  const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, h + 0.03, s + 0.03), goldMat);
  const r2 = new THREE.Mesh(new THREE.BoxGeometry(s + 0.03, h + 0.03, 0.36), goldMat);
  r1.castShadow = r2.castShadow = true;
  lidGroup.add(r1, r2);

  // Lazo: dos lazadas, nudo y dos colas
  const bow = new THREE.Group();
  bow.position.y = h / 2 + 0.02;
  const loopGeo = new THREE.TorusGeometry(0.36, 0.1, 14, 32);
  for (const side of [-1, 1]) {
    const loop = new THREE.Mesh(loopGeo, goldMat);
    loop.scale.set(1, 0.8, 1);
    loop.rotation.set(0, side * 0.5, side * 0.25);
    loop.position.set(side * 0.33, 0.22, 0);
    loop.castShadow = true;
    bow.add(loop);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.75), goldMat);
    tail.position.set(side * 0.22, 0.02, 0.36);
    tail.rotation.y = side * 0.45;
    tail.castShadow = true;
    bow.add(tail);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 12), goldMat);
  knot.scale.set(1, 0.85, 1);
  knot.position.y = 0.14;
  bow.add(knot);
  lidGroup.add(bow);
})();

// Pivote en el borde inferior de la tapa, que descansa en el suelo
lidGroup.position.set(0, 0, -(BOX.half + 0.08));
lidPivot.position.set(-(BOX.half + 0.55), 0.2, -1.35);
lidPivot.rotation.set(0, 0.75, 0);
lidGroup.rotation.set(1.28, 0, 0);
const LID_BASE = { x: lidPivot.position.x, y: lidPivot.position.y, tilt: lidGroup.rotation.x };

/* ---------- Coches ---------- */

function makeCar(spec) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.28, metalness: 0.2 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: spec.stripe, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: '#141722', roughness: 0.3, metalness: 0.4 });
  const tyre = new THREE.MeshStandardMaterial({ color: '#121216', roughness: 0.85 });
  const rim = new THREE.MeshStandardMaterial({ color: '#d4d8e2', roughness: 0.3, metalness: 0.3 });
  const helmet = new THREE.MeshStandardMaterial({ color: '#f7efe0', roughness: 0.25 });

  const add = (geo, mat, x, y, z, parent = car) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // Carrocería: perfil lateral (z hacia delante, y hacia arriba) extruido a lo ancho,
  // con los cantos redondeados
  const profile = new THREE.Shape();
  profile.moveTo(-0.27, 0.035);
  profile.lineTo(-0.27, 0.11);
  profile.quadraticCurveTo(-0.2, 0.13, -0.12, 0.13);
  profile.quadraticCurveTo(-0.06, 0.16, 0.02, 0.14); // joroba de la cabina
  profile.quadraticCurveTo(0.16, 0.11, 0.3, 0.06); // morro que baja
  profile.quadraticCurveTo(0.32, 0.04, 0.29, 0.035);
  profile.lineTo(-0.27, 0.035);
  const extrude = (width, bevel) => {
    const geo = new THREE.ExtrudeGeometry(profile, {
      depth: width,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 4,
      curveSegments: 14,
    });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(-Math.PI / 2); // el perfil pasa a ir a lo largo del coche
    return geo;
  };
  add(extrude(0.12, 0.025), paint, 0, 0, 0);
  // Franja central: la misma silueta y el mismo bisel, estrecha y un pelo por encima
  add(extrude(0.02, 0.025), stripeMat, 0, 0.007, 0);

  // Pontones laterales, más bajos, entre las ruedas
  for (const sx of [-1, 1]) {
    const pod = add(new THREE.SphereGeometry(1, 20, 12), paint, sx * 0.1, 0.07, -0.02);
    pod.scale.set(0.04, 0.036, 0.15); // esfera estirada: pontón redondeado
  }

  // Cabina abierta: aro negro sobre la carrocería, con el casco del piloto y su visera
  const cockpit = add(new THREE.TorusGeometry(0.06, 0.012, 8, 24), dark, 0, 0.178, -0.05);
  cockpit.rotation.x = Math.PI / 2;
  cockpit.scale.set(1, 1.35, 1);
  add(new THREE.SphereGeometry(0.045, 18, 12), helmet, 0, 0.205, -0.06);
  const visor = add(new THREE.SphereGeometry(0.046, 18, 8, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.32, Math.PI * 0.2), dark, 0, 0.205, -0.06);
  visor.rotation.y = 0;

  // Alerón delantero con sus derivas, por delante del morro
  add(new THREE.BoxGeometry(0.32, 0.016, 0.07), stripeMat, 0, 0.03, 0.33);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.014, 0.045, 0.085), paint, sx * 0.16, 0.042, 0.33);

  // Alerón trasero sobre dos soportes
  add(new THREE.BoxGeometry(0.31, 0.018, 0.08), paint, 0, 0.205, -0.235);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.014, 0.08, 0.025), dark, sx * 0.07, 0.16, -0.235);
    add(new THREE.BoxGeometry(0.012, 0.06, 0.1), stripeMat, sx * 0.155, 0.2, -0.235);
  }

  // Faros redondos delante y pilotos detrás
  const head = new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#fff1b0', emissiveIntensity: 0.9 });
  const tail = new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff1a1a', emissiveIntensity: 0.6 });
  const lampGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.01, 14);
  lampGeo.rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    add(lampGeo, head, sx * 0.07, 0.07, 0.285);
    add(new THREE.BoxGeometry(0.05, 0.022, 0.01), tail, sx * 0.075, 0.09, -0.3);
  }

  // Ruedas: neumático con llanta plateada; las de detrás, más anchas
  const wheels = [];
  for (const [x, z, r, w] of [[-0.135, 0.17, 0.05, 0.05], [0.135, 0.17, 0.05, 0.05], [-0.14, -0.17, 0.056, 0.064], [0.14, -0.17, 0.056, 0.064]]) {
    const wheel = new THREE.Group();
    wheel.position.set(x, r, z);
    wheel.rotation.z = Math.PI / 2;
    car.add(wheel);
    add(new THREE.CylinderGeometry(r, r, w, 22), tyre, 0, 0, 0, wheel);
    const hub = add(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.004, 16), rim, 0, 0, 0, wheel);
    hub.castShadow = false;
    wheels.push(wheel);
  }

  car.scale.setScalar(1.3);
  scene.add(car);

  // Materiales con su color original, para fundirlos a negro al entrar en la caja
  const shades = [paint, stripeMat, dark, tyre, rim, helmet, head, tail].map((m) => ({
    m,
    color: m.color.clone(),
    emissive: m.emissiveIntensity,
  }));

  return {
    ...spec,
    group: car,
    wheels,
    tailMat: tail,
    shades,
    light: 1,
    s: PARK_S + spec.grid,
    v: 0,
    vmax: CONFIG.baseSpeed,
    freq: 1,
    phaseOff: 0,
    boost: false, // ratón sobre su zona lateral
    boostMix: 0,  // 0 → 1, entra y sale suave
    stage: 'grid', // race · inside · return · grid (ver «Ciclo de la carrera»)
    insideTime: 0,
    trail: makeTrail(spec.trail),
  };
}

/* ---------- Estelas de velocidad ---------- */

const TRAIL_N = 28;

function makeTrail(color) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(TRAIL_N * 2 * 3);
  const alphas = new Float32Array(TRAIL_N * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) {
    const j = i * 2;
    idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
  }
  geo.setIndex(idx);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() { gl_FragColor = vec4(uColor, vAlpha); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, geo, history: [] };
}

function updateTrail(car, f, intensity, dir = 1) {
  const tr = car.trail;
  const tailPos = new V3().copy(car.group.position).addScaledVector(f.t, -0.24 * dir).addScaledVector(f.n, 0.08);
  tr.history.unshift({ p: tailPos, x: f.x.clone() });
  if (tr.history.length > TRAIL_N) tr.history.length = TRAIL_N;

  const pos = tr.geo.attributes.position.array;
  const alpha = tr.geo.attributes.alpha.array;
  for (let i = 0; i < TRAIL_N; i++) {
    const h = tr.history[Math.min(i, tr.history.length - 1)];
    const k = 1 - i / (TRAIL_N - 1);
    const w = 0.1 * k + 0.01;
    for (let side = 0; side < 2; side++) {
      const sgn = side ? 1 : -1;
      const o = (i * 2 + side) * 3;
      pos[o] = h.p.x + h.x.x * w * sgn;
      pos[o + 1] = h.p.y + h.x.y * w * sgn;
      pos[o + 2] = h.p.z + h.x.z * w * sgn;
      alpha[i * 2 + side] = i < tr.history.length ? k * k * intensity * 0.85 : 0;
    }
  }
  tr.geo.attributes.position.needsUpdate = true;
  tr.geo.attributes.alpha.needsUpdate = true;
}

function clearTrail(car) {
  car.trail.history.length = 0;
  car.trail.geo.attributes.alpha.array.fill(0);
  car.trail.geo.attributes.alpha.needsUpdate = true;
}

const cars = CARS.map(makeCar);

/* ---------- Confeti al entrar en la caja ---------- */

const CONFETTI_COUNT = 260;
const confettiMesh = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.07, 0.13),
  new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5 }),
  CONFETTI_COUNT
);
confettiMesh.frustumCulled = false;
scene.add(confettiMesh);

const confetti = [];
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

for (let i = 0; i < CONFETTI_COUNT; i++) {
  confetti.push({ p: new V3(), v: new V3(), r: new THREE.Euler(), w: new V3(), life: 0 });
  confettiMesh.setColorAt(i, tmpColor.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
  dummy.scale.setScalar(0);
  dummy.updateMatrix();
  confettiMesh.setMatrixAt(i, dummy.matrix);
}
confettiMesh.instanceColor.needsUpdate = true;

let confettiCursor = 0;

function burstConfetti(amount) {
  if (REDUCED_MOTION) amount = Math.round(amount * 0.2);
  for (let n = 0; n < amount; n++) {
    const c = confetti[confettiCursor];
    confettiCursor = (confettiCursor + 1) % CONFETTI_COUNT;
    c.p.set(rand(-0.9, 0.9), BOX.height + rand(-0.1, 0.2), rand(-0.9, 0.9));
    const a = rand(0, Math.PI * 2);
    const spread = rand(0.6, 2.6);
    c.v.set(Math.cos(a) * spread, rand(4.5, 8.5), Math.sin(a) * spread);
    c.r.set(rand(0, 6), rand(0, 6), rand(0, 6));
    c.w.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
    c.life = rand(2.4, 3.6);
  }
}

function updateConfetti(dt) {
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const c = confetti[i];
    if (c.life <= 0) continue;
    c.life -= dt;
    c.v.y -= 9 * dt;
    c.v.multiplyScalar(1 - 1.6 * dt);
    c.v.y = Math.max(c.v.y, -1.6);                        // caen planeando
    c.p.addScaledVector(c.v, dt);
    c.p.x += Math.sin(state.time * 4 + i) * 0.3 * dt;
    if (c.p.y < 0.02) {
      c.p.y = 0.02;
      c.v.set(0, 0, 0);
      c.w.multiplyScalar(0.9);
    }
    c.r.x += c.w.x * dt;
    c.r.y += c.w.y * dt;
    c.r.z += c.w.z * dt;
    dummy.position.copy(c.p);
    dummy.rotation.copy(c.r);
    dummy.scale.setScalar(c.life > 0 ? Math.min(1, c.life * 2) : 0);
    dummy.updateMatrix();
    confettiMesh.setMatrixAt(i, dummy.matrix);
  }
  confettiMesh.instanceMatrix.needsUpdate = true;
}

/* ---------- Nieve de fondo ---------- */

const SNOW_COUNT = 180;
const snowPos = new Float32Array(SNOW_COUNT * 3);
for (let i = 0; i < SNOW_COUNT; i++) {
  snowPos[i * 3] = rand(-7, 7);
  snowPos[i * 3 + 1] = rand(0, 11);
  snowPos[i * 3 + 2] = rand(-6, 2);
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3).setUsage(THREE.DynamicDrawUsage));
const snow = new THREE.Points(
  snowGeo,
  new THREE.PointsMaterial({ color: 0xf7efe0, size: 0.055, transparent: true, opacity: 0.55, depthWrite: false })
);
scene.add(snow);

function updateSnow(dt) {
  if (REDUCED_MOTION) return; // la nieve se queda quieta
  for (let i = 0; i < SNOW_COUNT; i++) {
    const o = i * 3;
    snowPos[o + 1] -= (0.25 + (i % 7) * 0.04) * dt;
    snowPos[o] += Math.sin(state.time * 0.6 + i) * 0.08 * dt;
    if (snowPos[o + 1] < 0) snowPos[o + 1] = 11;
  }
  snowGeo.attributes.position.needsUpdate = true;
}

/* ---------- Rebote de la caja y de la tapa ---------- */

const springs = {
  box: { x: 0, v: 0 },
  lid: { x: 0, v: 0 },
  glow: 0,
};

function kick(spring, impulse) {
  spring.v += impulse;
}

function stepSpring(sp, dt, k = 160, c = 9) {
  sp.v += (-k * sp.x - c * sp.v) * dt;
  sp.x += sp.v * dt;
}

/* ---------- Pedales de turbo en 3D ----------
   Cada lateral es una pequeña escena three.js en su propio <canvas>: una cartela con
   ornamentos barrocos de oro que sale del borde del cartel, como parte de un marco. El
   interior del marco es el propio pedal: aluminio cepillado del color del coche con
   tacos de goma negra, como un pedal deportivo. Al pisarlo (mouseenter) la placa se hunde en el marco y se encoge un
   poco, con un muelle, y se ilumina con el color del coche. */

const PEDAL = {
  pressScale: 0.06,  // al pisarlo se encoge un poco hacia el borde del cartel
  pressDepth: 0.1,   // y se hunde en el marco (en la dirección de la mirada)
  inset: 0.985,      // la placa llena todo el interior; su borde queda bajo la moldura
  stiffness: 320,
  damping: 17,
};

/* Cartela 3D que sale del borde del cartel, como parte de un marco. Su contorno está en
   píxeles del cartel (caja de 120 × 280, con el borde del cartel en x = 0) y se pasa a
   unidades de la escena con PX. */
const CARTOUCHE = { w: 120, h: 280, depth: 0.1, bevel: 0.03, pitch: 0.38 };
const PX = 0.01;
const cartoucheXY = (x, y) => new V3(x * PX, (CARTOUCHE.h - y) * PX, 0);

// Une tramos de Bézier cúbicas [p0, c1, c2, p3] (en píxeles) en un camino 3D a la altura z
function bezierPath(segments, z) {
  const path = new THREE.CurvePath();
  for (const seg of segments) {
    const [a, b, c, d] = seg.map(([x, y]) => cartoucheXY(x, y).setZ(z));
    path.add(new THREE.CubicBezierCurve3(a, b, c, d));
  }
  return path;
}

const CARTOUCHE_OUTLINE = [
  [[0, 0], [16, 8], [28, 24], [32, 46]],
  [[32, 46], [72, 58], [106, 92], [108, 140]],
  [[108, 140], [106, 188], [72, 222], [32, 234]],
  [[32, 234], [28, 256], [16, 272], [0, 280]],
];
/* ---- Ornamentos barrocos en relieve (volutas de acanto, concha y cuentas) ---- */

// Tubo que adelgaza a lo largo de la curva: tallos de volutas y hojas
function taperedTube(curve, r0, r1, segments = 64, radial = 12) {
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [];
  const nor = [];
  const idx = [];
  const n = new V3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const r = lerp(r0, r1, Math.pow(t, 0.8));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

// Espiral plana (en px del cartel) que se enrolla hacia su centro
function spiralCurve(cx, cy, r0, startAngle, turns, dir, z) {
  const pts = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = startAngle + dir * t * turns * Math.PI * 2;
    const r = r0 * (1 - 0.78 * t);
    pts.push(cartoucheXY(cx + Math.cos(a) * r, cy + Math.sin(a) * r).setZ(z));
  }
  return new THREE.CatmullRomCurve3(pts);
}

// Hoja de acanto: lóbulos alargados que salen en abanico desde un punto
function acanthusLeaf(parent, mat, x, y, z, angle, length, lobes = 3, spread = 0.9) {
  const lobeGeo = new THREE.SphereGeometry(1, 16, 10);
  for (let i = 0; i < lobes; i++) {
    const k = lobes === 1 ? 0 : i / (lobes - 1) - 0.5;
    const a = angle + k * spread;
    const len = length * (1 - Math.abs(k) * 0.45);
    const lobe = new THREE.Mesh(lobeGeo, mat);
    lobe.scale.set(len / 2, len * 0.17, len * 0.14);
    const base = cartoucheXY(x, y);
    // En px del cartel la y crece hacia abajo; en la escena, hacia arriba
    lobe.position.set(base.x + (Math.cos(a) * len) / 2, base.y - (Math.sin(a) * len) / 2, z + len * 0.05);
    lobe.rotation.z = -a;
    parent.add(lobe);
  }
}

// Voluta de acanto: un tallo grueso que se enrolla, con su botón y hojas
function acanthusScroll(parent, mat, { x, y, r = 14, start = 0, turns = 1.15, dir = 1, leafAngle = 0, z }) {
  const curve = spiralCurve(x, y, r, start, turns, dir, z);
  parent.add(new THREE.Mesh(taperedTube(curve, 0.05, 0.016), mat));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), mat);
  eye.position.copy(curve.getPointAt(1)).setZ(z + 0.01);
  parent.add(eye);
  const startPx = [x + Math.cos(start) * r, y + Math.sin(start) * r];
  acanthusLeaf(parent, mat, startPx[0], startPx[1], z + 0.02, leafAngle, 0.32, 3, 1.0);
}

// Concha (palmeta) en la punta de la cartela
function shellOrnament(parent, mat, x, y, z) {
  const base = cartoucheXY(x, y);
  const lobeGeo = new THREE.SphereGeometry(1, 18, 12);
  const lobes = 7;
  for (let i = 0; i < lobes; i++) {
    const k = i / (lobes - 1) - 0.5; // −0,5 … 0,5
    const a = k * 2.3; // abanico hacia fuera (+x)
    const len = 0.2 * (1 - Math.abs(k) * 0.35);
    const lobe = new THREE.Mesh(lobeGeo, mat);
    lobe.scale.set(len / 2, 0.034, 0.05);
    lobe.position.set(base.x + (Math.cos(a) * len) / 2, base.y + (Math.sin(a) * len) / 2, z + 0.02);
    lobe.rotation.z = a;
    parent.add(lobe);
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), mat);
  knob.position.set(base.x - 0.01, base.y, z + 0.05);
  parent.add(knob);
  // Dos hojas que abrazan la concha por dentro
  acanthusLeaf(parent, mat, x - 6, y - 4, z, Math.PI * 0.72, 0.22, 3, 0.7);
  acanthusLeaf(parent, mat, x - 6, y + 4, z, -Math.PI * 0.72, 0.22, 3, 0.7);
}

function buildCartouche(parent, gold, plaqueMat) {
  const shape = new THREE.Shape();
  const P = (x, y) => cartoucheXY(x, y);
  const start = P(0, 0);
  shape.moveTo(start.x, start.y);
  for (const [, b, c, d] of CARTOUCHE_OUTLINE) {
    const [pb, pc, pd] = [P(...b), P(...c), P(...d)];
    shape.bezierCurveTo(pb.x, pb.y, pc.x, pc.y, pd.x, pd.y);
  }
  shape.lineTo(start.x, start.y);

  const plaque = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: CARTOUCHE.depth,
      bevelEnabled: true,
      bevelThickness: CARTOUCHE.bevel,
      bevelSize: CARTOUCHE.bevel,
      bevelSegments: 5,
      curveSegments: 40,
    }),
    plaqueMat
  );
  // Fondo del hueco, detrás del pedal. Como la cámara mira desde arriba, lo que está más
  // al fondo se ve más alto: se baja lo mismo para que quede escondido tras el marco
  plaque.position.z = -0.6;
  plaque.position.y = -0.6 * Math.tan(CARTOUCHE.pitch);
  parent.add(plaque);

  const front = CARTOUCHE.depth + CARTOUCHE.bevel;

  // Moldura dorada gruesa en todo el contorno
  parent.add(new THREE.Mesh(new THREE.TubeGeometry(bezierPath(CARTOUCHE_OUTLINE, front), 200, 0.048, 14, false), gold));


  // Volutas de acanto: en los hombros y a media curva, arriba y abajo (reflejadas)
  const z = front + 0.03;
  for (const s of [1, -1]) {
    const yy = (y) => (s > 0 ? y : CARTOUCHE.h - y);
    acanthusScroll(parent, gold, { x: 44, y: yy(50), r: 15, start: s > 0 ? Math.PI : -Math.PI, turns: 1.1, dir: s, leafAngle: s > 0 ? -2.2 : 2.2, z });
    acanthusScroll(parent, gold, { x: 84, y: yy(88), r: 12, start: s > 0 ? -0.4 : 0.4, turns: 1.05, dir: -s, leafAngle: s > 0 ? 2.3 : -2.3, z });
  }

  // Concha en la punta
  shellOrnament(parent, gold, 98, 140, z);
}

// El interior del marco es el pedal: el mismo contorno (pegado al borde del cartel),
// de aluminio cepillado del color del coche, con tacos de goma negra
function buildFramePedal(parent, car) {
  const k = PEDAL.inset;
  const midY = (CARTOUCHE.h * PX) / 2;
  const T = ([x, y]) => {
    const p = cartoucheXY(x, y);
    return [p.x * k, midY + (p.y - midY) * k];
  };
  const shape = new THREE.Shape();
  const start = T(CARTOUCHE_OUTLINE[0][0]);
  shape.moveTo(...start);
  for (const [, b, c, d] of CARTOUCHE_OUTLINE) shape.bezierCurveTo(...T(b), ...T(c), ...T(d));
  shape.lineTo(...start);

  // El pivote está en el borde del cartel, a media altura: al pisarlo se encoge hacia ahí
  const pivot = new THREE.Group();
  pivot.position.set(0, midY, 0);
  parent.add(pivot);

  // Aluminio anodizado del color del coche, cepillado en horizontal (como los pedales
  // deportivos de metal)
  const plateMat = new THREE.MeshStandardMaterial({
    color: car.color,
    map: brushedTexture,
    roughnessMap: brushedTexture,
    roughness: 0.55,
    metalness: 0.6,
    envMapIntensity: 0.9,
    emissive: car.color,
    emissiveIntensity: 0,
  });
  const plate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 4,
      curveSegments: 40,
    }),
    plateMat
  );
  plate.position.y = -midY;
  pivot.add(plate);

  // Tacos de goma negra en cuadrícula, cada uno metido en su agujero con un reborde oscuro
  const outline = shape.getPoints(240);
  const reach = (y) => Math.max(...outline.filter((p) => Math.abs(p.y - y) < 0.04).map((p) => p.x));
  const rubber = new THREE.MeshStandardMaterial({ color: '#17171d', roughness: 0.85, envMapIntensity: 0.3 });
  const holeMat = new THREE.MeshStandardMaterial({ color: '#0b0b10', roughness: 0.6, metalness: 0.3 });
  // Perfil del taco (radio, altura): base recta y la cabeza abombada
  const studGeo = new THREE.LatheGeometry(
    // de abajo arriba: en ese orden las caras miran hacia fuera
    [[0.046, -0.02], [0.046, 0], [0.044, 0.016], [0.036, 0.032], [0.022, 0.04], [0, 0.042]].map(([x, y]) => new THREE.Vector2(x, y)),
    20
  );
  studGeo.rotateX(Math.PI / 2); // de pie sobre la cara de la placa (+z)
  const holeGeo = new THREE.TorusGeometry(0.052, 0.009, 8, 24);
  const SPACING = 0.19;
  const front = 0.085;
  const spots = [];
  for (let row = 0; row < 12; row++) {
    const y = 0.5 + row * SPACING;
    const limit = reach(y) - 0.11;
    const offset = row % 2 ? SPACING / 2 : 0; // filas al tresbolillo
    for (let x = 0.12 + offset; x <= limit; x += SPACING) spots.push([x, y - midY]);
  }
  // Todos los tacos (y todos los agujeros) en una sola malla instanciada: una llamada de
  // dibujo en vez de un centenar
  const studs = new THREE.InstancedMesh(studGeo, rubber, spots.length);
  const holes = new THREE.InstancedMesh(holeGeo, holeMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, y], i) => {
    studs.setMatrixAt(i, m.makeTranslation(x, y, front));
    holes.setMatrixAt(i, m.makeTranslation(x, y, front + 0.002));
  });
  pivot.add(studs, holes);
  return { pivot, plateMat };
}

// Brocado azul noche para el fondo de la cartela: celosía de rombos con flores de cuatro
// pétalos, todo tono sobre tono; el mismo dibujo en gris da el relieve
const brocadeTexture = (() => {
  const draw = (g, w, h, palette) => {
    g.fillStyle = palette.base;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = palette.line;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, h / 2); g.lineTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.closePath();
    g.stroke();
    const flower = (cx, cy, r) => {
      g.fillStyle = palette.flower;
      for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(cx, cy);
        g.rotate((i * Math.PI) / 2);
        g.beginPath();
        g.ellipse(0, -r * 0.55, r * 0.28, r * 0.55, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.fillStyle = palette.heart;
      g.beginPath();
      g.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
      g.fill();
    };
    flower(w / 2, h / 2, w * 0.2);
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) flower(cx, cy, w * 0.2);
    g.fillStyle = palette.star;
    for (const [cx, cy] of [[w / 2, 0], [0, h / 2], [w, h / 2], [w / 2, h]]) {
      g.beginPath();
      g.arc(cx, cy, w * 0.025, 0, Math.PI * 2);
      g.fill();
    }
  };
  const make = (palette) => {
    const tex = canvasTexture(128, 128, (g, w, h) => draw(g, w, h, palette));
    tex.repeat.set(2.8, 2.8); // las UV de la cara van en unidades de la escena
    return tex;
  };
  return {
    color: make({ base: '#16245a', line: '#20327a', flower: '#213480', heart: '#2a4194', star: '#20327a' }),
    bump: make({ base: '#404040', line: '#8a8a8a', flower: '#c8c8c8', heart: '#e0e0e0', star: '#8a8a8a' }),
  };
})();

// Aluminio cepillado: vetas finas horizontales en grises claros (sirve de color y de
// rugosidad a la vez)
const brushedTexture = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const v = 175 + Math.floor(Math.random() * 80);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 120, 1);
  }
});
brushedTexture.repeat.set(1.5, 1.5);

// Entorno para los reflejos del oro: cielo cálido, banda oscura y suelo tostado
function goldEnvironment(r) {
  const envCanvas = canvasTexture(256, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#fff3d6');
    grad.addColorStop(0.35, '#a9b6e8');
    grad.addColorStop(0.5, '#1b2550');
    grad.addColorStop(0.7, '#6b4a1c');
    grad.addColorStop(1, '#2a1a08');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255, 250, 235, 0.9)';
    g.fillRect(w * 0.18, h * 0.12, w * 0.12, h * 0.1); // dos ventanas de luz para los brillos
    g.fillRect(w * 0.62, h * 0.2, w * 0.08, h * 0.08);
  });
  envCanvas.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(r);
  const env = pmrem.fromEquirectangular(envCanvas).texture;
  pmrem.dispose();
  return env;
}

// Luces de las escenas de oro (cartelas y ornamentos), las mismas que la escena principal
function addOrnamentLights(sc) {
  sc.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a1d3a, 0.6));
  const key = new THREE.DirectionalLight(0xfff4e0, 0.8);
  key.position.set(-0.6, 3.2, 3.5);
  sc.add(key);
  const fill = new THREE.DirectionalLight(0x7f9bff, 0.35);
  fill.position.set(3, 0.5, 2);
  sc.add(fill);
}

function makePedal(zone, car) {
  const canvasEl = document.createElement('canvas');
  canvasEl.className = 'pedal';
  canvasEl.setAttribute('aria-hidden', 'true');
  zone.prepend(canvasEl);

  // La cámara mira un poco desde arriba: la cartela se ve algo más baja que su contorno
  const W = CARTOUCHE.w;
  const H = Math.round(CARTOUCHE.h * Math.cos(CARTOUCHE.pitch));
  const r = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setSize(W, H, false);
  r.setClearColor(0x000000, 0);

  const sc = new THREE.Scene();
  addOrnamentLights(sc);

  // Cámara ortográfica: así el borde de la cartela coincide justo con el borde del cartel
  const halfW = (CARTOUCHE.w * PX) / 2;
  const halfH = ((CARTOUCHE.h * PX) / 2) * Math.cos(CARTOUCHE.pitch);
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 30);
  const target = new V3(halfW, (CARTOUCHE.h * PX) / 2, 0);
  cam.position.copy(target).add(new V3(0, Math.sin(CARTOUCHE.pitch), Math.cos(CARTOUCHE.pitch)).multiplyScalar(10));
  cam.lookAt(target);

  sc.environment = goldEnvironment(r);

  const gold = new THREE.MeshStandardMaterial({ color: '#f2be52', roughness: 0.3, metalness: 0.9 });
  // Fondo del hueco, oscuro, para que se vea cómo se hunde el pedal
  const plaqueMat = new THREE.MeshStandardMaterial({
    map: brocadeTexture.color,
    color: '#5a647e',
    roughness: 0.8,
    envMapIntensity: 0.2,
  });

  // En el lado derecho todo se refleja, con el borde del cartel a la derecha
  const root = new THREE.Group();
  if (zone.classList.contains('boost--right')) {
    root.scale.x = -1;
    root.position.x = CARTOUCHE.w * PX;
  }
  sc.add(root);
  buildCartouche(root, gold, plaqueMat);

  // El pedal es el interior del marco
  const { pivot, plateMat } = buildFramePedal(root, car);

  const glowLight = new THREE.PointLight(car.color, 0, 2.2, 2);
  glowLight.position.set(0.42, (CARTOUCHE.h * PX) / 2, 0.7);
  root.add(glowLight);

  const pedal = {
    zone,
    car,
    canvas: canvasEl,
    renderer: r,
    scene: sc,
    camera: cam,
    pivot,
    pivotHome: pivot.position.clone(),
    plateMat,
    glowLight,
    press: 0, // 0 = suelto, 1 = pisado (con muelle, puede pasarse un poco)
    velocity: 0,
    glow: 0,
    dirty: true,
  };
  return pedal;
}

const pedals = cars.map((car) => makePedal(document.getElementById(car.boostZone), car));

// Dirección que se aleja de la cámara (la cámara mira desde arriba con CARTOUCHE.pitch)
const PEDAL_AWAY = new V3(0, -Math.sin(CARTOUCHE.pitch), -Math.cos(CARTOUCHE.pitch));

// Muelle de la placa y brillo; solo se vuelve a dibujar mientras se mueve
function updatePedals(dt) {
  for (const p of pedals) {
    const target = p.car.boost ? 1 : 0;
    p.velocity += ((target - p.press) * PEDAL.stiffness - p.velocity * PEDAL.damping) * dt;
    p.press += p.velocity * dt;
    p.glow += ((p.car.boost ? 1 : 0) - p.glow) * Math.min(1, dt * 8);
    const moving = Math.abs(p.velocity) > 0.002 || Math.abs(target - p.press) > 0.002 || (p.glow > 0.002 && p.glow < 0.998);
    if (!moving && !p.dirty) continue;
    // Se hunde recto, en la dirección de la mirada (así no salta hacia arriba en pantalla),
    // y se encoge un poco hacia el borde del cartel
    p.pivot.scale.setScalar(1 - PEDAL.pressScale * p.press);
    p.pivot.position.copy(p.pivotHome).addScaledVector(PEDAL_AWAY, PEDAL.pressDepth * p.press);
    p.plateMat.emissiveIntensity = 0.4 * p.glow;
    p.glowLight.intensity = 2.0 * p.glow;
    p.renderer.render(p.scene, p.camera);
    p.dirty = false;
  }
}

/* ---------- Ornamentos de oro del marco: esquinas y cresta del mensaje ----------
   Las mismas piezas barrocas de la cartela (volutas de acanto, hojas y concha), con el
   mismo oro y la misma luz. Como no se mueven, se dibujan una sola vez con un renderer
   aparte, se pasan a imagen y se suelta ese contexto de WebGL.                       */

// Dibuja un ornamento de w × h px (coordenadas como las de la cartela, con el origen
// arriba a la izquierda) y devuelve la imagen. flipX/flipY lo reflejan sin cambiar la luz.
function renderOrnament(r, { w, h, flipX = false, flipY = false, build }) {
  const H = Math.round(h * Math.cos(CARTOUCHE.pitch));
  r.setSize(w, H, false);

  const sc = new THREE.Scene();
  sc.environment = goldEnvironment(r);
  addOrnamentLights(sc);

  const top = CARTOUCHE.h * PX; // y de la escena para y = 0 px
  const center = new V3((w / 2) * PX, top - (h / 2) * PX, 0);
  const halfW = (w / 2) * PX;
  const halfH = (h / 2) * PX * Math.cos(CARTOUCHE.pitch);
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 30);
  cam.position.copy(center).add(new V3(0, Math.sin(CARTOUCHE.pitch), Math.cos(CARTOUCHE.pitch)).multiplyScalar(10));
  cam.lookAt(center);

  const group = new THREE.Group();
  if (flipX) {
    group.scale.x = -1;
    group.position.x = 2 * center.x;
  }
  if (flipY) {
    group.scale.y = -1;
    group.position.y = 2 * center.y;
  }
  sc.add(group);
  build(group, ORNAMENT_GOLD);

  r.render(sc, cam);
  return r.domElement.toDataURL('image/png');
}

const ORNAMENT_GOLD = new THREE.MeshStandardMaterial({ color: '#f2be52', roughness: 0.3, metalness: 0.9 });

// Pone un grupo con su origen en (x, y) px y girado `angle` (radianes, en pantalla:
// positivo = hacia abajo), para colocar piezas pensadas mirando a la derecha
function placed(parent, x, y, angle) {
  const g = new THREE.Group();
  g.position.copy(cartoucheXY(x, y));
  g.rotation.z = -angle;
  parent.add(g);
  return g;
}

// Esquina de arriba a la izquierda: concha mirando hacia dentro y una voluta con hojas
// a lo largo de cada borde
function buildCorner(group, gold) {
  const z = 0.06;
  const shell = placed(group, 15, 15, Math.PI / 4);
  shellOrnament(shell, gold, 0, CARTOUCHE.h, z); // (0, h) px es el origen del grupo
  acanthusScroll(group, gold, { x: 46, y: 13, r: 9, start: Math.PI, turns: 1.05, dir: 1, leafAngle: 0.2, z });
  acanthusScroll(group, gold, { x: 13, y: 46, r: 9, start: -Math.PI / 2, turns: 1.05, dir: -1, leafAngle: -1.4, z });
}

// Cresta sobre el mensaje: concha hacia arriba y volutas con hojas a cada lado, unidas
// por una moldura
function buildCrest(group, gold) {
  const z = 0.06;
  const cx = 98;
  const shell = placed(group, cx, 40, -Math.PI / 2);
  shellOrnament(shell, gold, 0, CARTOUCHE.h, z);
  for (const s of [-1, 1]) {
    acanthusScroll(group, gold, {
      x: cx + s * 52,
      y: 34,
      r: 11,
      start: s > 0 ? Math.PI : 0,
      turns: 1.1,
      dir: s,
      leafAngle: s > 0 ? Math.PI + 0.2 : -0.2,
      z,
    });
  }
  const rail = new THREE.CatmullRomCurve3([
    cartoucheXY(8, 48).setZ(z),
    cartoucheXY(cx, 50).setZ(z),
    cartoucheXY(188, 48).setZ(z),
  ]);
  group.add(new THREE.Mesh(taperedTube(rail, 0.018, 0.018), gold));
  for (const x of [8, 188]) {
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 10), gold);
    bead.position.copy(cartoucheXY(x, 48)).setZ(z);
    group.add(bead);
  }
}

(function placeFrameOrnaments() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * 1.5);
  r.setClearColor(0x000000, 0);

  const CORNER = 72;
  for (const el of document.querySelectorAll('.frame__corner')) {
    el.src = renderOrnament(r, {
      w: CORNER,
      h: CORNER,
      flipX: el.classList.contains('frame__corner--right'),
      flipY: el.classList.contains('frame__corner--bottom'),
      build: buildCorner,
    });
  }
  document.getElementById('messageCrest').src = renderOrnament(r, { w: 196, h: 64, build: buildCrest });

  r.dispose();
  r.forceContextLoss();
})();

/* ---------- Semáforo y texto del pie ---------- */

const LIGHT_OFF = { bg: '#2a2f4d', glow: 'inset 0 0 0 2px rgba(247, 239, 224, 0.15)' };
const LIGHT_RED = { bg: '#ff3048', glow: '0 0 14px 3px rgba(255, 48, 72, 0.7)' };
const LIGHT_GREEN = { bg: '#3ee07a', glow: '0 0 14px 3px rgba(62, 224, 122, 0.75)' };

let lastLightKey = '';

function setLights(redCount, green) {
  const key = `${redCount}-${green}`;
  if (key === lastLightKey) return;
  lastLightKey = key;
  lightEls.forEach((el, i) => {
    const look = green ? LIGHT_GREEN : i < redCount ? LIGHT_RED : LIGHT_OFF;
    el.style.background = look.bg;
    el.style.boxShadow = look.glow;
  });
  gantryLights.forEach((mat, i) => {
    if (green) {
      mat.color.set('#3ee07a');
      mat.emissive.set('#2bd16a');
    } else if (i < redCount) {
      mat.color.set('#ff3048');
      mat.emissive.set('#ff1030');
    } else {
      mat.color.set('#2a2f4d');
      mat.emissive.set('#000000');
    }
  });
}

let lastHint = '';

function setHint(text) {
  if (text === lastHint) return;
  lastHint = text;
  hintEl.textContent = text;
}

/* ---------- Ciclo de la carrera ----------
   parked → countdown → racing → racing otra vez si el ratón sigue encima, o parked si no.

   Durante «racing» cada coche va a su ritmo (car.stage):
   race (baja y entra en la caja) → inside (pausa corta dentro) → return (sale de la caja
   y sube por la izquierda) → grid (espera en la parrilla). El único punto en el que se
   esperan es la parrilla: la siguiente carrera arranca cuando están los dos.
   El turbo de cada coche acelera la bajada, acorta la pausa dentro de la caja y acelera
   la salida y la subida.                                                             */

function setPhase(phase) {
  state.phase = phase;
  state.phaseTime = 0;
}

function startRace() {
  state.raceTime = 0;
  state.winner = null;
  // Cada carrera es distinta: velocidades y oscilaciones al azar
  const lead = Math.random() < 0.5 ? 0 : 1;
  cars.forEach((car, i) => {
    car.stage = 'race';
    car.s = PARK_S + car.grid;
    car.v = 0;
    car.vmax = CONFIG.baseSpeed * (i === lead ? rand(1.0, 1.05) : rand(0.95, 1.0));
    car.freq = rand(1.2, 2.4);
    car.phaseOff = rand(0, Math.PI * 2);
    car.group.visible = true;
    clearTrail(car);
  });
  setPhase('racing');
}

// Oscurece el coche según lo hundido que esté en la caja (el mismo fundido que la pista)
function shadeCar(car) {
  const p = car.group.position;
  const light = boxFade(p.x, p.y, p.z);
  car.group.visible = light > 0.02;
  if (Math.abs(light - car.light) < 0.004) return light;
  car.light = light;
  for (const { m, color, emissive } of car.shades) {
    m.color.copy(color).multiplyScalar(light);
    m.emissiveIntensity = emissive * light;
  }
  return light;
}

function carEntersBox(car) {
  car.stage = 'inside';
  car.insideTime = 0;
  car.group.visible = false;
  clearTrail(car);
  if (!state.winner) state.winner = car;
  deliverGift();
  burstConfetti(state.winner === car ? 110 : 60);
  kick(springs.box, 3.2);
  kick(springs.lid, 4.5);
  springs.glow = 1;
}

// Sale de la caja en cuanto acaba su pausa, sin esperar al otro coche
function carExitsBox(car) {
  car.stage = 'return';
  car.s = S_OUT - 0.5;
  car.v = 2.5 + 3 * car.boostMix;
  car.vmax = CONFIG.climbSpeed * rand(0.95, 1.05);
  car.group.visible = false;
  clearTrail(car);
  kick(springs.box, 1.8);
  kick(springs.lid, 2.4);
  springs.glow = Math.max(springs.glow, 0.6);
  burstConfetti(25);
}

// Turbo: la mezcla sigue al pedal con suavidad, para que acelere y frene sin tirones
function updateBoost(car, dt) {
  const goal = car.boost ? 1 : 0;
  car.boostMix += (goal - car.boostMix) * Math.min(1, dt * CONFIG.boostEase);
  return 1 + CONFIG.boostGain * car.boostMix;
}

// Acerca la velocidad a la deseada: acelera con fuerza y frena suave al soltar el turbo
function approachSpeed(car, target, dt, accel) {
  if (car.v < target) car.v = Math.min(car.v + accel * dt, target);
  else car.v = Math.max(target, car.v - CONFIG.accel * 0.8 * dt);
}

// Coche parado en la parrilla, con el motor al ralentí
function idleOnGrid(car, i, rev) {
  car.group.visible = true;
  placeOnTrack(car.group, PARK_S + car.grid, car.lane, Math.abs(Math.sin(state.time * 48 + i * 1.7)) * rev);
}

function updateCars(dt) {
  const turbo = cars.map((car) => updateBoost(car, dt));

  if (state.phase === 'racing') {
    state.raceTime += dt;
    cars.forEach((car, i) => {
      const accel = CONFIG.accel * (1 + 1.5 * car.boostMix);

      if (car.stage === 'race') {
        const f0 = frameAt(car.s);
        const target = car.vmax * turbo[i] * (1 + 0.07 * Math.sin(state.raceTime * car.freq + car.phaseOff));
        approachSpeed(car, target, dt, accel);
        car.v += Math.max(0, -f0.t.y) * 7 * dt; // en las bajadas cogen velocidad
        car.s += car.v * dt;
        if (car.s >= S_IN) {
          carEntersBox(car);
          return;
        }
        const f = placeOnTrack(car.group, car.s, car.lane, 0);
        const light = shadeCar(car);
        for (const w of car.wheels) w.rotation.x += (car.v * dt) / 0.05;
        updateTrail(car, f, clamp(car.v / CONFIG.baseSpeed, 0, 1.4) * light);
      } else if (car.stage === 'inside') {
        // Pausa dentro de la caja; con turbo dura menos
        car.insideTime += dt * (1 + 2 * car.boostMix);
        if (car.insideTime >= CONFIG.insidePause) carExitsBox(car);
      } else if (car.stage === 'return') {
        // Sale de la caja, sube por la izquierda y frena en la parrilla
        const goal = TRACK_LEN + PARK_S + car.grid; // una vuelta completa después
        approachSpeed(car, car.vmax * turbo[i], dt, accel);
        const brake = clamp((goal - car.s) / 1.2, 0.25, 1);
        car.s = Math.min(goal, car.s + car.v * brake * dt);
        const f = placeOnTrack(car.group, car.s, car.lane, 0);
        const light = shadeCar(car); // sale de la oscuridad de la caja
        for (const w of car.wheels) w.rotation.x += (car.v * brake * dt) / 0.05;
        if (car.group.visible) updateTrail(car, f, clamp((car.v * brake) / CONFIG.baseSpeed, 0, 1.4) * 0.8 * light);
        if (car.s >= goal) {
          car.stage = 'grid';
          car.s = PARK_S + car.grid;
          clearTrail(car);
        }
      } else {
        idleOnGrid(car, i, 0.003); // espera al otro coche en la parrilla
      }
    });

    if (cars.every((c) => c.stage === 'grid')) {
      // Con el ratón encima el bucle no para; si no, se quedan en la parrilla esperando
      if (state.hover) startRace();
      else setPhase('parked');
    }
    return;
  }

  // parked / countdown: motores al ralentí, tiemblan más cuanto más cerca está la salida
  const rev = state.phase === 'countdown' ? 0.006 : state.hover ? 0.003 : 0.0012;
  cars.forEach((car, i) => {
    idleOnGrid(car, i, rev);
    car.tailMat.emissiveIntensity = state.phase === 'countdown' ? 1.2 : 0.6;
  });
}

function updatePhase(dt) {
  state.phaseTime += dt;
  const step = CONFIG.countdownStep;

  switch (state.phase) {
    case 'parked':
      setLights(0, false);
      setHint(state.hover ? 'Preparados…' : TOUCH_ONLY ? 'Toca el cartel y que empiece' : 'Pasa el ratón y que empiece');
      if (state.hover && state.phaseTime > CONFIG.relaunchPause) setPhase('countdown');
      break;

    case 'countdown': {
      if (!state.hover) {
        setPhase('parked');
        state.phaseTime = 99;
        break;
      }
      const reds = Math.min(3, Math.floor(state.phaseTime / step) + 1);
      setLights(reds, false);
      setHint(['Preparados…', 'Listos…', 'Listos…'][reds - 1]);
      if (state.phaseTime >= step * 3.4) startRace();
      break;
    }

    case 'racing': {
      setLights(0, state.raceTime < CONFIG.goHold);
      const returning = cars.some((c) => c.stage === 'return' || c.stage === 'grid');
      if (returning) setHint(state.hover ? 'Tu donación es un regalo' : 'Vuelta a la salida');
      else setHint(state.winner ? '¡Un regalo entregado!' : '¡Ya!');
      // Mientras haya algún coche dentro, la caja da saltitos
      if (cars.some((c) => c.stage === 'inside') && Math.random() < dt * 5) kick(springs.box, rand(0.6, 1.4));
      break;
    }
  }
}

/* ---------- Paralaje y animación de la escena ---------- */

function updateScene(dt) {
  const s = state.smooth;
  const follow = REDUCED_MOTION ? 0 : 1; // sin paralaje ni giro de cámara
  s.x = lerp(s.x, state.mouse.x * follow, 1 - Math.exp(-dt * 4));
  s.y = lerp(s.y, state.mouse.y * follow, 1 - Math.exp(-dt * 4));

  camera.position.set(CAM_BASE.x + s.x * 2.4, CAM_BASE.y - s.y * 1.4, CAM_BASE.z);
  camera.lookAt(CAM_LOOK);

  titleLayer.style.transform = `translate(${(-s.x * 14).toFixed(2)}px, ${(-s.y * 8).toFixed(2)}px)`;
  metaLayer.style.transform = `translate(${(-s.x * 6).toFixed(2)}px, ${(-s.y * 4).toFixed(2)}px)`;
  footLayer.style.transform = `translate(${(-s.x * 6).toFixed(2)}px, ${(-s.y * 4).toFixed(2)}px)`;
  sceneLayer.style.transform = `translate(${(s.x * 6).toFixed(2)}px, ${(s.y * 6).toFixed(2)}px)`;

  stepSpring(springs.box, dt);
  stepSpring(springs.lid, dt, 120, 7);
  const b = springs.box.x * (REDUCED_MOTION ? 0.3 : 1);
  boxGroup.scale.set(1 + b * 0.05, 1 - b * 0.08, 1 + b * 0.05);
  boxGroup.rotation.z = REDUCED_MOTION ? 0 : Math.sin(state.time * 31) * b * 0.02;

  const l = springs.lid.x;
  lidPivot.position.y = LID_BASE.y + Math.max(0, l) * 0.25;
  lidGroup.rotation.x = LID_BASE.tilt - l * 0.08;

  springs.glow = Math.max(0, springs.glow - dt * 1.4);
  boxGlow.intensity = 0.3 + springs.glow * 3.5 + Math.sin(state.time * 2) * 0.1;
}

/* ---------- Eventos ---------- */

function toPosterCoords(clientX, clientY) {
  const rect = poster.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / state.scale,
    y: (clientY - rect.top) / state.scale,
  };
}

function handlePosterEnter() {
  state.hover = true;
}

function handlePosterLeave() {
  state.hover = false;
  state.mouse.x = 0;
  state.mouse.y = 0;
}

function handlePosterMove(event) {
  const p = toPosterCoords(event.clientX, event.clientY);
  state.mouse.x = clamp(p.x / POSTER_W, 0, 1) * 2 - 1;
  state.mouse.y = clamp(p.y / POSTER_H, 0, 1) * 2 - 1;
}

/* Letras del titular: cada letra va en su propio <span> para que reaccione por separado */
const LETTER_COLORS = [COLORS.gold, COLORS.red, '#1fa8ff', '#3ee07a', '#ff7ab6', '#f7efe0'];

function splitTitleIntoLetters() {
  titleEl.setAttribute('aria-label', titleEl.textContent.replace(/\s+/g, ' ').trim());
  for (const line of titleEl.querySelectorAll('.title__line')) {
    const text = line.textContent;
    line.textContent = '';
    line.setAttribute('aria-hidden', 'true');
    for (const ch of text) {
      const span = document.createElement('span');
      if (ch === ' ') {
        span.className = 'char char--space';
      } else {
        span.className = 'char';
        span.textContent = ch;
        span.addEventListener('mouseenter', handleLetterEnter);
        span.addEventListener('mouseleave', handleLetterLeave);
      }
      line.appendChild(span);
    }
  }
}

/* Al pasar por encima, la letra salta, se ladea y cambia de color (distinto al de su línea) */
function handleLetterEnter(event) {
  const el = event.currentTarget;
  const own = getComputedStyle(el.parentElement).color;
  let color;
  do {
    color = LETTER_COLORS[Math.floor(Math.random() * LETTER_COLORS.length)];
  } while (new THREE.Color(color).getStyle() === own.replace(/\s/g, ''));
  const tilt = rand(-14, 14).toFixed(1);
  el.style.transform = `translateY(-0.16em) rotate(${tilt}deg) scale(1.12)`;
  el.style.color = color;
}

/* Al salir, vuelve a su sitio con un rebote (transición en CSS) y recupera su color */
function handleLetterLeave(event) {
  const el = event.currentTarget;
  el.style.transform = '';
  el.style.color = '';
}

/* Pedales de turbo: con el ratón encima se pisa el pedal (la placa 3D gira hacia el suelo
   en updatePedals) y el coche de ese color acelera; su cartela se ilumina con ese color */
function handleBoostEnter(event) {
  const zone = event.currentTarget;
  const car = cars.find((c) => c.boostZone === zone.id);
  if (car) car.boost = true;
  const color = getComputedStyle(zone).getPropertyValue('--boost-color').trim();
  zone.classList.add('is-active');
  // La cartela 3D brilla con el color del coche
  zone.querySelector('.pedal').style.filter = `drop-shadow(0 0 8px ${color}88) drop-shadow(0 0 18px ${color}55)`;
}

function handleBoostLeave(event) {
  const zone = event.currentTarget;
  const car = cars.find((c) => c.boostZone === zone.id);
  if (car) car.boost = false;
  zone.classList.remove('is-active');
  zone.querySelector('.pedal').style.filter = '';
}

/* Mensaje de sensibilización: al pasar el ratón crece y la frase se vuelve dorada */
function handleMessageEnter() {
  messageEl.style.transform = 'scale(1.08)';
  messageClaimEl.style.color = COLORS.gold;
}

function handleMessageLeave() {
  messageEl.style.transform = '';
  messageClaimEl.style.color = '';
}

/* Logos de las entidades: en reposo en blanco; al pasar el ratón recuperan su color
   (y los oscuros aparecen sobre una placa clara, data-chip) */
function handlePartnerEnter(event) {
  const el = event.currentTarget;
  el.style.filter = 'none';
  el.style.backgroundColor = el.dataset.chip || '';
  el.style.opacity = '1';
  el.style.transform = 'scale(1.15)';
}

function handlePartnerLeave(event) {
  const el = event.currentTarget;
  el.style.filter = '';
  el.style.backgroundColor = '';
  el.style.opacity = '';
  el.style.transform = '';
}

/* Cada coche que entra en la caja es un regalo entregado: sube el contador con un salto */
let giftPopTimer = 0;
function deliverGift() {
  state.gifts += 1;
  giftCountEl.textContent = String(state.gifts);
  giftCountEl.style.transform = 'scale(1.5)';
  clearTimeout(giftPopTimer);
  giftPopTimer = setTimeout(() => {
    giftCountEl.style.transform = '';
  }, 220);
}

poster.addEventListener('mouseenter', handlePosterEnter);
poster.addEventListener('mouseleave', handlePosterLeave);
poster.addEventListener('mousemove', handlePosterMove);
splitTitleIntoLetters();
for (const car of cars) {
  const zone = document.getElementById(car.boostZone);
  zone.addEventListener('mouseenter', handleBoostEnter);
  zone.addEventListener('mouseleave', handleBoostLeave);
}
messageEl.addEventListener('mouseenter', handleMessageEnter);
messageEl.addEventListener('mouseleave', handleMessageLeave);
for (const el of partnerEls) {
  el.addEventListener('mouseenter', handlePartnerEnter);
  el.addEventListener('mouseleave', handlePartnerLeave);
}
window.addEventListener('resize', fitPoster);

/* Pantallas táctiles: tocar el cartel da la salida (como mouseenter), arrastrar el dedo
   mueve la cámara (como mousemove) y mantener pulsado un pedal es el turbo. Si no se
   vuelve a tocar en un rato, la carrera termina como al sacar el ratón (mouseleave). */
const TOUCH_IDLE = 9000;
let touchIdleTimer = 0;

function handlePosterTouch(event) {
  const t = event.touches[0];
  if (!t) return;
  handlePosterEnter();
  handlePosterMove(t);
  clearTimeout(touchIdleTimer);
  touchIdleTimer = setTimeout(handlePosterLeave, TOUCH_IDLE);
}

function handlePedalTouchStart(event) {
  event.preventDefault(); // que no haga scroll ni simule clics
  handleBoostEnter(event);
  handlePosterTouch(event);
}

function handlePedalTouchEnd(event) {
  event.preventDefault();
  handleBoostLeave(event);
}

poster.addEventListener('touchstart', handlePosterTouch, { passive: true });
poster.addEventListener('touchmove', handlePosterTouch, { passive: true });
for (const car of cars) {
  const zone = document.getElementById(car.boostZone);
  zone.addEventListener('touchstart', handlePedalTouchStart, { passive: false });
  zone.addEventListener('touchend', handlePedalTouchEnd, { passive: false });
  zone.addEventListener('touchcancel', handlePedalTouchEnd, { passive: false });
}

/* ---------- Bucle ---------- */

const clock = new THREE.Clock();

function step(dt) {
  state.time += dt;
  updatePhase(dt);
  updateCars(dt);
  updateConfetti(dt);
  updateSnow(dt);
  updateScene(dt);
  updateXmasLights(state.time);
  updatePedals(dt);
}

function frame() {
  step(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

fitPoster();
updateCars(0);

// Atajo para pruebas: ?sim=3 simula 3 s de carrera con el ratón encima
const simMatch = location.search.match(/[?&]sim=([\d.]+)/);
if (simMatch) {
  state.hover = true;
  for (let t = 0; t < parseFloat(simMatch[1]); t += 1 / 60) step(1 / 60);
}

requestAnimationFrame(frame);
