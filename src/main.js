import kaplay from "kaplay";
import "kaplay/global";
import aitaTitles from "./aita-titles.json";

const k = kaplay({
  background: [135, 206, 235],
});

k.loadRoot("./");

k.loadSprite("twiggy", "sprites/Twiggy_spritesheet.png", {
  sliceX: 12,
  sliceY: 6,
  anims: {
    idle: { from: 25, to: 26, loop: true, speed: 3 },
    run: { from: 39, to: 42, loop: true, speed: 12 },
    jump: 31,
    fall: 40,
    dash: 52,
    hurt: 49,
  },
});

const PLATFORM_SCALE = 2;
const EDGE_W = 16;
const MID_W = 16;
const TILE_H = 30;
k.loadSprite("groundLeft", "sprites/groundLeft.png");
k.loadSprite("groundMid", "sprites/groundMid.png");
k.loadSprite("groundRight", "sprites/groundRight.png");
for (const b of ["snow", "sand", "autumn"]) {
  for (const part of ["Left", "Mid", "Right"]) {
    k.loadSprite(`${b}${part}`, `sprites/${b}${part}.png`);
  }
}
const BIOMES = ["ground", "snow", "sand", "autumn"];
const BIOME_PLATFORMS = 30;
const BIOME_BG = {
  ground: [135, 206, 235],
  snow: [136, 100, 147],
  sand: [135, 206, 235],
  autumn: [136, 100, 147],
};

const MOVE_SPEED = 240;
const SPEED_COIN_GAIN = 250;
const SPEED_CAP_COINS = 20;
const SPEED_CURVE_K = 0.5;
const JUMP_FORCE = 640;

const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.1;
const JUMP_CUT = 0.4;

const DASH_FREEZE = 0.07;
const DASH_SPEED = 820;
const DASH_DURATION = 0.14;
const DASH_COOLDOWN = 0.45;
const DASH_VERTICAL_SCALE = 0.5;
const DASH_UPWARD_HORIZONTAL_SCALE = 0.4;
const DASH_HORIZONTAL_SCALE = 1.9;
const DASH_H_GAIN = 0.4;

k.setGravity(1600);

const PLATFORM_H = TILE_H * PLATFORM_SCALE;
const BG_BOUNDARY_PAD = 28;
const PLAYER_FEET = 32;
const MAX_VEL = 1600;
const groundY = k.height() - TILE_H * PLATFORM_SCALE;
const SPAWN = k.vec2(120, groundY - PLAYER_FEET);

const player = k.add([
  k.sprite("twiggy", { anim: "idle" }),
  k.pos(SPAWN.x, SPAWN.y),
  k.area({ scale: k.vec2(0.7, 0.85), offset: k.vec2(0, 2.4) }),
  k.body(),
  k.anchor("center"),
  k.scale(2),
  k.z(10),
  "player",
]);

let currentAnim = "idle";
function setAnim(name) {
  if (currentAnim !== name) {
    player.play(name);
    currentAnim = name;
  }
}

function makePlatform(x, y, midCount, biome = "ground") {
  const S = PLATFORM_SCALE;
  const w = (EDGE_W * 2 + MID_W * midCount) * S;
  const platform = k.add([
    k.pos(x, y),
    k.area({ shape: new k.Rect(k.vec2(0), w, TILE_H * S) }),
    k.body({ isStatic: true }),
    { spanW: w },
    "platform",
  ]);
  platform.onBeforePhysicsResolve((col) => {
    const p = col.target;
    if (p !== player) return;
    if (p.vel.y < -20) {
      col.preventResolution();
      return;
    }
    const prevFeet = p.pos.y + PLAYER_FEET - p.vel.y * k.dt();
    if (prevFeet > platform.pos.y + 4) col.preventResolution();
  });
  platform.add([k.pos(0, 0), k.sprite(`${biome}Left`), k.scale(S)]);
  for (let i = 0; i < midCount; i++) {
    platform.add([
      k.pos((EDGE_W + i * MID_W) * S, 0),
      k.sprite(`${biome}Mid`),
      k.scale(S),
    ]);
  }
  platform.add([
    k.pos(w - EDGE_W * S, 0),
    k.sprite(`${biome}Right`),
    k.scale(S),
  ]);
  return platform;
}

function makeFloatingPlatform(x, y, midCount, biome) {
  const platform = makePlatform(x, y, midCount, biome);
  platform.use("floating");
  return platform;
}

const groundMids =
  Math.ceil((k.width() / PLATFORM_SCALE - EDGE_W * 2) / MID_W) + 1;
makePlatform(0, groundY, groundMids);

const MOVES = [
  { dyMin: 65, dyMax: 110, dxMin: 20, dxMax: 90 },
  { dyMin: 130, dyMax: 175, dxMin: 150, dxMax: 195 },
  { dyMin: 60, dyMax: 100, dxMin: 300, dxMax: 335 },
];
const MIN_MID = 3;
const MAX_MID = 8;
const GEN_LOOKAHEAD = k.height() + 300;

let highestY = groundY;
let prevX = k.width() / 2;
let prevW = 0;
let platformIndex = 0;

let biomeBands = [{ y: groundY, biome: "ground" }];

function spawnNextPlatform() {
  const biome =
    BIOMES[Math.floor(platformIndex / BIOME_PLATFORMS) % BIOMES.length];
  platformIndex += 1;

  const move = MOVES[Math.floor(Math.random() * MOVES.length)];
  const midCount =
    MIN_MID + Math.floor(Math.random() * (MAX_MID - MIN_MID + 1));
  const newW = (EDGE_W * 2 + MID_W * midCount) * PLATFORM_SCALE;
  const dy = Math.max(
    PLATFORM_H,
    move.dyMin + Math.random() * (move.dyMax - move.dyMin),
  );
  const dx = move.dxMin + Math.random() * (move.dxMax - move.dxMin);
  highestY -= dy;

  if (biomeBands[biomeBands.length - 1].biome !== biome) {
    biomeBands.push({ y: highestY + PLATFORM_H + BG_BOUNDARY_PAD, biome });
  }

  const minX = 20;
  const maxX = k.width() - newW - 20;
  const xRight = prevX + prevW + dx;
  const xLeft = prevX - dx - newW;
  const canRight = xRight <= maxX;
  const canLeft = xLeft >= minX;
  let x;
  if (canRight && canLeft) x = Math.random() < 0.5 ? xRight : xLeft;
  else if (canRight) x = xRight;
  else if (canLeft) x = xLeft;
  else x = Math.max(minX, Math.min(maxX, xRight));

  makeFloatingPlatform(x, highestY, midCount, biome);
  prevX = x;
  prevW = newW;
}

function regeneratePlatforms() {
  for (const p of k.get("floating")) p.destroy();
  highestY = groundY;
  prevX = k.width() / 2;
  prevW = 0;
  platformIndex = 0;
  biomeBands = [{ y: groundY, biome: "ground" }];
  while (highestY > player.pos.y - GEN_LOOKAHEAD) spawnNextPlatform();
}

regeneratePlatforms();

k.onUpdate(() => {
  while (highestY > player.pos.y - GEN_LOOKAHEAD) {
    spawnNextPlatform();
  }
});

function bgColorAt(worldY) {
  let idx = 0;
  for (let i = 0; i < biomeBands.length; i++) {
    if (biomeBands[i].y >= worldY) idx = i;
    else break;
  }
  return BIOME_BG[biomeBands[idx].biome];
}
k.add([
  k.pos(0, 0),
  k.z(-1000),
  {
    draw() {
      const M = 120;
      const W = k.width();
      const H = k.height();
      const camY = k.getCamPos().y;
      const top = camY - H / 2 - M;
      const bot = camY + H / 2 + M;
      const edges = [];
      for (let i = 1; i < biomeBands.length; i++) {
        const by = biomeBands[i].y;
        if (by > top && by < bot) edges.push(by);
      }
      edges.sort((a, b) => a - b);
      edges.push(bot);
      let y = top;
      for (const edge of edges) {
        const c = bgColorAt((y + edge) / 2);
        k.drawRect({
          pos: k.vec2(-M, y),
          width: W + M * 2,
          height: edge - y + 1,
          color: k.rgb(c[0], c[1], c[2]),
        });
        y = edge;
      }
    },
  },
]);

let facing = 1;
let dashVel = k.vec2(0, 0);
let dashReady = true;
let freezeTimer = 0;
let dashTimer = 0;
let dashCooldown = 0;
let started = false;

function spawnDashGhost() {
  const ghost = k.add([
    k.sprite("twiggy", { frame: player.frame }),
    k.pos(player.pos.x, player.pos.y),
    k.anchor("center"),
    k.scale(2),
    k.color(225, 248, 255),
    k.opacity(0.5),
    k.z(9),
    k.lifespan(0.45, { fade: 0.45 }),
  ]);
  ghost.flipX = player.flipX;
}

player.onUpdate(() => {
  if (!started) return;
  const dir = (k.isKeyDown("d") ? 1 : 0) - (k.isKeyDown("a") ? 1 : 0);
  if (dir !== 0) facing = dir;

  dashCooldown = Math.max(0, dashCooldown - k.dt());

  if (freezeTimer > 0) {
    freezeTimer -= k.dt();
    player.gravityScale = 0;
    player.vel = k.vec2(0, 0);
  } else if (dashTimer > 0) {
    dashTimer -= k.dt();
    player.gravityScale = 0;
    player.vel = k.vec2(dashVel.x, dashVel.y);
    spawnDashGhost();
  } else {
    player.gravityScale = 1;
    player.vel.x = dir * (MOVE_SPEED + SPEED_COIN_GAIN * coinPower());
    if (player.vel.y > MAX_VEL) player.vel.y = MAX_VEL;
    if (player.isGrounded()) dashReady = true;
  }

  if (player.pos.x < 0) player.pos.x += k.width();
  else if (player.pos.x > k.width()) player.pos.x -= k.width();

  player.flipX = facing < 0;
  if (freezeTimer > 0 || dashTimer > 0) {
    setAnim("dash");
  } else if (!player.isGrounded()) {
    setAnim(player.vel.y < 0 ? "jump" : "fall");
  } else if (dir !== 0) {
    setAnim("run");
  } else {
    setAnim("idle");
  }
});

k.onKeyPress("k", () => {
  if (!started) return;
  if (!dashReady || player.isGrounded()) return;
  if (dashCooldown > 0 || freezeTimer > 0 || dashTimer > 0) return;

  const dx = (k.isKeyDown("d") ? 1 : 0) - (k.isKeyDown("a") ? 1 : 0);
  const dy = (k.isKeyDown("s") ? 1 : 0) - (k.isKeyDown("w") ? 1 : 0);
  if (dx === 0 && dy < 0) return;

  const aim = dx === 0 && dy === 0 ? k.vec2(facing, 0) : k.vec2(dx, dy).unit();
  let hScale = 1;
  if (aim.y < 0) hScale = DASH_UPWARD_HORIZONTAL_SCALE;
  else if (aim.y === 0) hScale = DASH_HORIZONTAL_SCALE;

  const hBoost = 1 + DASH_H_GAIN * coinPower();
  dashVel = k.vec2(
    aim.x * hScale * DASH_SPEED * hBoost,
    aim.y * DASH_VERTICAL_SCALE * DASH_SPEED,
  );
  if (dashVel.x !== 0) facing = dashVel.x > 0 ? 1 : -1;

  dashReady = false;
  freezeTimer = DASH_FREEZE;
  dashTimer = DASH_DURATION;
  dashCooldown = DASH_COOLDOWN + DASH_FREEZE;
  k.shake(5);
});

let coyoteTimer = 0;
let bufferTimer = 0;

player.onUpdate(() => {
  coyoteTimer = player.isGrounded()
    ? COYOTE_TIME
    : Math.max(0, coyoteTimer - k.dt());
  bufferTimer = Math.max(0, bufferTimer - k.dt());

  if (bufferTimer > 0 && coyoteTimer > 0) {
    player.jump(JUMP_FORCE);
    coyoteTimer = 0;
    bufferTimer = 0;
  }
});

k.onKeyPress("w", requestJump);
k.onKeyPress("space", requestJump);

function requestJump() {
  if (!started) return;
  bufferTimer = JUMP_BUFFER;
}

function cutJump() {
  if (player.vel.y < 0) {
    player.vel.y *= JUMP_CUT;
  }
}

k.onKeyRelease("w", cutJump);
k.onKeyRelease("space", cutJump);

k.setCamPos(k.width() / 2, k.height() / 2);
player.onUpdate(() => {
  const targetY = Math.min(k.height() / 2, player.pos.y);
  const cam = k.getCamPos();
  k.setCamPos(cam.x, k.lerp(cam.y, targetY, 0.1));
});

const FALLBACK_STORIES = [
  {
    title: "(couldn't reach r/AmItheAsshole — showing placeholders)",
    text: "",
  },
  {
    title: "AITA for eating the last slice of pizza I'd labeled with my name?",
    text: "",
  },
  {
    title:
      "AITA for telling my roommate the plant is fake and always has been?",
    text: "",
  },
  { title: "AITA for refusing to swap seats on a 3 hour flight?", text: "" },
  {
    title: "AITA for skipping my cousin's fourth wedding this year?",
    text: "",
  },
];

const TICKER_WIDTH_RATIO = 0.35;
const TICKER_WIDTH = Math.round(k.width() * TICKER_WIDTH_RATIO);
const TICKER_SPEED = 30;
const TICKER_TITLE_SIZE = 30;
const TICKER_BODY_SIZE = 20;
const TICKER_TITLE_BODY_GAP = 8;
const TICKER_STORY_GAP = 32;
const TICKER_PADDING_RATIO = 0.05;
const TICKER_PADDING = Math.round(k.width() * TICKER_PADDING_RATIO);

const TICKER_FONT_SCALE = 1.3;

const TICKER_REVEAL_RADIUS = 180;
const TICKER_REVEAL_ALPHA = 0.25;
const TICKER_REVEAL_SOFT = 48;
const TICKER_EDGE_FADE = 40;

k.loadShader(
  "tickerReveal",
  null,
  `
uniform vec2 u_circlePos;
uniform float u_circleRadius;
uniform vec2 u_resolution;

vec4 frag(vec2 pos, vec2 uv, vec4 color, sampler2D tex) {
  vec4 c = def_frag();
  vec2 screenPos = vec2(
    (pos.x * 0.5 + 0.5) * u_resolution.x,
    (1.0 - (pos.y * 0.5 + 0.5)) * u_resolution.y
  );
  float d = distance(screenPos, u_circlePos);
  float t = smoothstep(u_circleRadius, u_circleRadius - ${TICKER_REVEAL_SOFT}.0, d);
  float edgeLeft = u_resolution.x - ${TICKER_WIDTH}.0;
  float edge = smoothstep(edgeLeft, edgeLeft + ${TICKER_EDGE_FADE}.0, screenPos.x);
  return c * mix(1.0, ${TICKER_REVEAL_ALPHA}, t) * edge;
}
`,
);

function tickerRevealUniform() {
  return {
    u_circlePos: player.screenPos(),
    u_circleRadius: TICKER_REVEAL_RADIUS,
    u_resolution: k.vec2(k.width(), k.height()),
  };
}

k.add([
  k.rect(TICKER_WIDTH, k.height()),
  k.pos(k.width() - TICKER_WIDTH, 0),
  k.color(255, 255, 255),
  k.shader("tickerReveal", tickerRevealUniform),
  k.fixed(),
  k.z(50),
]);

function renderStoryBitmap(story, fontScale) {
  const innerWidth = TICKER_WIDTH - TICKER_PADDING * 2;
  const titleSize = Math.round(TICKER_TITLE_SIZE * fontScale);
  const bodySize = Math.round(TICKER_BODY_SIZE * fontScale);
  const titleFont = `bold ${titleSize}px monospace`;
  const bodyFont = `${bodySize}px monospace`;
  const titleLineH = Math.round(titleSize * 1.3);
  const bodyLineH = Math.round(bodySize * 1.4);
  const titleBodyGap = Math.round(TICKER_TITLE_BODY_GAP * fontScale);

  const measurer = document.createElement("canvas").getContext("2d");

  function wrap(text, font) {
    measurer.font = font;
    const lines = [];
    for (const paragraph of text.split("\n")) {
      if (paragraph === "") {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(" ")) {
        const attempt = line ? `${line} ${word}` : word;
        if (line && measurer.measureText(attempt).width > innerWidth) {
          lines.push(line);
          line = word;
        } else {
          line = attempt;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  const ops = [];
  let y = 0;
  for (const line of wrap(story.title, titleFont)) {
    y += titleLineH;
    ops.push({ text: line, y, font: titleFont, color: "#000" });
  }
  if (story.text) {
    y += titleBodyGap;
    for (const line of wrap(story.text, bodyFont)) {
      y += bodyLineH;
      ops.push({ text: line, y, font: bodyFont, color: "#464646" });
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = TICKER_WIDTH;
  canvas.height = Math.ceil(y);
  const ctx = canvas.getContext("2d");
  for (const op of ops) {
    ctx.font = op.font;
    ctx.fillStyle = op.color;
    ctx.fillText(op.text, TICKER_PADDING, op.y);
  }

  return { dataUrl: canvas.toDataURL(), height: canvas.height };
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const stories = shuffled(
  Array.isArray(aitaTitles) && aitaTitles.length > 0
    ? aitaTitles
    : FALLBACK_STORIES,
);

const ticker = k.add([
  k.pos(k.width() - TICKER_WIDTH, k.height()),
  k.fixed(),
  k.z(51),
]);

const TICKER_WINDOW_BUFFER = 200;
const activeItems = new Map();
let items = [];
let tickerLoopHeight = 0;
let bitmapGen = 0;

function buildTicker(fontScale) {
  for (const obj of activeItems.values()) obj.destroy();
  activeItems.clear();
  bitmapGen += 1;
  const bitmaps = stories.map((story, i) => {
    const { dataUrl, height } = renderStoryBitmap(story, fontScale);
    const name = `story_${bitmapGen}_${i}`;
    k.loadSprite(name, dataUrl);
    return { name, height };
  });
  const gap = Math.round(TICKER_STORY_GAP * fontScale);
  items = [];
  let y = 0;
  for (const bitmap of [...bitmaps, ...bitmaps]) {
    items.push({ name: bitmap.name, height: bitmap.height, y });
    y += bitmap.height + gap;
  }
  tickerLoopHeight = items.length ? items[items.length / 2].y : 0;
}

function syncTickerWindow() {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const top = ticker.pos.y + item.y;
    const bottom = top + item.height;
    const visible =
      bottom >= -TICKER_WINDOW_BUFFER &&
      top <= k.height() + TICKER_WINDOW_BUFFER;
    if (visible && !activeItems.has(i)) {
      activeItems.set(
        i,
        ticker.add([
          k.sprite(item.name),
          k.pos(0, item.y),
          k.shader("tickerReveal", tickerRevealUniform),
        ]),
      );
    } else if (!visible && activeItems.has(i)) {
      activeItems.get(i).destroy();
      activeItems.delete(i);
    }
  }
}

buildTicker(TICKER_FONT_SCALE);
syncTickerWindow();

ticker.onUpdate(() => {
  ticker.pos.y -= TICKER_SPEED * k.dt();
  if (ticker.pos.y <= k.height() - tickerLoopHeight) {
    ticker.pos.y += tickerLoopHeight;
  }
  syncTickerWindow();
});

const TICKER_LEFT = k.width() - TICKER_WIDTH;
let secrets = 0;

function coinPower() {
  const t = Math.min(secrets, SPEED_CAP_COINS) / SPEED_CAP_COINS;
  return t + (SPEED_CURVE_K / (2 * Math.PI)) * Math.sin(2 * Math.PI * t);
}

const AURA_BASE = 30;
const AURA_RANGE = 95;
const AURA_RX = 16;
const AURA_RY = 16;
const AURA_GROW_RATE = 0.015;
const AURA_SPIKES = 499;
const AURA_SPIKE_AMOUNT = 0.9;
const AURA_FRAMES = 8;
const AURA_TILE = 200;

function drawAuraFrame(ctx, cx, cy, phase) {
  const maxR = Math.max(AURA_RX, AURA_RY) * (1 + AURA_SPIKE_AMOUNT);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  grad.addColorStop(0, "rgba(255,238,170,0.95)");
  grad.addColorStop(0.4, "rgba(255,200,60,0.8)");
  grad.addColorStop(1, "rgba(255,130,10,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const upFactor = Math.max(0, -Math.sin(angle));
    const spike =
      1 +
      AURA_SPIKE_AMOUNT *
        (0.5 + 0.5 * Math.sin(angle * AURA_SPIKES + phase)) *
        (0.3 + 0.7 * upFactor);
    const x = cx + Math.cos(angle) * AURA_RX * spike;
    const y = cy + Math.sin(angle) * AURA_RY * spike;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function buildAuraSpritesheet() {
  const canvas = document.createElement("canvas");
  canvas.width = AURA_TILE * AURA_FRAMES;
  canvas.height = AURA_TILE;
  const ctx = canvas.getContext("2d");
  for (let f = 0; f < AURA_FRAMES; f++) {
    drawAuraFrame(
      ctx,
      AURA_TILE * f + AURA_TILE / 2,
      AURA_TILE / 2 + 8,
      (f / AURA_FRAMES) * Math.PI * 2,
    );
  }
  return canvas.toDataURL();
}

k.loadSprite("aura", buildAuraSpritesheet(), {
  sliceX: AURA_FRAMES,
  sliceY: 1,
  anims: { flicker: { from: 0, to: AURA_FRAMES - 1, loop: true, speed: 14 } },
});

const aura = k.add([
  k.sprite("aura", { anim: "flicker" }),
  k.pos(player.pos.clone()),
  k.anchor("center"),
  k.color(255, 214, 96),
  k.opacity(0.65),
  k.z(-1),
]);
aura.hidden = true;
let auraGrowth = 0;
aura.onUpdate(() => {
  aura.pos = player.pos.clone();
  const targetGrowth = (AURA_BASE + AURA_RANGE * coinPower()) / AURA_BASE;
  auraGrowth = k.lerp(auraGrowth, targetGrowth, AURA_GROW_RATE);
  aura.scale = k.vec2(auraGrowth * (1 + Math.sin(k.time() * 5) * 0.06));
});

function spawnGem(x, y) {
  const gem = k.add([
    k.rect(18, 18),
    k.pos(x, y),
    k.anchor("center"),
    k.rotate(45),
    k.color(255, 214, 74),
    k.outline(3, k.rgb(255, 255, 255)),
    k.area(),
    k.z(8),
    "gem",
    { seed: Math.random() * 6.28 },
  ]);
  gem.onUpdate(() => {
    gem.scale = k.vec2(1 + Math.sin(k.time() * 4 + gem.seed) * 0.18);
  });
}

const GEM_HALF = 20;
const GEM_MIN_X = TICKER_LEFT + TICKER_EDGE_FADE + GEM_HALF;
const GEM_MAX_X = k.width() - GEM_HALF;

k.onUpdate(() => {
  for (const p of k.get("floating")) {
    if (p.gemDecided) continue;
    p.gemDecided = true;
    const span = p.spanW || 0;
    if (p.pos.x + span > GEM_MIN_X && Math.random() < 0.85) {
      const gx = Math.min(GEM_MAX_X, Math.max(GEM_MIN_X, p.pos.x + span / 2));
      spawnGem(gx, p.pos.y - 30);
    }
  }
});

player.onCollide("gem", (gem) => {
  const at = gem.pos.clone();
  gem.destroy();
  secrets += 1;
  aura.hidden = false;
  k.shake(4);
  for (let i = 0; i < 10; i++) {
    k.add([
      k.rect(5, 5),
      k.pos(at),
      k.anchor("center"),
      k.color(255, 232, 130),
      k.z(11),
      k.move((i / 10) * 360, 220),
      k.opacity(1),
      k.lifespan(0.45, { fade: 0.45 }),
    ]);
  }
  k.add([
    k.text("+1", { size: 24 }),
    k.pos(at),
    k.anchor("center"),
    k.color(255, 222, 90),
    k.outline(3, k.rgb(60, 40, 0)),
    k.z(12),
    k.move(270, 60),
    k.opacity(1),
    k.lifespan(0.7, { fade: 0.7 }),
  ]);
  if (secrets % 5 === 0) {
    k.shake(9);
    k.add([
      k.rect(k.width(), k.height()),
      k.pos(0, 0),
      k.color(255, 240, 180),
      k.opacity(0.45),
      k.fixed(),
      k.z(59),
      k.lifespan(0.35, { fade: 0.35 }),
    ]);
  }
});

const startEls = [];
startEls.push(
  k.add([
    k.rect(k.width(), k.height()),
    k.pos(0, 0),
    k.color(18, 18, 28),
    k.opacity(0.92),
    k.fixed(),
    k.z(200),
  ]),
);
startEls.push(
  k.add([
    k.text("WASD to move & jump", { size: 34 }),
    k.pos(k.width() / 2, k.height() / 2 - 46),
    k.anchor("center"),
    k.color(255, 255, 255),
    k.fixed(),
    k.z(201),
  ]),
);
startEls.push(
  k.add([
    k.text("K to dash", { size: 34 }),
    k.pos(k.width() / 2, k.height() / 2 + 4),
    k.anchor("center"),
    k.color(255, 255, 255),
    k.fixed(),
    k.z(201),
  ]),
);
startEls.push(
  k.add([
    k.text("press any key to start", { size: 20 }),
    k.pos(k.width() / 2, k.height() / 2 + 66),
    k.anchor("center"),
    k.color(190, 190, 205),
    k.fixed(),
    k.z(201),
  ]),
);
k.onKeyPress(() => {
  if (started) return;
  started = true;
  for (const el of startEls) el.destroy();
});
