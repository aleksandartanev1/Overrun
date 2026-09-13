// render.js
// ---------------------------------------------------------------------------
// Everything that touches the canvas 2D context lives here. This module is
// deliberately "dumb": it draws whatever state it's handed every frame and
// owns no game logic of its own (no combat math, no timers counting down) —
// main.js's update() is the only place game state changes, and render()
// here just paints the result. That update-then-render split is what lets
// features like screen shake or hit-flash get added without touching
// combat code at all.
// ---------------------------------------------------------------------------

import { BASE_W, ANIM_FPS, DEATH_FPS } from './config.js';
import { SPRITE_SHEETS, arrowImg, bgSky, bgWoods1, bgWoods2, bgWoods3, bgWoods4, groundTileset, GROUND_TILE_SRC } from './assets.js';

/** The main canvas's 2D context, set once via initRenderer(). */
let ctx = null;

/**
 * A 100x100 offscreen canvas used only as scratch space for the hit-flash
 * effect (see drawSpriteEntity below). Drawing the current frame onto this
 * *separate* canvas before tinting it white keeps the white tint confined
 * to the sprite's own pixels — tinting directly on the main canvas would
 * use whatever's already been painted there (sky, ground, other sprites)
 * as the mask instead, producing a solid white block rather than a
 * character-shaped flash.
 */
const spriteBuffer = document.createElement('canvas');
spriteBuffer.width = 100;
spriteBuffer.height = 100;
const bufCtx = spriteBuffer.getContext('2d');

/**
 * Must be called once before the first render() — hands this module the
 * canvas context everything else in this file draws into. Kept as an
 * explicit init step (rather than importing the canvas element directly)
 * so this module doesn't need to know the canvas's DOM id.
 *
 * @param {CanvasRenderingContext2D} canvasCtx
 */
export function initRenderer(canvasCtx) {
    ctx = canvasCtx;
}

/**
 * Draws one unit or enemy as an animated pixel-art sprite: picks the right
 * animation (walk / attack / death) and frame based on the entity's current
 * state and timers, then draws that single 100x100 frame from the sheet,
 * flipped to face the correct direction and scaled so the character's
 * actual height matches the entity's `h` stat.
 *
 * Animation selection: a dying entity always plays its death sheet; an
 * entity mid-swing (`attacking`) plays its type's chosen attack variant;
 * otherwise it plays the walk cycle. Each of those three states tracks its
 * own elapsed-time counter (`deathTimer`/`attackTimer`/`walkTimer`) so
 * switching between them doesn't reset or desync the animation.
 *
 * @param {object} e The unit or enemy entity to draw.
 * @param {boolean} isEnemy True to flip the sprite to face left (enemies
 *                          advance leftward toward the player's base).
 */
function drawSpriteEntity(e, isEnemy) {
    const sheet = SPRITE_SHEETS[e.def.team];
    if (!sheet) return;

    let frameSet, frameCount, fps;
    if (e.dying) {
        frameSet = sheet.death; frameCount = sheet.death.frames; fps = DEATH_FPS;
    } else if (e.attacking) {
        const variant = sheet.attacks[e.def.atkVariant] || sheet.attacks[0];
        frameSet = variant; frameCount = variant.frames; fps = ANIM_FPS;
    } else {
        frameSet = sheet.walk; frameCount = sheet.walk.frames; fps = ANIM_FPS;
    }

    const timer = e.dying ? e.deathTimer : (e.attacking ? e.attackTimer : e.walkTimer);
    const rawFrame = Math.floor(timer * fps);
    // Death plays once and holds its last frame; walk/attack loop.
    const frameIndex = e.dying ? Math.min(rawFrame, frameCount - 1) : (rawFrame % frameCount);
    const img = frameSet.img;
    if (!img.complete || img.naturalWidth === 0) return;

    const facing = isEnemy ? -1 : 1;
    const scale = e.h / sheet.contentH;
    const tile = 100 * scale;

    let source = img;
    let sx = frameIndex * 100;

    // Hit-flash: tint this frame white via the offscreen buffer so the tint
    // only affects the sprite's own opaque pixels (see spriteBuffer's comment).
    if (e.flash && e.flash > 0) {
        bufCtx.clearRect(0, 0, 100, 100);
        bufCtx.drawImage(img, sx, 0, 100, 100, 0, 0, 100, 100);
        bufCtx.globalCompositeOperation = 'source-atop';
        bufCtx.globalAlpha = Math.min(1, e.flash / 0.12);
        bufCtx.fillStyle = '#ffffff';
        bufCtx.fillRect(0, 0, 100, 100);
        bufCtx.globalCompositeOperation = 'source-over';
        bufCtx.globalAlpha = 1;
        source = spriteBuffer;
        sx = 0;
    }

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(facing, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, sx, 0, 100, 100, -tile / 2, -sheet.groundY * scale, tile, tile);
    ctx.restore();
}

/**
 * Draws one side's base as a simple colored tower with a bright cap stripe.
 *
 * @param {number} x Left edge x position (0 for the player base; the enemy
 *                    base is positioned at the right edge of the canvas).
 * @param {boolean} isPlayer True for the player's (left, green) base.
 */
function drawBase(x, isPlayer, GROUND_Y) {
    const color = isPlayer ? '#3a4a33' : '#4a3328';
    ctx.fillStyle = color;
    ctx.fillRect(isPlayer ? 0 : x, GROUND_Y - 112, BASE_W, 112);
    ctx.fillStyle = isPlayer ? '#7c9c5f' : '#c1502e';
    ctx.fillRect(isPlayer ? 0 : x, GROUND_Y - 118, BASE_W, 10);
}

/**
 * Draws a full entity: its sprite, plus a small HP bar above its head. The
 * HP bar is skipped once an entity is dying — a health bar over a
 * collapsing corpse reads as a bug, not a feature.
 *
 * @param {object} e The unit or enemy to draw.
 * @param {boolean} isEnemy Passed through to drawSpriteEntity for facing.
 */
function drawEntity(e, isEnemy) {
    drawSpriteEntity(e, isEnemy);
    if (e.dying) return;
    const pct = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = '#0c0d0b';
    ctx.fillRect(e.x - e.w / 2, e.y - e.h - 12, e.w, 6);
    ctx.fillStyle = isEnemy ? '#c1502e' : '#7c9c5f';
    ctx.fillRect(e.x - e.w / 2, e.y - e.h - 12, e.w * pct, 6);
}

/**
 * Draws every active death-burst particle (the small squares that fly
 * outward when a unit dies) as fading squares in that unit's own color.
 *
 * @param {object[]} bursts Array of burst-particle objects with x/y/life/maxLife/color.
 */
function drawBursts(bursts) {
    for (const b of bursts) {
        ctx.globalAlpha = Math.max(0, b.life / b.maxLife);
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
}

/**
 * Draws the full battlefield backdrop: the flat sky color plus four
 * parallax tree-silhouette layers (farthest/lightest to nearest/darkest),
 * then a dark semi-transparent scrim over the whole thing so the busy,
 * colorful art doesn't fight the HUD and sprites for visual attention.
 * Falls back to a plain dark gradient if the background images haven't
 * loaded yet (or failed to), so the game is still playable either way.
 *
 * @param {number} W Canvas width.
 * @param {number} GROUND_Y Y position of the ground line (bottom of the sky).
 */
function drawSky(W, GROUND_Y) {
    if (bgSky.complete && bgSky.naturalWidth > 0) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(bgSky, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
        ctx.drawImage(bgWoods4, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
        ctx.drawImage(bgWoods3, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
        ctx.drawImage(bgWoods2, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
        ctx.drawImage(bgWoods1, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
        ctx.fillStyle = 'rgba(10, 11, 9, 0.52)';
        ctx.fillRect(0, 0, W, GROUND_Y);
    } else {
        const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
        grad.addColorStop(0, '#232722');
        grad.addColorStop(1, '#14150f');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, GROUND_Y);
    }
}

/**
 * Draws the walkable ground strip below the sky: the grass-top dirt tile
 * repeated (alternating two variants for visual variety) across the full
 * canvas width, a faint dark scrim to match the sky's tone-down, and a
 * crisp horizon line where the ground meets the sky. Falls back to a flat
 * dark rectangle if the tileset hasn't loaded.
 *
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @param {number} GROUND_Y Y position of the ground line (top of this strip).
 */
function drawGround(W, H, GROUND_Y) {
    if (groundTileset.complete && groundTileset.naturalWidth > 0) {
        const groundH = H - GROUND_Y;
        const tileW = Math.max(32, groundH * 0.8);
        ctx.imageSmoothingEnabled = false;
        let gi = 0;
        for (let gx = 0; gx < W; gx += tileW) {
            const src = GROUND_TILE_SRC[gi % GROUND_TILE_SRC.length];
            ctx.drawImage(groundTileset, src.sx, src.sy, 32, 32, gx, GROUND_Y, tileW + 1, groundH);
            gi++;
        }
        ctx.fillStyle = 'rgba(10, 11, 9, 0.3)';
        ctx.fillRect(0, GROUND_Y, W, groundH);
    } else {
        ctx.fillStyle = '#1a1d1a';
        ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    }
    ctx.strokeStyle = '#3a3c33';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.stroke();
}

/**
 * Draws every in-flight projectile (currently just the Ranged unit's
 * arrows) as the arrow sprite rotated to face its direction of travel, or
 * a plain dot as a fallback if the sprite hasn't loaded.
 *
 * @param {object[]} projectiles Array of projectile objects with x/y/angle.
 */
function drawProjectiles(projectiles) {
    for (const p of projectiles) {
        if (arrowImg.complete && arrowImg.naturalWidth > 0) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle || 0);
            ctx.drawImage(arrowImg, -12, -4, 24, 8);
            ctx.restore();
        } else {
            ctx.fillStyle = '#e8e4d8';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

/**
 * Draws every floating damage-number particle (the "-6", "-14" text that
 * pops up when something takes damage), fading out as its lifespan ends.
 *
 * @param {object[]} particles Array of particle objects with x/y/life/text/color.
 */
function drawParticles(particles) {
    ctx.font = '15px monospace';
    ctx.textAlign = 'center';
    for (const pt of particles) {
        ctx.globalAlpha = Math.max(0, pt.life / 0.2);
        ctx.fillStyle = pt.color;
        ctx.fillText(pt.text, pt.x, pt.y);
    }
    ctx.globalAlpha = 1;
}

/**
 * Renders one full frame: clears the canvas, applies screen shake (if
 * active), then draws every layer back-to-front — sky, ground, bases,
 * units/enemies, death bursts, projectiles, damage numbers. This is the
 * single entry point main.js's game loop calls every frame; nothing else
 * in this module is exported because nothing else needs to be called
 * independently.
 *
 * @param {{W: number, H: number, GROUND_Y: number}} viewport Current canvas dimensions.
 * @param {object} world Everything currently on the battlefield: units,
 *   enemies, projectiles, particles, bursts arrays, plus shakeTime/shakeMag.
 */
export function render(viewport, world) {
    const { W, H, GROUND_Y } = viewport;
    const { units, enemies, projectiles, particles, bursts, shakeTime, shakeMag } = world;

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    if (shakeTime > 0) {
        const falloff = shakeTime > 0.15 ? 1 : shakeTime / 0.15;
        ctx.translate(
            (Math.random() * 2 - 1) * shakeMag * falloff,
            (Math.random() * 2 - 1) * shakeMag * falloff
        );
    }

    drawSky(W, GROUND_Y);
    drawGround(W, H, GROUND_Y);

    drawBase(0, true, GROUND_Y);
    drawBase(W - BASE_W, false, GROUND_Y);

    for (const u of units) drawEntity(u, false);
    for (const en of enemies) drawEntity(en, true);
    drawBursts(bursts);

    drawProjectiles(projectiles);
    drawParticles(particles);

    ctx.restore();
}