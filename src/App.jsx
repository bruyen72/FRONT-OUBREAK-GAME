import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import Galaxy from './Galaxy';
const WORLD = 3000;
const FPS = 60;
const FIXED_STEP = 1 / FPS;
const NUM_BOTS = 45;
const NUM_FOOD = 450;
const FOOD_MASS_GAIN = 0.2;
const PLAYER_ABSORB_MULT = 0.35;
const BOT_ABSORB_MULT = 0.3;
const MIN_CAMERA_ZOOM = 0.22;
const MAX_CAMERA_ZOOM = 1.2;
const MOBILE_LAYOUT_BREAKPOINT = 980;
const normalizeSocketUrl = (url) => String(url || '').trim().replace(/\/+$/, '');
const socketEnvUrl = normalizeSocketUrl(import.meta.env.VITE_SOCKET_URL);
const SOCKET_URL = socketEnvUrl || (import.meta.env.DEV ? 'http://localhost:3000' : '');
const PLAY_MODES = {
  OFFLINE: 'offline',
  ONLINE: 'online',
  ONLINE_BOTS: 'online_bots',
};
const TITLE_FONT_FAMILY = "'Arial Black', Impact, sans-serif";
const UI_FONT_FAMILY = 'Consolas, Monaco, "Courier New", monospace';

const BOT_NAMES = ['Relampago', 'Sombra', 'Fenix', 'Fantasma', 'Tornado', 'Estrela', 'Trovoada', 'Aguia'];
const BOT_COLORS = [
  [[255, 51, 102], [255, 102, 153]],
  [[255, 120, 0], [255, 199, 51]],
  [[255, 219, 0], [255, 255, 102]],
  [[51, 255, 153], [0, 204, 102]],
  [[0, 199, 255], [0, 102, 255]],
  [[199, 0, 255], [255, 0, 199]],
  [[255, 0, 153], [255, 102, 204]],
  [[153, 255, 0], [102, 199, 0]],
];

const FOOD_COLORS = [
  [255, 51, 102], [255, 120, 0], [255, 219, 0], [51, 255, 153], [0, 199, 255],
  [199, 0, 255], [0, 255, 199], [255, 0, 153], [153, 255, 0], [0, 153, 255],
];

const PLAYER_SKINS = [
  { name: 'Normal', c1: [0, 255, 179], c2: [0, 171, 255] },
  { name: 'Estrela', c1: [255, 204, 0], c2: [255, 102, 0] },
  { name: 'Fogo', c1: [255, 51, 0], c2: [204, 0, 0] },
  { name: 'Gelo', c1: [0, 204, 255], c2: [0, 102, 204] },
  { name: 'Eletrico', c1: [153, 0, 255], c2: [77, 0, 153] },
  { name: 'Nebula', c1: [108, 184, 255], c2: [45, 78, 176], imagePath: '/skins/nebula.svg' },
  { name: 'Circuit', c1: [93, 255, 188], c2: [12, 110, 95], imagePath: '/skins/circuit.svg' },
  { name: 'Inferno', c1: [255, 145, 62], c2: [170, 36, 12], imagePath: '/skins/inferno.svg' },
  { name: 'Gear', c1: [190, 216, 255], c2: [86, 122, 192], imagePath: '/skins/gear.png' },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const randomFloat = (min, max) => Math.random() * (max - min) + min;
const randomInt = (min, max) => Math.floor(randomFloat(min, max + 1));
const massToRadius = (m) => 35 * Math.pow(m, 0.55);
const radiusToMass = (r) => Math.pow(Math.max(1, r) / 35, 1 / 0.55);
const WORLD_EDGE_MARGIN = 20;
const MAX_CELL_RADIUS = WORLD * 0.5 - WORLD_EDGE_MARGIN;
const MAX_CELL_MASS = radiusToMass(MAX_CELL_RADIUS);
const clampCellRadius = (radius) => clamp(Number.isFinite(radius) ? radius : 8, 8, MAX_CELL_RADIUS);
const clampCellMass = (mass) => clamp(Number.isFinite(mass) ? mass : 1, 1, MAX_CELL_MASS);
const firstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};
const toNumberOr = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};
const normalizeColorArray = (input, fallback = [255, 255, 255]) => {
  if (Array.isArray(input) && input.length >= 3) {
    return [
      toNumberOr(input[0], fallback[0]),
      toNumberOr(input[1], fallback[1]),
      toNumberOr(input[2], fallback[2]),
    ];
  }
  return [fallback[0], fallback[1], fallback[2]];
};
const toEntityArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
};
const colorToCss = (c, a = 1) => {
  const [r, g, b] = normalizeColorArray(c);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
};
const blendColors = (from, to, t = 0.5) => {
  const c1 = normalizeColorArray(from);
  const c2 = normalizeColorArray(to);
  return [
    lerp(c1[0], c2[0], t),
    lerp(c1[1], c2[1], t),
    lerp(c1[2], c2[2], t),
  ];
};
const lerp = (a, b, t) => a + (b - a) * t;

class Camera {
  constructor() { this.x = WORLD / 2; this.y = WORLD / 2; this.zoom = 1; }
  update(tx, ty, tz) { this.x += (tx - this.x) * 0.08; this.y += (ty - this.y) * 0.08; this.zoom += (tz - this.zoom) * 0.05; }
}

class Food {
  constructor() {
    this.x = randomFloat(50, WORLD - 50);
    this.y = randomFloat(50, WORLD - 50);
    this.r = randomFloat(5, 10);
    this.color = FOOD_COLORS[randomInt(0, FOOD_COLORS.length - 1)];
    this.pulse = randomFloat(0, Math.PI * 2);
  }
  update() { this.pulse += 0.05; }
}

class Particle {
  static GRAVITY = { 0: 0, 1: -0.08, 2: -0.18, 3: 0.12, 4: 0 };
  static SPIN = { 0: 0.05, 1: 0.18, 2: 0.04, 3: 0.22, 4: 0.35 };

  constructor(x, y, color, power, type = 0) {
    this.x = x; this.y = y; this.color = color; this.type = type;
    if (type === 5) {
      this.life = 1; this.decay = randomFloat(0.12, 0.25); this.size = 1; this.segs = [];
      let angle = randomFloat(0, Math.PI * 2);
      const length = randomFloat(30, 120);
      const forks = randomInt(1, 3);
      const segLen = length / (forks * 3);
      let cx = x; let cy = y;
      for (let i = 0; i < forks * 3; i += 1) {
        angle += randomFloat(-0.6, 0.6);
        const nx = cx + Math.cos(angle) * segLen;
        const ny = cy + Math.sin(angle) * segLen;
        this.segs.push([cx, cy, nx, ny]);
        cx = nx; cy = ny;
      }
      this.vx = 0; this.vy = 0; this.angle = 0; this.spin = 0; this.gravity = 0;
      return;
    }
    const a = randomFloat(0, Math.PI * 2);
    const s = randomFloat(1, power);
    this.vx = Math.cos(a) * s;
    this.vy = Math.sin(a) * s;
    this.life = 1;
    this.decay = randomFloat(0.012, 0.028);
    this.size = randomFloat(8, 22);
    this.angle = randomFloat(0, Math.PI * 2);
    this.spin = Particle.SPIN[type] * (Math.random() < 0.5 ? -1 : 1);
    this.gravity = Particle.GRAVITY[type] ?? 0;
  }

  update() {
    if (this.segs) { this.life -= this.decay; return; }
    this.x += this.vx; this.y += this.vy;
    this.vy += this.gravity;
    this.vx *= 0.92; this.vy *= 0.92;
    this.life -= this.decay; this.size *= 0.965;
    this.angle += this.spin;
  }

  alive() { return this.life > 0 && this.size > 0.5; }
}

class Shockwave {
  constructor(x, y, color, options = {}) {
    this.x = x;
    this.y = y;
    this.r = toNumberOr(options.startRadius, 0);
    this.color = normalizeColorArray(color);
    this.alpha = toNumberOr(options.alpha, 1);
    this.speed = toNumberOr(options.speed, 12);
    this.decay = toNumberOr(options.decay, 0.03);
    this.lineWidth = toNumberOr(options.lineWidth, 10);
    this.glow = toNumberOr(options.glow, 0.18);
  }

  update() { this.r += this.speed; this.alpha -= this.decay; }
  alive() { return this.alpha > 0; }
}

class Cell {
  constructor(x, y, mass, c1, c2, name, type = 0) {
    this.x = x; this.y = y;
    this.color1 = c1; this.color2 = c2; this.name = name;
    this.vx = 0; this.vy = 0; this.pulse = randomFloat(0, Math.PI * 2);
    this.score = 0; this.type = type;
    this.setMass(mass);
  }
  setMass(nextMass) {
    this.mass = clampCellMass(nextMass);
    this.r = clampCellRadius(massToRadius(this.mass));
  }
  grow(v) { this.setMass(this.mass + Math.max(0, v)); }
  shrink(v) { this.setMass(this.mass - Math.max(0, v)); }
}

class Bot extends Cell {
  constructor(i) {
    const [c1, c2] = BOT_COLORS[i % BOT_COLORS.length];
    const typePool = [0, 0, 0, 0, 1, 2, 3, 4];
    const bType = typePool[randomInt(0, typePool.length - 1)];
    const botName = `${BOT_NAMES[i % BOT_NAMES.length]}-${String(i + 1).padStart(2, '0')}`;
    super(randomFloat(100, WORLD - 100), randomFloat(100, WORLD - 100), 1, c1, c2, botName, bType);
    this.localId = `OFFLINE_BOT_${i}`;
    this.score = 0; this.tx = randomFloat(0, WORLD); this.ty = randomFloat(0, WORLD);
    this.retarget = 0; this.angle = randomFloat(0, Math.PI * 2);
  }

  update(player, foods, bots) {
    this.retarget -= 1;
    if (this.retarget <= 0) {
      this.retarget = randomInt(15, 30);
      const threats = []; const preys = [];
      if (dist(this.x, this.y, player.x, player.y) < 1000) {
        if (player.mass > this.mass * 1.1) threats.push(player);
        else if (this.mass > player.mass * 1.1) preys.push(player);
      }
      for (const b of bots) {
        if (b === this) continue;
        if (dist(this.x, this.y, b.x, b.y) < 1000) {
          if (b.mass > this.mass * 1.1) threats.push(b);
          else if (this.mass > b.mass * 1.1) preys.push(b);
        }
      }
      if (threats.length) {
        let nearest = threats[0];
        let nd = dist(this.x, this.y, nearest.x, nearest.y);
        for (let i = 1; i < threats.length; i += 1) {
          const d = dist(this.x, this.y, threats[i].x, threats[i].y);
          if (d < nd) { nd = d; nearest = threats[i]; }
        }
        const a = Math.atan2(this.y - nearest.y, this.x - nearest.x);
        this.tx = this.x + Math.cos(a) * 1000;
        this.ty = this.y + Math.sin(a) * 1000;
      } else if (preys.length) {
        let nearest = preys[0];
        let nd = dist(this.x, this.y, nearest.x, nearest.y);
        for (let i = 1; i < preys.length; i += 1) {
          const d = dist(this.x, this.y, preys[i].x, preys[i].y);
          if (d < nd) { nd = d; nearest = preys[i]; }
        }
        this.tx = nearest.x; this.ty = nearest.y;
      } else {
        let bf = null; let bd = Number.POSITIVE_INFINITY;
        for (const f of foods) {
          const d = dist(f.x, f.y, this.x, this.y);
          if (d < bd) { bd = d; bf = f; }
        }
        if (bf && bd < 1500) { this.tx = bf.x; this.ty = bf.y; }
        else { this.tx = randomFloat(100, WORLD - 100); this.ty = randomFloat(100, WORLD - 100); }
      }
      this.tx = clamp(this.tx, 50, WORLD - 50);
      this.ty = clamp(this.ty, 50, WORLD - 50);
    }

    this.angle = Math.atan2(this.ty - this.y, this.tx - this.x);
    const speed = 3.5 / Math.max(1, Math.pow(this.r / 25, 0.5));
    this.vx += Math.cos(this.angle) * speed * 0.25;
    this.vy += Math.sin(this.angle) * speed * 0.25;
    this.vx *= 0.85; this.vy *= 0.85;
    const wallR = Math.min(this.r, MAX_CELL_RADIUS);
    let nx = this.x + this.vx;
    let ny = this.y + this.vy;
    let hitWall = false;
    if (nx <= wallR) { nx = wallR; this.vx *= -1; hitWall = true; }
    else if (nx >= WORLD - wallR) { nx = WORLD - wallR; this.vx *= -1; hitWall = true; }
    if (ny <= wallR) { ny = wallR; this.vy *= -1; hitWall = true; }
    else if (ny >= WORLD - wallR) { ny = WORLD - wallR; this.vy *= -1; hitWall = true; }
    if (hitWall) {
      this.tx = WORLD / 2 + randomFloat(-500, 500);
      this.ty = WORLD / 2 + randomFloat(-500, 500);
      this.retarget = 15;
    }
    this.x = nx; this.y = ny;
  }

}
class Player extends Cell {
  constructor(name, skinType = 0) {
    const skin = PLAYER_SKINS[skinType] ?? PLAYER_SKINS[0];
    super(WORLD / 2, WORLD / 2, 1, skin.c1, skin.c2, name, skinType);
    this.trail = [];
    this.turbo = false;
  }

  update(wx, wy, sensitivity = 1) {
    this.pulse += 0.05;
    this.trail.push({ x: this.x, y: this.y, r: this.r, a: 1 });
    if (this.trail.length > 5) this.trail.shift();
    for (const t of this.trail) t.a -= 0.2;

    const sens = clamp(toNumberOr(sensitivity, 1), 0.55, 2.2);
    const sens01 = (sens - 0.55) / (2.2 - 0.55);
    const dx = wx - this.x;
    const dy = wy - this.y;
    const d = Math.hypot(dx, dy) + 0.001;

    let speed = 4.5 / Math.max(1, Math.pow(this.r / 25, 0.4));
    const accelMul = lerp(0.62, 1.95, sens01);
    const damping = lerp(0.9, 0.78, sens01);
    const stopRadius = this.r * lerp(0.52, 0.16, sens01);
    if (this.turbo && this.mass > 1.05) {
      speed *= 2.3;
      this.shrink(0.05);
    }

    if (d > stopRadius) {
      this.vx += (dx / d) * speed * 0.25 * accelMul;
      this.vy += (dy / d) * speed * 0.25 * accelMul;
    }

    this.vx *= damping;
    this.vy *= damping;
    const maxVel = speed * lerp(1.8, 3.4, sens01);
    const vel = Math.hypot(this.vx, this.vy);
    if (vel > maxVel) {
      const inv = maxVel / vel;
      this.vx *= inv;
      this.vy *= inv;
    }
    const wallR = Math.min(this.r, MAX_CELL_RADIUS);
    this.x = clamp(this.x + this.vx, wallR, WORLD - wallR);
    this.y = clamp(this.y + this.vy, wallR, WORLD - wallR);
  }
}

class WebAgarGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.width = 1280;
    this.height = 720;
    this.lastTime = 0;
    this.accumulator = 0;
    this.running = false;
    this.raf = null;

    this.mouseX = this.width / 2;
    this.mouseY = this.height / 2;
    this.cam = new Camera();
    this.playerNick = 'VOCE';
    this.skinIdx = 0;
    // States: DASHBOARD, PLAYING, GAMEOVER, SPECTATING
    this.state = 'DASHBOARD';
    this.playMode = PLAY_MODES.OFFLINE;
    this.time = 0;
    this.player = new Player(this.playerNick, this.skinIdx);
    this.bots = [];
    this.foods = [];
    this.particles = [];
    this.shockwaves = [];
    this.shakeTimer = 0;
    this.shakeMax = 0;
    this.dashboardStars = this.buildDashboardStars();
    this.victoryPulse = 0;
    this.hoverInfo = { left: false, right: false, upload: false, byUrl: false, clearSkin: false, offline: false, online: false, onlineBots: false };
    this.socket = null;
    this.connectionStatus = '';
    this.remotePlayers = [];
    this.remoteBots = [];
    this.remoteFoods = [];
    this.onlineFxPrimed = false;
    this.mySocketId = '';
    this.qPressed = false;
    this.spectateTargetId = '';
    this.spectateTargetName = '';
    this.spectateLastSwitchTime = 0;
    this.spectateAutoSwitchSec = 4.5;
    this.pauseMenuOpen = false;
    this.soundEnabled = true;
    this.inputSensitivity = 1;
    this.lastFoodToneTime = 0;
    this.audioCtx = null;
    this.isMobile = typeof window !== 'undefined'
      && (('ontouchstart' in window) || ((typeof navigator !== 'undefined') && navigator.maxTouchPoints > 0));
    this.mobileTurboTouchId = null;
    this.mobileMoveTouchId = null;
    this.mobileMoveStick = {
      active: false,
      anchorX: 0,
      anchorY: 0,
      x: 0,
      y: 0,
      strength: 0,
    };
    this.customSkinImage = null;
    this.customSkinLabel = '';
    this.skinImageCache = new Map();
    this.dashboardTitleImage = null;
    this.dashboardTitleReady = false;
    this.skinFileInput = null;
    this.preloadSkinAssets();
    this.preloadDashboardTitleImage();

    this.onResize = this.onResize.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onWindowBlur = this.onWindowBlur.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.loop = this.loop.bind(this);
  }

  buildDashboardStars() {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const stars = [];
    for (let i = 0; i < 120; i += 1) {
      stars.push({
        x: Math.floor(rand() * 1920),
        y: Math.floor(rand() * 2160),
        speed: lerp(20, 80, rand()),
        size: lerp(0.5, 3, rand()),
        phase: lerp(1, 4, rand()),
      });
    }
    return stars;
  }

  preloadSkinAssets() {
    this.skinImageCache.clear();
    for (let i = 0; i < PLAYER_SKINS.length; i += 1) {
      const skin = PLAYER_SKINS[i];
      if (!skin.imagePath) continue;
      const image = new Image();
      image.decoding = 'async';
      image.src = skin.imagePath;
      this.skinImageCache.set(i, image);
    }
  }

  preloadDashboardTitleImage() {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      this.dashboardTitleReady = true;
    };
    image.onerror = () => {
      this.dashboardTitleReady = false;
    };
    image.src = '/branding/titulo.png';
    this.dashboardTitleImage = image;
  }

  ensureSkinFileInput() {
    if (this.skinFileInput) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0] ? input.files[0] : null;
      if (!file) return;
      this.loadCustomSkinFromFile(file);
      input.value = '';
    });
    document.body.appendChild(input);
    this.skinFileInput = input;
  }

  cleanupSkinFileInput() {
    if (!this.skinFileInput) return;
    this.skinFileInput.remove();
    this.skinFileInput = null;
  }

  openSkinFileDialog() {
    this.ensureSkinFileInput();
    if (this.skinFileInput) this.skinFileInput.click();
  }

  loadCustomSkinFromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Arquivo invalido para skin.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const source = typeof event.target?.result === 'string' ? event.target.result : '';
      if (!source) return;
      this.applyCustomSkinSource(source, file.name);
    };
    reader.readAsDataURL(file);
  }

  promptSkinUrl() {
    const raw = window.prompt('Cole URL da imagem da skin (http/https):', '');
    if (!raw) return;
    const url = raw.trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      alert('URL invalida.');
      return;
    }
    this.applyCustomSkinSource(url, 'URL');
  }

  applyCustomSkinSource(source, label = 'CUSTOM') {
    const img = new Image();
    if (/^https?:\/\//i.test(source)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.customSkinImage = img;
      this.customSkinLabel = label;
    };
    img.onerror = () => {
      alert('Nao foi possivel carregar esta imagem.');
    };
    img.src = source;
  }

  clearCustomSkin() {
    this.customSkinImage = null;
    this.customSkinLabel = '';
  }

  getSkinImageByIndex(skinIndex) {
    const clamped = clamp(Math.round(toNumberOr(skinIndex, 0)), 0, PLAYER_SKINS.length - 1);
    const image = this.skinImageCache.get(clamped);
    if (!image || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
    return image;
  }

  getCellSkinImage(cell, isPlayer = false) {
    if (isPlayer && this.customSkinImage && this.customSkinImage.complete && this.customSkinImage.naturalWidth > 0) {
      return this.customSkinImage;
    }
    const idx = firstDefined(cell?.skinId, cell?.type, 0);
    return this.getSkinImageByIndex(idx);
  }

  getSelectedSkinImage() {
    if (this.customSkinImage && this.customSkinImage.complete && this.customSkinImage.naturalWidth > 0) {
      return this.customSkinImage;
    }
    return this.getSkinImageByIndex(this.skinIdx);
  }

  initializeWorld() {
    this.bots = Array.from({ length: NUM_BOTS }, (_, i) => new Bot(i));
    this.foods = Array.from({ length: NUM_FOOD }, () => new Food());
    this.particles = [];
    this.shockwaves = [];
    this.shakeTimer = 0;
    this.shakeMax = 0;
  }

  disconnectSocket() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.connectionStatus = '';
    this.remotePlayers = [];
    this.remoteBots = [];
    this.remoteFoods = [];
    this.onlineFxPrimed = false;
    this.mySocketId = '';
    this.qPressed = false;
    this.player.turbo = false;
    this.pauseMenuOpen = false;
    this.mobileTurboTouchId = null;
    this.mobileMoveTouchId = null;
    this.resetMobileMoveStick();
  }

  isSameRemoteId(entity, socketId) {
    if (!entity || !socketId) return false;
    const sid = String(socketId);
    const ids = [entity.id, entity.socketId, entity.sid, entity.playerId]
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value));
    return ids.includes(sid);
  }

  normalizeIncomingEntity(entity, isBotFallback = false) {
    if (!entity || typeof entity !== 'object') return null;

    const rawId = firstDefined(entity.id, entity.socketId, entity.sid, entity.playerId, '');
    const id = String(rawId || '');
    const skinId = clamp(Math.round(toNumberOr(firstDefined(entity.skinId, entity.type, entity.skin), 0)), 0, PLAYER_SKINS.length - 1);
    const skin = PLAYER_SKINS[skinId] || PLAYER_SKINS[0];

    const rawMass = Math.max(1, toNumberOr(firstDefined(entity.mass, entity.m), 1));
    const massBase = clampCellMass(rawMass);
    const rawRadius = Math.max(8, toNumberOr(firstDefined(entity.r, entity.radius), massToRadius(massBase)));
    const radius = clampCellRadius(rawRadius);
    const safeRadius = Math.min(radius, MAX_CELL_RADIUS);
    const x = clamp(toNumberOr(firstDefined(entity.x, entity.posX, entity.px), WORLD / 2), safeRadius, WORLD - safeRadius);
    const y = clamp(toNumberOr(firstDefined(entity.y, entity.posY, entity.py), WORLD / 2), safeRadius, WORLD - safeRadius);

    const color1 = normalizeColorArray(firstDefined(entity.color1, entity.c1, entity.color), skin.c1);
    const color2 = normalizeColorArray(firstDefined(entity.color2, entity.c2, entity.color), skin.c2);
    const nameRaw = firstDefined(entity.name, entity.nick, entity.username, isBotFallback ? 'BOT' : 'Player');
    const finalName = typeof nameRaw === 'string' && nameRaw.trim().length > 0
      ? nameRaw.trim().slice(0, 16)
      : (isBotFallback ? 'BOT' : 'Player');

    return {
      id,
      socketId: String(firstDefined(entity.socketId, entity.sid, entity.playerId, id)),
      isBot: Boolean(firstDefined(entity.isBot, entity.bot, isBotFallback)),
      name: finalName,
      skinId,
      type: skinId,
      color1,
      color2,
      x,
      y,
      targetX: x, // for lerp
      targetY: y, // for lerp
      mass: clampCellMass(Math.max(massBase, radiusToMass(radius))),
      r: radius,
      pulse: toNumberOr(entity.pulse, this.time),
      score: Math.max(0, Math.round(toNumberOr(firstDefined(entity.score, entity.points), 0))),
      turbo: Boolean(entity.turbo),
    };
  }

  normalizeIncomingFood(food) {
    if (!food || typeof food !== 'object') return null;
    const x = toNumberOr(firstDefined(food.x, food.px), Number.NaN);
    const y = toNumberOr(firstDefined(food.y, food.py), Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const radius = Math.max(2, toNumberOr(firstDefined(food.r, food.radius, food.size), 6));
    const color = normalizeColorArray(firstDefined(food.color, food.c, food.rgb), FOOD_COLORS[0]);
    const idRaw = firstDefined(food.id, `${Math.round(x * 10)}_${Math.round(y * 10)}_${Math.round(radius * 10)}`);

    return {
      id: String(idRaw),
      x: clamp(x, radius, WORLD - radius),
      y: clamp(y, radius, WORLD - radius),
      r: radius,
      color,
      pulse: toNumberOr(food.pulse, this.time),
    };
  }

  applyOnlineVisualEffects(prevFoods, nextFoods, prevEntities, nextEntities, myId = '') {
    if (this.state !== 'PLAYING' || this.pauseMenuOpen) return;
    if (!Array.isArray(prevFoods) || !Array.isArray(nextFoods)) return;
    if (!Array.isArray(prevEntities) || !Array.isArray(nextEntities)) return;
    if (prevFoods.length === 0 && prevEntities.length === 0) return;

    const nextFoodIds = new Set(nextFoods.map((food) => String(food.id)));
    const maxFoodFx = 26;
    let foodFxCount = 0;
    for (const food of prevFoods) {
      if (foodFxCount >= maxFoodFx) break;
      if (!food || nextFoodIds.has(String(food.id))) continue;

      let eater = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const entity of nextEntities) {
        if (!entity) continue;
        const reach = Math.max(20, toNumberOr(entity.r, 20) * 1.08);
        const d = dist(food.x, food.y, entity.x, entity.y);
        if (d <= reach && d < bestDist) {
          bestDist = d;
          eater = entity;
        }
      }

      if (eater) this.foodBoom(food.x, food.y, food.color, eater.r);
      else this.spawnParticles(food.x, food.y, food.color, 2, 1.8, 1);
      foodFxCount += 1;
    }

    const nextEntityById = new Map(nextEntities.map((entity) => [String(entity.id), entity]));
    const removed = [];
    for (const entity of prevEntities) {
      if (!entity) continue;
      const id = String(entity.id);
      if (!id || nextEntityById.has(id)) continue;
      if (myId && id === myId && this.state !== 'PLAYING') continue;
      removed.push(entity);
    }

    if (removed.length > 0 && removed.length <= 8) {
      for (const entity of removed) {
        this.eatExplosion(
          entity.x,
          entity.y,
          normalizeColorArray(entity.color1, [220, 220, 255]),
          true,
          Number.isFinite(entity.type) ? entity.type : 0,
        );
      }
    }
  }

  resolveCurrentPlayer(socketId) {
    if (!Array.isArray(this.remotePlayers) || this.remotePlayers.length === 0) return null;

    if (socketId) {
      const bySocketId = this.remotePlayers.find((entity) => this.isSameRemoteId(entity, socketId));
      if (bySocketId) return bySocketId;
    }

    const sameName = this.remotePlayers.filter((entity) => entity.name === this.player.name);
    if (sameName.length === 1) return sameName[0];

    if (this.remotePlayers.length === 1) return this.remotePlayers[0];
    return null;
  }

  startOnlineMatch(mode) {
    if (!SOCKET_URL) {
      alert('Servidor online nao configurado. Defina VITE_SOCKET_URL no frontend (Vercel).');
      this.connectionStatus = '';
      this.state = 'DASHBOARD';
      this.playMode = PLAY_MODES.OFFLINE;
      return;
    }

    const finalName = this.playerNick.trim().length > 0 ? this.playerNick.trim() : 'Player';
    this.playMode = mode;
    this.state = 'PLAYING';
    this.player = new Player(finalName, this.skinIdx);
    this.killerName = '';
    this.qPressed = false;
    this.cam.x = WORLD / 2;
    this.cam.y = WORLD / 2;
    this.cam.zoom = 1;
    this.mouseX = this.width / 2;
    this.mouseY = this.height / 2;
    this.disconnectSocket();
    this.foods = [];
    this.bots = [];
    this.particles = [];
    this.shockwaves = [];
    this.connectionStatus = 'Conectando ao servidor...';
    this.onlineFxPrimed = false;
    this.spectateTargetId = '';
    this.spectateTargetName = '';
    this.spectateLastSwitchTime = this.time;
    this.pauseMenuOpen = false;
    this.mobileTurboTouchId = null;
    this.mobileMoveTouchId = null;
    this.resetMobileMoveStick();

    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    this.socket = socket;

    socket.on('connect', () => {
      socket.emit('join_game', { name: finalName, skinId: this.skinIdx, mode: this.playMode });
    });

    socket.on('game_init', (payload) => {
      this.mySocketId = payload?.id || socket.id;
      const initFoodsRaw = firstDefined(payload?.foods, payload?.f, []);
      this.remoteFoods = toEntityArray(initFoodsRaw)
        .map((food) => this.normalizeIncomingFood(food))
        .filter(Boolean);
      this.foods = this.remoteFoods;
      this.connectionStatus = '';
    });

    socket.on('state_update', (payload = {}) => {
      const prevFoods = Array.isArray(this.remoteFoods) ? [...this.remoteFoods] : [];
      const prevEntities = [
        ...(Array.isArray(this.remotePlayers) ? this.remotePlayers : []),
        ...(Array.isArray(this.remoteBots) ? this.remoteBots : []),
      ];
      const playersFromServer = toEntityArray(firstDefined(payload.players, payload.p));
      const botsFromServer = toEntityArray(firstDefined(payload.bots, payload.b));
      const foodsFromServer = firstDefined(payload.foods, payload.f);
      const eatenFromServer = toEntityArray(payload.eaten);

      // Map incoming entities (with targets)
      const incomingPlayers = playersFromServer
        .map((entity) => this.normalizeIncomingEntity(entity, false))
        .filter(Boolean);
      const incomingBots = botsFromServer
        .map((entity) => this.normalizeIncomingEntity(entity, true))
        .filter(Boolean);

      // Update targets of existing remote entities while preserving their current x,y
      const updateLerpTargets = (existingList, incomingList) => {
        return incomingList.map((inc) => {
          const existing = existingList.find((e) => e.id === inc.id);
          if (existing) {
            inc.x = existing.x;
            inc.y = existing.y;
          }
          return inc;
        });
      };

      this.remotePlayers = updateLerpTargets(this.remotePlayers, incomingPlayers);
      this.remoteBots = updateLerpTargets(this.remoteBots, incomingBots);

      if (foodsFromServer !== undefined) {
        this.remoteFoods = toEntityArray(foodsFromServer)
          .map((food) => this.normalizeIncomingFood(food))
          .filter(Boolean);
      } else if (eatenFromServer.length > 0 && this.remoteFoods.length > 0) {
        const eatenIds = new Set(eatenFromServer.map((entry) => {
          if (entry && typeof entry === 'object') return String(firstDefined(entry.id, entry.foodId, ''));
          return String(entry);
        }));
        this.remoteFoods = this.remoteFoods.filter((food) => !eatenIds.has(String(food.id)));
      }

      const currentSocketId = this.mySocketId || socket.id || '';
      if (this.onlineFxPrimed) {
        this.applyOnlineVisualEffects(
          prevFoods,
          this.remoteFoods,
          prevEntities,
          [...incomingPlayers, ...incomingBots],
          currentSocketId,
        );
      } else {
        this.onlineFxPrimed = true;
      }

      this.foods = this.remoteFoods;
      this.bots = [
        ...this.remoteBots,
        ...this.remotePlayers.filter((player) => !this.isSameRemoteId(player, currentSocketId)),
      ];
    });

    socket.on('connect_error', () => {
      alert(`Falha de conexao com o servidor online (${SOCKET_URL}). Verifique VITE_SOCKET_URL.`);
      this.disconnectSocket();
      this.state = 'DASHBOARD';
      this.playMode = PLAY_MODES.OFFLINE;
    });

    socket.on('death', (payload) => {
      this.killerName = payload?.killer || 'desconhecido';
      this.state = 'SPECTATING';
      this.connectionStatus = '';
      this.qPressed = false;
      this.player.turbo = false;
      this.spectateTargetId = '';
      this.spectateTargetName = '';
      this.spectateLastSwitchTime = this.time;
    });

    socket.on('disconnect', () => {
      if (['PLAYING', 'GAMEOVER', 'SPECTATING'].includes(this.state) && this.playMode !== PLAY_MODES.OFFLINE) {
        alert('Conexao com servidor encerrada.');
        this.disconnectSocket();
        this.state = 'DASHBOARD';
        this.playMode = PLAY_MODES.OFFLINE;
      }
    });
  }

  startMatch(mode) {
    if (mode === PLAY_MODES.OFFLINE) {
      const finalName = this.playerNick.trim().length > 0 ? this.playerNick.trim() : 'Player';
      this.playMode = PLAY_MODES.OFFLINE;
      this.state = 'PLAYING';
      this.player = new Player(finalName, this.skinIdx);
      this.killerName = '';
      this.qPressed = false;
      this.cam.x = WORLD / 2;
      this.cam.y = WORLD / 2;
      this.cam.zoom = 1;
      this.mouseX = this.width / 2;
      this.mouseY = this.height / 2;
      this.connectionStatus = '';
      this.onlineFxPrimed = false;
      this.spectateTargetId = '';
      this.spectateTargetName = '';
      this.spectateLastSwitchTime = this.time;
      this.pauseMenuOpen = false;
      this.mobileTurboTouchId = null;
      this.mobileMoveTouchId = null;
      this.resetMobileMoveStick();
      this.disconnectSocket();
      this.initializeWorld();
      return;
    }

    this.startOnlineMatch(mode);
  }

  setup() {
    this.onResize();
    this.initializeWorld();
    this.ensureSkinFileInput();
    this.isMobile = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
    window.addEventListener('resize', this.onResize);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('touchstart', this.onTouchStart, { passive: false });
    window.addEventListener('touchmove', this.onTouchMove, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.disconnectSocket();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('touchstart', this.onTouchStart, { passive: false });
    window.removeEventListener('touchmove', this.onTouchMove, { passive: false });
    window.removeEventListener('touchend', this.onTouchEnd, { passive: false });
    window.removeEventListener('touchcancel', this.onTouchEnd, { passive: false });
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.cleanupSkinFileInput();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  onResize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width || window.innerWidth));
    this.height = Math.max(1, Math.round(rect.height || window.innerHeight));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  clientToCanvas(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  updatePointerFromCanvas(canvasX, canvasY) {
    this.mouseX = clamp(toNumberOr(canvasX, this.width / 2), 0, this.width);
    this.mouseY = clamp(toNumberOr(canvasY, this.height / 2), 0, this.height);
  }

  updatePointerFromClient(clientX, clientY) {
    const p = this.clientToCanvas(toNumberOr(clientX, this.width / 2), toNumberOr(clientY, this.height / 2));
    this.updatePointerFromCanvas(p.x, p.y);
  }

  isCompactUi() {
    return this.isMobile || this.width <= MOBILE_LAYOUT_BREAKPOINT || this.height <= 760;
  }

  getViewportInsets() {
    const compact = this.isCompactUi();
    return {
      top: compact ? clamp(Math.round(this.height * 0.02), 10, 24) : 12,
      right: compact ? clamp(Math.round(this.width * 0.016), 10, 20) : 14,
      bottom: compact ? clamp(Math.round(this.height * 0.028), 14, 30) : 14,
      left: compact ? clamp(Math.round(this.width * 0.016), 10, 20) : 14,
    };
  }

  getMobileMovePad() {
    const insets = this.getViewportInsets();
    const diameter = clamp(Math.min(this.width, this.height) * 0.24, 116, 194);
    const margin = clamp(diameter * 0.24, 20, 40);
    const cx = insets.left + margin + diameter / 2;
    const cy = this.height - insets.bottom - margin - diameter / 2;
    return {
      x: cx - diameter / 2,
      y: cy - diameter / 2,
      w: diameter,
      h: diameter,
      cx,
      cy,
      r: diameter / 2,
      knobR: diameter * 0.28,
      maxTravel: diameter * 0.34,
    };
  }

  getMobileTurboButton() {
    const insets = this.getViewportInsets();
    const diameter = clamp(Math.min(this.width, this.height) * 0.18, 78, 118);
    const margin = clamp(diameter * 0.34, 24, 40);
    return {
      x: this.width - insets.right - margin - diameter,
      y: this.height - insets.bottom - margin - diameter,
      w: diameter,
      h: diameter,
      cx: this.width - insets.right - margin - diameter / 2,
      cy: this.height - insets.bottom - margin - diameter / 2,
      r: diameter / 2,
    };
  }

  getMobileMenuButton() {
    const insets = this.getViewportInsets();
    const size = clamp(Math.min(this.width, this.height) * 0.09, 48, 68);
    const margin = clamp(Math.round(size * 0.22), 10, 16);
    return {
      x: insets.left + margin,
      y: insets.top + margin,
      w: size,
      h: size,
    };
  }

  resetMobileMoveStick() {
    this.mobileMoveStick.active = false;
    this.mobileMoveStick.anchorX = 0;
    this.mobileMoveStick.anchorY = 0;
    this.mobileMoveStick.x = 0;
    this.mobileMoveStick.y = 0;
    this.mobileMoveStick.strength = 0;
  }

  beginMobileMoveStick(clientX, clientY) {
    const pad = this.getMobileMovePad();
    const anchorX = clamp(clientX, pad.cx - pad.r * 0.6, pad.cx + pad.r * 0.6);
    const anchorY = clamp(clientY, pad.cy - pad.r * 0.6, pad.cy + pad.r * 0.6);
    this.mobileMoveStick.active = true;
    this.mobileMoveStick.anchorX = anchorX;
    this.mobileMoveStick.anchorY = anchorY;
    this.mobileMoveStick.x = 0;
    this.mobileMoveStick.y = 0;
    this.mobileMoveStick.strength = 0;
  }

  updateMobileMoveStick(clientX, clientY) {
    if (!this.mobileMoveStick.active) return;
    const pad = this.getMobileMovePad();
    const dx = clientX - this.mobileMoveStick.anchorX;
    const dy = clientY - this.mobileMoveStick.anchorY;
    const length = Math.hypot(dx, dy);
    const maxTravel = Math.max(1, pad.maxTravel);
    const limited = Math.min(maxTravel, length);
    const inv = length > 0.001 ? 1 / length : 0;
    this.mobileMoveStick.x = dx * inv * (limited / maxTravel);
    this.mobileMoveStick.y = dy * inv * (limited / maxTravel);
    this.mobileMoveStick.strength = clamp(limited / maxTravel, 0, 1);
  }

  pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  pointInCircle(x, y, cx, cy, r) {
    return dist(x, y, cx, cy) <= r;
  }

  ensureAudioContext() {
    if (!this.soundEnabled) return null;
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  playTone(freq = 440, duration = 0.06, volume = 0.035, type = 'sine') {
    if (!this.soundEnabled) return;
    const audio = this.ensureAudioContext();
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    if (this.soundEnabled) this.playTone(740, 0.05, 0.02, 'triangle');
  }

  adjustSensitivity(delta) {
    this.inputSensitivity = clamp(this.inputSensitivity + delta, 0.55, 2.2);
  }

  closePauseMenu() {
    this.pauseMenuOpen = false;
    this.qPressed = false;
    this.player.turbo = false;
    this.mobileTurboTouchId = null;
    this.mobileMoveTouchId = null;
    this.resetMobileMoveStick();
  }

  openPauseMenu() {
    this.pauseMenuOpen = true;
    this.qPressed = false;
    this.player.turbo = false;
    this.mobileTurboTouchId = null;
    this.mobileMoveTouchId = null;
    this.resetMobileMoveStick();
    if (this.soundEnabled) this.playTone(520, 0.045, 0.018, 'triangle');
  }

  togglePauseMenu() {
    if (!(this.state === 'PLAYING' || this.state === 'SPECTATING')) return;
    if (this.pauseMenuOpen) this.closePauseMenu();
    else this.openPauseMenu();
  }

  getPauseMenuLayout() {
    const compact = this.isCompactUi();
    const panelW = compact
      ? clamp(Math.round(this.width * 0.9), 300, 520)
      : clamp(Math.round(this.width * 0.4), 360, 560);
    const panelH = compact
      ? clamp(Math.round(this.height * 0.8), 430, 720)
      : clamp(Math.round(this.height * 0.72), 440, 680);
    const panelX = Math.round((this.width - panelW) / 2);
    const panelY = Math.round((this.height - panelH) / 2);
    const hasWatch = this.state === 'PLAYING';
    const rowCount = hasWatch ? 5 : 4;
    const headerSpace = compact ? 110 : 98;
    const footerSpace = compact ? 22 : 28;
    const pad = compact ? 20 : 26;
    const btnX = panelX + pad;
    const btnW = panelW - pad * 2;
    const contentTop = panelY + headerSpace;
    const contentBottom = panelY + panelH - footerSpace;
    const availableH = Math.max(240, contentBottom - contentTop);
    const gap = compact
      ? clamp(Math.round(availableH * 0.046), 10, 16)
      : clamp(Math.round(availableH * 0.04), 10, 18);
    const btnH = compact
      ? clamp(Math.floor((availableH - gap * (rowCount - 1)) / rowCount), 46, 62)
      : clamp(Math.floor((availableH - gap * (rowCount - 1)) / rowCount), 44, 62);
    const startY = contentTop;

    const continueBtn = { x: btnX, y: startY, w: btnW, h: btnH };
    const watchBtn = hasWatch ? { x: btnX, y: startY + (btnH + gap), w: btnW, h: btnH } : null;
    const soundBtn = { x: btnX, y: startY + (btnH + gap) * (hasWatch ? 2 : 1), w: btnW, h: btnH };
    const sensY = startY + (btnH + gap) * (hasWatch ? 3 : 2);
    const sideBtnW = compact ? clamp(Math.round(btnW * 0.19), 58, 84) : clamp(Math.round(btnW * 0.15), 54, 76);
    const sensMinus = { x: btnX, y: sensY, w: sideBtnW, h: btnH };
    const sensPlus = { x: btnX + btnW - sideBtnW, y: sensY, w: sideBtnW, h: btnH };
    const exitBtn = { x: btnX, y: sensY + btnH + gap, w: btnW, h: btnH };
    const titleFont = compact ? clamp(Math.round(btnH * 0.56), 24, 30) : 30;
    const labelFont = compact ? clamp(Math.round(btnH * 0.34), 14, 18) : 16;
    const valueFont = compact ? clamp(Math.round(btnH * 0.42), 18, 22) : 20;
    const metaFont = compact ? 11 : 12;

    return {
      panelX, panelY, panelW, panelH,
      continueBtn, watchBtn, soundBtn, sensMinus, sensPlus, exitBtn,
      hasWatch, gap, btnH, compact, titleFont, labelFont, valueFont, metaFont,
    };
  }

  computePauseMenuHover(mx, my) {
    const layout = this.getPauseMenuLayout();
    return {
      continue: this.pointInRect(mx, my, layout.continueBtn),
      watch: layout.watchBtn ? this.pointInRect(mx, my, layout.watchBtn) : false,
      sound: this.pointInRect(mx, my, layout.soundBtn),
      sensMinus: this.pointInRect(mx, my, layout.sensMinus),
      sensPlus: this.pointInRect(mx, my, layout.sensPlus),
      exit: this.pointInRect(mx, my, layout.exitBtn),
    };
  }

  handlePauseMenuClick(mx, my) {
    const hit = this.computePauseMenuHover(mx, my);
    if (hit.continue) {
      this.closePauseMenu();
      return true;
    }
    if (hit.watch) {
      this.state = 'SPECTATING';
      this.spectateTargetId = '';
      this.spectateTargetName = '';
      this.spectateLastSwitchTime = this.time;
      this.closePauseMenu();
      return true;
    }
    if (hit.sound) {
      this.toggleSound();
      return true;
    }
    if (hit.sensMinus) {
      this.adjustSensitivity(-0.1);
      this.playTone(360, 0.04, 0.015, 'sine');
      return true;
    }
    if (hit.sensPlus) {
      this.adjustSensitivity(0.1);
      this.playTone(460, 0.04, 0.015, 'sine');
      return true;
    }
    if (hit.exit) {
      if (this.playMode !== PLAY_MODES.OFFLINE) this.disconnectSocket();
      this.state = 'DASHBOARD';
      this.playMode = PLAY_MODES.OFFLINE;
      this.spectateTargetId = '';
      this.spectateTargetName = '';
      this.closePauseMenu();
      return true;
    }
    return false;
  }

  onTouchStart(event) {
    if (!event.changedTouches || event.changedTouches.length === 0) return;
    this.ensureAudioContext();

    if (this.state === 'DASHBOARD' || this.pauseMenuOpen) {
      const touch = event.changedTouches[0];
      this.updatePointerFromClient(touch.clientX, touch.clientY);
      event.preventDefault();
      this.onMouseDown({ button: 0 });
      return;
    }

    if (!(this.state === 'PLAYING' || this.state === 'SPECTATING')) return;
    const menuButton = this.getMobileMenuButton();
    const turboBtn = this.getMobileTurboButton();

    for (let i = 0; i < event.changedTouches.length; i += 1) {
      const touch = event.changedTouches[i];
      const p = this.clientToCanvas(touch.clientX, touch.clientY);
      const x = p.x;
      const y = p.y;

      if (this.pointInRect(x, y, menuButton)) {
        event.preventDefault();
        this.togglePauseMenu();
        continue;
      }

      if (this.state === 'SPECTATING' && !this.pauseMenuOpen) {
        event.preventDefault();
        this.cycleSpectateTarget(x >= this.width / 2 ? 1 : -1);
        continue;
      }

      if (this.state === 'PLAYING' && !this.pauseMenuOpen && this.pointInCircle(x, y, turboBtn.cx, turboBtn.cy, turboBtn.r)) {
        event.preventDefault();
        this.mobileTurboTouchId = touch.identifier;
        this.qPressed = true;
        this.player.turbo = true;
      } else if (this.mobileMoveTouchId === null) {
        event.preventDefault();
        this.mobileMoveTouchId = touch.identifier;
        this.beginMobileMoveStick(x, y);
        this.updateMobileMoveStick(x, y);
        this.updatePointerFromCanvas(x, y);
      }
    }
  }

  onTouchMove(event) {
    if (!event.changedTouches || event.changedTouches.length === 0) return;
    for (let i = 0; i < event.changedTouches.length; i += 1) {
      const touch = event.changedTouches[i];
      if (touch.identifier === this.mobileMoveTouchId) {
        event.preventDefault();
        const p = this.clientToCanvas(touch.clientX, touch.clientY);
        this.updateMobileMoveStick(p.x, p.y);
        const pad = this.getMobileMovePad();
        this.updatePointerFromCanvas(
          this.mobileMoveStick.anchorX + this.mobileMoveStick.x * pad.maxTravel,
          this.mobileMoveStick.anchorY + this.mobileMoveStick.y * pad.maxTravel,
        );
        break;
      }
      if (touch.identifier === this.mobileTurboTouchId) event.preventDefault();
    }
  }

  onTouchEnd(event) {
    if (!event.changedTouches || event.changedTouches.length === 0) return;
    for (let i = 0; i < event.changedTouches.length; i += 1) {
      const touch = event.changedTouches[i];
      if (touch.identifier === this.mobileTurboTouchId) {
        this.mobileTurboTouchId = null;
        this.qPressed = false;
        this.player.turbo = false;
      }
      if (touch.identifier === this.mobileMoveTouchId) {
        this.mobileMoveTouchId = null;
        this.resetMobileMoveStick();
      }
    }
  }

  onMouseMove(event) {
    this.updatePointerFromClient(event.clientX, event.clientY);
  }

  onMouseDown(event) {
    if (event.button !== 0) return;
    this.updatePointerFromClient(event.clientX, event.clientY);
    this.ensureAudioContext();

    if ((this.state === 'PLAYING' || this.state === 'SPECTATING') && this.isMobile) {
      const menuButton = this.getMobileMenuButton();
      if (this.pointInRect(this.mouseX, this.mouseY, menuButton)) {
        this.togglePauseMenu();
        return;
      }
    }

    if (this.pauseMenuOpen && (this.state === 'PLAYING' || this.state === 'SPECTATING')) {
      this.handlePauseMenuClick(this.mouseX, this.mouseY);
      return;
    }

    if (this.state !== 'DASHBOARD') return;

    const {
      left, right, upload, byUrl, clearSkin, offline, online, onlineBots,
    } = this.computeDashboardHover(this.mouseX, this.mouseY);
    if (left) this.skinIdx = (this.skinIdx + PLAYER_SKINS.length - 1) % PLAYER_SKINS.length;
    if (right) this.skinIdx = (this.skinIdx + 1) % PLAYER_SKINS.length;
    if (upload) this.openSkinFileDialog();
    if (byUrl) this.promptSkinUrl();
    if (clearSkin) this.clearCustomSkin();
    if (offline) this.startMatch(PLAY_MODES.OFFLINE);
    if (online) this.startMatch(PLAY_MODES.ONLINE);
    if (onlineBots) this.startMatch(PLAY_MODES.ONLINE_BOTS);
  }

  handleGameOverClick() {
    const layout = this.getGameOverLayout();
    const cx = this.width / 2;
    const cy = layout.rowY;
    const btnW = layout.btnW;
    const btnH = layout.btnH;
    const gap = layout.gap;
    const startX = cx - btnW - gap / 2;
    const mx = this.mouseX;
    const my = this.mouseY;

    // Check "Assistir"
    if (mx >= startX && mx <= startX + btnW && my >= cy && my <= cy + btnH) {
      this.state = 'SPECTATING';
      return;
    }
    // Check "Sair"
    const sairX = cx + gap / 2;
    if (mx >= sairX && mx <= sairX + btnW && my >= cy && my <= cy + btnH) {
      this.disconnectSocket();
      this.state = 'DASHBOARD';
      this.playMode = PLAY_MODES.OFFLINE;
      return;
    }
  }

  getGameOverLayout() {
    const compact = this.isCompactUi();
    return {
      compact,
      btnW: compact ? clamp(Math.round(this.width * 0.38), 130, 180) : 200,
      btnH: compact ? clamp(Math.round(this.height * 0.064), 42, 52) : 50,
      gap: compact ? 12 : 20,
      rowY: this.height / 2 + (compact ? 32 : 40),
    };
  }

  handleSpectatingClick() {
    if (this.pauseMenuOpen) return;
    this.cycleSpectateTarget(this.mouseX >= this.width / 2 ? 1 : -1);
  }

  onWindowBlur() {
    this.qPressed = false;
    this.player.turbo = false;
    this.mobileTurboTouchId = null;
    this.mobileMoveTouchId = null;
    this.resetMobileMoveStick();
  }

  onVisibilityChange() {
    if (!document.hidden) return;
    this.qPressed = false;
    this.player.turbo = false;
    this.mobileTurboTouchId = null;
    this.mobileMoveTouchId = null;
    this.resetMobileMoveStick();
  }

  isTurboKey(event) {
    return event.code === 'KeyQ' || (typeof event.key === 'string' && event.key.toLowerCase() === 'q');
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      if (this.state === 'PLAYING' || this.state === 'SPECTATING') {
        this.togglePauseMenu();
        return;
      }
      if (this.state === 'GAMEOVER') {
        this.state = 'DASHBOARD';
        this.playMode = PLAY_MODES.OFFLINE;
      }
      return;
    }

    if (this.state === 'DASHBOARD') {
      const lowerKey = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      if (event.key === 'Backspace') {
        event.preventDefault();
        this.playerNick = this.playerNick.slice(0, -1);
        return;
      }
      if (event.key === 'Enter') {
        this.startMatch(PLAY_MODES.OFFLINE);
        return;
      }
      if (lowerKey === 'u') {
        this.openSkinFileDialog();
        return;
      }
      if (lowerKey === 'l') {
        this.promptSkinUrl();
        return;
      }
      if (lowerKey === 'c') {
        this.clearCustomSkin();
        return;
      }
      if (event.key.length === 1 && this.playerNick.length < 12) {
        if (/[ -~]/.test(event.key)) {
          if (this.playerNick === 'VOCE') this.playerNick = '';
          this.playerNick += event.key;
        }
      }
      return;
    }

    if (this.state === 'SPECTATING') {
      if (event.code === 'ArrowRight' || event.code === 'KeyD') {
        event.preventDefault();
        this.cycleSpectateTarget(1);
        return;
      }
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
        event.preventDefault();
        this.cycleSpectateTarget(-1);
        return;
      }
    }

    if (this.state === 'PLAYING' && !this.pauseMenuOpen && this.isTurboKey(event)) {
      if (event.repeat) return;
      this.qPressed = true;
      this.player.turbo = true;
    }
  }

  onKeyUp(event) {
    if (this.state === 'PLAYING' && this.isTurboKey(event)) {
      this.qPressed = false;
      this.player.turbo = false;
    }
  }

  worldToScreen(wx, wy) {
    return [(wx - this.cam.x) * this.cam.zoom + this.width / 2, (wy - this.cam.y) * this.cam.zoom + this.height / 2];
  }

  screenToWorld(sx, sy) {
    return [(sx - this.width / 2) / this.cam.zoom + this.cam.x, (sy - this.height / 2) / this.cam.zoom + this.cam.y];
  }

  getInputWorldTarget() {
    if (
      this.isMobile
      && this.state === 'PLAYING'
      && !this.pauseMenuOpen
      && this.mobileMoveTouchId !== null
      && this.mobileMoveStick.active
      && this.mobileMoveStick.strength > 0.02
    ) {
      const sens01 = (clamp(this.inputSensitivity, 0.55, 2.2) - 0.55) / (2.2 - 0.55);
      const reach = lerp(240, 760, sens01) * lerp(0.25, 1, this.mobileMoveStick.strength);
      return [
        this.player.x + this.mobileMoveStick.x * reach,
        this.player.y + this.mobileMoveStick.y * reach,
      ];
    }
    const [wx, wy] = this.screenToWorld(this.mouseX, this.mouseY);
    return [wx, wy];
  }

  getAdaptiveMinZoomForRadius(radius) {
    const safeRadius = Math.max(35, toNumberOr(radius, 35));
    const viewportMin = Math.max(320, Math.min(this.width, this.height));
    const fitZoom = (viewportMin * 0.36) / safeRadius;
    return clamp(fitZoom, 0.035, MIN_CAMERA_ZOOM);
  }

  spawnParticles(x, y, color, count, power, type = 0) {
    for (let i = 0; i < count; i += 1) this.particles.push(new Particle(x, y, color, power, type));
    if (this.particles.length > 150) this.particles = this.particles.slice(-150);
  }

  foodBoom(x, y, color, eaterRadius = 30) {
    const baseColor = normalizeColorArray(color, [120, 220, 255]);
    const brightColor = blendColors(baseColor, [255, 255, 255], 0.45);
    const warmColor = blendColors(baseColor, [255, 216, 120], 0.28);

    const burstCount = randomInt(7, 11);
    const burstStart = this.particles.length;
    this.spawnParticles(x, y, baseColor, burstCount, 3.8, 0);

    for (let i = burstStart; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      particle.size = randomFloat(6, 13);
      particle.decay = randomFloat(0.042, 0.072);
      particle.vx *= randomFloat(1.2, 1.9);
      particle.vy *= randomFloat(1.1, 1.85);
      particle.gravity = randomFloat(-0.04, 0.05);
    }

    const sparkleCount = randomInt(2, 4);
    const sparkleStart = this.particles.length;
    this.spawnParticles(x, y, brightColor, sparkleCount, 2.8, 4);
    for (let i = sparkleStart; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      particle.size = randomFloat(4, 8);
      particle.decay = randomFloat(0.05, 0.085);
      particle.vx *= randomFloat(1.05, 1.5);
      particle.vy *= randomFloat(1.05, 1.5);
    }

    const waveScale = clamp(eaterRadius / 52, 0.6, 1.35);
    this.shockwaves.push(new Shockwave(x, y, brightColor, {
      startRadius: Math.max(1, eaterRadius * 0.04),
      speed: 4.8 * waveScale,
      decay: 0.11,
      alpha: 0.7,
      lineWidth: 7,
      glow: 0.24,
    }));
    this.shockwaves.push(new Shockwave(x, y, warmColor, {
      startRadius: 0,
      speed: 3.1 * waveScale,
      decay: 0.14,
      alpha: 0.34,
      lineWidth: 4,
      glow: 0.14,
    }));

    if (this.soundEnabled && (this.time - this.lastFoodToneTime) > 0.04) {
      const pitch = 700 + randomFloat(-60, 130);
      this.playTone(pitch, 0.04, 0.02, 'triangle');
      this.lastFoodToneTime = this.time;
    }
  }

  eatExplosion(x, y, color, big = false, type = 0) {
    this.spawnParticles(x, y, color, big ? 60 : 5, big ? 18 : 5, type);
    this.shockwaves.push(new Shockwave(x, y, color));
    if (big) {
      this.shakeTimer = 20;
      this.shakeMax = 20;
      const sw2 = new Shockwave(x, y, [255, 255, 255]);
      sw2.alpha = 2;
      this.shockwaves.push(sw2);
    }
    if (big && this.soundEnabled) this.playTone(140, 0.11, 0.04, 'sawtooth');
  }

  triggerOfflineDefeat(killerName = 'INIMIGO') {
    this.qPressed = false;
    this.player.turbo = false;
    this.killerName = killerName;
    this.state = 'SPECTATING';
    this.spectateTargetId = '';
    this.spectateTargetName = '';
    this.spectateLastSwitchTime = this.time;
  }

  getEntityPower(entity) {
    const mass = Math.max(1, toNumberOr(entity?.mass, 1));
    const score = Math.max(0, toNumberOr(entity?.score, 0));
    return score * 1.4 + mass;
  }

  getSpectateId(entity, index = 0) {
    const rawId = firstDefined(entity?.id, entity?.socketId, entity?.sid, entity?.playerId, entity?.localId, '');
    const safeRaw = String(rawId ?? '').trim();
    if (safeRaw) return safeRaw;
    const safeName = typeof entity?.name === 'string' && entity.name.trim().length > 0 ? entity.name.trim().slice(0, 12) : 'BOT';
    return `fallback_${safeName}_${index}`;
  }

  getSpectateCandidates() {
    if (!Array.isArray(this.bots) || this.bots.length === 0) return [];
    return this.bots
      .map((entity, index) => ({
        entity,
        id: this.getSpectateId(entity, index),
        power: this.getEntityPower(entity),
      }))
      .filter((entry) => Number.isFinite(entry.entity?.x) && Number.isFinite(entry.entity?.y))
      .sort((a, b) => b.power - a.power);
  }

  cycleSpectateTarget(step = 1) {
    const candidates = this.getSpectateCandidates();
    if (candidates.length === 0) {
      this.spectateTargetId = '';
      this.spectateTargetName = '';
      return;
    }
    let index = candidates.findIndex((entry) => entry.id === this.spectateTargetId);
    if (index < 0) index = 0;
    const nextIndex = (index + step + candidates.length) % candidates.length;
    const next = candidates[nextIndex];
    this.spectateTargetId = next.id;
    this.spectateTargetName = String(next.entity?.name || `JOGADOR ${nextIndex + 1}`).trim().slice(0, 16);
    this.spectateLastSwitchTime = this.time;
  }

  getSpectateFocus(autoCycle = true) {
    const candidates = this.getSpectateCandidates();
    if (candidates.length === 0) {
      this.spectateTargetId = '';
      this.spectateTargetName = '';
      return { x: WORLD / 2, y: WORLD / 2, mass: 1 };
    }

    let currentIndex = candidates.findIndex((entry) => entry.id === this.spectateTargetId);
    if (currentIndex < 0) {
      currentIndex = 0;
      this.spectateLastSwitchTime = this.time;
    } else if (autoCycle && candidates.length > 1 && (this.time - this.spectateLastSwitchTime) >= this.spectateAutoSwitchSec) {
      currentIndex = (currentIndex + 1) % candidates.length;
      this.spectateLastSwitchTime = this.time;
    }

    const current = candidates[currentIndex];
    this.spectateTargetId = current.id;
    this.spectateTargetName = String(current.entity?.name || `JOGADOR ${currentIndex + 1}`).trim().slice(0, 16);

    return {
      x: clamp(toNumberOr(current.entity?.x, WORLD / 2), 0, WORLD),
      y: clamp(toNumberOr(current.entity?.y, WORLD / 2), 0, WORLD),
      mass: Math.max(1, toNumberOr(current.entity?.mass, 1)),
    };
  }

  checkCollisions() {
    for (let i = this.foods.length - 1; i >= 0; i -= 1) {
      const food = this.foods[i];
      let eaten = false;
      if (dist(food.x, food.y, this.player.x, this.player.y) < this.player.r) {
        this.foodBoom(food.x, food.y, food.color, this.player.r);
        this.player.grow(FOOD_MASS_GAIN);
        this.player.score += 10;
        eaten = true;
      } else {
        for (const bot of this.bots) {
          if (dist(food.x, food.y, bot.x, bot.y) < bot.r) {
            this.spawnParticles(food.x, food.y, food.color, 1, 1);
            bot.grow(FOOD_MASS_GAIN);
            bot.score += 10;
            eaten = true;
            break;
          }
        }
      }
      if (eaten) {
        this.foods.splice(i, 1);
        this.foods.push(new Food());
      }
    }

    for (let i = this.bots.length - 1; i >= 0; i -= 1) {
      const bot = this.bots[i];
      const d = dist(this.player.x, this.player.y, bot.x, bot.y);
      if (d < this.player.r - bot.r * 0.3 && this.player.mass > bot.mass * 1.1) {
        this.eatExplosion(bot.x, bot.y, bot.color1, true, bot.type);
        this.player.grow(bot.mass * PLAYER_ABSORB_MULT);
        this.player.score += 50 + bot.score;
        this.bots.splice(i, 1);
      } else if (d < bot.r - this.player.r * 0.3 && bot.mass > this.player.mass * 1.1) {
        this.eatExplosion(this.player.x, this.player.y, this.player.color1, true, this.player.type);
        this.triggerOfflineDefeat(bot.name);
        return true;
      }
    }

    const removedBots = new Set();
    for (let i = 0; i < this.bots.length; i += 1) {
      const b1 = this.bots[i];
      if (!b1 || removedBots.has(b1)) continue;
      for (let j = i + 1; j < this.bots.length; j += 1) {
        const b2 = this.bots[j];
        if (!b2 || removedBots.has(b2)) continue;
        const d = dist(b1.x, b1.y, b2.x, b2.y);
        if (d < b1.r - b2.r * 0.3 && b1.mass > b2.mass * 1.1) {
          this.eatExplosion(b2.x, b2.y, b2.color1, true, b2.type);
          b1.grow(b2.mass * BOT_ABSORB_MULT);
          b1.score += Math.floor(b2.score / 2);
          removedBots.add(b2);
        } else if (d < b2.r - b1.r * 0.3 && b2.mass > b1.mass * 1.1) {
          this.eatExplosion(b1.x, b1.y, b1.color1, true, b1.type);
          b2.grow(b1.mass * BOT_ABSORB_MULT);
          b2.score += Math.floor(b1.score / 2);
          removedBots.add(b1);
          break;
        }
      }
    }
    if (removedBots.size > 0) this.bots = this.bots.filter((bot) => !removedBots.has(bot));
    return false;
  }

  updateDashboardStep() {
    this.hoverInfo = this.computeDashboardHover(this.mouseX, this.mouseY);
  }

  updateOfflineStep() {
    const [wx, wy] = this.getInputWorldTarget();
    const isSpectating = this.state === 'SPECTATING';
    const paused = this.pauseMenuOpen;
    if (isSpectating) {
      this.qPressed = false;
      this.player.turbo = false;
    } else if (paused) {
      this.qPressed = false;
      this.player.turbo = false;
    } else {
      this.player.turbo = this.qPressed;
    }
    if (this.shakeTimer > 0) {
      const frac = this.shakeTimer / this.shakeMax;
      const intensity = frac * 8;
      this.cam.x += randomFloat(-intensity, intensity) / this.cam.zoom;
      this.cam.y += randomFloat(-intensity, intensity) / this.cam.zoom;
      this.shakeTimer -= 1;
    }

    if (!isSpectating && !paused) this.player.update(wx, wy, this.inputSensitivity);

    if (!isSpectating && !paused && this.player.turbo && this.player.mass > 1.05 && Math.random() < 0.92) {
      this.spawnParticles(this.player.x, this.player.y, [0, 180, 255], 2, 0, 4);
      if (this.particles.length > 0) {
        const p = this.particles[this.particles.length - 1];
        p.size = randomFloat(16, 34);
        p.decay = 0.04;
      }
      if (Math.random() < 0.75) this.spawnParticles(this.player.x, this.player.y, [180, 100, 255], 1, 0, 5);
      if (Math.random() < 0.5) this.spawnParticles(this.player.x, this.player.y, [120, 220, 255], 1, 0, 5);
    }

    if (!paused) {
      for (const bot of this.bots) { bot.update(this.player, this.foods, this.bots); bot.pulse += 0.04; }
      for (const food of this.foods) food.update();
      for (const p of this.particles) p.update();
      for (const sw of this.shockwaves) sw.update();
    }

    this.particles = this.particles.filter((p) => p.alive());
    this.shockwaves = this.shockwaves.filter((sw) => sw.alive());

    if (this.state === 'PLAYING') {
      if (!paused && this.checkCollisions()) return;
      const minZoom = this.getAdaptiveMinZoomForRadius(this.player.r);
      const targetZoom = clamp(0.8 * (80 / this.player.r), minZoom, MAX_CAMERA_ZOOM);
      this.cam.update(this.player.x, this.player.y, targetZoom);
    } else {
      const focus = this.getSpectateFocus();
      const focusRadius = massToRadius(focus.mass);
      const minZoom = this.getAdaptiveMinZoomForRadius(focusRadius);
      const targetZoom = clamp(0.62 * (95 / Math.max(35, focusRadius)), minZoom, 0.55);
      this.cam.update(focus.x, focus.y, targetZoom);
    }
  }

  updateOnlineStep(paused = false) {
    const [wx, wy] = this.getInputWorldTarget();
    const currentSocketId = this.mySocketId || this.socket?.id || '';
    const turboRequested = !paused && !this.pauseMenuOpen && this.qPressed && this.player.mass > 1.05;
    const lerpEntity = (e) => {
      if (e.targetX !== undefined) {
        e.x = lerp(e.x, e.targetX, 0.2);
        e.y = lerp(e.y, e.targetY, 0.2);
      }
      return e;
    };

    if (this.state === 'SPECTATING') {
      this.qPressed = false;
      this.player.turbo = false;
      this.connectionStatus = '';
      this.foods = this.remoteFoods;

      const updatedRemotePlayers = this.remotePlayers.map(lerpEntity).filter((p) => !this.isSameRemoteId(p, currentSocketId));
      const updatedRemoteBots = this.remoteBots.map(lerpEntity);
      this.bots = [...updatedRemoteBots, ...updatedRemotePlayers];

      for (const p of this.particles) p.update();
      for (const sw of this.shockwaves) sw.update();
      this.particles = this.particles.filter((p) => p.alive());
      this.shockwaves = this.shockwaves.filter((sw) => sw.alive());

      const focus = this.getSpectateFocus();
      const focusRadius = massToRadius(focus.mass);
      const targetZoom = clamp(0.62 * (95 / Math.max(35, focusRadius)), MIN_CAMERA_ZOOM, 0.55);
      this.cam.update(focus.x, focus.y, targetZoom);
      return;
    }

    if (!paused && this.socket && this.socket.connected) {
      this.socket.emit('player_input', {
        mouseX: wx,
        mouseY: wy,
        turbo: turboRequested,
      });
    }

    const me = this.resolveCurrentPlayer(currentSocketId);
    if (me && !this.mySocketId && me.id) this.mySocketId = me.id;
    if (me) {
      this.player.x = me.x;
      this.player.y = me.y;
      this.player.mass = me.mass;
      this.player.r = me.r;
      this.player.score = me.score;
      this.player.pulse = me.pulse;
      this.player.name = me.name;
      this.player.type = Number.isFinite(me.skinId) ? me.skinId : this.player.type;
      this.player.turbo = turboRequested;
      this.player.color1 = me.color1 || this.player.color1;
      this.player.color2 = me.color2 || this.player.color2;
      this.player.trail.push({ x: me.x, y: me.y, r: me.r, a: 1 });
      if (this.player.trail.length > 5) this.player.trail.shift();
      for (const t of this.player.trail) t.a -= 0.2;
      const minZoom = this.getAdaptiveMinZoomForRadius(this.player.r);
      const targetZoom = clamp(0.8 * (80 / this.player.r), minZoom, MAX_CAMERA_ZOOM);
      this.cam.update(this.player.x, this.player.y, targetZoom);
      this.connectionStatus = '';
    } else if (!this.connectionStatus) {
      this.player.turbo = false;
      this.connectionStatus = 'Aguardando sincronizacao...';
    }

    if (!paused && this.state === 'PLAYING' && this.player.turbo && this.player.mass > 1.05 && Math.random() < 0.92) {
      this.spawnParticles(this.player.x, this.player.y, [0, 180, 255], 2, 0, 4);
      if (this.particles.length > 0) {
        const p = this.particles[this.particles.length - 1];
        p.size = randomFloat(16, 34);
        p.decay = 0.04;
      }
      if (Math.random() < 0.75) this.spawnParticles(this.player.x, this.player.y, [180, 100, 255], 1, 0, 5);
      if (Math.random() < 0.5) this.spawnParticles(this.player.x, this.player.y, [120, 220, 255], 1, 0, 5);
    }

    this.foods = this.remoteFoods;
    const resolvedId = currentSocketId || me?.id || '';

    const updatedRemotePlayers = this.remotePlayers.map(lerpEntity).filter((p) => !this.isSameRemoteId(p, resolvedId));
    const updatedRemoteBots = this.remoteBots.map(lerpEntity);

    this.bots = [
      ...updatedRemoteBots,
      ...updatedRemotePlayers,
    ];

    for (const p of this.particles) p.update();
    for (const sw of this.shockwaves) sw.update();
    this.particles = this.particles.filter((p) => p.alive());
    this.shockwaves = this.shockwaves.filter((sw) => sw.alive());

    if (this.state !== 'PLAYING') {
      const focus = this.getSpectateFocus();
      const focusRadius = massToRadius(focus.mass);
      const minZoom = this.getAdaptiveMinZoomForRadius(focusRadius);
      const targetZoom = clamp(0.62 * (95 / Math.max(35, focusRadius)), minZoom, 0.55);
      this.cam.update(focus.x, focus.y, targetZoom);
    }
  }

  updatePlayingStep() {
    if (this.playMode === PLAY_MODES.OFFLINE) {
      this.updateOfflineStep();
      return;
    }
    this.updateOnlineStep(this.pauseMenuOpen);
  }

  updateFixed() {
    this.time += FIXED_STEP;
    if (this.state === 'DASHBOARD') this.updateDashboardStep();
    else this.updatePlayingStep();
  }

  drawBackground(isDashboard = false) {
    if (isDashboard) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
    const g = this.ctx.createLinearGradient(0, 0, 0, this.height);
    if (isDashboard) {
      g.addColorStop(0, 'rgba(4, 10, 17, 0.62)');
      g.addColorStop(0.55, 'rgba(2, 6, 11, 0.74)');
      g.addColorStop(1, 'rgba(1, 3, 6, 0.9)');
    } else {
      g.addColorStop(0, '#050810');
      g.addColorStop(0.55, '#02040a');
      g.addColorStop(1, '#010205');
    }
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawGrid() {
    const size = Math.max(4, Math.floor(80 * this.cam.zoom));
    const ox = ((-this.cam.x * this.cam.zoom + this.width / 2) % size + size) % size;
    const oy = ((-this.cam.y * this.cam.zoom + this.height / 2) % size + size) % size;
    this.ctx.strokeStyle = 'rgba(102, 153, 255, 0.08)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (let x = ox; x < this.width; x += size) { this.ctx.moveTo(x, 0); this.ctx.lineTo(x, this.height); }
    for (let y = oy; y < this.height; y += size) { this.ctx.moveTo(0, y); this.ctx.lineTo(this.width, y); }
    this.ctx.stroke();
  }

  drawBorder() {
    const [x1, y1] = this.worldToScreen(0, 0);
    const [x2, y2] = this.worldToScreen(WORLD, WORLD);
    const w = x2 - x1;
    const h = y2 - y1;
    for (let i = 3; i >= 1; i -= 1) {
      this.ctx.strokeStyle = `rgba(0, 255, 179, ${0.08 * i})`;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x1 - i * 2, y1 - i * 2, w + i * 4, h + i * 4);
    }
    this.ctx.strokeStyle = 'rgba(0, 255, 179, 0.8)';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x1, y1, w, h);
  }

  drawFood(food) {
    if (!food || !Number.isFinite(food.x) || !Number.isFinite(food.y) || !Number.isFinite(food.r)) return;
    const [sx, sy] = this.worldToScreen(food.x, food.y);
    if (sx < -30 || sx > this.width + 30 || sy < -30 || sy > this.height + 30) return;
    const minScreenR = this.isMobile ? 2.4 : 1;
    const baseR = Math.max(minScreenR, food.r * this.cam.zoom);
    const pulse = Number.isFinite(food.pulse) ? food.pulse : this.time;
    const r = baseR * (1 + Math.sin(pulse) * 0.08);
    const glowR = r * (this.isMobile ? 2.45 : 2.8);
    const glow = this.ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
    glow.addColorStop(0, colorToCss(food.color, 0.42));
    glow.addColorStop(1, colorToCss(food.color, 0));
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
    this.ctx.fill();

    const core = this.ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.35, r * 0.1, sx, sy, r);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    core.addColorStop(0.35, colorToCss(food.color, 1));
    core.addColorStop(1, colorToCss(food.color, 0.65));
    this.ctx.fillStyle = core;
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawTrail() {
    for (const t of this.player.trail) {
      if (t.a <= 0) continue;
      const [sx, sy] = this.worldToScreen(t.x, t.y);
      const r = t.r * this.cam.zoom * 0.9;
      const g = this.ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.8);
      g.addColorStop(0, colorToCss(this.player.color1, t.a * 0.22));
      g.addColorStop(1, colorToCss(this.player.color1, 0));
      this.ctx.fillStyle = g;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, r * 1.8, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawShockwave(sw) {
    const [sx, sy] = this.worldToScreen(sw.x, sw.y);
    const r = sw.r * this.cam.zoom;
    const ringWidth = Math.max(1, (sw.lineWidth || 10) * this.cam.zoom);
    const glowStrength = clamp(sw.glow ?? 0.18, 0, 0.6);
    const innerR = Math.max(0, r - ringWidth * 0.7);
    const outerR = r + ringWidth * 1.9;

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';

    const glow = this.ctx.createRadialGradient(sx, sy, innerR, sx, sy, outerR);
    glow.addColorStop(0, colorToCss(sw.color, 0));
    glow.addColorStop(0.55, colorToCss(sw.color, sw.alpha * glowStrength));
    glow.addColorStop(1, colorToCss(sw.color, 0));
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, outerR, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = colorToCss(sw.color, sw.alpha * 0.8);
    this.ctx.lineWidth = ringWidth;
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, r, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.strokeStyle = colorToCss([255, 255, 255], sw.alpha * 0.45);
    this.ctx.lineWidth = Math.max(0.8, ringWidth * 0.33);
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, Math.max(0, r - ringWidth * 0.35), 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.restore();
  }
  drawParticles() {
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const alpha = clamp(p.life, 0, 1);
      if (p.segs) {
        this.ctx.strokeStyle = colorToCss(p.color, alpha);
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        for (const seg of p.segs) {
          const [x1, y1] = this.worldToScreen(seg[0], seg[1]);
          const [x2, y2] = this.worldToScreen(seg[2], seg[3]);
          this.ctx.moveTo(x1, y1);
          this.ctx.lineTo(x2, y2);
        }
        this.ctx.stroke();
        continue;
      }
      const [sx, sy] = this.worldToScreen(p.x, p.y);
      const size = Math.max(0.4, p.size * this.cam.zoom);
      this.ctx.save();
      this.ctx.translate(sx, sy);
      this.ctx.rotate(p.angle);
      const tail = 1 + Math.min(2.2, Math.hypot(p.vx, p.vy) * 0.35);
      this.ctx.scale(tail, 1);
      const g = this.ctx.createRadialGradient(0, 0, 0, 0, 0, size);
      g.addColorStop(0, colorToCss(p.color, alpha));
      g.addColorStop(1, colorToCss(p.color, 0));
      this.ctx.fillStyle = g;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
    this.ctx.restore();
  }

  drawCellCore(cell, sx, sy, radius, isPlayer = false) {
    const skinImage = this.getCellSkinImage(cell, isPlayer);
    if (skinImage) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      this.ctx.clip();
      this.ctx.drawImage(skinImage, sx - radius, sy - radius, radius * 2, radius * 2);

      const shade = this.ctx.createRadialGradient(sx - radius * 0.3, sy - radius * 0.32, radius * 0.05, sx, sy, radius * 1.05);
      shade.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
      shade.addColorStop(0.55, 'rgba(0, 0, 0, 0.05)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
      this.ctx.fillStyle = shade;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();

      this.ctx.strokeStyle = colorToCss(cell.color1, 0.38);
      this.ctx.lineWidth = Math.max(1, radius * 0.03);
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, radius * 0.985, 0, Math.PI * 2);
      this.ctx.stroke();
      return;
    }

    const g = this.ctx.createRadialGradient(sx - radius * 0.35, sy - radius * 0.35, radius * 0.1, sx, sy, radius);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    g.addColorStop(0.35, colorToCss(cell.color1, 1));
    g.addColorStop(1, colorToCss(cell.color2, 0.92));
    this.ctx.fillStyle = g;
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawCellSpecial(cell, sx, sy, radius) {
    const t = Number.isFinite(cell.pulse) ? cell.pulse : 0;
    if (cell.type === 1) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i += 1) {
        const a = t * 1.8 + (i * Math.PI * 2) / 5;
        const pr = radius * 0.5;
        const px = sx + Math.cos(a) * pr;
        const py = sy + Math.sin(a) * pr;
        const rg = this.ctx.createRadialGradient(px, py, 0, px, py, radius * 0.45);
        rg.addColorStop(0, 'rgba(255, 240, 150, 0.65)');
        rg.addColorStop(1, 'rgba(255, 140, 0, 0)');
        this.ctx.fillStyle = rg;
        this.ctx.beginPath();
        this.ctx.arc(px, py, radius * 0.45, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    } else if (cell.type === 2) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + t * 0.5;
        const rr = radius * (0.55 + Math.sin(t * 5 + i) * 0.14);
        const x = sx + Math.cos(a) * rr;
        const y = sy + Math.sin(a) * rr;
        const g = this.ctx.createRadialGradient(x, y, 0, x, y, radius * 0.32);
        g.addColorStop(0, 'rgba(255, 240, 130, 0.6)');
        g.addColorStop(1, 'rgba(255, 70, 0, 0)');
        this.ctx.fillStyle = g;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius * 0.32, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    } else if (cell.type === 3) {
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(210, 245, 255, 0.45)';
      this.ctx.lineWidth = Math.max(1, radius * 0.04);
      for (let i = 0; i < 6; i += 1) {
        const a = t * 0.6 + (i * Math.PI * 2) / 6;
        const x = sx + Math.cos(a) * radius * 0.75;
        const y = sy + Math.sin(a) * radius * 0.75;
        this.ctx.beginPath();
        this.ctx.moveTo(sx, sy);
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
      }
      this.ctx.restore();
    } else if (cell.type === 4) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.strokeStyle = 'rgba(190, 120, 255, 0.75)';
      this.ctx.lineWidth = Math.max(1, radius * 0.045);
      for (let i = 0; i < 4; i += 1) {
        const baseA = t * 2 + i * 1.57;
        this.ctx.beginPath();
        for (let s = 0; s <= 5; s += 1) {
          const k = s / 5;
          const a = baseA + (Math.random() - 0.5) * 0.6;
          const rr = radius * (0.2 + k * 0.7);
          const x = sx + Math.cos(a) * rr;
          const y = sy + Math.sin(a) * rr;
          if (s === 0) this.ctx.moveTo(x, y);
          else this.ctx.lineTo(x, y);
        }
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
  }

  drawPlayerElectricRays(sx, sy, radius, turboOn) {
    const borderA = turboOn ? 0.92 : 0.74;
    const glowA = turboOn ? 0.2 : 0.12;
    const amp = turboOn ? radius * 0.03 : radius * 0.018;
    const phase = this.time * (turboOn ? 10 : 6.5);
    const segments = 96;

    const ringGlow = this.ctx.createRadialGradient(sx, sy, radius * 0.92, sx, sy, radius * (turboOn ? 1.16 : 1.1));
    ringGlow.addColorStop(0, 'rgba(80, 170, 255, 0)');
    ringGlow.addColorStop(0.62, `rgba(90, 185, 255, ${glowA})`);
    ringGlow.addColorStop(1, 'rgba(80, 170, 255, 0)');

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.fillStyle = ringGlow;
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, radius * (turboOn ? 1.16 : 1.1), 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.beginPath();
    for (let i = 0; i <= segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const n1 = Math.sin(a * 12 + phase) * 0.55;
      const n2 = Math.sin(a * 23 - phase * 1.12) * 0.35;
      const n3 = Math.sin(a * 37 + phase * 0.72) * 0.22;
      const rr = radius * 1.005 + (n1 + n2 + n3) * amp;
      const px = sx + Math.cos(a) * rr;
      const py = sy + Math.sin(a) * rr;
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }

    this.ctx.strokeStyle = `rgba(190, 232, 255, ${borderA * 0.55})`;
    this.ctx.lineWidth = Math.max(1, radius * 0.021);
    this.ctx.stroke();

    this.ctx.strokeStyle = `rgba(225, 246, 255, ${borderA})`;
    this.ctx.lineWidth = Math.max(0.8, radius * 0.008);
    this.ctx.stroke();

    if (turboOn) {
      const forks = 5;
      this.ctx.strokeStyle = 'rgba(220, 246, 255, 0.68)';
      this.ctx.lineWidth = Math.max(0.9, radius * 0.007);
      for (let i = 0; i < forks; i += 1) {
        const a = phase * 0.3 + i * ((Math.PI * 2) / forks);
        const startX = sx + Math.cos(a) * radius * 1.02;
        const startY = sy + Math.sin(a) * radius * 1.02;
        const midX = sx + Math.cos(a + 0.14) * radius * 1.18;
        const midY = sy + Math.sin(a + 0.14) * radius * 1.18;
        const endX = sx + Math.cos(a + 0.23) * radius * 1.28;
        const endY = sy + Math.sin(a + 0.23) * radius * 1.28;
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(midX, midY);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  drawCell(cell, isPlayer = false) {
    if (!cell || !Number.isFinite(cell.x) || !Number.isFinite(cell.y) || !Number.isFinite(cell.r)) return;
    const safeName = typeof cell.name === 'string' && cell.name.trim().length > 0
      ? cell.name.trim().slice(0, 16)
      : (isPlayer ? 'VOCE' : 'BOT');
    const [sx, sy] = this.worldToScreen(cell.x, cell.y);
    const r = cell.r * this.cam.zoom;
    const pad = r * 1.3 + 30 * this.cam.zoom;
    if (sx + pad < 0 || sx - pad > this.width || sy + pad < 0 || sy - pad > this.height) return;
    this.ctx.save();
    this.ctx.shadowColor = colorToCss(cell.color2, 0.8);
    this.ctx.shadowBlur = r * 0.4;
    this.drawCellCore(cell, sx, sy, r, isPlayer);
    if (!isPlayer) this.drawCellSpecial(cell, sx, sy, r);
    this.ctx.restore();

    if (isPlayer) this.drawPlayerElectricRays(sx, sy, r, this.player.turbo && this.player.mass > 1.05);

    if (r > 14) {
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.font = `bold ${r > 30 ? 18 : 13}px Consolas, monospace`;
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      this.ctx.fillText(safeName, sx + 1, sy + 1);
      this.ctx.fillText(safeName, sx - 1, sy - 1);
      this.ctx.fillStyle = isPlayer ? 'rgb(255, 255, 100)' : 'rgb(255, 255, 255)';
      this.ctx.fillText(safeName, sx, sy);
    }
  }

  drawTurboAura() {
    // Efeito externo pesado desativado: a borda eletrica fina ja indica turbo.
  }

  drawHud(shakeFrac) {
    const isSpectating = this.state === 'SPECTATING';
    const compact = this.isCompactUi();
    const insets = this.getViewportInsets();
    const menuBtn = this.getMobileMenuButton();
    const turboActive = this.player.turbo && this.player.mass > 1.05;

    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    const boxX = insets.left + 6;
    const boxY = this.isMobile ? menuBtn.y + menuBtn.h + 10 : insets.top + 6;
    const boxW = compact ? clamp(Math.round(this.width * 0.34), 156, 236) : 276;
    const boxH = isSpectating
      ? (compact ? 130 : 148)
      : (compact ? 138 : 152);
    const statsGradient = this.ctx.createLinearGradient(boxX, boxY, boxX, boxY + boxH);
    statsGradient.addColorStop(0, 'rgba(8, 22, 35, 0.78)');
    statsGradient.addColorStop(1, 'rgba(4, 12, 22, 0.8)');
    this.ctx.fillStyle = statsGradient;
    this.ctx.fillRect(boxX, boxY, boxW, boxH);
    this.ctx.strokeStyle = 'rgba(94, 196, 255, 0.45)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(boxX, boxY, boxW, boxH);

    const modeLabel = this.playMode === PLAY_MODES.OFFLINE
      ? 'OFFLINE'
      : (this.playMode === PLAY_MODES.ONLINE_BOTS ? 'ONLINE+BOTS' : 'ONLINE PVP');

    this.ctx.fillStyle = 'rgba(176, 222, 255, 0.95)';
    this.ctx.font = `700 ${compact ? 10 : 11}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(`TIPO: ${isSpectating ? `ESPECTADOR (${modeLabel})` : modeLabel}`, boxX + 14, boxY + 10);

    if (isSpectating) {
      this.ctx.fillStyle = 'rgba(230, 242, 252, 0.98)';
      this.ctx.font = `900 ${compact ? 18 : 22}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText('ASSISTINDO MAPA', boxX + 14, boxY + 34);
      this.ctx.fillStyle = 'rgba(160, 196, 225, 0.95)';
      this.ctx.font = `700 ${compact ? 11 : 12}px ${UI_FONT_FAMILY}`;
      const spectBase = compact ? 58 : 64;
      const spectStep = compact ? 16 : 18;
      this.ctx.fillText(`ULTIMO SCORE: ${this.player.score}`, boxX + 14, boxY + spectBase);
      this.ctx.fillText(`ALVO: ${this.spectateTargetName || 'AUTO'}`, boxX + 14, boxY + spectBase + spectStep);
      if (this.killerName) this.ctx.fillText(`DERROTADO POR: ${this.killerName}`, boxX + 14, boxY + spectBase + spectStep * 2);
      this.ctx.fillText(`SOM: ${this.soundEnabled ? 'ON' : 'OFF'} | SENS: ${this.inputSensitivity.toFixed(2)}x`, boxX + 14, boxY + boxH - 20);
    } else {
      this.ctx.fillStyle = 'rgb(118, 255, 214)';
      this.ctx.font = `700 ${compact ? 10 : 11}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText('PONTOS', boxX + 14, boxY + 30);
      this.ctx.fillStyle = 'rgb(233, 251, 255)';
      this.ctx.font = `900 ${compact ? 28 : 34}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText(String(this.player.score), boxX + 14, boxY + 44);
      this.ctx.fillStyle = 'rgba(150, 238, 201, 0.95)';
      this.ctx.font = `700 ${compact ? 12 : 13}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText(`MASSA: ${this.player.mass.toFixed(1)}`, boxX + 14, boxY + (compact ? 88 : 92));
      this.ctx.fillStyle = 'rgba(170, 214, 238, 0.95)';
      this.ctx.font = `700 ${compact ? 11 : 12}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText(`SENS: ${this.inputSensitivity.toFixed(2)}x`, boxX + 14, boxY + (compact ? 106 : 112));
      this.ctx.fillText(`SOM: ${this.soundEnabled ? 'ON' : 'OFF'} | TURBO: ${turboActive ? 'ATIVO' : 'PRONTO'}`, boxX + 14, boxY + (compact ? 122 : 128));
    }

    const rankingSource = this.bots
      .map((b) => ({ name: b.name, score: b.score, you: false }));
    if (!isSpectating) rankingSource.push({ name: this.player.name, score: this.player.score, you: true });

    const ranking = rankingSource
      .sort((a, b) => b.score - a.score)
      .slice(0, compact ? 5 : 6);

    const rowH = compact ? 20 : 24;
    const lbW = compact ? clamp(Math.round(this.width * 0.33), 150, 220) : 244;
    const lbX = this.width - lbW - insets.right - 6;
    const lbY = boxY;
    const lbH = 38 + ranking.length * rowH;
    const rankGradient = this.ctx.createLinearGradient(lbX, lbY, lbX, lbY + lbH);
    rankGradient.addColorStop(0, 'rgba(28, 14, 38, 0.74)');
    rankGradient.addColorStop(1, 'rgba(16, 8, 24, 0.8)');
    this.ctx.fillStyle = rankGradient;
    this.ctx.fillRect(lbX, lbY, lbW, lbH);
    this.ctx.strokeStyle = 'rgba(225, 128, 255, 0.46)';
    this.ctx.strokeRect(lbX, lbY, lbW, lbH);

    this.ctx.fillStyle = 'rgb(238, 175, 255)';
    this.ctx.font = `700 ${compact ? 10 : 11}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(`RANKING TOP ${ranking.length}`, lbX + 12, lbY + 10);

    for (let i = 0; i < ranking.length; i += 1) {
      const entry = ranking[i];
      const rowY = lbY + 30 + i * rowH;
      this.ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)';
      this.ctx.fillRect(lbX + 8, rowY, lbW - 16, rowH - 2);
      this.ctx.fillStyle = entry.you ? 'rgb(120, 255, 214)' : 'rgba(232, 236, 248, 0.95)';
      this.ctx.font = `900 ${compact ? 12 : 13}px ${UI_FONT_FAMILY}`;
      const safeName = String(entry.name || 'BOT').trim().slice(0, compact ? 9 : 12) || 'BOT';
      this.ctx.fillText(`${i + 1}. ${safeName}`, lbX + 14, rowY + 5);
      const scoreText = String(Math.max(0, Math.round(toNumberOr(entry.score, 0))));
      this.ctx.font = `700 ${compact ? 12 : 13}px ${UI_FONT_FAMILY}`;
      this.ctx.textAlign = 'right';
      this.ctx.fillText(scoreText, lbX + lbW - 14, rowY + 5);
      this.ctx.textAlign = 'left';
    }

    const tip = isSpectating
      ? (this.isMobile
        ? 'ASSISTINDO | TOQUE ESQ/DIR TROCA ALVO | MENU'
        : 'ASSISTINDO MAPA | A/D TROCA ALVO | ESC MENU')
      : (this.playMode === PLAY_MODES.OFFLINE
        ? (this.isMobile
          ? 'TOQUE MOVER | BOTAO TURBO | MENU'
          : 'MOVA MOUSE | Q TURBO | ESC MENU')
        : (this.isMobile
          ? 'ONLINE MOBILE | BOTAO TURBO | MENU'
          : 'ONLINE | Q TURBO | ESC MENU'));
    this.ctx.font = `700 ${compact ? 10 : 11}px ${UI_FONT_FAMILY}`;
    this.ctx.fillStyle = 'rgba(130, 145, 176, 0.92)';
    const tw = this.ctx.measureText(tip).width;
    const bottomTipY = this.height - insets.bottom - (this.isMobile ? 12 : 28);
    this.ctx.fillText(tip, this.width / 2 - tw / 2, bottomTipY);

    if (this.isMobile && !isSpectating) {
      const movePad = this.getMobileMovePad();
      const turboBtn = this.getMobileTurboButton();
      const chipW = clamp(Math.round(this.width * 0.46), 190, 320);
      const chipH = compact ? 30 : 34;
      const chipX = Math.round((this.width - chipW) / 2);
      const chipY = clamp(Math.min(
        this.height - insets.bottom - chipH - 8,
        Math.min(movePad.y, turboBtn.y) - chipH - 8,
      ), boxY + boxH + 8, this.height - insets.bottom - chipH - 8);
      const chipGrad = this.ctx.createLinearGradient(chipX, chipY, chipX, chipY + chipH);
      chipGrad.addColorStop(0, turboActive ? 'rgba(45, 143, 206, 0.92)' : 'rgba(18, 52, 82, 0.82)');
      chipGrad.addColorStop(1, turboActive ? 'rgba(27, 100, 154, 0.94)' : 'rgba(8, 30, 52, 0.88)');
      this.ctx.fillStyle = chipGrad;
      this.ctx.fillRect(chipX, chipY, chipW, chipH);
      this.ctx.strokeStyle = turboActive ? 'rgba(175, 236, 255, 0.94)' : 'rgba(96, 162, 214, 0.7)';
      this.ctx.lineWidth = 1.4;
      this.ctx.strokeRect(chipX, chipY, chipW, chipH);
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillStyle = 'rgba(236, 246, 255, 0.98)';
      this.ctx.font = `800 ${compact ? 12 : 13}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText(
        `HUB TURBO: ${turboActive ? 'ATIVO' : 'PRONTO'} | SENS ${this.inputSensitivity.toFixed(2)}x`,
        chipX + chipW / 2,
        chipY + chipH / 2 + 0.5,
      );
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'top';
    }

    if (!isSpectating && shakeFrac > 0.6) {
      this.ctx.fillStyle = `rgba(0, 255, 179, ${shakeFrac * 0.12})`;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  drawCursor() {
    const x = this.mouseX; const y = this.mouseY;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(x - 14, y); this.ctx.lineTo(x + 14, y);
    this.ctx.moveTo(x, y - 14); this.ctx.lineTo(x, y + 14);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(x, y, 9, 0, Math.PI * 2);
    this.ctx.stroke();
  }
  getDashboardLayout() {
    const compact = this.isCompactUi();
    const centerX = this.width / 2;
    const visualWidth = compact ? Math.min(this.width * 0.95, 620) : Math.min(this.width, 1700);
    const uiScale = compact
      ? clamp(Math.min(this.width / 900, this.height / 980), 0.72, 1)
      : clamp(Math.min(this.width / 1720, this.height / 980), 0.68, 1.08);

    const titleSize = clamp(Math.round(68 * uiScale), 34, 76);
    const subTitleSize = clamp(Math.round(44 * uiScale), 22, 48);
    const topPad = compact
      ? clamp(Math.round(this.height * 0.08), 54, 86)
      : clamp(Math.round(this.height * 0.06), 34, 58);
    const titleY1 = topPad + Math.round(titleSize * 0.58);
    const titleY2 = titleY1 + Math.round(subTitleSize * 1.06);

    const bw = compact
      ? clamp(Math.round(visualWidth * 0.78), 280, 420)
      : clamp(Math.round(visualWidth * 0.34), 320, 430);
    const inputW = compact ? clamp(bw + 20, 300, 460) : clamp(bw + 22, 320, 470);
    const inputH = compact ? clamp(Math.round(44 * uiScale), 40, 52) : clamp(Math.round(46 * uiScale), 42, 54);
    const inputX = centerX - inputW / 2;
    const infoY = compact
      ? titleY2 + clamp(Math.round(this.height * 0.3), 210, 320)
      : titleY2 + clamp(Math.round(this.height * 0.24), 170, 280);
    const inputY = infoY + (compact
      ? clamp(Math.round(44 * uiScale), 34, 52)
      : clamp(Math.round(52 * uiScale), 40, 62));

    const skinHeaderY = inputY + inputH + (compact
      ? clamp(Math.round(62 * uiScale), 50, 82)
      : clamp(Math.round(54 * uiScale), 40, 70));
    const skinY = skinHeaderY + (compact ? 24 : 20);
    const arrowW = compact ? 38 : 42;
    const arrowH = compact ? 48 : 52;
    const arrowOffset = compact
      ? clamp(Math.round(inputW * 0.5), 142, 208)
      : clamp(Math.round(inputW * 0.5), 150, 230);
    const leftX = centerX - arrowOffset - arrowW / 2;
    const rightX = centerX + arrowOffset - arrowW / 2;

    const skinNameY = skinY + arrowH / 2 + (compact
      ? clamp(Math.round(46 * uiScale), 36, 56)
      : clamp(Math.round(44 * uiScale), 36, 54));
    const skinStatusY = skinNameY + (compact
      ? clamp(Math.round(24 * uiScale), 18, 26)
      : clamp(Math.round(22 * uiScale), 16, 24));

    const bh = compact ? clamp(Math.round(52 * uiScale), 44, 56) : clamp(Math.round(56 * uiScale), 46, 58);
    const gap = compact ? clamp(Math.round(12 * uiScale), 10, 16) : clamp(Math.round(10 * uiScale), 8, 13);
    const skinBtnGap = compact ? 12 : 10;
    const skinBtnH = compact ? clamp(Math.round(40 * uiScale), 34, 42) : clamp(Math.round(38 * uiScale), 32, 40);
    const skinBtnY = skinStatusY + (compact
      ? clamp(Math.round(44 * uiScale), 34, 54)
      : clamp(Math.round(38 * uiScale), 28, 44));
    const skinBtnW = Math.max(92, Math.floor((bw - skinBtnGap * 2) / 3));
    const totalButtonsHeight = bh * 3 + gap * 2;
    const bx = centerX - bw / 2;
    let by1 = skinBtnY + skinBtnH + (compact
      ? clamp(Math.round(58 * uiScale), 46, 72)
      : clamp(Math.round(48 * uiScale), 34, 60));
    const maxBy1 = this.height - totalButtonsHeight - (compact ? 16 : 24);
    const minBy1 = skinBtnY + skinBtnH + (compact ? 36 : 30);
    if (maxBy1 <= minBy1) by1 = maxBy1;
    else by1 = clamp(by1, minBy1, maxBy1);

    const by3 = by1 + (bh + gap) * 2;
    const panelY = Math.max(
      titleY2 + (compact ? 44 : 24),
      inputY - (compact
        ? clamp(Math.round(66 * uiScale), 52, 78)
        : clamp(Math.round(56 * uiScale), 38, 62)),
    );
    const panelH = by3 + bh - panelY + (compact ? 20 : 18);
    const panelX = bx - (compact ? 18 : 24);
    const panelW = bw + (compact ? 36 : 48);
    const dividerTopY = inputY + inputH + (compact
      ? clamp(Math.round(22 * uiScale), 16, 26)
      : clamp(Math.round(20 * uiScale), 14, 24));
    const dividerBottomY = by1 - (compact
      ? clamp(Math.round(24 * uiScale), 16, 30)
      : clamp(Math.round(22 * uiScale), 16, 28));

    return {
      centerX,
      uiScale,
      compact,
      titleSize,
      subTitleSize,
      titleY1,
      titleY2,
      infoY,
      inputX,
      inputY,
      inputW,
      inputH,
      skinY,
      skinHeaderY,
      skinNameY,
      skinStatusY,
      leftX,
      rightX,
      arrowW,
      arrowH,
      skinBtnY,
      skinBtnW,
      skinBtnH,
      skinBtnGap,
      panelX,
      panelY,
      panelW,
      panelH,
      dividerTopY,
      dividerBottomY,
      buttonX: bx,
      buttonY1: by1,
      buttonW: bw,
      buttonH: bh,
      buttonGap: gap,
    };
  }

  computeDashboardHover(mx, my) {
    const layout = this.getDashboardLayout();
    const by2 = layout.buttonY1 + layout.buttonH + layout.buttonGap;
    const by3 = by2 + layout.buttonH + layout.buttonGap;
    const skinBx = layout.centerX - layout.buttonW / 2;
    const skinBtn2X = skinBx + layout.skinBtnW + layout.skinBtnGap;
    const skinBtn3X = skinBtn2X + layout.skinBtnW + layout.skinBtnGap;

    return {
      left: mx >= layout.leftX && mx <= layout.leftX + layout.arrowW && my >= layout.skinY && my <= layout.skinY + layout.arrowH,
      right: mx >= layout.rightX && mx <= layout.rightX + layout.arrowW && my >= layout.skinY && my <= layout.skinY + layout.arrowH,
      upload: mx >= skinBx && mx <= skinBx + layout.skinBtnW && my >= layout.skinBtnY && my <= layout.skinBtnY + layout.skinBtnH,
      byUrl: mx >= skinBtn2X && mx <= skinBtn2X + layout.skinBtnW && my >= layout.skinBtnY && my <= layout.skinBtnY + layout.skinBtnH,
      clearSkin: mx >= skinBtn3X && mx <= skinBtn3X + layout.skinBtnW && my >= layout.skinBtnY && my <= layout.skinBtnY + layout.skinBtnH,
      offline: mx >= layout.buttonX && mx <= layout.buttonX + layout.buttonW && my >= layout.buttonY1 && my <= layout.buttonY1 + layout.buttonH,
      online: mx >= layout.buttonX && mx <= layout.buttonX + layout.buttonW && my >= by2 && my <= by2 + layout.buttonH,
      onlineBots: mx >= layout.buttonX && mx <= layout.buttonX + layout.buttonW && my >= by3 && my <= by3 + layout.buttonH,
    };
  }

  drawDashboardButton({ x, y, w, h, label, subtitle, palette, hover }) {
    const gradient = this.ctx.createLinearGradient(x, y, x, y + h);
    gradient.addColorStop(0, hover ? palette.hoverTop : palette.top);
    gradient.addColorStop(1, hover ? palette.hoverBottom : palette.bottom);
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(x, y, w, h);

    if (hover) {
      this.ctx.strokeStyle = palette.hoverGlow;
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    }

    this.ctx.strokeStyle = hover ? palette.hoverBorder : palette.border;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, w, h);

    const hasSubtitle = typeof subtitle === 'string' && subtitle.length > 0;
    const labelSize = clamp(Math.round(h * (hasSubtitle ? 0.42 : 0.5)), 14, 30);
    const subSize = clamp(Math.round(h * 0.2), 10, 14);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = 'rgb(245, 250, 255)';
    this.ctx.font = `900 ${labelSize}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(label, x + w / 2, y + h * (hasSubtitle ? 0.48 : 0.55));

    if (hasSubtitle) {
      this.ctx.fillStyle = 'rgba(220, 235, 250, 0.9)';
      this.ctx.font = `700 ${subSize}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText(subtitle, x + w / 2, y + h * 0.8);
    }
  }

  drawDashboardSkinPreview(cx, cy, radius) {
    const activeImage = this.getSelectedSkinImage();
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    this.ctx.clip();

    if (activeImage) {
      this.ctx.drawImage(activeImage, cx - radius, cy - radius, radius * 2, radius * 2);
      const shade = this.ctx.createRadialGradient(cx - radius * 0.32, cy - radius * 0.35, radius * 0.08, cx, cy, radius);
      shade.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0.26)');
      this.ctx.fillStyle = shade;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      const skin = PLAYER_SKINS[this.skinIdx] || PLAYER_SKINS[0];
      const g = this.ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.1, cx, cy, radius);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      g.addColorStop(0.35, colorToCss(skin.c1, 1));
      g.addColorStop(1, colorToCss(skin.c2, 0.92));
      this.ctx.fillStyle = g;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();

    this.ctx.strokeStyle = 'rgba(195, 231, 255, 0.62)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  drawDashboard() {
    this.drawBackground(true);
    const layout = this.getDashboardLayout();
    const compact = layout.compact;
    const hover = this.hoverInfo;

    for (const star of this.dashboardStars) {
      const ex = (star.x / 1920) * this.width;
      const eyBase = (star.y / 2160) * (this.height * 2);
      const ey = (eyBase + this.time * star.speed) % this.height;
      const alpha = 0.35 + (Math.sin(this.time * star.phase + ex) * 0.4 + 0.2);
      this.ctx.fillStyle = `rgba(255, 255, 255, ${clamp(alpha, 0, 1)})`;
      this.ctx.fillRect(ex, ey, star.size, star.size);
    }

    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const sourceW = this.dashboardTitleImage?.naturalWidth || 1536;
    const sourceH = this.dashboardTitleImage?.naturalHeight || 1024;
    const cropTop = Math.round(sourceH * (compact ? 0.14 : 0.18));
    const cropBottom = Math.round(sourceH * (compact ? 0.94 : 0.86));
    const cropH = Math.max(1, cropBottom - cropTop);
    const logoAspect = sourceW / cropH;
    const logoMaxBottom = layout.infoY - (compact ? 24 : 14);
    const logoMaxHeight = Math.max(compact ? 126 : 230, logoMaxBottom - (compact ? 10 : 6));
    let logoW = compact
      ? clamp(Math.round(this.width * 0.92), 320, 1080)
      : clamp(Math.round(this.width * 0.98), 980, 2200);
    let logoH = Math.round(logoW / logoAspect);
    if (logoH > logoMaxHeight) {
      logoH = logoMaxHeight;
      logoW = Math.round(logoH * logoAspect);
    }
    const logoX = Math.round(layout.centerX - logoW / 2);
    const logoY = Math.round(Math.max(compact ? 8 : 4, logoMaxBottom - logoH));

    if (this.dashboardTitleReady && this.dashboardTitleImage && this.dashboardTitleImage.naturalWidth > 0) {
      this.ctx.save();
      this.ctx.globalAlpha = 0.98;
      this.ctx.drawImage(this.dashboardTitleImage, 0, cropTop, sourceW, cropH, logoX, logoY, logoW, logoH);
      this.ctx.restore();
    }

    const panelGradient = this.ctx.createLinearGradient(layout.panelX, layout.panelY, layout.panelX, layout.panelY + layout.panelH);
    panelGradient.addColorStop(0, 'rgba(9, 20, 30, 0.72)');
    panelGradient.addColorStop(1, 'rgba(5, 12, 22, 0.74)');
    this.ctx.fillStyle = panelGradient;
    this.ctx.fillRect(layout.panelX, layout.panelY, layout.panelW, layout.panelH);
    this.ctx.strokeStyle = 'rgba(98, 182, 236, 0.44)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(layout.panelX, layout.panelY, layout.panelW, layout.panelH);

    const infoText = 'DIGITE NICK, ESCOLHA MODO E ENTRE NO MAPA';
    this.ctx.font = `900 ${clamp(Math.round((compact ? 14 : 15) * layout.uiScale), 12, 18)}px ${UI_FONT_FAMILY}`;
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = 'rgba(6, 18, 30, 0.9)';
    this.ctx.strokeText(infoText, layout.centerX, layout.infoY);
    this.ctx.fillStyle = 'rgba(236, 246, 255, 0.98)';
    this.ctx.fillText(infoText, layout.centerX, layout.infoY);

    const inputGradient = this.ctx.createLinearGradient(layout.inputX, layout.inputY, layout.inputX, layout.inputY + layout.inputH);
    inputGradient.addColorStop(0, 'rgba(18, 36, 52, 0.96)');
    inputGradient.addColorStop(1, 'rgba(8, 22, 34, 0.96)');
    this.ctx.fillStyle = inputGradient;
    this.ctx.fillRect(layout.inputX, layout.inputY, layout.inputW, layout.inputH);
    this.ctx.strokeStyle = 'rgba(100, 205, 255, 0.75)';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(layout.inputX, layout.inputY, layout.inputW, layout.inputH);

    const nickText = `${this.playerNick}${Math.floor(this.time * 2) % 2 === 0 ? '_' : ''}`;
    this.ctx.fillStyle = 'rgb(255, 255, 255)';
    this.ctx.font = `900 ${clamp(Math.round(layout.inputH * 0.52), 22, 32)}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(nickText, layout.centerX, layout.inputY + layout.inputH * 0.55);

    this.ctx.strokeStyle = 'rgba(116, 176, 220, 0.35)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(layout.panelX + 24, layout.dividerTopY);
    this.ctx.lineTo(layout.panelX + layout.panelW - 24, layout.dividerTopY);
    this.ctx.stroke();

    this.ctx.fillStyle = 'rgb(184, 209, 229)';
    this.ctx.font = `700 ${compact ? 14 : 15}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText('ESCOLHA SUA SKIN', layout.centerX, layout.skinHeaderY);

    this.ctx.fillStyle = hover.left ? 'rgb(255, 255, 255)' : 'rgb(100, 120, 138)';
    this.ctx.font = `900 ${clamp(Math.round(layout.arrowH * 0.86), 34, 50)}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText('<', layout.leftX + layout.arrowW / 2, layout.skinY + layout.arrowH / 2 + 1);
    this.ctx.fillStyle = hover.right ? 'rgb(255, 255, 255)' : 'rgb(100, 120, 138)';
    this.ctx.fillText('>', layout.rightX + layout.arrowW / 2, layout.skinY + layout.arrowH / 2 + 1);

    const skinColor = PLAYER_SKINS[this.skinIdx].c1;
    this.drawDashboardSkinPreview(layout.centerX, layout.skinY + layout.arrowH / 2, compact ? 32 : 34);
    this.ctx.fillStyle = colorToCss(skinColor, 1);
    this.ctx.font = `900 ${clamp(Math.round(layout.arrowH * 0.52), 20, 30)}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(PLAYER_SKINS[this.skinIdx].name, layout.centerX, layout.skinNameY);

    const customStatus = this.customSkinImage
      ? `SKIN IMG: ${this.customSkinLabel || 'ATIVA'}`
      : 'SKIN IMG: OFF';
    this.ctx.fillStyle = this.customSkinImage ? 'rgba(148, 236, 179, 0.96)' : 'rgba(164, 180, 194, 0.9)';
    this.ctx.font = `700 ${clamp(Math.round(12 * layout.uiScale), 11, 13)}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(customStatus, layout.centerX, layout.skinStatusY);

    const skinButtonX = layout.centerX - layout.buttonW / 2;
    const skinButtons = [
      {
        x: skinButtonX,
        y: layout.skinBtnY,
        w: layout.skinBtnW,
        h: layout.skinBtnH,
        label: 'ARQUIVO',
        subtitle: '',
        hover: hover.upload,
        palette: {
          top: 'rgba(37, 108, 183, 0.94)',
          bottom: 'rgba(23, 76, 134, 0.95)',
          border: 'rgba(112, 196, 255, 0.8)',
          hoverTop: 'rgba(52, 136, 220, 0.97)',
          hoverBottom: 'rgba(30, 93, 158, 0.97)',
          hoverBorder: 'rgba(166, 225, 255, 0.95)',
          hoverGlow: 'rgba(166, 225, 255, 0.34)',
        },
      },
      {
        x: skinButtonX + layout.skinBtnW + layout.skinBtnGap,
        y: layout.skinBtnY,
        w: layout.skinBtnW,
        h: layout.skinBtnH,
        label: 'URL',
        subtitle: '',
        hover: hover.byUrl,
        palette: {
          top: 'rgba(23, 127, 114, 0.94)',
          bottom: 'rgba(12, 88, 78, 0.95)',
          border: 'rgba(114, 244, 208, 0.8)',
          hoverTop: 'rgba(30, 164, 144, 0.97)',
          hoverBottom: 'rgba(16, 111, 98, 0.97)',
          hoverBorder: 'rgba(170, 255, 231, 0.95)',
          hoverGlow: 'rgba(170, 255, 231, 0.34)',
        },
      },
      {
        x: skinButtonX + (layout.skinBtnW + layout.skinBtnGap) * 2,
        y: layout.skinBtnY,
        w: layout.skinBtnW,
        h: layout.skinBtnH,
        label: 'LIMPAR',
        subtitle: '',
        hover: hover.clearSkin,
        palette: {
          top: 'rgba(131, 58, 58, 0.94)',
          bottom: 'rgba(95, 36, 36, 0.95)',
          border: 'rgba(241, 147, 147, 0.8)',
          hoverTop: 'rgba(176, 77, 77, 0.97)',
          hoverBottom: 'rgba(122, 48, 48, 0.97)',
          hoverBorder: 'rgba(255, 186, 186, 0.95)',
          hoverGlow: 'rgba(255, 186, 186, 0.34)',
        },
      },
    ];

    for (const button of skinButtons) this.drawDashboardButton(button);

    this.ctx.strokeStyle = 'rgba(116, 176, 220, 0.32)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(layout.panelX + 24, layout.dividerBottomY);
    this.ctx.lineTo(layout.panelX + layout.panelW - 24, layout.dividerBottomY);
    this.ctx.stroke();

    const buttons = [
      {
        x: layout.buttonX,
        y: layout.buttonY1,
        w: layout.buttonW,
        h: layout.buttonH,
        label: 'OFFLINE COM BOTS',
        subtitle: 'JOGUE LOCAL AGORA',
        hover: hover.offline,
        palette: {
          top: 'rgba(34, 88, 150, 0.93)',
          bottom: 'rgba(18, 56, 104, 0.95)',
          border: 'rgba(81, 170, 240, 0.8)',
          hoverTop: 'rgba(45, 120, 195, 0.97)',
          hoverBottom: 'rgba(25, 76, 130, 0.97)',
          hoverBorder: 'rgba(143, 220, 255, 0.95)',
          hoverGlow: 'rgba(143, 220, 255, 0.45)',
        },
      },
      {
        x: layout.buttonX,
        y: layout.buttonY1 + layout.buttonH + layout.buttonGap,
        w: layout.buttonW,
        h: layout.buttonH,
        label: 'ONLINE PVP',
        subtitle: 'JOGADOR VS JOGADOR',
        hover: hover.online,
        palette: {
          top: 'rgba(160, 104, 26, 0.93)',
          bottom: 'rgba(112, 70, 16, 0.95)',
          border: 'rgba(245, 184, 94, 0.85)',
          hoverTop: 'rgba(205, 138, 30, 0.97)',
          hoverBottom: 'rgba(140, 90, 20, 0.97)',
          hoverBorder: 'rgba(255, 214, 139, 0.95)',
          hoverGlow: 'rgba(255, 214, 139, 0.42)',
        },
      },
      {
        x: layout.buttonX,
        y: layout.buttonY1 + (layout.buttonH + layout.buttonGap) * 2,
        w: layout.buttonW,
        h: layout.buttonH,
        label: 'ONLINE COM BOTS',
        subtitle: 'SERVIDOR + BOTS',
        hover: hover.onlineBots,
        palette: {
          top: 'rgba(145, 38, 38, 0.93)',
          bottom: 'rgba(95, 24, 24, 0.95)',
          border: 'rgba(240, 102, 102, 0.85)',
          hoverTop: 'rgba(186, 50, 50, 0.97)',
          hoverBottom: 'rgba(126, 32, 32, 0.97)',
          hoverBorder: 'rgba(255, 158, 158, 0.95)',
          hoverGlow: 'rgba(255, 158, 158, 0.4)',
        },
      },
    ];

    for (const button of buttons) this.drawDashboardButton(button);
    if (!this.isMobile) this.drawCursor();
  }

  drawGameOverOverlay() {
    this.ctx.fillStyle = 'rgba(0,0,0,0.85)';
    this.ctx.fillRect(0, 0, this.width, this.height);

    const layout = this.getGameOverLayout();
    const cx = this.width / 2;
    const cy = this.height / 2;

    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = 'rgb(255, 60, 60)';
    this.ctx.font = `900 ${layout.compact ? 44 : 64}px ${TITLE_FONT_FAMILY}`;
    this.ctx.fillText('GAME OVER', cx, cy - (layout.compact ? 62 : 80));

    this.ctx.fillStyle = 'rgb(220, 220, 220)';
    this.ctx.font = `700 ${layout.compact ? 18 : 24}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(`DERROTADO POR: ${this.killerName}`, cx, cy - (layout.compact ? 12 : 20));

    const btnW = layout.btnW;
    const btnH = layout.btnH;
    const gap = layout.gap;

    const mx = this.mouseX;
    const my = this.mouseY;

    // Btn Assistir
    const watchX = cx - btnW - gap / 2;
    const hoverWatch = mx >= watchX && mx <= watchX + btnW && my >= layout.rowY && my <= layout.rowY + btnH;
    this.drawDashboardButton({
      x: watchX, y: layout.rowY, w: btnW, h: btnH,
      label: 'ASSISTIR', subtitle: '', hover: hoverWatch,
      palette: {
        top: 'rgba(34, 88, 150, 0.93)', bottom: 'rgba(18, 56, 104, 0.95)', border: 'rgba(81, 170, 240, 0.8)',
        hoverTop: 'rgba(45, 120, 195, 0.97)', hoverBottom: 'rgba(25, 76, 130, 0.97)', hoverBorder: 'rgba(143, 220, 255, 0.95)', hoverGlow: 'rgba(143, 220, 255, 0.45)'
      }
    });

    // Btn Sair
    const exitX = cx + gap / 2;
    const hoverExit = mx >= exitX && mx <= exitX + btnW && my >= layout.rowY && my <= layout.rowY + btnH;
    this.drawDashboardButton({
      x: exitX, y: layout.rowY, w: btnW, h: btnH,
      label: 'SAIR DO JOGO', subtitle: '', hover: hoverExit,
      palette: {
        top: 'rgba(145, 38, 38, 0.93)', bottom: 'rgba(95, 24, 24, 0.95)', border: 'rgba(240, 102, 102, 0.85)',
        hoverTop: 'rgba(186, 50, 50, 0.97)', hoverBottom: 'rgba(126, 32, 32, 0.97)', hoverBorder: 'rgba(255, 158, 158, 0.95)', hoverGlow: 'rgba(255, 158, 158, 0.4)'
      }
    });
  }

  drawSpectatingOverlay() {
    const menuBtn = this.getMobileMenuButton();
    const y = this.isMobile ? menuBtn.y + menuBtn.h + 6 : 18;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = 'rgba(232, 240, 250, 0.85)';
    this.ctx.font = `700 ${this.isCompactUi() ? 12 : 14}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText('MODO ESPECTADOR ATIVO', this.width / 2, y);
  }

  drawPauseMenuOverlay() {
    const layout = this.getPauseMenuLayout();
    const hover = this.computePauseMenuHover(this.mouseX, this.mouseY);
    const modeLabel = this.playMode === PLAY_MODES.OFFLINE
      ? 'OFFLINE'
      : (this.playMode === PLAY_MODES.ONLINE_BOTS ? 'ONLINE+BOTS' : 'ONLINE PVP');

    this.ctx.fillStyle = 'rgba(2, 7, 12, 0.72)';
    this.ctx.fillRect(0, 0, this.width, this.height);

    const g = this.ctx.createLinearGradient(layout.panelX, layout.panelY, layout.panelX, layout.panelY + layout.panelH);
    g.addColorStop(0, 'rgba(9, 20, 32, 0.95)');
    g.addColorStop(1, 'rgba(5, 12, 22, 0.96)');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(layout.panelX, layout.panelY, layout.panelW, layout.panelH);
    this.ctx.strokeStyle = 'rgba(122, 198, 250, 0.68)';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(layout.panelX, layout.panelY, layout.panelW, layout.panelH);

    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = 'rgba(232, 246, 255, 0.98)';
    this.ctx.font = `900 ${layout.titleFont}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText('MENU', layout.panelX + layout.panelW / 2, layout.panelY + 34);
    this.ctx.fillStyle = 'rgba(152, 210, 246, 0.96)';
    this.ctx.font = `700 ${layout.metaFont}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(`MODO: ${this.state === 'SPECTATING' ? 'ESPECTADOR' : 'JOGANDO'} | ${modeLabel}`, layout.panelX + layout.panelW / 2, layout.panelY + 56);

    const drawMenuBtn = (rect, label, active, palette) => {
      const grad = this.ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      grad.addColorStop(0, active ? palette.hoverTop : palette.top);
      grad.addColorStop(1, active ? palette.hoverBottom : palette.bottom);
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      this.ctx.strokeStyle = active ? palette.hoverBorder : palette.border;
      this.ctx.lineWidth = 1.8;
      this.ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      this.ctx.fillStyle = 'rgb(240, 247, 255)';
      this.ctx.font = `900 ${layout.labelFont}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    };

    drawMenuBtn(layout.continueBtn, 'CONTINUAR', hover.continue, {
      top: 'rgba(38, 102, 162, 0.92)',
      bottom: 'rgba(22, 66, 118, 0.95)',
      border: 'rgba(114, 200, 255, 0.72)',
      hoverTop: 'rgba(58, 132, 202, 0.96)',
      hoverBottom: 'rgba(32, 88, 142, 0.96)',
      hoverBorder: 'rgba(182, 236, 255, 0.96)',
    });

    if (layout.hasWatch && layout.watchBtn) {
      drawMenuBtn(layout.watchBtn, 'ASSISTIR MAPA', hover.watch, {
        top: 'rgba(117, 78, 23, 0.92)',
        bottom: 'rgba(88, 56, 14, 0.95)',
        border: 'rgba(236, 189, 106, 0.72)',
        hoverTop: 'rgba(164, 112, 28, 0.96)',
        hoverBottom: 'rgba(118, 76, 18, 0.96)',
        hoverBorder: 'rgba(255, 219, 155, 0.96)',
      });
    }

    drawMenuBtn(layout.soundBtn, `SOM: ${this.soundEnabled ? 'ON' : 'OFF'}`, hover.sound, {
      top: 'rgba(24, 122, 102, 0.92)',
      bottom: 'rgba(10, 84, 68, 0.95)',
      border: 'rgba(126, 244, 213, 0.72)',
      hoverTop: 'rgba(33, 156, 132, 0.96)',
      hoverBottom: 'rgba(16, 108, 92, 0.96)',
      hoverBorder: 'rgba(188, 255, 238, 0.96)',
    });

    this.ctx.fillStyle = 'rgba(173, 214, 242, 0.95)';
    this.ctx.font = `700 ${layout.metaFont}px ${UI_FONT_FAMILY}`;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText('SENSIBILIDADE MOUSE/TOQUE', layout.sensMinus.x, layout.sensMinus.y - (layout.compact ? 16 : 18));
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const drawSmallBtn = (rect, label, active) => {
      const grad = this.ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      grad.addColorStop(0, active ? 'rgba(64, 142, 214, 0.96)' : 'rgba(32, 94, 154, 0.92)');
      grad.addColorStop(1, active ? 'rgba(36, 102, 165, 0.96)' : 'rgba(18, 64, 112, 0.95)');
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      this.ctx.strokeStyle = active ? 'rgba(186, 232, 255, 0.96)' : 'rgba(112, 190, 242, 0.72)';
      this.ctx.lineWidth = 1.4;
      this.ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      this.ctx.fillStyle = 'rgba(236, 246, 255, 0.98)';
      this.ctx.font = `900 ${clamp(Math.round(rect.h * 0.56), 20, 26)}px ${UI_FONT_FAMILY}`;
      this.ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    };

    drawSmallBtn(layout.sensMinus, '-', hover.sensMinus);
    drawSmallBtn(layout.sensPlus, '+', hover.sensPlus);
    this.ctx.fillStyle = 'rgba(240, 247, 255, 0.98)';
    this.ctx.font = `900 ${layout.valueFont}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(`${this.inputSensitivity.toFixed(2)}x`, layout.panelX + layout.panelW / 2, layout.sensMinus.y + layout.sensMinus.h / 2 + 1);

    drawMenuBtn(layout.exitBtn, 'SAIR DO JOGO', hover.exit, {
      top: 'rgba(145, 38, 38, 0.93)',
      bottom: 'rgba(95, 24, 24, 0.95)',
      border: 'rgba(240, 102, 102, 0.85)',
      hoverTop: 'rgba(186, 50, 50, 0.97)',
      hoverBottom: 'rgba(126, 32, 32, 0.97)',
      hoverBorder: 'rgba(255, 158, 158, 0.95)',
    });
  }

  drawMobileControls() {
    if (!this.isMobile) return;
    if (!(this.state === 'PLAYING' || this.state === 'SPECTATING')) return;

    const menuBtn = this.getMobileMenuButton();
    const compact = this.isCompactUi();
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(10, 22, 38, 0.72)';
    this.ctx.fillRect(menuBtn.x, menuBtn.y, menuBtn.w, menuBtn.h);
    this.ctx.strokeStyle = 'rgba(120, 206, 255, 0.82)';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(menuBtn.x, menuBtn.y, menuBtn.w, menuBtn.h);
    this.ctx.strokeStyle = 'rgba(228, 242, 255, 0.95)';
    this.ctx.lineWidth = 2.2;
    const padX = menuBtn.w * 0.24;
    const y1 = menuBtn.y + menuBtn.h * 0.3;
    const y2 = menuBtn.y + menuBtn.h * 0.5;
    const y3 = menuBtn.y + menuBtn.h * 0.7;
    this.ctx.beginPath();
    this.ctx.moveTo(menuBtn.x + padX, y1); this.ctx.lineTo(menuBtn.x + menuBtn.w - padX, y1);
    this.ctx.moveTo(menuBtn.x + padX, y2); this.ctx.lineTo(menuBtn.x + menuBtn.w - padX, y2);
    this.ctx.moveTo(menuBtn.x + padX, y3); this.ctx.lineTo(menuBtn.x + menuBtn.w - padX, y3);
    this.ctx.stroke();
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = 'rgba(180, 220, 246, 0.9)';
    this.ctx.font = `700 ${compact ? 10 : 11}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText('MENU', menuBtn.x + menuBtn.w / 2, menuBtn.y + menuBtn.h + 4);
    this.ctx.restore();

    if (this.state !== 'PLAYING' || this.pauseMenuOpen) return;
    const movePad = this.getMobileMovePad();
    const moveActive = this.mobileMoveTouchId !== null && this.mobileMoveStick.active;
    const knobX = moveActive
      ? this.mobileMoveStick.anchorX + this.mobileMoveStick.x * movePad.maxTravel
      : movePad.cx;
    const knobY = moveActive
      ? this.mobileMoveStick.anchorY + this.mobileMoveStick.y * movePad.maxTravel
      : movePad.cy;

    const padGlow = this.ctx.createRadialGradient(movePad.cx, movePad.cy, movePad.r * 0.2, movePad.cx, movePad.cy, movePad.r);
    padGlow.addColorStop(0, moveActive ? 'rgba(90, 182, 255, 0.5)' : 'rgba(56, 118, 176, 0.28)');
    padGlow.addColorStop(1, 'rgba(8, 24, 44, 0.12)');
    this.ctx.fillStyle = padGlow;
    this.ctx.beginPath();
    this.ctx.arc(movePad.cx, movePad.cy, movePad.r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = moveActive ? 'rgba(170, 226, 255, 0.9)' : 'rgba(112, 178, 222, 0.72)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = 'rgba(34, 88, 138, 0.82)';
    this.ctx.beginPath();
    this.ctx.arc(knobX, knobY, movePad.knobR, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(198, 240, 255, 0.92)';
    this.ctx.lineWidth = 1.8;
    this.ctx.stroke();
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = 'rgba(172, 222, 250, 0.92)';
    this.ctx.font = `700 ${compact ? 10 : 11}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText('MOVER', movePad.cx, movePad.cy + movePad.r + 4);

    const turbo = this.getMobileTurboButton();
    const active = this.qPressed || this.mobileTurboTouchId !== null;
    const turboReady = this.player.mass > 1.05;
    const tg = this.ctx.createRadialGradient(turbo.cx - turbo.r * 0.3, turbo.cy - turbo.r * 0.3, turbo.r * 0.2, turbo.cx, turbo.cy, turbo.r);
    if (active) {
      tg.addColorStop(0, 'rgba(220, 250, 255, 0.98)');
      tg.addColorStop(0.5, 'rgba(96, 196, 255, 0.9)');
      tg.addColorStop(1, 'rgba(32, 120, 198, 0.88)');
    } else if (!turboReady) {
      tg.addColorStop(0, 'rgba(192, 208, 220, 0.78)');
      tg.addColorStop(0.55, 'rgba(84, 104, 124, 0.72)');
      tg.addColorStop(1, 'rgba(40, 60, 88, 0.72)');
    } else {
      tg.addColorStop(0, 'rgba(202, 236, 255, 0.94)');
      tg.addColorStop(0.55, 'rgba(74, 155, 225, 0.82)');
      tg.addColorStop(1, 'rgba(26, 90, 152, 0.78)');
    }
    this.ctx.fillStyle = tg;
    this.ctx.beginPath();
    this.ctx.arc(turbo.cx, turbo.cy, turbo.r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = active ? 'rgba(226, 248, 255, 0.98)' : 'rgba(148, 218, 255, 0.9)';
    this.ctx.lineWidth = 2.2;
    this.ctx.stroke();

    const turboCharge = clamp((this.player.mass - 1.05) / 2.4, 0, 1);
    this.ctx.strokeStyle = turboReady ? 'rgba(172, 240, 255, 0.96)' : 'rgba(150, 170, 190, 0.65)';
    this.ctx.lineWidth = 2.4;
    this.ctx.beginPath();
    this.ctx.arc(turbo.cx, turbo.cy, turbo.r * 0.84, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * turboCharge);
    this.ctx.stroke();

    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = turboReady ? 'rgb(244, 251, 255)' : 'rgba(216, 225, 234, 0.9)';
    this.ctx.font = `900 ${clamp(Math.round(turbo.r * 0.64), 20, 34)}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText('Q', turbo.cx, turbo.cy - turbo.r * 0.13);
    this.ctx.font = `700 ${clamp(Math.round(turbo.r * 0.28), 11, 14)}px ${UI_FONT_FAMILY}`;
    this.ctx.fillText(turboReady ? 'TURBO' : 'RECARGA', turbo.cx, turbo.cy + turbo.r * 0.36);
  }

  drawPlaying() {
    const shakeFrac = this.shakeMax > 0 && this.shakeTimer > 0 ? this.shakeTimer / this.shakeMax : 0;
    this.drawBackground(false);
    this.drawGrid();
    this.drawBorder();
    for (const food of this.foods) this.drawFood(food);
    this.drawTrail();
    for (const sw of this.shockwaves) this.drawShockwave(sw);
    this.drawParticles();
    for (const bot of this.bots) this.drawCell(bot, false);
    if (this.state !== 'SPECTATING') this.drawCell(this.player, true);

    if (this.connectionStatus) {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.font = 'bold 36px Consolas, monospace';
      this.ctx.fillStyle = 'rgb(220, 220, 220)';
      this.ctx.fillText(this.connectionStatus, this.width / 2, this.height / 2);
    }

    this.drawHud(shakeFrac);
    this.drawMobileControls();

    if (this.state === 'GAMEOVER') {
      this.drawGameOverOverlay();
    } else if (this.state === 'SPECTATING') {
      this.drawSpectatingOverlay();
    }

    if (this.pauseMenuOpen && (this.state === 'PLAYING' || this.state === 'SPECTATING')) {
      this.drawPauseMenuOverlay();
    }

    if (this.state !== 'SPECTATING' && !this.isMobile && !this.pauseMenuOpen) this.drawCursor();
  }

  draw() {
    if (this.state === 'DASHBOARD') this.drawDashboard();
    else this.drawPlaying();
  }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.accumulator += dt;
    while (this.accumulator >= FIXED_STEP) {
      this.updateFixed();
      this.accumulator -= FIXED_STEP;
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }
}

export default function App() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [gameState, setGameState] = useState('DASHBOARD');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const game = new WebAgarGame(canvas);
    game.setup();
    game.start();
    gameRef.current = game;

    const interval = setInterval(() => {
      setGameState((prev) => (prev === game.state ? prev : game.state));
    }, 200);

    const overrideMouseDown = (e) => {
      if (e.button !== 0) return;
      if (game.state === 'GAMEOVER') game.handleGameOverClick();
      else if (game.state === 'SPECTATING') game.handleSpectatingClick();
    };
    window.addEventListener('mousedown', overrideMouseDown);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mousedown', overrideMouseDown);
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="game-root">
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', background: '#02040a', opacity: gameState === 'DASHBOARD' ? 1 : 0, transition: 'opacity 0.2s' }}>
        {gameState === 'DASHBOARD' && (
          <div style={{ position: 'absolute', inset: 0 }}>
            <Galaxy
              transparent={true}
              mouseRepulsion={true}
              repulsionStrength={2.5}
              glowIntensity={0.6}
              starSpeed={1.0}
              speed={1.0}
              density={1.5}
            />
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="game-canvas" style={{ position: 'relative', zIndex: 2 }} />
    </div>
  );
}
