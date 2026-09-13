// config.js
// ---------------------------------------------------------------------------
// Pure data: every number that defines game balance lives here and nowhere
// else. Nothing in this file has side effects or touches the DOM, so it's
// safe to import from any other module without worrying about load order.
// Tuning the game (cheaper Heavy, faster waves, bigger bases) means editing
// this file only — combat math, spawning, and rendering all read from these
// objects rather than hardcoding numbers of their own.
// ---------------------------------------------------------------------------

/** Width, in pixels, of each side's base structure. */
export const BASE_W = 74;

/** Number of enemy waves that make up a full run. */
export const TOTAL_WAVES = 8;

/** Playback speed (frames per second) for walk/attack sprite animations. */
export const ANIM_FPS = 12;

/** Playback speed (frames per second) for the death animation specifically —
 * slower than ANIM_FPS so the death pose reads clearly instead of flashing by. */
export const DEATH_FPS = 10;

/**
 * The three troop types the player can deploy. Each entry's `team` and
 * `atkVariant` pick which sprite sheet (see assets.js's SPRITE_SHEETS) and
 * which attack animation variant that unit uses, so visual variety and
 * combat stats are defined together in one place per unit.
 */
export const UNIT_TYPES = {
    grunt: {
        name: 'GRUNT', key: '1', cost: 20, hp: 40, dmg: 6, range: 34, atkSpeed: 0.8,
        speed: 55, w: 32, h: 48, color: '#7c9c5f', splash: false, team: 'soldier', atkVariant: 0
    },
    heavy: {
        name: 'HEAVY', key: '2', cost: 50, hp: 140, dmg: 14, range: 39, atkSpeed: 1.4,
        speed: 26, w: 45, h: 66, color: '#5b6b8c', splash: false, team: 'soldier', atkVariant: 1
    },
    ranged: {
        name: 'RANGED', key: '3', cost: 35, hp: 25, dmg: 8, range: 140, atkSpeed: 1.1,
        speed: 44, w: 29, h: 45, color: '#d4a017', splash: false, projectile: true, team: 'soldier', atkVariant: 2
    }
};

/**
 * The three enemy types that appear in waves, mixed together by
 * buildWaveQueue() (see entities.js) with heavier types unlocking in later
 * waves. Same shape as UNIT_TYPES so both sides can share combat/render code.
 */
export const ENEMY_TYPES = {
    shambler: { hp: 30, dmg: 5, range: 29, atkSpeed: 0.9, speed: 34, w: 32, h: 48, color: '#8a5a4a', team: 'orc', atkVariant: 0 },
    runner: { hp: 18, dmg: 4, range: 26, atkSpeed: 0.7, speed: 81, w: 26, h: 42, color: '#a86a3a', team: 'orc', atkVariant: 1 },
    brute: { hp: 110, dmg: 16, range: 34, atkSpeed: 1.3, speed: 23, w: 48, h: 68, color: '#5a3a2a', team: 'orc', atkVariant: 0 }
};