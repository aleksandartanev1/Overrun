// assets.js
// ---------------------------------------------------------------------------
// Loads every image the game needs (character sprite sheets, the arrow
// projectile, and the parallax background layers) and describes how each
// sprite sheet is laid out (frame counts, per-character ground anchor).
// Nothing here draws anything — render.js consumes these exports — this
// module's only job is "fetch the pictures and describe their shape".
// ---------------------------------------------------------------------------

/**
 * Tracks how many images have been requested vs. how many have finished
 * loading (success or failure both count, so a missing file can't hang the
 * loading screen forever). main.js polls this to know when it's safe to
 * enable the Start button. Exported as one object, rather than two loose
 * exported numbers, so its live values are visible to importers — see the
 * note on audioSettings in audio.js for why that distinction matters with
 * ES modules.
 */
export const assetsProgress = { loaded: 0, total: 0 };

/**
 * Creates an Image, points it at a file under /assets, and registers its
 * load/error against assetsProgress. Every other export in this file is
 * built by calling this once per file, so image loading always goes
 * through the same bookkeeping.
 *
 * @param {string} src Path relative to the assets/ folder, e.g. 'orc_walk.png'.
 * @returns {HTMLImageElement}
 */
function loadImg(src) {
    const img = new Image();
    img.src = 'assets/' + src;
    assetsProgress.total++;
    img.onload = () => { assetsProgress.loaded++; };
    img.onerror = () => { assetsProgress.loaded++; console.warn('Failed to load asset:', src); };
    return img;
}

/**
 * True once every requested image has either loaded or failed. Used to
 * gate the Start button so the player can't begin before sprites exist to
 * draw.
 */
export function assetsReady() {
    return assetsProgress.loaded >= assetsProgress.total;
}

/**
 * Character sprite sheets, keyed by team ("soldier" for player troops,
 * "orc" for enemies — see each unit/enemy's `team` field in config.js).
 *
 * Each sheet is a horizontal filmstrip of 100x100 frames. `groundY` is the
 * pixel row (within that 100px-tall frame) where the character's feet/
 * shadow sit — render.js uses it to anchor the sprite to the battlefield's
 * ground line regardless of how tall the character's pose is. `contentH` is
 * the character's actual drawn height in source pixels (measured from the
 * art, not the full 100px canvas), which render.js uses to scale the sprite
 * up to match that unit's `h` stat from config.js.
 */
export const SPRITE_SHEETS = {
    soldier: {
        groundY: 60, contentH: 21,
        walk: { img: loadImg('soldier_walk.png'), frames: 8 },
        attacks: [
            { img: loadImg('soldier_attack01.png'), frames: 6 },
            { img: loadImg('soldier_attack02.png'), frames: 6 },
            { img: loadImg('soldier_attack03.png'), frames: 9 }
        ],
        death: { img: loadImg('soldier_death.png'), frames: 4 }
    },
    orc: {
        groundY: 57, contentH: 15,
        walk: { img: loadImg('orc_walk.png'), frames: 8 },
        attacks: [
            { img: loadImg('orc_attack01.png'), frames: 6 },
            { img: loadImg('orc_attack02.png'), frames: 6 }
        ],
        death: { img: loadImg('orc_death.png'), frames: 4 }
    }
};

/** The Ranged unit's projectile sprite. */
export const arrowImg = loadImg('arrow.png');

// ---- Background art (parallax forest + ground tileset) --------------------

/** Flat sky-color backdrop, drawn first (farthest back). */
export const bgSky = loadImg('bg/sky.png');
/** Lightest/farthest tree silhouette layer. */
export const bgWoods4 = loadImg('bg/woods4.png');
export const bgWoods3 = loadImg('bg/woods3.png');
export const bgWoods2 = loadImg('bg/woods2.png');
/** Darkest/closest tree silhouette layer, drawn last (nearest the camera). */
export const bgWoods1 = loadImg('bg/woods1.png');

/** Tilesheet containing the grass-top dirt tiles used for the ground strip. */
export const groundTileset = loadImg('bg/tileset.png');

/**
 * Source rectangles (top-left corner only; tiles are 32x32) within
 * groundTileset for the two ground-tile variants render.js alternates
 * between, so the tiled strip doesn't look obviously copy-pasted.
 */
export const GROUND_TILE_SRC = [
    { sx: 7 * 32, sy: 2 * 32 },
    { sx: 8 * 32, sy: 2 * 32 }
];