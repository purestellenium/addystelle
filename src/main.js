import kaplay from "kaplay";
import "kaplay/global";

const k = kaplay({
  background: [135, 206, 235], // sky blue
});

k.loadRoot("./"); // A good idea for Itch.io publishing later
k.loadSprite("bean", "sprites/bean.png");

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

// --- Tuning ---
const MOVE_SPEED = 240; // horizontal speed (px/s)
const JUMP_FORCE = 640; // initial jump velocity
const FLOOR_HEIGHT = 48;

// Feel tuning
const COYOTE_TIME = 0.1; // grace period to still jump after leaving a ledge (s)
const JUMP_BUFFER = 0.1; // press jump this early before landing and it still fires (s)
const JUMP_CUT = 0.4; // release jump early -> keep this fraction of upward velocity

// Dash tuning
const DASH_FREEZE = 0.07; // brief hang before the burst — kills momentum first (s)
const DASH_SPEED = 820; // horizontal speed during a dash (px/s)
const DASH_DURATION = 0.14; // how long the burst lasts (s)
const DASH_COOLDOWN = 0.45; // time before you can dash again (s)

k.setGravity(1600);

// --- Player ---
const player = k.add([
  k.sprite("twiggy", { anim: "idle" }),
  k.pos(120, 80),
  k.area({ scale: 0.7 }), // tighter hitbox than the sprite's transparent padding
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
// [x, y, width, height]
const platforms = [
  [0, k.height() - FLOOR_HEIGHT, k.width(), FLOOR_HEIGHT], // ground
  [180, k.height() - 160, 160, 24],
  [420, k.height() - 260, 160, 24],
  [120, k.height() - 360, 160, 24],
];

for (const [x, y, w, h] of platforms) {
  k.add([
    k.rect(w, h),
    k.pos(x, y),
    k.area(),
    k.body({ isStatic: true }),
    k.color(90, 160, 70),
    k.outline(2, k.rgb(60, 110, 50)),
    "platform",
  ]);
}

// --- Controls ---
let facing = 1; // last horizontal direction, used to aim the dash
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
    // Burst: pure horizontal, no gravity, movement input ignored.
    dashTimer -= k.dt();
    player.gravityScale = 0;
    player.vel = k.vec2(facing * DASH_SPEED, 0);
  } else {
    // Normal movement — physics fully resumed.
    player.gravityScale = 1;
    player.vel.x = dir * MOVE_SPEED;
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

// Space: dash in the facing direction (freeze first, then burst).
k.onKeyPress("space", () => {
  if (dashCooldown <= 0 && freezeTimer <= 0 && dashTimer <= 0) {
    freezeTimer = DASH_FREEZE;
    dashTimer = DASH_DURATION;
    dashCooldown = DASH_COOLDOWN + DASH_FREEZE;
  }
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

// --- Fall off screen = respawn ---
player.onUpdate(() => {
  if (player.pos.y > k.height() + 200) {
    player.pos = k.vec2(120, 80);
    player.vel = k.vec2(0, 0);
  }
});

// --- HUD ---
k.add([
  k.text("A/D to move, W to jump, Space to dash", { size: 18 }),
  k.pos(12, 12),
  k.color(40, 40, 40),
  k.fixed(),
]);
