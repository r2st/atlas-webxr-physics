import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const PARTICLE_COUNT = 1200;
const G = 7.675e-2; // scaled for visual effect
const SOFTENING = 0.5;
const DAMPING = 0.999;

let scene, camera, renderer, particles, clock;
let positions, velocities, colors, masses, charges;
let currentMode = 'gravity';
let controllers = [];
let controllerGrips = [];
let vrSession = null;
let stats = { meanVelocity: 0, totalEnergy: 0, fps: 0 };
let frameCount = 0;
let lastFpsTime = 0;

init();

function init() {
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);
  scene.fog = new THREE.FogExp2(0x0a0a0f, 0.015);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 2, 30);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.setAnimationLoop(animate);
  document.body.appendChild(renderer.domElement);

  setupVRButton();
  setupControllers();
  createParticles();
  createEnvironment();
  setupEventListeners();

  window.addEventListener('resize', onResize);
}

function setupVRButton() {
  const vrBtn = document.getElementById('vr-button');

  if ('xr' in navigator) {
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      if (supported) {
        vrBtn.textContent = 'ENTER VR';
        vrBtn.disabled = false;
        vrBtn.addEventListener('click', () => {
          if (!vrSession) {
            navigator.xr.requestSession('immersive-vr', {
              optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
            }).then(onSessionStarted);
          } else {
            vrSession.end();
          }
        });
      } else {
        vrBtn.textContent = 'VR NOT SUPPORTED';
        vrBtn.disabled = true;
      }
    });
  } else {
    vrBtn.textContent = 'WEBXR NOT AVAILABLE';
    vrBtn.disabled = true;
  }
}

function onSessionStarted(session) {
  vrSession = session;
  renderer.xr.setSession(session);
  document.getElementById('vr-button').textContent = 'EXIT VR';

  session.addEventListener('end', () => {
    vrSession = null;
    document.getElementById('vr-button').textContent = 'ENTER VR';
  });
}

function setupControllers() {
  const controllerModelFactory = new XRControllerModelFactory();

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('selectstart', onSelectStart);
    controller.addEventListener('selectend', onSelectEnd);
    controller.addEventListener('squeezestart', onSqueezeStart);
    controller.addEventListener('squeezeend', onSqueezeEnd);
    scene.add(controller);
    controllers.push(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(controllerModelFactory.createControllerModel(grip));
    scene.add(grip);
    controllerGrips.push(grip);

    // Ray visualization
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -5)
    ]);
    const material = new THREE.LineBasicMaterial({ color: 0xd4a826, transparent: true, opacity: 0.5 });
    const line = new THREE.Line(geometry, material);
    controller.add(line);
  }
}

let attractorActive = [false, false];
let repelActive = [false, false];

function onSelectStart(event) {
  const idx = controllers.indexOf(event.target);
  attractorActive[idx] = true;
}
function onSelectEnd(event) {
  const idx = controllers.indexOf(event.target);
  attractorActive[idx] = false;
}
function onSqueezeStart(event) {
  const idx = controllers.indexOf(event.target);
  repelActive[idx] = true;
}
function onSqueezeEnd(event) {
  const idx = controllers.indexOf(event.target);
  repelActive[idx] = false;
}

function createParticles() {
  positions = new Float32Array(PARTICLE_COUNT * 3);
  velocities = new Float32Array(PARTICLE_COUNT * 3);
  colors = new Float32Array(PARTICLE_COUNT * 3);
  masses = new Float32Array(PARTICLE_COUNT);
  charges = new Float32Array(PARTICLE_COUNT);

  resetParticles('gravity');

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const sprite = createGlowTexture();

  const material = new THREE.PointsMaterial({
    size: 0.4,
    map: sprite,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
  });

  particles = new THREE.Points(geometry, material);
  scene.add(particles);
}

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.15, 'rgba(255, 220, 100, 0.8)');
  gradient.addColorStop(0.4, 'rgba(255, 160, 50, 0.4)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

function resetParticles(mode) {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    masses[i] = 0.5 + Math.random() * 1.5;
    charges[i] = Math.random() > 0.5 ? 1 : -1;

    switch (mode) {
      case 'gravity':
        // Disk distribution
        const angle = Math.random() * Math.PI * 2;
        const radius = 2 + Math.random() * 12;
        positions[i3] = Math.cos(angle) * radius;
        positions[i3 + 1] = (Math.random() - 0.5) * 2;
        positions[i3 + 2] = Math.sin(angle) * radius;
        // Orbital velocity
        const speed = Math.sqrt(G * 100 / radius) * 0.3;
        velocities[i3] = -Math.sin(angle) * speed;
        velocities[i3 + 1] = (Math.random() - 0.5) * 0.1;
        velocities[i3 + 2] = Math.cos(angle) * speed;
        break;

      case 'electromagnetism':
        positions[i3] = (Math.random() - 0.5) * 20;
        positions[i3 + 1] = (Math.random() - 0.5) * 20;
        positions[i3 + 2] = (Math.random() - 0.5) * 20;
        velocities[i3] = (Math.random() - 0.5) * 0.5;
        velocities[i3 + 1] = (Math.random() - 0.5) * 0.5;
        velocities[i3 + 2] = (Math.random() - 0.5) * 0.5;
        break;

      case 'fluid':
        // Cube of fluid
        const side = Math.cbrt(PARTICLE_COUNT);
        const xi = (i % side) / side - 0.5;
        const yi = (Math.floor(i / side) % side) / side - 0.5;
        const zi = Math.floor(i / (side * side)) / side - 0.5;
        positions[i3] = xi * 15;
        positions[i3 + 1] = yi * 15 + 5;
        positions[i3 + 2] = zi * 15;
        velocities[i3] = 0;
        velocities[i3 + 1] = 0;
        velocities[i3 + 2] = 0;
        break;

      case 'quantum':
        // Orbital cloud distribution
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(2 * Math.random() - 1);
        const r = 3 + Math.random() * 10 * Math.pow(Math.random(), 0.5);
        positions[i3] = r * Math.sin(theta) * Math.cos(phi);
        positions[i3 + 1] = r * Math.sin(theta) * Math.sin(phi);
        positions[i3 + 2] = r * Math.cos(theta);
        // Quantum jitter
        velocities[i3] = (Math.random() - 0.5) * 2;
        velocities[i3 + 1] = (Math.random() - 0.5) * 2;
        velocities[i3 + 2] = (Math.random() - 0.5) * 2;
        break;
    }

    updateParticleColor(i, mode);
  }
}

function updateParticleColor(i, mode) {
  const i3 = i * 3;
  const speed = Math.sqrt(
    velocities[i3] ** 2 + velocities[i3 + 1] ** 2 + velocities[i3 + 2] ** 2
  );

  switch (mode) {
    case 'gravity': {
      // Amber to white based on speed
      const t = Math.min(speed / 3, 1);
      colors[i3] = 0.83 + t * 0.17;
      colors[i3 + 1] = 0.55 + t * 0.45;
      colors[i3 + 2] = 0.1 + t * 0.9;
      break;
    }
    case 'electromagnetism': {
      // Red for positive, blue for negative
      if (charges[i] > 0) {
        colors[i3] = 1.0;
        colors[i3 + 1] = 0.2 + speed * 0.1;
        colors[i3 + 2] = 0.1;
      } else {
        colors[i3] = 0.1;
        colors[i3 + 1] = 0.3 + speed * 0.1;
        colors[i3 + 2] = 1.0;
      }
      break;
    }
    case 'fluid': {
      // Cyan to white
      const t = Math.min(speed / 2, 1);
      colors[i3] = 0.1 + t * 0.9;
      colors[i3 + 1] = 0.6 + t * 0.4;
      colors[i3 + 2] = 0.9 + t * 0.1;
      break;
    }
    case 'quantum': {
      // Purple/magenta shifting
      const phase = (performance.now() * 0.001 + i * 0.1) % (Math.PI * 2);
      colors[i3] = 0.5 + Math.sin(phase) * 0.3;
      colors[i3 + 1] = 0.1 + Math.cos(phase * 1.3) * 0.15;
      colors[i3 + 2] = 0.8 + Math.sin(phase * 0.7) * 0.2;
      break;
    }
  }
}

function applyPreset(preset) {
  currentMode = 'gravity';
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-mode="gravity"]').classList.add('active');

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;

    switch (preset) {
      case 'singularity': {
        // All particles converging toward center
        const angle = Math.random() * Math.PI * 2;
        const elev = (Math.random() - 0.5) * Math.PI;
        const r = 15 + Math.random() * 5;
        positions[i3] = Math.cos(angle) * Math.cos(elev) * r;
        positions[i3 + 1] = Math.sin(elev) * r;
        positions[i3 + 2] = Math.sin(angle) * Math.cos(elev) * r;
        const inward = 0.8;
        velocities[i3] = -positions[i3] * inward / r;
        velocities[i3 + 1] = -positions[i3 + 1] * inward / r;
        velocities[i3 + 2] = -positions[i3 + 2] * inward / r;
        break;
      }
      case 'binary': {
        // Two clumps orbiting each other
        const clump = i < PARTICLE_COUNT / 2 ? -1 : 1;
        const cx = clump * 6;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.random() * 3;
        positions[i3] = cx + Math.cos(a) * rad;
        positions[i3 + 1] = (Math.random() - 0.5) * 2;
        positions[i3 + 2] = Math.sin(a) * rad;
        velocities[i3] = 0;
        velocities[i3 + 1] = clump * 0.8;
        velocities[i3 + 2] = clump * 0.3;
        break;
      }
      case 'lagrange': {
        // Ring with 5 Lagrange clusters
        const lIdx = i % 5;
        const baseAngle = (lIdx / 5) * Math.PI * 2;
        const spread = 0.3;
        const a = baseAngle + (Math.random() - 0.5) * spread;
        const r = 10 + (Math.random() - 0.5) * 2;
        positions[i3] = Math.cos(a) * r;
        positions[i3 + 1] = (Math.random() - 0.5) * 1;
        positions[i3 + 2] = Math.sin(a) * r;
        const orbSpeed = 0.4;
        velocities[i3] = -Math.sin(a) * orbSpeed;
        velocities[i3 + 1] = 0;
        velocities[i3 + 2] = Math.cos(a) * orbSpeed;
        break;
      }
    }

    updateParticleColor(i, 'gravity');
  }

  document.getElementById('hud-mode').textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
}

function createEnvironment() {
  // Ambient light
  const ambient = new THREE.AmbientLight(0x222222);
  scene.add(ambient);

  // Central glow
  const glowGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xd4a826,
    transparent: true,
    opacity: 0.3,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  scene.add(glow);

  // Grid floor (subtle)
  const gridHelper = new THREE.GridHelper(60, 30, 0x1a1a2e, 0x0d0d1a);
  gridHelper.position.y = -10;
  scene.add(gridHelper);

  // Starfield background
  const starGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(3000 * 3);
  for (let i = 0; i < 3000; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 400;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 400;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 400;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    size: 0.15,
    color: 0x444466,
    transparent: true,
    opacity: 0.6,
  });
  scene.add(new THREE.Points(starGeo, starMat));
}

function updatePhysics(dt) {
  dt = Math.min(dt, 0.05);
  let totalVel = 0;
  let totalE = 0;

  // VR controller interaction
  const controllerPositions = [];
  for (let c = 0; c < 2; c++) {
    if (attractorActive[c] || repelActive[c]) {
      const pos = new THREE.Vector3();
      controllers[c].getWorldPosition(pos);
      controllerPositions.push({
        x: pos.x, y: pos.y, z: pos.z,
        attract: attractorActive[c],
        repel: repelActive[c]
      });
    }
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    let ax = 0, ay = 0, az = 0;

    switch (currentMode) {
      case 'gravity': {
        // Central attractor
        const dx = -positions[i3];
        const dy = -positions[i3 + 1];
        const dz = -positions[i3 + 2];
        const distSq = dx * dx + dy * dy + dz * dz + SOFTENING;
        const dist = Math.sqrt(distSq);
        const force = G * 50 / distSq;
        ax += dx / dist * force;
        ay += dy / dist * force;
        az += dz / dist * force;

        // N-body sampling (interact with every 20th particle for perf)
        for (let j = (i + 7) % 20; j < PARTICLE_COUNT; j += 20) {
          if (j === i) continue;
          const j3 = j * 3;
          const ddx = positions[j3] - positions[i3];
          const ddy = positions[j3 + 1] - positions[i3 + 1];
          const ddz = positions[j3 + 2] - positions[i3 + 2];
          const dd = ddx * ddx + ddy * ddy + ddz * ddz + SOFTENING;
          const d = Math.sqrt(dd);
          const f = G * masses[j] / dd * 0.1;
          ax += ddx / d * f;
          ay += ddy / d * f;
          az += ddz / d * f;
        }
        break;
      }
      case 'electromagnetism': {
        // Lorentz-like force with sampled neighbors
        for (let j = (i + 3) % 10; j < PARTICLE_COUNT; j += 10) {
          if (j === i) continue;
          const j3 = j * 3;
          const dx = positions[j3] - positions[i3];
          const dy = positions[j3 + 1] - positions[i3 + 1];
          const dz = positions[j3 + 2] - positions[i3 + 2];
          const distSq = dx * dx + dy * dy + dz * dz + SOFTENING;
          const dist = Math.sqrt(distSq);
          // Opposite charges attract, same repel
          const sign = -charges[i] * charges[j];
          const f = sign * 0.05 / distSq;
          ax += dx / dist * f;
          ay += dy / dist * f;
          az += dz / dist * f;
        }
        // Magnetic-like rotation
        ax += velocities[i3 + 2] * charges[i] * 0.02;
        az -= velocities[i3] * charges[i] * 0.02;
        break;
      }
      case 'fluid': {
        // SPH-like pressure and viscosity
        const restDensity = 1.0;
        const pressure = 0.5;
        const viscosity = 0.1;
        const gravY = -2.0;
        ay += gravY;

        for (let j = (i + 1) % 8; j < PARTICLE_COUNT; j += 8) {
          if (j === i) continue;
          const j3 = j * 3;
          const dx = positions[j3] - positions[i3];
          const dy = positions[j3 + 1] - positions[i3 + 1];
          const dz = positions[j3 + 2] - positions[i3 + 2];
          const distSq = dx * dx + dy * dy + dz * dz;
          const h = 2.0; // smoothing radius
          if (distSq < h * h && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            const q = 1 - dist / h;
            // Pressure
            const pForce = -pressure * q * q / dist;
            ax += dx * pForce;
            ay += dy * pForce;
            az += dz * pForce;
            // Viscosity
            const vx = velocities[j3] - velocities[i3];
            const vy = velocities[j3 + 1] - velocities[i3 + 1];
            const vz = velocities[j3 + 2] - velocities[i3 + 2];
            ax += vx * viscosity * q;
            ay += vy * viscosity * q;
            az += vz * viscosity * q;
          }
        }

        // Floor collision
        if (positions[i3 + 1] < -8) {
          positions[i3 + 1] = -8;
          velocities[i3 + 1] *= -0.5;
        }
        // Wall boundaries
        for (let d = 0; d < 3; d += 2) {
          if (Math.abs(positions[i3 + d]) > 12) {
            positions[i3 + d] = Math.sign(positions[i3 + d]) * 12;
            velocities[i3 + d] *= -0.5;
          }
        }
        break;
      }
      case 'quantum': {
        // Probability cloud with tunneling
        const dist = Math.sqrt(positions[i3] ** 2 + positions[i3 + 1] ** 2 + positions[i3 + 2] ** 2);
        // Harmonic potential
        const k = 0.02;
        ax -= positions[i3] * k;
        ay -= positions[i3 + 1] * k;
        az -= positions[i3 + 2] * k;
        // Quantum jitter (Heisenberg-like uncertainty)
        ax += (Math.random() - 0.5) * 0.8;
        ay += (Math.random() - 0.5) * 0.8;
        az += (Math.random() - 0.5) * 0.8;
        // Tunneling events
        if (Math.random() < 0.001) {
          const newR = 3 + Math.random() * 10;
          const phi = Math.random() * Math.PI * 2;
          const theta = Math.acos(2 * Math.random() - 1);
          positions[i3] = newR * Math.sin(theta) * Math.cos(phi);
          positions[i3 + 1] = newR * Math.sin(theta) * Math.sin(phi);
          positions[i3 + 2] = newR * Math.cos(theta);
        }
        break;
      }
    }

    // VR controller forces
    for (const cp of controllerPositions) {
      const dx = cp.x - positions[i3];
      const dy = cp.y - positions[i3 + 1];
      const dz = cp.z - positions[i3 + 2];
      const distSq = dx * dx + dy * dy + dz * dz + SOFTENING;
      const dist = Math.sqrt(distSq);
      const strength = 5.0 / distSq;
      const dir = cp.attract ? 1 : -1;
      ax += dx / dist * strength * dir;
      ay += dy / dist * strength * dir;
      az += dz / dist * strength * dir;
    }

    velocities[i3] = (velocities[i3] + ax * dt) * DAMPING;
    velocities[i3 + 1] = (velocities[i3 + 1] + ay * dt) * DAMPING;
    velocities[i3 + 2] = (velocities[i3 + 2] + az * dt) * DAMPING;

    positions[i3] += velocities[i3] * dt;
    positions[i3 + 1] += velocities[i3 + 1] * dt;
    positions[i3 + 2] += velocities[i3 + 2] * dt;

    updateParticleColor(i, currentMode);

    const v = Math.sqrt(velocities[i3] ** 2 + velocities[i3 + 1] ** 2 + velocities[i3 + 2] ** 2);
    totalVel += v;
    totalE += 0.5 * masses[i] * v * v;
  }

  stats.meanVelocity = totalVel / PARTICLE_COUNT;
  stats.totalEnergy = totalE;

  particles.geometry.attributes.position.needsUpdate = true;
  particles.geometry.attributes.color.needsUpdate = true;
}

function animate() {
  const dt = clock.getDelta();

  updatePhysics(dt);

  // Camera auto-orbit in non-VR mode
  if (!renderer.xr.isPresenting) {
    const t = performance.now() * 0.0001;
    camera.position.x = Math.sin(t) * 30;
    camera.position.z = Math.cos(t) * 30;
    camera.position.y = 5 + Math.sin(t * 0.5) * 3;
    camera.lookAt(0, 0, 0);
  }

  renderer.render(scene, camera);

  // FPS counter
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    stats.fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
    frameCount = 0;
    lastFpsTime = now;
    updateHUD();
  }
}

function updateHUD() {
  const velEl = document.getElementById('hud-vel');
  const energyEl = document.getElementById('hud-energy');
  const fpsEl = document.getElementById('hud-fps');
  if (velEl) velEl.textContent = stats.meanVelocity.toFixed(2);
  if (energyEl) energyEl.textContent = stats.totalEnergy.toFixed(2);
  if (fpsEl) fpsEl.textContent = stats.fps;
}

function setupEventListeners() {
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      resetParticles(currentMode);
      document.getElementById('hud-mode').textContent =
        currentMode.charAt(0).toUpperCase() + currentMode.slice(1);
    });
  });

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyPreset(btn.dataset.preset);
    });
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
