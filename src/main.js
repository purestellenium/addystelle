import kaplay from "kaplay";
import "kaplay/global";

const k = kaplay({
  background: [135, 206, 235], // sky blue
});

k.loadRoot("./"); // A good idea for Itch.io publishing later

k.loadSprite("bgShroom", "platformerGraphics_mushroomLand/Backgrounds/bg_shroom.png");
k.add([
  k.sprite("bgShroom", { width: k.width(), height: k.height() }),
  k.pos(0, 0),
  k.z(-999),
]);

// Twiggy: a 12x6 grid of 32x32 frames. KAPLAY slices it natively — no need
// to split the sheet into separate files. Filled frames by index:
//   row 2: 25-34  (front idle / emotes)
//   row 3: 37-46  (3/4 side poses incl. the walk stride 39-42)
//   row 4: 49-54  (49 KO, 50-51 crouch, 52 arms-out, 53-54 idle variants)
k.loadSprite("twiggy", "sprites/Twiggy_spritesheet.png", {
  sliceX: 12,
  sliceY: 6,
  anims: {
    idle: { from: 25, to: 26, loop: true, speed: 3 },
    run: { from: 39, to: 42, loop: true, speed: 12 },
    jump: 31, // rising pose
    fall: 40, // reuse a stride frame while descending
    dash: 52, // arms-out burst pose
    hurt: 49, // lying / KO
  },
});

// Mushroom-cap platform tiles: each piece is a 70x70 canvas but the drawn
// cap only fills the top 40px (rows 40-69 are transparent padding), so
// Left/Mid/Right tile edge-to-edge to build a cap of any width.
const MUSHROOM_TILE = 70;
const MUSHROOM_CAP_H = 40;
const MUSHROOM_COLORS = ["shroomBrown", "shroomRed", "shroomTan", "shroomBrownSpots"];
for (const color of MUSHROOM_COLORS) {
  for (const part of ["Left", "Mid", "Right"]) {
    k.loadSprite(
      `${color}${part}`,
      `platformerGraphics_mushroomLand/PNG/${color}${part}.png`,
    );
  }
}

// --- Tuning ---
const MOVE_SPEED = 240; // horizontal speed (px/s)
const JUMP_FORCE = 640; // initial jump velocity

// Feel tuning
const COYOTE_TIME = 0.01; // grace period to still jump after leaving a ledge (s)
const JUMP_BUFFER = 0.1; // press jump this early before landing and it still fires (s)
const JUMP_CUT = 0.4; // release jump early -> keep this fraction of upward velocity

// Dash tuning
const DASH_FREEZE = 0.07; // brief hang before the burst — kills momentum first (s)
const DASH_SPEED = 820; // horizontal speed during a dash (px/s)
const DASH_DURATION = 0.14; // how long the burst lasts (s)
const DASH_COOLDOWN = 0.45; // time before you can dash again (s)
const DASH_VERTICAL_SCALE = 0.5; // cut vertical reach of up/diagonal dashes

k.setGravity(1600);

// --- Player ---
const player = k.add([
  k.sprite("twiggy", { anim: "idle" }),
  k.pos(120, 80),
  // Hitbox tuned to the character within the 32px cell (anchor = center, so
  // local Y runs -16 at the top to +16 at the feet). Content spans ~y=5..32,
  // i.e. local -11..+16. Height scale 0.85 -> 27px tall (spans ±13.6); offset
  // +2.4 slides that down so the bottom lands on the feet and the top meets
  // the head instead of empty space. Width 0.7 trims the side padding.
  k.area({ scale: k.vec2(0.7, 0.85), offset: k.vec2(0, 2.4) }),
  k.body(),
  k.anchor("center"),
  k.scale(2),
  "player",
]);

// Play an animation only when it actually changes (play() restarts otherwise).
let currentAnim = "idle";
function setAnim(name) {
  if (currentAnim !== name) {
    player.play(name);
    currentAnim = name;
  }
}

// --- Platforms ---
// A continuous ground strip (Mid tiles only, edge-to-edge) plus a few
// floating mushroom caps (Left + Mid...Mid + Right) in different colors.
function addGroundStrip(x, y, tileCount, color) {
  for (let i = 0; i < tileCount; i++) {
    k.add([k.sprite(`${color}Mid`), k.pos(x + i * MUSHROOM_TILE, y), "platform"]);
  }
  addPlatformBody(x, y, tileCount * MUSHROOM_TILE);
}

function addMushroomCap(x, y, tileCount, color) {
  k.add([k.sprite(`${color}Left`), k.pos(x, y), "platform"]);
  for (let i = 1; i < tileCount - 1; i++) {
    k.add([k.sprite(`${color}Mid`), k.pos(x + i * MUSHROOM_TILE, y), "platform"]);
  }
  k.add([
    k.sprite(`${color}Right`),
    k.pos(x + (tileCount - 1) * MUSHROOM_TILE, y),
    "platform",
  ]);
  addPlatformBody(x, y, tileCount * MUSHROOM_TILE);
}

// Invisible collider matching the cap's visible (non-transparent) band.
function addPlatformBody(x, y, width) {
  k.add([
    k.rect(width, MUSHROOM_CAP_H),
    k.pos(x, y),
    k.area(),
    k.body({ isStatic: true }),
    k.opacity(0),
    "platform",
  ]);
}

const groundY = k.height() - MUSHROOM_CAP_H;
addGroundStrip(0, groundY, Math.ceil(k.width() / MUSHROOM_TILE), "shroomBrown");
addMushroomCap(180, k.height() - 160, 3, "shroomRed");
addMushroomCap(420, k.height() - 260, 3, "shroomTan");
addMushroomCap(120, k.height() - 360, 3, "shroomBrownSpots");

// --- Controls ---
let facing = 1; // last horizontal direction, used for flip + default dash aim
let dashDir = k.vec2(1, 0); // aimed direction of the current dash
let dashReady = true; // one dash per airtime — refills on touching ground
let freezeTimer = 0; // remaining pre-dash hang (s)
let dashTimer = 0; // remaining dash burst (s)
let dashCooldown = 0; // remaining cooldown before next dash (s)

// Horizontal: set velocity directly for instant, drift-free response.
player.onUpdate(() => {
  const dir = (k.isKeyDown("d") ? 1 : 0) - (k.isKeyDown("a") ? 1 : 0);
  if (dir !== 0) facing = dir;

  dashCooldown = Math.max(0, dashCooldown - k.dt());

  if (freezeTimer > 0) {
    // Pre-dash hang: gravity off, all momentum killed so the dash reads clean.
    freezeTimer -= k.dt();
    player.gravityScale = 0;
    player.vel = k.vec2(0, 0);
  } else if (dashTimer > 0) {
    // Burst: fly along the aimed direction, no gravity, input ignored.
    dashTimer -= k.dt();
    player.gravityScale = 0;
    player.vel = dashDir.scale(DASH_SPEED);
  } else {
    // Normal movement — physics fully resumed.
    player.gravityScale = 1;
    player.vel.x = dir * MOVE_SPEED;
    if (player.isGrounded()) dashReady = true; // refill dash on the ground
  }

  // --- Animation state ---
  player.flipX = facing < 0; // sprite art faces right by default
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

// Shift: 8-directional dash aimed by held WASD (freeze first, then burst).
k.onKeyPress("shift", () => {
  // Air-only, one dash per airtime.
  if (!dashReady || player.isGrounded()) return;
  if (dashCooldown > 0 || freezeTimer > 0 || dashTimer > 0) return;

  const dx = (k.isKeyDown("d") ? 1 : 0) - (k.isKeyDown("a") ? 1 : 0);
  const dy = (k.isKeyDown("s") ? 1 : 0) - (k.isKeyDown("w") ? 1 : 0);
  if (dx === 0 && dy < 0) return; // no straight-up dash

  // Normalize so diagonals aren't faster; default to facing if no input.
  const aim = dx === 0 && dy === 0 ? k.vec2(facing, 0) : k.vec2(dx, dy).unit();
  // Cut the vertical component so up/diagonal dashes give little lift.
  dashDir = k.vec2(aim.x, aim.y * DASH_VERTICAL_SCALE);
  if (dashDir.x !== 0) facing = dashDir.x > 0 ? 1 : -1; // face the dash

  dashReady = false; // consumed until we land again
  freezeTimer = DASH_FREEZE;
  dashTimer = DASH_DURATION;
  dashCooldown = DASH_COOLDOWN + DASH_FREEZE;
});

// Timers powering coyote time and jump buffering.
let coyoteTimer = 0;
let bufferTimer = 0;

player.onUpdate(() => {
  coyoteTimer = player.isGrounded()
    ? COYOTE_TIME
    : Math.max(0, coyoteTimer - k.dt());
  bufferTimer = Math.max(0, bufferTimer - k.dt());

  // Fire a buffered jump the moment we're grounded (or within coyote window).
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

// Variable jump height: releasing early cuts the ascent short.
function cutJump() {
  if (player.vel.y < 0) {
    player.vel.y *= JUMP_CUT;
  }
}

k.onKeyRelease("w", cutJump);
k.onKeyRelease("space", cutJump);

// --- Fall off screen = respawn ---
player.onUpdate(() => {
  if (player.pos.y > k.height() + 200) {
    player.pos = k.vec2(120, 80);
    player.vel = k.vec2(0, 0);
  }
});

// --- HUD ---
k.add([
  k.text("A/D move, W/Space jump, Shift dash (aim with WASD)", { size: 18 }),
  k.pos(12, 12),
  k.color(40, 40, 40),
  k.fixed(),
]);
