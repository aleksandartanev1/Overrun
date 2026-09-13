// entities.js
// ---------------------------------------------------------------------------
// Everything to do with creating combatants and deciding who they fight.
// Functions here are deliberately side-effect-light: createUnit/createEnemy
// *return* a new entity object rather than pushing it into a shared array
// themselves, and findTarget only reads its inputs. main.js owns the actual
// `units`/`enemies` arrays and decides what to do with what this module
// hands back — that keeps this file testable and reusable without needing
// to know about the rest of the game's state.
// ---------------------------------------------------------------------------

import { UNIT_TYPES, ENEMY_TYPES } from './config.js';

/**
 * Builds a fresh player-troop entity from its type definition. The returned
 * object carries both its static stats (`def`, looked up from UNIT_TYPES)
 * and its live combat/animation state (hp, cooldown, flash timer, which
 * animation is currently playing) — everything update()/render() need,
 * bundled together so the rest of the game can treat one unit as one object.
 *
 * @param {string} typeKey One of UNIT_TYPES's keys ('grunt' | 'heavy' | 'ranged').
 * @param {number} x Spawn x position (typically just in front of the player base).
 * @param {number} y Spawn y position (the battlefield's ground line).
 * @returns {object} A new unit entity, not yet added to any array.
 */
export function createUnit(typeKey, x, y) {
    const def = UNIT_TYPES[typeKey];
    return {
        type: typeKey, def,
        x, y,
        hp: def.hp, maxHp: def.hp,
        cooldown: 0, target: null, flash: 0,
        w: def.w, h: def.h,
        attacking: false, walkTimer: 0, attackTimer: 0, dying: false, deathTimer: 0
    };
}

/**
 * Builds a fresh enemy entity. Mirrors createUnit() exactly — enemies and
 * units share the same object shape so combat code (update()) and rendering
 * (render.js) don't need separate code paths for the two sides.
 *
 * @param {string} typeKey One of ENEMY_TYPES's keys ('shambler' | 'runner' | 'brute').
 * @param {number} x Spawn x position (typically just in front of the enemy base).
 * @param {number} y Spawn y position (the battlefield's ground line).
 * @returns {object} A new enemy entity, not yet added to any array.
 */
export function createEnemy(typeKey, x, y) {
    const def = ENEMY_TYPES[typeKey];
    return {
        type: typeKey, def,
        x, y,
        hp: def.hp, maxHp: def.hp,
        cooldown: 0, target: null, flash: 0,
        w: def.w, h: def.h,
        attacking: false, walkTimer: 0, attackTimer: 0, dying: false, deathTimer: 0
    };
}

/**
 * Picks which opponent a combatant should engage: simply the nearest one
 * by horizontal distance, skipping anyone already in their death animation
 * (a dying entity shouldn't keep absorbing hits or holding attention once
 * it's out of the fight). This is a single-lane game, so "nearest" reduces
 * to a 1D distance check rather than anything spatial.
 *
 * @param {object} entity The attacker looking for a target.
 * @param {object[]} opponents The opposing side's array (units or enemies).
 * @returns {object|null} The closest living opponent, or null if none exist.
 */
export function findTarget(entity, opponents) {
    let closest = null, closestDist = Infinity;
    for (const o of opponents) {
        if (o.dying) continue;
        const d = Math.abs(o.x - entity.x);
        if (d < closestDist) { closestDist = d; closest = o; }
    }
    return closest;
}

/**
 * Generates one wave's worth of enemy spawns as a queue of
 * `{ type, delay }` entries, where `delay` is seconds-from-wave-start
 * (not seconds-from-previous-spawn), so main.js can just count down each
 * entry's delay independently every frame.
 *
 * Wave difficulty scales three ways as `waveNum` climbs: more enemies per
 * wave, tougher enemy types unlocking (runners at wave 3+, brutes at wave
 * 4+), and less time between individual spawns.
 *
 * @param {number} waveNum 1-based wave number.
 * @returns {{type: string, delay: number}[]}
 */
export function buildWaveQueue(waveNum) {
    const q = [];
    let t = 0;
    const count = 3 + Math.floor(waveNum * 1.6);
    for (let i = 0; i < count; i++) {
        let type = 'shambler';
        const roll = Math.random();
        if (waveNum >= 3 && roll < 0.25) type = 'runner';
        if (waveNum >= 4 && roll > 0.8) type = 'brute';
        q.push({ type, delay: t });
        t += Math.max(0.35, 1.1 - waveNum * 0.05) + Math.random() * 0.4;
    }
    return q;
}