(function() {
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

    // ---- Audio (synthesized, no external assets) ----
    let audioCtx = null;
    let muted = false;
    function ensureAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }
    function tone(freq, dur, type, vol, delay) {
        if (muted || !audioCtx) return;
        delay = delay || 0;
        const t0 = audioCtx.currentTime + delay;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }
    function noiseThud(vol, dur) {
        if (muted || !audioCtx) return;
        const bufferSize = audioCtx.sampleRate * dur;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        src.start();
    }
    const sfx = {
        spawnPlayer: () => tone(340, 0.09, 'square', 0.05),
        spawnEnemy: () => tone(120, 0.12, 'sawtooth', 0.035),
        hit: () => tone(180, 0.05, 'square', 0.03),
        baseDamage: () => noiseThud(0.18, 0.28),
        waveStart: () => { tone(220, 0.15, 'triangle', 0.06); tone(330, 0.15, 'triangle', 0.05, 0.12); },
        death: () => noiseThud(0.09, 0.15),
        win: () => { tone(392, 0.12, 'square', 0.06, 0); tone(523, 0.12, 'square', 0.06, 0.13); tone(659, 0.22, 'square', 0.06, 0.26); },
        lose: () => { tone(220, 0.2, 'sawtooth', 0.06, 0); tone(160, 0.3, 'sawtooth', 0.06, 0.18); }
    };

    // ---- Sprite assets ----
    const ANIM_FPS = 12;
    const DEATH_FPS = 10;
    function loadImg(src) {
        const img = new Image();
        img.src = 'assets/' + src;
        assetsToLoad++;
        img.onload = () => { assetsLoaded++; };
        img.onerror = () => { assetsLoaded++; console.warn('Failed to load asset:', src); };
        return img;
    }
    let assetsToLoad = 0, assetsLoaded = 0;
    const SPRITE_SHEETS = {
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
    const arrowImg = loadImg('arrow.png');

    // ---- Background art ----
    const bgSky = loadImg('bg/sky.png');
    const bgWoods4 = loadImg('bg/woods4.png');
    const bgWoods3 = loadImg('bg/woods3.png');
    const bgWoods2 = loadImg('bg/woods2.png');
    const bgWoods1 = loadImg('bg/woods1.png');
    const groundTileset = loadImg('bg/tileset.png');
    const GROUND_TILE_SRC = [ { sx: 7 * 32, sy: 2 * 32 }, { sx: 8 * 32, sy: 2 * 32 } ];

    let W, H, GROUND_Y;
    function resize() {
        const holder = document.getElementById('canvasholder');
        W = canvas.width = holder.clientWidth;
        H = canvas.height = holder.clientHeight;
        GROUND_Y = H - 60;
    }
    window.addEventListener('resize', resize);

    const BASE_W = 74;
    const TOTAL_WAVES = 8;

    const UNIT_TYPES = {
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

    const ENEMY_TYPES = {
        shambler: { hp: 30, dmg: 5, range: 29, atkSpeed: 0.9, speed: 34, w: 32, h: 48, color: '#8a5a4a', team: 'orc', atkVariant: 0 },
        runner:   { hp: 18, dmg: 4, range: 26, atkSpeed: 0.7, speed: 81, w: 26, h: 42, color: '#a86a3a', team: 'orc', atkVariant: 1 },
        brute:    { hp: 110, dmg: 16, range: 34, atkSpeed: 1.3, speed: 23, w: 48, h: 68, color: '#5a3a2a', team: 'orc', atkVariant: 0 }
    };

    let state, units, enemies, projectiles, particles, bursts, supplies, wave, waveTimer, spawnQueue, running, gameOver, lastTime, paused, animClock = 0;
    let shakeTime = 0, shakeMag = 0;

    function triggerShake(mag, dur) {
        shakeMag = Math.max(shakeMag, mag);
        shakeTime = Math.max(shakeTime, dur);
    }

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

    function buildWaveQueue(waveNum) {
        // returns array of {type, delay}
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

    function startWave() {
        spawnQueue = buildWaveQueue(wave);
        waveNumEl.textContent = wave;
        sfx.waveStart();
        showWaveBanner('WAVE ' + wave + ' INCOMING');
    }

    function spawnUnit(typeKey) {
        if (gameOver || paused || !running) return;
        const def = UNIT_TYPES[typeKey];
        if (supplies < def.cost) return;
        supplies -= def.cost;
        units.push({
            type: typeKey, def,
            x: BASE_W + 4, y: GROUND_Y,
            hp: def.hp, maxHp: def.hp,
            cooldown: 0, target: null, flash: 0,
            w: def.w, h: def.h,
            attacking: false, walkTimer: 0, attackTimer: 0, dying: false, deathTimer: 0
        });
        sfx.spawnPlayer();
        updateHUD();
    }

    function spawnEnemy(typeKey) {
        const def = ENEMY_TYPES[typeKey];
        enemies.push({
            type: typeKey, def,
            x: W - BASE_W - 4, y: GROUND_Y,
            hp: def.hp, maxHp: def.hp,
            cooldown: 0, target: null, flash: 0,
            w: def.w, h: def.h,
            attacking: false, walkTimer: 0, attackTimer: 0, dying: false, deathTimer: 0
        });
        sfx.spawnEnemy();
    }

    function updateHUD() {
        supplyNum.textContent = Math.floor(supplies);
        playerHpBar.style.width = Math.max(0, state.playerHp / state.playerMaxHp * 100) + '%';
        enemyHpBar.style.width = Math.max(0, state.enemyHp / state.enemyMaxHp * 100) + '%';
        for (const key in UNIT_TYPES) {
            const btn = document.getElementById('btn-' + key);
            if (btn) btn.disabled = supplies < UNIT_TYPES[key].cost || gameOver;
        }
    }

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

    window.addEventListener('keydown', (e) => {
        if (e.key === '1') spawnUnit('grunt');
        if (e.key === '2') spawnUnit('heavy');
        if (e.key === '3') spawnUnit('ranged');
    });

    function findTarget(entity, opponents, opponentBaseX, isPlayer) {
        let closest = null, closestDist = Infinity;
        for (const o of opponents) {
            if (o.dying) continue;
            const d = Math.abs(o.x - entity.x);
            if (d < closestDist) { closestDist = d; closest = o; }
        }
        return closest;
    }

    function update(dt) {
        if (!running || gameOver) return;

        supplies += dt * (3.2 + wave * 0.15);
        animClock += dt;
        updateHUD();

        // spawn queued enemies
        waveTimer -= dt;
        spawnQueue = spawnQueue.filter(item => {
            item.delay -= dt;
            if (item.delay <= 0) { spawnEnemy(item.type); return false; }
            return true;
        });

        if (spawnQueue.length === 0 && enemies.length === 0 && !gameOver) {
            waveTimer -= dt;
        }

        // move & fight units
        for (const u of units) {
            if (u.dying) { u.deathTimer += dt; continue; }
            const target = findTarget(u, enemies);
            const distToEnemyBase = (W - BASE_W) - u.x;
            if (target && Math.abs(target.x - u.x) <= (u.def.range + u.w/2 + target.w/2)) {
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
                // attack enemy base
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

        // move & fight enemies
        for (const en of enemies) {
            if (en.dying) { en.deathTimer += dt; continue; }
            const target = findTarget(en, units);
            const distToPlayerBase = en.x - BASE_W;
            if (target && Math.abs(target.x - en.x) <= (en.def.range + en.w/2 + target.w/2)) {
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

        // projectiles
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

        // trigger death state (once) instead of instant removal
        for (const u of units) {
            if (u.hp <= 0 && !u.dying) { u.dying = true; u.deathTimer = 0; spawnBurst(u.x, u.y - u.h * 0.5, u.def.color); sfx.death(); }
        }
        for (const en of enemies) {
            if (en.hp <= 0 && !en.dying) { en.dying = true; en.deathTimer = 0; spawnBurst(en.x, en.y - en.h * 0.5, en.def.color); sfx.death(); }
        }

        // remove units/enemies once their death animation has finished
        const soldierDeathDur = SPRITE_SHEETS.soldier.death.frames / DEATH_FPS;
        const orcDeathDur = SPRITE_SHEETS.orc.death.frames / DEATH_FPS;
        units = units.filter(u => !(u.dying && u.deathTimer > soldierDeathDur));
        enemies = enemies.filter(en => !(en.dying && en.deathTimer > orcDeathDur));

        // flash decay
        for (const u of units) if (u.flash > 0) u.flash -= dt;
        for (const en of enemies) if (en.flash > 0) en.flash -= dt;

        // particles
        for (const pt of particles) { pt.life -= dt; pt.y -= dt * 20; }
        particles = particles.filter(pt => pt.life > 0);

        // bursts
        for (const b of bursts) {
            b.life -= dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.vy += 160 * dt;
        }
        bursts = bursts.filter(b => b.life > 0);

        // shake decay
        if (shakeTime > 0) {
            shakeTime -= dt;
            if (shakeTime <= 0) shakeMag = 0;
        }

        // win/lose checks
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

    function endGame(won, reason) {
        gameOver = true;
        running = false;
        overlay.style.display = 'flex';
        if (won) { sfx.win(); } else { sfx.lose(); }
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

    // ---- Sprite drawing: real pixel-art sheets ----
    const spriteBuffer = document.createElement('canvas');
    spriteBuffer.width = 100;
    spriteBuffer.height = 100;
    const bufCtx = spriteBuffer.getContext('2d');

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
        const frameIndex = e.dying ? Math.min(rawFrame, frameCount - 1) : (rawFrame % frameCount);
        const img = frameSet.img;
        if (!img.complete || img.naturalWidth === 0) return;

        const facing = isEnemy ? -1 : 1;
        const scale = e.h / sheet.contentH;
        const tile = 100 * scale;

        let source = img;
        let sx = frameIndex * 100;

        // Hit-flash: tint via an offscreen buffer so source-atop only affects
        // this sprite's own pixels, not whatever's already on the main canvas.
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

    function drawBase(x, isPlayer) {
        const color = isPlayer ? '#3a4a33' : '#4a3328';
        ctx.fillStyle = color;
        ctx.fillRect(isPlayer ? 0 : x, GROUND_Y - 112, BASE_W, 112);
        ctx.fillStyle = isPlayer ? '#7c9c5f' : '#c1502e';
        ctx.fillRect(isPlayer ? 0 : x, GROUND_Y - 118, BASE_W, 10);
    }

    function drawEntity(e, isEnemy) {
        drawSpriteEntity(e, isEnemy);
        // hp bar (skip once death animation is playing)
        if (e.dying) return;
        const pct = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = '#0c0d0b';
        ctx.fillRect(e.x - e.w/2, e.y - e.h - 12, e.w, 6);
        ctx.fillStyle = isEnemy ? '#c1502e' : '#7c9c5f';
        ctx.fillRect(e.x - e.w/2, e.y - e.h - 12, e.w * pct, 6);
    }

    function drawBursts() {
        for (const b of bursts) {
            ctx.globalAlpha = Math.max(0, b.life / b.maxLife);
            ctx.fillStyle = b.color;
            ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
        }
        ctx.globalAlpha = 1;
    }

    function render() {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        if (shakeTime > 0) {
            const dx = (Math.random() * 2 - 1) * shakeMag * (shakeTime > 0.15 ? 1 : shakeTime / 0.15);
            const dy = (Math.random() * 2 - 1) * shakeMag * (shakeTime > 0.15 ? 1 : shakeTime / 0.15);
            ctx.translate(dx, dy);
        }

        // sky + parallax woods layers (stretched to fill the battlefield backdrop)
        if (bgSky.complete && bgSky.naturalWidth > 0) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(bgSky, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
            ctx.drawImage(bgWoods4, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
            ctx.drawImage(bgWoods3, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
            ctx.drawImage(bgWoods2, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
            ctx.drawImage(bgWoods1, 0, 0, 512, 288, 0, 0, W, GROUND_Y);
            // dark scrim so the busy art doesn't fight the HUD/units for attention
            ctx.fillStyle = 'rgba(10, 11, 9, 0.52)';
            ctx.fillRect(0, 0, W, GROUND_Y);
        } else {
            const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
            grad.addColorStop(0, '#232722');
            grad.addColorStop(1, '#14150f');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, GROUND_Y);
        }

        // ground: tiled dirt/grass strip
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
            ctx.strokeStyle = '#3a3c33';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, GROUND_Y);
            ctx.lineTo(W, GROUND_Y);
            ctx.stroke();
        } else {
            ctx.fillStyle = '#1a1d1a';
            ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
            ctx.strokeStyle = '#3a3c33';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, GROUND_Y);
            ctx.lineTo(W, GROUND_Y);
            ctx.stroke();
        }

        drawBase(0, true);
        drawBase(W - BASE_W, false);

        for (const u of units) drawEntity(u, false);
        for (const en of enemies) drawEntity(en, true);
        drawBursts();

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

        ctx.font = '15px monospace';
        ctx.textAlign = 'center';
        for (const pt of particles) {
            ctx.globalAlpha = Math.max(0, pt.life / 0.2);
            ctx.fillStyle = pt.color;
            ctx.fillText(pt.text, pt.x, pt.y);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    function loop(t) {
        if (lastTime == null) lastTime = t;
        const dt = Math.min(0.05, (t - lastTime) / 1000);
        lastTime = t;
        if (!paused) update(dt);
        render();
        requestAnimationFrame(loop);
    }

    function updatePauseBtn() {
        pauseBtn.textContent = paused ? '►' : 'II';
        pausedTag.classList.toggle('show', paused && running && !gameOver);
    }

    pauseBtn.addEventListener('click', () => {
        if (!running || gameOver) return;
        paused = !paused;
        updatePauseBtn();
    });

    muteBtn.addEventListener('click', () => {
        muted = !muted;
        muteBtn.classList.toggle('active', muted);
        muteBtn.textContent = muted ? '✕' : '♪';
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
        if (e.key === ' ' && running && !gameOver) {
            e.preventDefault();
            paused = !paused;
            updatePauseBtn();
        }
    });

    overlayBtn.addEventListener('click', () => {
        ensureAudio();
        resetGame();
        resize();
        startWave();
        running = true;
        overlay.style.display = 'none';
    });

    buildUnitButtons();
    waveTotalEl.textContent = TOTAL_WAVES;
    resize();
    resetGame();

    overlayBtn.disabled = true;
    overlayBtn.textContent = 'LOADING...';
    const loadCheck = setInterval(() => {
        if (assetsLoaded >= assetsToLoad) {
            clearInterval(loadCheck);
            overlayBtn.disabled = false;
            overlayBtn.textContent = 'START';
        }
    }, 100);

    requestAnimationFrame(loop);
})();