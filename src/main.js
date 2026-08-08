import kaplay from "kaplay";
import "kaplay/global";

const k = kaplay({
  background: [135, 206, 235], // sky blue
});

k.loadRoot("./"); // A good idea for Itch.io publishing later
k.loadSprite("bean", "sprites/bean.png");

// --- Tuning ---
const MOVE_SPEED = 240; // horizontal speed (px/s)
const JUMP_FORCE = 640; // initial jump velocity
const FLOOR_HEIGHT = 48;

// Feel tuning
const COYOTE_TIME = 0.1; // grace period to still jump after leaving a ledge (s)
const JUMP_BUFFER = 0.1; // press jump this early before landing and it still fires (s)
const JUMP_CUT = 0.4; // release jump early -> keep this fraction of upward velocity

// Dash tuning
const DASH_SPEED = 720; // horizontal speed during a dash (px/s)
const DASH_DURATION = 0.15; // how long a dash lasts (s)
const DASH_COOLDOWN = 0.4; // time before you can dash again (s)

k.setGravity(1600);

// --- Player ---
const player = k.add([
  k.sprite("bean"),
  k.pos(120, 80),
  k.area(),
  k.body(),
  k.anchor("center"),
  "player",
]);

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
let dashTimer = 0; // remaining dash time (s)
let dashCooldown = 0; // remaining cooldown before next dash (s)

// Horizontal: set velocity directly for instant, drift-free response.
player.onUpdate(() => {
  const dir =
    (k.isKeyDown("d") ? 1 : 0) - (k.isKeyDown("a") ? 1 : 0);
  if (dir !== 0) facing = dir;

  dashCooldown = Math.max(0, dashCooldown - k.dt());

  if (dashTimer > 0) {
    // During a dash, movement input is overridden by the burst.
    dashTimer -= k.dt();
    player.vel.x = facing * DASH_SPEED;
  } else {
    player.vel.x = dir * MOVE_SPEED;
  }
});

// Space: dash in the facing direction.
k.onKeyPress("space", () => {
  if (dashCooldown <= 0) {
    dashTimer = DASH_DURATION;
    dashCooldown = DASH_COOLDOWN;
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
