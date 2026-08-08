import kaplay from "kaplay";
import "kaplay/global";

const k = kaplay({
  background: [135, 206, 235], // sky blue
});

k.loadRoot("./"); // A good idea for Itch.io publishing later

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

// Ground + platform pieces cropped out of Tiles.png's top-left (grassland)
// style, all 40px tall. The source slab is a rounded dirt mound, so its
// grass-edge sides only belong at the two true ends of a platform — groundMid
// is cropped from the pure-dirt middle (one 16px fleck-pattern period, safe
// to repeat) while groundLeft/Right keep the grass edge on their outer side.
// legLeft/legRight are the floating-island pedestal legs, cropped from
// beneath that same slab. tree/bush are just scenery, no collision.
const PLATFORM_SCALE = 2; // draw the tiles larger than their native pixels
const EDGE_W = 16; // groundLeft/Right width — inner cut lands in pure dirt so
//                    the grass edge butts seamlessly against the dirt mids
const MID_W = 16; // groundMid width (pure-interior dirt strip, repeatable)
const TILE_H = 30; // grass+dirt cap height (fence excluded, legs hang below)
const LEG_W = 20; // pedestal leg sprite width
k.loadSprite("groundLeft", "sprites/groundLeft.png");
k.loadSprite("groundMid", "sprites/groundMid.png");
k.loadSprite("groundRight", "sprites/groundRight.png");
k.loadSprite("legLeft", "sprites/legLeft.png");
k.loadSprite("legRight", "sprites/legRight.png");
k.loadSprite("tree", "sprites/tree.png");
k.loadSprite("bush", "sprites/bush.png");

// --- Tuning ---
const MOVE_SPEED = 240; // horizontal speed (px/s)
const JUMP_FORCE = 640; // initial jump velocity

// Feel tuning
const COYOTE_TIME = 0.1; // grace period to still jump after leaving a ledge (s)
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
// One invisible static collider spanning the full width, with groundLeft +
// groundMid*N + groundRight laid edge-to-edge on top as children — grass
// only shows on the two outer edges, solid dirt everywhere in between.
function makePlatform(x, y, midCount) {
  const w = EDGE_W * 2 + MID_W * midCount;
  const platform = k.add([
    k.pos(x, y),
    // scale() cascades to the tile children AND the collider, so tiles + physics
    // stay in sync; all child coords below stay in native (unscaled) tile units.
    k.scale(PLATFORM_SCALE),
    k.area({ shape: new k.Rect(k.vec2(0), w, TILE_H) }),
    k.body({ isStatic: true }),
    "platform",
  ]);
  platform.add([k.pos(0, 0), k.sprite("groundLeft")]);
  for (let i = 0; i < midCount; i++) {
    platform.add([k.pos(EDGE_W + i * MID_W, 0), k.sprite("groundMid")]);
  }
  platform.add([k.pos(w - EDGE_W, 0), k.sprite("groundRight")]);
  return { platform, width: w };
}

// Same as makePlatform, but hangs pedestal legs under the end tiles so it
// reads as a floating island instead of a slab that just stops mid-air.
// Tagged "floating" (on top of "platform") so the endless generator below
// can clean up ones the player has long since climbed past, without
// touching the ground.
function makeFloatingPlatform(x, y, midCount) {
  const { platform } = makePlatform(x, y, midCount);
  platform.use("floating");
  return platform;
}

// Ground spans the bottom, flat and grounded; floating platforms climb up
// from there, each a distinct hovering island. Tiles render at PLATFORM_SCALE,
// so world sizes are the native units times that factor.
const groundY = k.height() - TILE_H * PLATFORM_SCALE;
const groundMids =
  Math.ceil((k.width() / PLATFORM_SCALE - EDGE_W * 2) / MID_W) + 1;
makePlatform(0, groundY, groundMids);

// Endless generation: keep spawning platforms above the highest one so far,
// as the player climbs.
//
// Reach limits below aren't guesses — they came from simulating the actual
// jump/dash physics (gravity 1600, JUMP_FORCE 640, dash speed/duration/vertical
// scale) frame-by-frame:
//   1. A plain jump rises at most ~127px (JUMP_FORCE^2 / (2*gravity)).
//      MAX_GAP stays under that so every gap is clearable without dashing.
//      (An apex-timed diagonal dash *can* stretch that further — the freeze
//      phase hangs you at the apex instead of falling, then the burst adds
//      real upward velocity — but nothing here requires that.)
//   2. Dash also buys extra *horizontal* reach at a given height (e.g. at a
//      115px rise, a plain jump reaches ~125px sideways). MAX_REACH is kept
//      inside that plain-jump figure — dash is a bonus, not a requirement.
const MIN_MID = 3;
const MAX_MID = 8;
const MIN_GAP = 60; // vertical gap floor (px)
const MAX_GAP = 115; // vertical gap ceiling — comfortably under the ~127px jump cap
const MAX_REACH = 110; // max horizontal step (px) — safe even at MAX_GAP on a plain jump
const GEN_LOOKAHEAD = 500; // keep generating this far above the player (world px)
const CLEANUP_BELOW = 900; // destroy floating platforms this far below the player

// Bound the wander walk against the WIDEST possible platform's edge, not
// each platform's own (randomly narrower or wider) edge. If the x-clamp used
// the current platform's actual width instead, a wide platform rolled right
// after the walk had drifted near a narrow platform's looser boundary could
// force a final position more than MAX_REACH away from the previous one —
// silently producing an unreachable jump. Using a fixed worst-case bound
// means the reach clamp is always the tighter (and only relevant) one.
const MAX_WIDTH_WORLD = (EDGE_W * 2 + MID_W * MAX_MID) * PLATFORM_SCALE;
const WANDER_MAX_X = Math.max(20, k.width() - MAX_WIDTH_WORLD - 20);

let highestY = groundY;
// Clamped in case the viewport is narrow enough that 180 or the midpoint
// would already fall outside [20, WANDER_MAX_X] — keeps the "both bounds
// always agree" invariant true from the very first spawn, not just once the
// wander loop has run once.
let prevX = Math.max(20, Math.min(180, WANDER_MAX_X));
// A point the path is currently walking toward; once reached, a fresh one is
// picked anywhere across the width. This is what makes the climb actually
// swing out to both edges of the screen over time, rather than just taking
// small steps that (even randomly directed) tend to hover near the middle.
let wanderTargetX = Math.max(20, Math.min(k.width() / 2, WANDER_MAX_X));

function spawnNextPlatform() {
  const midCount = MIN_MID + Math.floor(Math.random() * (MAX_MID - MIN_MID + 1));
  const widthWorld = (EDGE_W * 2 + MID_W * midCount) * PLATFORM_SCALE;
  highestY -= MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP);

  if (Math.abs(wanderTargetX - prevX) < 1) {
    wanderTargetX = 20 + Math.random() * (WANDER_MAX_X - 20);
  }
  const step = Math.max(-MAX_REACH, Math.min(MAX_REACH, wanderTargetX - prevX));
  const x = Math.min(WANDER_MAX_X, Math.max(20, prevX + step));

  makeFloatingPlatform(x, highestY, midCount);
  prevX = x;
}

// Seed a handful up front so there's already a climb visible on load.
for (let i = 0; i < 6; i++) spawnNextPlatform();

k.onUpdate(() => {
  while (highestY > player.pos.y - GEN_LOOKAHEAD) {
    spawnNextPlatform();
  }
  for (const p of k.get("floating")) {
    if (p.pos.y > player.pos.y + CLEANUP_BELOW) p.destroy();
  }
});

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
k.onKeyPress("k", () => {
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

// --- Camera ---
// Vertical-only follow: horizontal stays centered, and the camera holds at
// its default height (ground visible at the bottom) until the player climbs
// above the midline, at which point it scrolls up to keep them in view.
k.camPos(k.width() / 2, k.height() / 2);
player.onUpdate(() => {
  const targetY = Math.min(k.height() / 2, player.pos.y);
  const cam = k.camPos();
  k.camPos(cam.x, k.lerp(cam.y, targetY, 0.1));
});

// --- HUD ---
k.add([
  k.text("A/D move, W/Space jump, K dash (aim with WASD)", { size: 18 }),
  k.pos(12, 12),
  k.color(40, 40, 40),
  k.fixed(),
]);

// --- AITA ticker ---
// Reddit's JSON API 403s unauthenticated cross-origin requests outright and
// sends no Access-Control-Allow-Origin header, so a plain fetch() from the
// browser can never read the response — this goes through a public CORS
// proxy instead. That proxy is a soft dependency: Reddit's bot-blocking has
// been seen to catch proxy traffic too, and free proxies go down on their
// own. Either failure just leaves FALLBACK_TITLES showing — never an error,
// never a broken ticker, just a quiet fallback.
const REDDIT_PROXY = "https://api.allorigins.win/raw?url=";
const REDDIT_URL =
  "https://www.reddit.com/r/AmItheAsshole/top.json?limit=15&t=day";
const FALLBACK_TITLES = [
  "(couldn't reach r/AmItheAsshole — showing placeholders)",
  "AITA for eating the last slice of pizza I'd labeled with my name?",
  "AITA for telling my roommate the plant is fake and always has been?",
  "AITA for refusing to swap seats on a 3 hour flight?",
  "AITA for skipping my cousin's fourth wedding this year?",
];

const TICKER_WIDTH = 260;
const TICKER_SPEED = 30; // px/s, scrolling upward
const TICKER_ROW_H = 100; // fixed slot height per title (generous for wrapped text)

k.add([
  k.rect(TICKER_WIDTH, k.height()),
  k.pos(k.width() - TICKER_WIDTH, 0),
  k.color(20, 20, 30),
  k.opacity(0.55),
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
      k.text(title, { size: 14, width: TICKER_WIDTH - 24 }),
      k.pos(0, ticker.children.length * TICKER_ROW_H),
      k.color(255, 255, 255),
    ]);
  }
  tickerLoopHeight = titles.length * TICKER_ROW_H;
  ticker.pos.y = k.height();
}

setTickerTitles(FALLBACK_TITLES);

ticker.onUpdate(() => {
  ticker.pos.y -= TICKER_SPEED * k.dt();
  if (ticker.pos.y <= k.height() - tickerLoopHeight) {
    ticker.pos.y += tickerLoopHeight;
  }
});

fetch(REDDIT_PROXY + encodeURIComponent(REDDIT_URL))
  .then((res) => res.json())
  .then((json) => {
    const titles = (json?.data?.children ?? [])
      .map((post) => post?.data?.title)
      .filter(Boolean);
    if (titles.length > 0) setTickerTitles(titles);
  })
  .catch(() => {}); // Reddit/proxy unreachable — FALLBACK_TITLES stays up.
