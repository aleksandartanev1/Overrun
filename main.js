// main.js
// ---------------------------------------------------------------------------
// The orchestrator. This is the only module that owns mutable game state
// (units, enemies, supplies, wave number, ...) and the only one that wires
// up DOM elements and event listeners. Everything else in the project is a
// service this file calls: audio.js for sound, assets.js for images,
// config.js for balance numbers, entities.js to create/target combatants,
// render.js to draw the result. That split keeps state changes in exactly
// one place (this file's update()) so it's always clear what can change
// the game and when.
// ---------------------------------------------------------------------------

import { sfx, ensureAudio, audioSettings } from './audio.js';
import { BASE_W, TOTAL_WAVES, UNIT_TYPES, ENEMY_TYPES } from './config.js';
import { SPRITE_SHEETS, assetsProgress, assetsReady } from './assets.js';
import { createUnit, createEnemy, findTarget, buildWaveQueue } from './entities.js';
import { initRenderer, render } from './render.js';
import { DEATH_FPS } from './config.js';

// ---- DOM references --------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlaytitle');
const overlayText = document.getElementById('overlaytext');
const overlayBtn = document.getElementById('overlaybtn');
const supplyNum = document.getElementById('supplynum');
const playerHpBar = document.getElementById('playerhp');
const enemyHpBar = document.getElementById('enemyhp');
const waveNumEl = document.getElementById('wavenum');
const waveTotalEl = document.getElementById('wavetotal');
const unitBtnsEl = document.getElementById('unitbtns');
const pauseBtn = document.getElementById('pausebtn');
const muteBtn = document.getElementById('mutebtn');
const helpBtn = document.getElementById('helpbtn');
const helpModal = document.getElementById('helpmodal');
const helpClose = document.getElementById('helpclose');
const pausedTag = document.getElementById('pausedtag');
const waveBanner = document.getElementById('wavebanner');

initRenderer(ctx);

// ---- Canvas sizing ----------------------------------------------------------
let W, H, GROUND_Y;

/**
 * Recomputes the canvas's pixel dimensions from its container's current
 * CSS size, and derives GROUND_Y (the horizon line all entities walk
 * along) as a fixed 60px inset from the bottom. Called on load and on
 * every window resize so the battlefield always fills its panel exactly.
 */
function resize() {
    const holder = document.getElementById('canvasholder');
    W = canvas.width = holder.clientWidth;
    H = canvas.height = holder.clientHeight;
    GROUND_Y = H - 60;
}
window.addEventListener('resize', resize);

// ---- Game state --------------------------------------------------------------
// Everything below is reassigned by resetGame() at the start of every run
// and mutated frame-by-frame by update(). This is the single source of
// truth for "what is currently happening in the game".
let state, units, enemies, projectiles, particles, bursts;
let supplies, wave, waveTimer, spawnQueue, running, gameOver, paused;
let lastTime, animClock = 0;
let shakeTime = 0, shakeMag = 0;

/**
 * Registers a screen shake, taking the strongest of the new request and
 * whatever shake is already in progress — so two base hits in quick
 * succession don't cut a longer shake short, they extend it.
 *
 * @param {number} mag Shake magnitude in pixels.
 * @param {number} dur Shake duration in seconds.
 */
function triggerShake(mag, dur) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = Math.max(shakeTime, dur);
}

/**
 * Spawns a small outward-flying particle burst at a death location, in the
 * dying entity's own color, as a bit of extra visual punctuation on top of
 * the death animation itself.
 *
 * @param {number} x
 * @param {number} y
 * @param {string} color CSS color for every particle in this burst.
 */
function spawnBurst(x, y, color) {
    for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
        const speed = 40 + Math.random() * 60;
        bursts.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 30,
            life: 0.35 + Math.random() * 0.15,
            maxLife: 0.5,
            color
        });
    }
}

/**
 * Shows the fading "WAVE X INCOMING" banner text. Restarts its CSS
 * transition from scratch each call (by clearing it, forcing a style
 * flush via requestAnimationFrame, then re-applying it) so back-to-back
 * wave announcements each get their own full fade rather than the second
 * one jumping in partway through the first's animation.
 *
 * @param {string} text
 */
function showWaveBanner(text) {
    waveBanner.textContent = text;
    waveBanner.style.transition = 'none';
    waveBanner.style.opacity = '1';
    waveBanner.style.transform = 'translate(-50%, -50%) scale(1)';
    requestAnimationFrame(() => {
        waveBanner.style.transition = 'opacity 1.4s ease, transform 1.4s ease';
        waveBanner.style.opacity = '0';
        waveBanner.style.transform = 'translate(-50%, -70%) scale(1.15)';
    });
}

/**
 * Resets every piece of game state to the start of a fresh run: empty
 * entity arrays, starting supplies, wave 1, both bases at full health.
 * Called once on page load (so there's valid state to render before the
 * player hits Start) and again every time Start/Restart is clicked.
 */
function resetGame() {
    units = [];
    enemies = [];
    projectiles = [];
    particles = [];
    bursts = [];
    supplies = 40;
    wave = 1;
    waveTimer = 2.5;
    spawnQueue = [];
    running = false;
    paused = false;
    gameOver = false;
    shakeTime = 0; shakeMag = 0;
    state = { playerHp: 100, playerMaxHp: 100, enemyHp: 100, enemyMaxHp: 100 };
    updateHUD();
    updatePauseBtn();
}

/**
 * Begins the current `wave` number: generates its enemy spawn queue,
 * updates the wave counter in the HUD, and announces it with a sound and
 * the on-screen banner.
 */
function startWave() {
    spawnQueue = buildWaveQueue(wave);
    waveNumEl.textContent = wave;
    sfx.waveStart();
    showWaveBanner('WAVE ' + wave + ' INCOMING');
}

/**
 * Attempts to deploy a player troop of the given type: checks the player
 * can afford it, deducts the cost, creates the entity just in front of the
 * player base, and plays the spawn sound. Silently does nothing if the
 * game isn't in a state where spawning makes sense (paused, over, or not
 * yet started) or the player can't afford it — the Start-button/HUD
 * already disables the relevant buttons in those cases, so this is a
 * defensive second check rather than the primary gate.
 *
 * @param {string} typeKey One of UNIT_TYPES's keys.
 */
function spawnUnit(typeKey) {
    if (gameOver || paused || !running) return;
    const def = UNIT_TYPES[typeKey];
    if (supplies < def.cost) return;
    supplies -= def.cost;
    units.push(createUnit(typeKey, BASE_W + 4, GROUND_Y));
    sfx.spawnPlayer();
    updateHUD();
}

/**
 * Creates an enemy of the given type just in front of the enemy base and
 * plays its spawn sound. Called by update() as each wave's spawn queue
 * counts down, never directly by the player.
 *
 * @param {string} typeKey One of ENEMY_TYPES's keys.
 */
function spawnEnemy(typeKey) {
    enemies.push(createEnemy(typeKey, W - BASE_W - 4, GROUND_Y));
    sfx.spawnEnemy();
}

/**
 * Syncs every HUD element (supplies counter, both health bars, and each
 * troop button's disabled state) to the current game state. Called after
 * anything that changes supplies or health, and once a frame from update()
 * as a catch-all — cheap enough that redundant calls aren't a concern.
 */
function updateHUD() {
    supplyNum.textContent = Math.floor(supplies);
    playerHpBar.style.width = Math.max(0, state.playerHp / state.playerMaxHp * 100) + '%';
    enemyHpBar.style.width = Math.max(0, state.enemyHp / state.enemyMaxHp * 100) + '%';
    for (const key in UNIT_TYPES) {
        const btn = document.getElementById('btn-' + key);
        if (btn) btn.disabled = supplies < UNIT_TYPES[key].cost || gameOver;
    }
}

/**
 * Builds the three troop-deploy buttons in the HUD from UNIT_TYPES, so
 * adding a new troop type to config.js is enough to make it deployable —
 * nothing here needs to change. Called once on page load.
 */
function buildUnitButtons() {
    unitBtnsEl.innerHTML = '';
    for (const key in UNIT_TYPES) {
        const def = UNIT_TYPES[key];
        const btn = document.createElement('button');
        btn.className = 'ubtn';
        btn.id = 'btn-' + key;
        btn.innerHTML = `<span class="key">${def.key}</span>
      <svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" rx="2" fill="${def.color}"/></svg>
      <span class="name">${def.name}</span>
      <span class="cost">${def.cost}</span>`;
        btn.addEventListener('click', () => spawnUnit(key));
        unitBtnsEl.appendChild(btn);
    }
}

/**
 * Advances the simulation by `dt` seconds: accrues supplies, spawns any
 * enemies whose queued delay has elapsed, moves and fights every unit and
 * enemy (or advances their death animation if they're dying), resolves
 * projectiles, promotes anything at 0 HP into its death animation, decays
 * timers (hit-flash, damage numbers, particle bursts, screen shake), and
 * finally checks win/lose/next-wave conditions. This is the only function
 * that mutates combat state — render() only ever reads it.
 *
 * @param {number} dt Elapsed time since the last frame, in seconds.
 */
function update(dt) {
    if (!running || gameOver) return;

    supplies += dt * (3.2 + wave * 0.15);
    animClock += dt;
    updateHUD();

    // Count down and fire off this wave's queued enemy spawns.
    waveTimer -= dt;
    spawnQueue = spawnQueue.filter(item => {
        item.delay -= dt;
        if (item.delay <= 0) { spawnEnemy(item.type); return false; }
        return true;
    });
    if (spawnQueue.length === 0 && enemies.length === 0 && !gameOver) {
        waveTimer -= dt;
    }

    // Move & fight units (player side).
    for (const u of units) {
        if (u.dying) { u.deathTimer += dt; continue; }
        const target = findTarget(u, enemies);
        const distToEnemyBase = (W - BASE_W) - u.x;
        if (target && Math.abs(target.x - u.x) <= (u.def.range + u.w / 2 + target.w / 2)) {
            u.attacking = true; u.attackTimer += dt;
            u.cooldown -= dt;
            if (u.cooldown <= 0) {
                u.cooldown = u.def.atkSpeed;
                if (u.def.projectile) {
                    projectiles.push({ x: u.x, y: u.y - u.h * 0.6, targetRef: target, dmg: u.def.dmg, team: 'player', speed: 260 });
                } else {
                    target.hp -= u.def.dmg;
                    target.flash = 0.12;
                    sfx.hit();
                    particles.push({ x: target.x, y: target.y - target.h * 0.6, life: 0.2, text: '-' + u.def.dmg, color: '#e8e4d8' });
                }
            }
        } else if (distToEnemyBase > u.def.range) {
            u.attacking = false; u.walkTimer += dt;
            u.x += u.def.speed * dt;
        } else {
            // Nothing left in range but not yet at the base's edge either — hit the base.
            u.attacking = true; u.attackTimer += dt;
            u.cooldown -= dt;
            if (u.cooldown <= 0) {
                u.cooldown = u.def.atkSpeed;
                state.enemyHp -= u.def.dmg;
                sfx.baseDamage();
                triggerShake(4, 0.15);
                particles.push({ x: u.x + 20, y: u.y - u.h, life: 0.2, text: '-' + u.def.dmg, color: '#c1502e' });
            }
        }
    }

    // Move & fight enemies (mirrors the unit loop above, opposite direction).
    for (const en of enemies) {
        if (en.dying) { en.deathTimer += dt; continue; }
        const target = findTarget(en, units);
        const distToPlayerBase = en.x - BASE_W;
        if (target && Math.abs(target.x - en.x) <= (en.def.range + en.w / 2 + target.w / 2)) {
            en.attacking = true; en.attackTimer += dt;
            en.cooldown -= dt;
            if (en.cooldown <= 0) {
                en.cooldown = en.def.atkSpeed;
                target.hp -= en.def.dmg;
                target.flash = 0.12;
                sfx.hit();
                particles.push({ x: target.x, y: target.y - target.h * 0.6, life: 0.2, text: '-' + en.def.dmg, color: '#e8e4d8' });
            }
        } else if (distToPlayerBase > en.def.range) {
            en.attacking = false; en.walkTimer += dt;
            en.x -= en.def.speed * dt;
        } else {
            en.attacking = true; en.attackTimer += dt;
            en.cooldown -= dt;
            if (en.cooldown <= 0) {
                en.cooldown = en.def.atkSpeed;
                state.playerHp -= en.def.dmg;
                sfx.baseDamage();
                triggerShake(4, 0.15);
                particles.push({ x: en.x - 20, y: en.y - en.h, life: 0.2, text: '-' + en.def.dmg, color: '#c1502e' });
            }
        }
    }

    // Advance projectiles toward their target, resolving a hit on arrival.
    for (const p of projectiles) {
        if (!p.targetRef || p.targetRef.hp <= 0) { p.dead = true; continue; }
        const dx = p.targetRef.x - p.x;
        const dy = (p.targetRef.y - p.targetRef.h * 0.5) - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 8) {
            p.targetRef.hp -= p.dmg;
            p.targetRef.flash = 0.12;
            sfx.hit();
            particles.push({ x: p.targetRef.x, y: p.targetRef.y - p.targetRef.h * 0.6, life: 0.2, text: '-' + p.dmg, color: '#e8e4d8' });
            p.dead = true;
        } else {
            p.angle = Math.atan2(dy, dx);
            p.x += (dx / dist) * p.speed * dt;
            p.y += (dy / dist) * p.speed * dt;
        }
    }
    projectiles = projectiles.filter(p => !p.dead);

    // Anything that just hit 0 HP starts dying (once) instead of vanishing instantly.
    for (const u of units) {
        if (u.hp <= 0 && !u.dying) { u.dying = true; u.deathTimer = 0; spawnBurst(u.x, u.y - u.h * 0.5, u.def.color); sfx.death(); }
    }
    for (const en of enemies) {
        if (en.hp <= 0 && !en.dying) { en.dying = true; en.deathTimer = 0; spawnBurst(en.x, en.y - en.h * 0.5, en.def.color); sfx.death(); }
    }

    // Remove units/enemies only once their death animation has actually finished playing.
    const soldierDeathDur = SPRITE_SHEETS.soldier.death.frames / DEATH_FPS;
    const orcDeathDur = SPRITE_SHEETS.orc.death.frames / DEATH_FPS;
    units = units.filter(u => !(u.dying && u.deathTimer > soldierDeathDur));
    enemies = enemies.filter(en => !(en.dying && en.deathTimer > orcDeathDur));

    // Decay all the little timers that drive transient visual effects.
    for (const u of units) if (u.flash > 0) u.flash -= dt;
    for (const en of enemies) if (en.flash > 0) en.flash -= dt;

    for (const pt of particles) { pt.life -= dt; pt.y -= dt * 20; }
    particles = particles.filter(pt => pt.life > 0);

    for (const b of bursts) {
        b.life -= dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vy += 160 * dt;
    }
    bursts = bursts.filter(b => b.life > 0);

    if (shakeTime > 0) {
        shakeTime -= dt;
        if (shakeTime <= 0) shakeMag = 0;
    }

    // Win/lose and wave-advance checks, in priority order.
    if (state.playerHp <= 0) { endGame(false); return; }
    if (state.enemyHp <= 0) { endGame(true, 'base'); return; }

    if (spawnQueue.length === 0 && enemies.length === 0) {
        if (wave >= TOTAL_WAVES) {
            endGame(true, 'waves');
            return;
        }
        if (waveTimer <= 0) {
            wave++;
            startWave();
        }
    }

    updateHUD();
}

/**
 * Ends the current run, win or lose, and puts the start-screen overlay
 * back up with a result-specific title/message/sound. `reason` only
 * matters on a win, distinguishing "broke through the enemy base early"
 * from "survived all 8 waves" for the message text.
 *
 * @param {boolean} won
 * @param {'base'|'waves'} [reason]
 */
function endGame(won, reason) {
    gameOver = true;
    running = false;
    overlay.style.display = 'flex';
    if (won) sfx.win(); else sfx.lose();
    if (won) {
        overlayTitle.textContent = reason === 'base' ? 'BASE DESTROYED' : 'YOU SURVIVED';
        overlayTitle.style.color = '#7c9c5f';
        overlayText.textContent = reason === 'base'
            ? 'You broke through the enemy line. The horde falls silent.'
            : 'Eight waves down. The line held.';
    } else {
        overlayTitle.textContent = 'OVERRUN';
        overlayTitle.style.color = '#c1502e';
        overlayText.textContent = 'Your base has fallen. The horde pours through.';
    }
    overlayBtn.textContent = 'RESTART';
}

/**
 * The main loop, driven by requestAnimationFrame. Computes this frame's
 * elapsed time (clamped to 50ms so an alt-tab or a slow frame can't cause
 * a huge simulation jump), advances the simulation unless paused, then
 * draws the result. Runs forever once started — pausing is handled inside
 * the loop (skip update, keep rendering) rather than by stopping the
 * rAF chain, so the paused frame stays visible instead of freezing on
 * whatever was mid-draw.
 *
 * @param {number} t Timestamp supplied by requestAnimationFrame.
 */
function loop(t) {
    if (lastTime == null) lastTime = t;
    const dt = Math.min(0.05, (t - lastTime) / 1000);
    lastTime = t;
    if (!paused) update(dt);
    render({ W, H, GROUND_Y }, { units, enemies, projectiles, particles, bursts, shakeTime, shakeMag });
    requestAnimationFrame(loop);
}

/**
 * Syncs the pause button's icon and the "PAUSED" overlay tag to the
 * current `paused` state. Called any time `paused` changes.
 */
function updatePauseBtn() {
    pauseBtn.textContent = paused ? '►' : 'II';
    pausedTag.classList.toggle('show', paused && running && !gameOver);
}

// ---- UI event wiring ----------------------------------------------------

pauseBtn.addEventListener('click', () => {
    if (!running || gameOver) return;
    paused = !paused;
    updatePauseBtn();
});

muteBtn.addEventListener('click', () => {
    audioSettings.muted = !audioSettings.muted;
    muteBtn.classList.toggle('active', audioSettings.muted);
    muteBtn.textContent = audioSettings.muted ? '✕' : '♪';
});

helpBtn.addEventListener('click', () => {
    helpModal.classList.add('show');
    if (running && !gameOver) { paused = true; updatePauseBtn(); }
});
helpClose.addEventListener('click', () => {
    helpModal.classList.remove('show');
    if (running && !gameOver) { paused = false; updatePauseBtn(); }
});

window.addEventListener('keydown', (e) => {
    if (e.key === '1') spawnUnit('grunt');
    if (e.key === '2') spawnUnit('heavy');
    if (e.key === '3') spawnUnit('ranged');
    if (e.key === ' ' && running && !gameOver) {
        e.preventDefault();
        paused = !paused;
        updatePauseBtn();
    }
});

overlayBtn.addEventListener('click', () => {
    ensureAudio(); // must happen inside a user gesture — see audio.js
    resetGame();
    resize();
    startWave();
    running = true;
    overlay.style.display = 'none';
});

// ---- Startup --------------------------------------------------------------

buildUnitButtons();
waveTotalEl.textContent = TOTAL_WAVES;
resize();
resetGame();

// Block Start until every sprite/background image has finished loading (or
// failed) so the player never sees an empty battlefield partway through.
overlayBtn.disabled = true;
overlayBtn.textContent = 'LOADING...';
const loadCheck = setInterval(() => {
    if (assetsReady()) {
        clearInterval(loadCheck);
        overlayBtn.disabled = false;
        overlayBtn.textContent = 'START';
    }
}, 100);

requestAnimationFrame(loop);