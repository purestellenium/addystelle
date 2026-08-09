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

const MOVE_SPEED = 240;
const JUMP_FORCE = 640;

const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.1;
const JUMP_CUT = 0.4;

const DASH_FREEZE = 0.07;
const DASH_SPEED = 820;
const DASH_DURATION = 0.14;
const DASH_COOLDOWN = 0.45;
const DASH_VERTICAL_SCALE = 0.5;

k.setGravity(1600);

const PLATFORM_H = TILE_H * PLATFORM_SCALE;
const PLAYER_FEET = 32;
const MAX_VEL = 1600;
const groundY = k.height() - TILE_H * PLATFORM_SCALE;
const SPAWN = k.vec2(120, groundY - PLAYER_FEET);

const player = k.add([
  k.sprite("twiggy", { anim: "idle" }),
  k.pos(SPAWN.x, SPAWN.y),
  k.area({ scale: k.vec2(0.7, 0.85), offset: k.vec2(0, 2.4) }),
  k.body({ maxVelocity: MAX_VEL }),
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

function makePlatform(x, y, midCount) {
  const S = PLATFORM_SCALE;
  const w = (EDGE_W * 2 + MID_W * midCount) * S;
  const platform = k.add([
    k.pos(x, y),
    k.area({ shape: new k.Rect(k.vec2(0), w, TILE_H * S) }),
    k.body({ isStatic: true }),
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
  platform.add([k.pos(0, 0), k.sprite("groundLeft"), k.scale(S)]);
  for (let i = 0; i < midCount; i++) {
    platform.add([
      k.pos((EDGE_W + i * MID_W) * S, 0),
      k.sprite("groundMid"),
      k.scale(S),
    ]);
  }
  platform.add([k.pos(w - EDGE_W * S, 0), k.sprite("groundRight"), k.scale(S)]);
  return { platform, width: w };
}

function makeFloatingPlatform(x, y, midCount) {
  const { platform } = makePlatform(x, y, midCount);
  platform.use("floating");
  return platform;
}

const groundMids =
  Math.ceil((k.width() / PLATFORM_SCALE - EDGE_W * 2) / MID_W) + 1;
makePlatform(0, groundY, groundMids);

const MOVES = [
  { dyMin: 95, dyMax: 120, dxMin: 20, dxMax: 105 },
  { dyMin: 95, dyMax: 108, dxMin: 125, dxMax: 148 },
  { dyMin: 140, dyMax: 182, dxMin: 180, dxMax: 225 },
];
const MIN_MID = 3;
const MAX_MID = 8;
const GEN_LOOKAHEAD = 500;

let highestY = groundY;
let prevX = k.width() / 2;
let prevW = 0;

function spawnNextPlatform() {
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

  makeFloatingPlatform(x, highestY, midCount);
  prevX = x;
  prevW = newW;
}

function regeneratePlatforms() {
  for (const p of k.get("floating")) p.destroy();
  highestY = groundY;
  prevX = k.width() / 2;
  prevW = 0;
  for (let i = 0; i < 6; i++) spawnNextPlatform();
}

regeneratePlatforms();

k.onUpdate(() => {
  while (highestY > player.pos.y - GEN_LOOKAHEAD) {
    spawnNextPlatform();
  }
});

let facing = 1;
let dashDir = k.vec2(1, 0);
let dashReady = true;
let freezeTimer = 0;
let dashTimer = 0;
let dashCooldown = 0;

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
    player.vel = dashDir.scale(DASH_SPEED);
    spawnDashGhost();
  } else {
    player.gravityScale = 1;
    player.vel.x = dir * MOVE_SPEED;
    if (player.isGrounded()) dashReady = true;
  }

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
  if (!dashReady || player.isGrounded()) return;
  if (dashCooldown > 0 || freezeTimer > 0 || dashTimer > 0) return;

  const dx = (k.isKeyDown("d") ? 1 : 0) - (k.isKeyDown("a") ? 1 : 0);
  const dy = (k.isKeyDown("s") ? 1 : 0) - (k.isKeyDown("w") ? 1 : 0);
  if (dx === 0 && dy < 0) return;

  const aim = dx === 0 && dy === 0 ? k.vec2(facing, 0) : k.vec2(dx, dy).unit();
  dashDir = k.vec2(aim.x, aim.y * DASH_VERTICAL_SCALE);
  if (dashDir.x !== 0) facing = dashDir.x > 0 ? 1 : -1;

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
  bufferTimer = JUMP_BUFFER;
}

function cutJump() {
  if (player.vel.y < 0) {
    player.vel.y *= JUMP_CUT;
  }
}

k.onKeyRelease("w", cutJump);
k.onKeyRelease("space", cutJump);

k.camPos(k.width() / 2, k.height() / 2);
player.onUpdate(() => {
  const targetY = Math.min(k.height() / 2, player.pos.y);
  const cam = k.camPos();
  k.camPos(cam.x, k.lerp(cam.y, targetY, 0.1));
});

k.add([
  k.text("A/D move, W/Space jump, K dash (aim with WASD)", { size: 18 }),
  k.pos(12, 12),
  k.color(40, 40, 40),
  k.fixed(),
]);

// --- AITA ticker ---
// Titles are baked in at build time from src/aita-titles.json — refresh with
// `npm run titles` (see scripts/fetch-aita.mjs). Reddit blocks cloud IPs and
// browsers can't fetch it cross-origin, so a live pull isn't possible on static
// hosting; this snapshot updates whenever you re-run the script and rebuild.
// FALLBACK_TITLES shows only if the JSON is somehow empty.
const FALLBACK_TITLES = [
  "(couldn't reach r/AmItheAsshole — showing placeholders)",
  "AITA for eating the last slice of pizza I'd labeled with my name?",
  "AITA for telling my roommate the plant is fake and always has been?",
  "AITA for refusing to swap seats on a 3 hour flight?",
  "AITA for skipping my cousin's fourth wedding this year?",
];

const TICKER_WIDTH = 380;
const TICKER_SPEED = 30; // px/s, scrolling upward
const TICKER_ROW_H = 140; // fixed slot height per title (generous for wrapped text)
const TICKER_TEXT_SIZE = 22;

k.add([
  k.rect(TICKER_WIDTH, k.height()),
  k.pos(k.width() - TICKER_WIDTH, 0),
  k.color(255, 255, 255),
  k.fixed(),
  k.z(50),
]);

const ticker = k.add([
  k.pos(k.width() - TICKER_WIDTH + 12, k.height()),
  k.fixed(),
  k.z(51),
]);
let tickerLoopHeight = 0;

function setTickerTitles(titles) {
  ticker.removeAll();
  // Render the list twice back-to-back so wrapping from the bottom of the
  // second copy back to the top of the first reads as a seamless loop.
  for (const title of [...titles, ...titles]) {
    ticker.add([
      k.text(title, { size: TICKER_TEXT_SIZE, width: TICKER_WIDTH - 24 }),
      k.pos(0, ticker.children.length * TICKER_ROW_H),
      k.color(0, 0, 0),
    ]);
  }
  tickerLoopHeight = titles.length * TICKER_ROW_H;
  ticker.pos.y = k.height();
}

setTickerTitles(
  Array.isArray(aitaTitles) && aitaTitles.length > 0
    ? aitaTitles
    : FALLBACK_TITLES,
);

ticker.onUpdate(() => {
  ticker.pos.y -= TICKER_SPEED * k.dt();
  if (ticker.pos.y <= k.height() - tickerLoopHeight) {
    ticker.pos.y += tickerLoopHeight;
  }
});
