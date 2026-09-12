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
            speed: 55, w: 32, h: 48, color: '#7c9c5f', splash: false, sprite: 'grunt'
        },
        heavy: {
            name: 'HEAVY', key: '2', cost: 50, hp: 140, dmg: 14, range: 39, atkSpeed: 1.4,
            speed: 26, w: 45, h: 58, color: '#5b6b8c', splash: false, sprite: 'heavy'
        },
        ranged: {
            name: 'RANGED', key: '3', cost: 35, hp: 25, dmg: 8, range: 140, atkSpeed: 1.1,
            speed: 44, w: 29, h: 45, color: '#d4a017', splash: false, projectile: true, sprite: 'ranged'
        }
    };

    const ENEMY_TYPES = {
        shambler: { hp: 30, dmg: 5, range: 29, atkSpeed: 0.9, speed: 34, w: 32, h: 48, color: '#8a5a4a', sprite: 'shambler' },
        runner:   { hp: 18, dmg: 4, range: 26, atkSpeed: 0.7, speed: 81, w: 26, h: 42, color: '#a86a3a', sprite: 'runner' },
        brute:    { hp: 110, dmg: 16, range: 34, atkSpeed: 1.3, speed: 23, w: 48, h: 61, color: '#5a3a2a', sprite: 'brute' }
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
            w: def.w, h: def.h
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
            w: def.w, h: def.h
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
            const target = findTarget(u, enemies);
            const distToEnemyBase = (W - BASE_W) - u.x;
            if (target && Math.abs(target.x - u.x) <= (u.def.range + u.w/2 + target.w/2)) {
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
                u.x += u.def.speed * dt;
            } else {
                // attack enemy base
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
            const target = findTarget(en, units);
            const distToPlayerBase = en.x - BASE_W;
            if (target && Math.abs(target.x - en.x) <= (en.def.range + en.w/2 + target.w/2)) {
                en.cooldown -= dt;
                if (en.cooldown <= 0) {
                    en.cooldown = en.def.atkSpeed;
                    target.hp -= en.def.dmg;
                    target.flash = 0.12;
                    sfx.hit();
                    particles.push({ x: target.x, y: target.y - target.h * 0.6, life: 0.2, text: '-' + en.def.dmg, color: '#e8e4d8' });
                }
            } else if (distToPlayerBase > en.def.range) {
                en.x -= en.def.speed * dt;
            } else {
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
                p.x += (dx / dist) * p.speed * dt;
                p.y += (dy / dist) * p.speed * dt;
            }
        }
        projectiles = projectiles.filter(p => !p.dead);

        // death bursts before cleanup
        for (const u of units) {
            if (u.hp <= 0) { spawnBurst(u.x, u.y - u.h * 0.5, u.def.color); sfx.death(); }
        }
        for (const en of enemies) {
            if (en.hp <= 0) { spawnBurst(en.x, en.y - en.h * 0.5, en.def.color); sfx.death(); }
        }

        // cleanup dead
        units = units.filter(u => u.hp > 0);
        enemies = enemies.filter(en => en.hp > 0);

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

    function drawBase(x, isPlayer) {
        const color = isPlayer ? '#3a4a33' : '#4a3328';
        ctx.fillStyle = color;
        ctx.fillRect(isPlayer ? 0 : x, GROUND_Y - 112, BASE_W, 112);
        ctx.fillStyle = isPlayer ? '#7c9c5f' : '#c1502e';
        ctx.fillRect(isPlayer ? 0 : x, GROUND_Y - 118, BASE_W, 10);
    }

    // ---- Sprite drawing: procedural vector humanoids ----
    function shade(hex, amt) {
        const n = parseInt(hex.slice(1), 16);
        let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
        r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
        return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
    }

    // Draws a humanoid centered at (cx, groundY), facing dir (1 = right, -1 = left).
    function drawHumanoid(cx, groundY, w, h, facing, opts) {
        const flashOn = opts.flash && opts.flash > 0;
        const base = flashOn ? '#f2efe6' : opts.color;
        const dark = flashOn ? '#f2efe6' : shade(opts.color, -50);
        const skin = flashOn ? '#f2efe6' : '#c99a75';
        const legPhase = Math.sin(animClock * 8 + cx * 0.4) * (opts.walking ? 1 : 0.25);

        ctx.save();
        ctx.translate(cx, groundY);
        ctx.scale(facing, 1);

        const bodyH = h * (opts.hunched ? 0.72 : 0.62);
        const legH = h - bodyH;
        const legW = Math.max(3, w * 0.16);

        // legs (simple swinging pair)
        ctx.fillStyle = dark;
        ctx.fillRect(-legW - 1 + legPhase * 2, -legH, legW, legH);
        ctx.fillRect(1 - legPhase * 2, -legH, legW, legH);

        // torso
        const torsoY = -h + (opts.hunched ? h * 0.06 : 0);
        ctx.fillStyle = base;
        if (opts.hunched) {
            // hunched zombie torso: leaning wedge shape
            ctx.beginPath();
            ctx.moveTo(-w * 0.32, torsoY + bodyH);
            ctx.lineTo(-w * 0.4, torsoY + bodyH * 0.25);
            ctx.lineTo(w * 0.05, torsoY);
            ctx.lineTo(w * 0.38, torsoY + bodyH * 0.35);
            ctx.lineTo(w * 0.3, torsoY + bodyH);
            ctx.closePath();
            ctx.fill();
        } else {
            const torsoW = opts.bulky ? w * 0.82 : w * 0.62;
            ctx.fillRect(-torsoW / 2, torsoY, torsoW, bodyH);
            if (opts.bulky) {
                // armor plate accent
                ctx.fillStyle = dark;
                ctx.fillRect(-torsoW / 2, torsoY, torsoW, bodyH * 0.3);
            }
        }

        // head
        const headR = w * (opts.hunched ? 0.24 : 0.2);
        const headY = torsoY - headR * 0.9;
        ctx.fillStyle = opts.hunched ? shade(opts.color, 25) : skin;
        ctx.beginPath();
        ctx.arc(opts.hunched ? headR * 0.5 : 0, headY, headR, 0, Math.PI * 2);
        ctx.fill();

        if (opts.helmet) {
            ctx.fillStyle = dark;
            ctx.beginPath();
            ctx.arc(0, headY, headR + 1.5, Math.PI, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(-headR - 1.5, headY, (headR + 1.5) * 2, 2);
        }

        // arm + weapon (points forward, i.e. +x before facing flip)
        const armY = torsoY + bodyH * 0.32;
        ctx.strokeStyle = dark;
        ctx.lineWidth = Math.max(2, w * 0.1);
        ctx.lineCap = 'round';

        if (opts.weapon === 'rifle') {
            ctx.beginPath();
            ctx.moveTo(w * 0.1, armY);
            ctx.lineTo(w * 0.55, armY - 2);
            ctx.stroke();
        } else if (opts.weapon === 'cannon') {
            ctx.lineWidth = Math.max(3, w * 0.16);
            ctx.beginPath();
            ctx.moveTo(w * 0.15, armY + 2);
            ctx.lineTo(w * 0.62, armY);
            ctx.stroke();
        } else if (opts.weapon === 'bow') {
            ctx.beginPath();
            ctx.arc(w * 0.42, armY, w * 0.28, -Math.PI * 0.4, Math.PI * 0.4);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(w * 0.3, armY - w * 0.1);
            ctx.lineTo(w * 0.62, armY);
            ctx.lineTo(w * 0.3, armY + w * 0.1);
            ctx.stroke();
        } else if (opts.weapon === 'claws') {
            ctx.beginPath();
            ctx.moveTo(w * 0.05, armY - 2);
            ctx.lineTo(w * 0.4, armY - 8);
            ctx.moveTo(w * 0.05, armY + 2);
            ctx.lineTo(w * 0.42, armY + 4);
            ctx.stroke();
        }

        ctx.restore();
    }

    const SPRITE_PROFILES = {
        grunt:    { weapon: 'rifle', helmet: true, bulky: false, hunched: false, walking: true },
        heavy:    { weapon: 'cannon', helmet: true, bulky: true, hunched: false, walking: true },
        ranged:   { weapon: 'bow', helmet: false, bulky: false, hunched: false, walking: true },
        shambler: { weapon: 'claws', helmet: false, bulky: false, hunched: true, walking: true },
        runner:   { weapon: 'claws', helmet: false, bulky: false, hunched: true, walking: true },
        brute:    { weapon: 'claws', helmet: false, bulky: true, hunched: true, walking: true }
    };

    function drawEntity(e, isEnemy) {
        const profile = SPRITE_PROFILES[e.def.sprite] || { weapon: 'rifle', helmet: false, bulky: false, hunched: false, walking: true };
        drawHumanoid(e.x, e.y, e.w, e.h, isEnemy ? -1 : 1, {
            color: e.def.color,
            flash: e.flash,
            weapon: profile.weapon,
            helmet: profile.helmet,
            bulky: profile.bulky,
            hunched: profile.hunched,
            walking: profile.walking
        });
        // hp bar
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

        // sky
        const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
        grad.addColorStop(0, '#232722');
        grad.addColorStop(1, '#14150f');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, GROUND_Y);

        // ground
        ctx.fillStyle = '#1a1d1a';
        ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        ctx.strokeStyle = '#3a3c33';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, GROUND_Y);
        ctx.lineTo(W, GROUND_Y);
        ctx.stroke();

        drawBase(0, true);
        drawBase(W - BASE_W, false);

        for (const u of units) drawEntity(u, false);
        for (const en of enemies) drawEntity(en, true);
        drawBursts();

        ctx.fillStyle = '#e8e4d8';
        for (const p of projectiles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fill();
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
    requestAnimationFrame(loop);
})();