/**
 * SillyTavern 消息提示音替换脚本（酒馆助手 / JS-Slash-Runner）
 * 仓库: https://github.com/cone97218-alt/sounds
 * 版本: 1.1.0
 * 说明:
 * - 仅替换酒馆自带提示音音源并提供 0%~300% 音量增益，开关仍由酒馆「用户设置 -> 杂项」控制。
 * - 使用 Web Audio API（GainNode + 防破音限幅器）实现超 100% 增益，同时解决移动端音量滑块限制。
 * - 严格按需懒加载：启动时仅加载当前选中的 1 个音效，不拖慢酒馆加载速度。
 */
(function () {
    'use strict';

    const SCRIPT_VERSION = '1.1.1';
    const REPO = 'cone97218-alt/sounds';
    const BRANCH = 'main';
    const STORAGE_KEY = 'st_msg_sound_replacer_v1';
    const GLOBAL_KEY = '__ST_MSG_SOUND_REPLACER__';
    const STYLE_ID = 'st-msr-style';
    const PANEL_ID = 'st-msr-panel';
    const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB
    const MAX_VOLUME = 3.0; // 300%
    const MAX_CACHE_ITEMS = 12;

    const topWin = (window.parent && window.parent !== window) ? window.parent : window;
    const topDoc = topWin.document;

    // 清理旧实例（防止酒馆助手重载时重复挂载）
    if (topWin[GLOBAL_KEY] && typeof topWin[GLOBAL_KEY].cleanup === 'function') {
        try {
            topWin[GLOBAL_KEY].cleanup();
        } catch (e) {
            console.warn('[ST提示音替换] 清理旧实例失败:', e);
        }
    }

    // 保底音效列表（远程 sounds.json 拉取成功时会被最新清单替换）
    const FALLBACK_SOUNDS = [
        { id: 'zelda-secret', name: '解谜成功', group: '塞尔达传说', file: 'sounds/zelda-secret.mp3' },
        { id: 'zelda-korok', name: '发现克洛格 (Yahaha!)', group: '塞尔达传说', file: 'sounds/zelda-korok.mp3' },
        { id: 'zelda-item', name: '获得道具', group: '塞尔达传说', file: 'sounds/zelda-item.mp3' },
        { id: 'zelda-rupee', name: '拾取卢比', group: '塞尔达传说', file: 'sounds/zelda-rupee.mp3' },
        { id: 'stardew-fishing', name: '钓鱼上钩', group: '星露谷物语', file: 'sounds/stardew-fishing.mp3' },
        { id: 'stardew-valley', name: '清晨旋律 (柔和淡出)', group: '星露谷物语', file: 'sounds/stardew-valley.mp3', maxDuration: 3.8, fadeOut: 1.3 },
        { id: 'mc-xp', name: '经验球', group: 'Minecraft', file: 'sounds/mc-xp.mp3' },
        { id: 'mc-levelup', name: '升级提示', group: 'Minecraft', file: 'sounds/mc-levelup.mp3' },
        { id: 'pokemon-heal', name: '精灵中心回复', group: '宝可梦', file: 'sounds/pokemon-heal.mp3' },
        { id: 'pokemon-levelup', name: '升级音效', group: '宝可梦', file: 'sounds/pokemon-levelup.mp3' },
        { id: 'mario-coin', name: '吃金币', group: '经典游戏', file: 'sounds/mario-coin.mp3' },
        { id: 'mario-1up', name: '超级马里奥 · 1UP', group: '经典游戏', file: 'sounds/mario-1up.mp3' },
        { id: 'sonic-ring', name: '索尼克 · 金币环', group: '经典游戏', file: 'sounds/sonic-ring.mp3' },
        { id: 'ps-trophy', name: 'PlayStation · 奖杯', group: '经典游戏', file: 'sounds/ps-trophy.mp3' },
        { id: 'switch-click', name: 'Switch · 咔哒', group: '经典游戏', file: 'sounds/switch-click.mp3' },
        { id: 'ac-greetings', name: '动物森友会 · 打招呼', group: '经典游戏', file: 'sounds/ac-greetings.mp3' },
        { id: 'hk-grub', name: '空洞骑士 · 小幼虫', group: '经典游戏', file: 'sounds/hk-grub.mp3' },
        { id: 'mgs-alert', name: '合金装备 · 惊叹号', group: '经典游戏', file: 'sounds/mgs-alert.mp3' },
        { id: 'ui-confirm-1', name: '清脆双音 · 柔和', group: '开源轻提示 (CC0)', file: 'sounds/ui-confirm-1.wav' },
        { id: 'ui-confirm-2', name: '清脆双音 · 明亮', group: '开源轻提示 (CC0)', file: 'sounds/ui-confirm-2.wav' },
        { id: 'ui-confirm-3', name: '清脆双音 · 轻快', group: '开源轻提示 (CC0)', file: 'sounds/ui-confirm-3.wav' },
        { id: 'ui-confirm-4', name: '清脆双音 · 温暖', group: '开源轻提示 (CC0)', file: 'sounds/ui-confirm-4.wav' },
        { id: 'ui-glass-1', name: '玻璃叮咚 · 轻', group: '开源轻提示 (CC0)', file: 'sounds/ui-glass-1.wav' },
        { id: 'ui-glass-4', name: '玻璃叮咚 · 响', group: '开源轻提示 (CC0)', file: 'sounds/ui-glass-4.wav' },
        { id: 'ui-drop-2', name: '水滴气泡 · 轻', group: '开源轻提示 (CC0)', file: 'sounds/ui-drop-2.wav' },
        { id: 'ui-drop-3', name: '水滴气泡 · 弹', group: '开源轻提示 (CC0)', file: 'sounds/ui-drop-3.wav' },
        { id: 'ui-pluck-1', name: '拨弦轻音 · 短', group: '开源轻提示 (CC0)', file: 'sounds/ui-pluck-1.wav' },
        { id: 'ui-pluck-2', name: '拨弦轻音 · 扬', group: '开源轻提示 (CC0)', file: 'sounds/ui-pluck-2.wav' },
        { id: 'ui-bong-1', name: '柔和木琴叮', group: '开源轻提示 (CC0)', file: 'sounds/ui-bong-1.wav' },
        { id: 'ui-rise-6', name: '柔和上扬提示', group: '开源轻提示 (CC0)', file: 'sounds/ui-rise-6.wav' },
        { id: 'ui-question-1', name: '俏皮提问音', group: '开源轻提示 (CC0)', file: 'sounds/ui-question-1.wav' },
        { id: 'discord-notify', name: 'Discord · 消息提示', group: '日常提示音', file: 'sounds/discord-notify.mp3' },
        { id: 'iphone-ding', name: 'iPhone · 短信叮', group: '日常提示音', file: 'sounds/iphone-ding.mp3' },
        { id: 'bell-ding', name: '清脆小铃铛', group: '日常提示音', file: 'sounds/bell-ding.mp3' },
        { id: 'bubble-pop', name: '清脆泡泡啵', group: '日常提示音', file: 'sounds/bubble-pop.mp3' },
    ];

    const DEFAULT_CONFIG = {
        soundId: 'default',
        volume: 0.8,
        customUrl: '',
        customDataUrl: '',
        customFileName: '',
    };

    let soundsList = FALLBACK_SOUNDS.slice();
    let config = loadConfig();

    // 轻量 LRU 内存缓存（避免占用过多内存）
    const bufferCache = new Map(); // cacheKey -> AudioBuffer
    const blobCache = new Map();   // cacheKey -> blobUrl（供降级 <audio> 使用）
    let audioCtx = null;
    let activeSource = null;
    let hookedAudio = null;
    let originalAudioSrc = 'sounds/message.mp3';
    let mountTimer = null;
    let destroyed = false;

    function clamp(num, min, max) {
        return Math.min(max, Math.max(min, num));
    }

    function loadConfig() {
        try {
            const raw = topWin.localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_CONFIG };
            const parsed = JSON.parse(raw);
            return {
                ...DEFAULT_CONFIG,
                ...parsed,
                volume: typeof parsed.volume === 'number' && !Number.isNaN(parsed.volume)
                    ? clamp(parsed.volume, 0, MAX_VOLUME)
                    : DEFAULT_CONFIG.volume,
            };
        } catch {
            return { ...DEFAULT_CONFIG };
        }
    }

    function saveConfig() {
        try {
            topWin.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        } catch (e) {
            console.warn('[ST提示音替换] 保存配置失败:', e);
        }
    }

    function getAudioContext() {
        if (audioCtx) return audioCtx;
        const Ctx = topWin.AudioContext || topWin.webkitAudioContext;
        if (!Ctx) return null;
        try {
            audioCtx = new Ctx();
        } catch {
            audioCtx = null;
        }
        return audioCtx;
    }

    function unlockAudioContext() {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
    }

    function cacheSet(map, key, val, revokeOldBlob = false) {
        if (map.has(key)) map.delete(key);
        map.set(key, val);
        if (map.size > MAX_CACHE_ITEMS) {
            const oldestKey = map.keys().next().value;
            const oldestVal = map.get(oldestKey);
            map.delete(oldestKey);
            if (revokeOldBlob && typeof oldestVal === 'string' && oldestVal.startsWith('blob:')) {
                try { topWin.URL.revokeObjectURL(oldestVal); } catch {}
            }
        }
    }

    function getManifestUrls() {
        const ts = Date.now();
        return [
            `https://raw.githubusercontent.com/${REPO}/${BRANCH}/sounds.json?t=${ts}`,
            `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/sounds.json?t=${ts}`,
            `https://fastly.jsdelivr.net/gh/${REPO}@${BRANCH}/sounds.json?t=${ts}`,
            `https://gh-proxy.com/https://raw.githubusercontent.com/${REPO}/${BRANCH}/sounds.json?t=${ts}`,
        ];
    }

    function getAssetUrls(relPath) {
        const clean = relPath.replace(/^\/+/, '');
        return [
            `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${clean}`,
            `https://fastly.jsdelivr.net/gh/${REPO}@${BRANCH}/${clean}`,
            `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${clean}`,
            `https://gh-proxy.com/https://raw.githubusercontent.com/${REPO}/${BRANCH}/${clean}`,
        ];
    }

    async function fetchJsonWithFallback(urls) {
        let lastErr = null;
        for (const url of urls) {
            try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || new Error('所有远程源均不可用');
    }

    async function fetchArrayBufferWithFallback(urls) {
        let lastErr = null;
        for (const url of urls) {
            try {
                const res = await fetch(url, { cache: 'force-cache' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buf = await res.arrayBuffer();
                if (buf && buf.byteLength > 0) return buf;
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || new Error('音频拉取失败');
    }

    function dataUrlToArrayBuffer(dataUrl) {
        const idx = dataUrl.indexOf(',');
        if (idx === -1) return null;
        const bin = topWin.atob(dataUrl.slice(idx + 1));
        const len = bin.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = bin.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function getCurrentCacheKey() {
        if (config.soundId === 'custom') {
            if (config.customDataUrl) return `custom:file:${config.customFileName}:${config.customDataUrl.length}`;
            if (config.customUrl && config.customUrl.trim()) return `custom:url:${config.customUrl.trim()}`;
            return 'default';
        }
        return config.soundId || 'default';
    }

    function getFallbackDirectUrl() {
        if (config.soundId === 'custom') {
            if (config.customDataUrl) return config.customDataUrl;
            if (config.customUrl && config.customUrl.trim()) return config.customUrl.trim();
            return originalAudioSrc;
        }
        if (!config.soundId || config.soundId === 'default') {
            return originalAudioSrc;
        }
        const item = soundsList.find(s => s.id === config.soundId);
        if (!item) return originalAudioSrc;
        return item.url || getAssetUrls(item.file)[0];
    }

    async function loadAudioBufferForCurrent() {
        const key = getCurrentCacheKey();
        if (bufferCache.has(key)) {
            return bufferCache.get(key);
        }

        const ctx = getAudioContext();
        if (!ctx) return null;

        let arrayBuf = null;
        try {
            if (key === 'default') {
                const res = await fetch(originalAudioSrc, { cache: 'force-cache' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                arrayBuf = await res.arrayBuffer();
            } else if (key.startsWith('custom:file:')) {
                arrayBuf = dataUrlToArrayBuffer(config.customDataUrl);
            } else if (key.startsWith('custom:url:')) {
                const res = await fetch(config.customUrl.trim(), { cache: 'force-cache' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                arrayBuf = await res.arrayBuffer();
            } else {
                const item = soundsList.find(s => s.id === key);
                if (!item) return null;
                const urls = item.url ? [item.url] : getAssetUrls(item.file);
                arrayBuf = await fetchArrayBufferWithFallback(urls);
            }

            if (!arrayBuf || destroyed) return null;

            // 顺手保存 Blob URL 供降级使用
            const blobUrl = topWin.URL.createObjectURL(new Blob([arrayBuf]));
            cacheSet(blobCache, key, blobUrl, true);

            const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
            if (destroyed) return null;
            cacheSet(bufferCache, key, decoded, false);
            return decoded;
        } catch (err) {
            console.warn('[ST提示音替换] Web Audio 解码失败，将使用原生音频降级播放:', err);
            return null;
        }
    }

    async function playWithWebAudio(gainValue) {
        const ctx = getAudioContext();
        if (!ctx) return false;

        if (ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch {
                return false;
            }
        }

        const buffer = await loadAudioBufferForCurrent();
        if (!buffer || destroyed) return false;

        // 停止上一次未播完的提示音
        if (activeSource) {
            try { activeSource.stop(); } catch {}
            activeSource = null;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const gainNode = ctx.createGain();
        const now = ctx.currentTime;
        const item = soundsList.find(s => s.id === config.soundId);
        const maxDur = (item && typeof item.maxDuration === 'number' && item.maxDuration > 0)
            ? Math.min(buffer.duration, item.maxDuration)
            : buffer.duration;
        const fadeOut = (item && typeof item.fadeOut === 'number' && item.fadeOut > 0)
            ? Math.min(item.fadeOut, maxDur * 0.8)
            : 0;

        gainNode.gain.setValueAtTime(gainValue, now);
        if (fadeOut > 0 && gainValue > 0.0001) {
            const fadeStart = Math.max(0, maxDur - fadeOut);
            gainNode.gain.setValueAtTime(gainValue, now + fadeStart);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + maxDur);
        }

        if (gainValue > 1.0) {
            // 超过 100% 时串接防破音限幅器（软压缩），既提响度又防爆音
            const limiter = ctx.createDynamicsCompressor();
            limiter.threshold.setValueAtTime(-2, now);
            limiter.knee.setValueAtTime(6, now);
            limiter.ratio.setValueAtTime(12, now);
            limiter.attack.setValueAtTime(0.002, now);
            limiter.release.setValueAtTime(0.1, now);

            source.connect(gainNode);
            gainNode.connect(limiter);
            limiter.connect(ctx.destination);
        } else {
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
        }

        activeSource = source;
        source.onended = () => {
            if (activeSource === source) activeSource = null;
        };
        if (maxDur < buffer.duration) {
            source.start(now, 0, maxDur);
        } else {
            source.start(now);
        }
        return true;
    }

    function hookAudioElement() {
        const audio = topDoc.getElementById('audio_message_sound');
        if (!audio) return null;

        if (hookedAudio === audio && audio.__stMsrHooked) {
            return audio;
        }

        originalAudioSrc = audio.getAttribute('src') || 'sounds/message.mp3';
        const nativePlay = topWin.HTMLMediaElement.prototype.play;

        audio.__stMsrHooked = true;
        audio.play = function () {
            const vol = clamp(Number(config.volume), 0, MAX_VOLUME);
            if (vol <= 0) {
                return Promise.resolve();
            }

            // 优先走 Web Audio API（支持 0%~300% 增益 & iOS 音量控制），失败时自动无缝降级到原生 <audio>
            return playWithWebAudio(vol).then(ok => {
                if (ok || destroyed) return;
                const key = getCurrentCacheKey();
                const fallbackSrc = blobCache.get(key) || getFallbackDirectUrl();
                if (this.getAttribute('src') !== fallbackSrc) {
                    this.src = fallbackSrc;
                }
                this.volume = clamp(vol, 0, 1);
                return nativePlay.call(this);
            }).catch(() => {
                this.volume = clamp(vol, 0, 1);
                return nativePlay.call(this);
            });
        };

        hookedAudio = audio;
        return audio;
    }

    async function preloadCurrentSound() {
        hookAudioElement();
        // 仅按需预加载当前选中的 1 个音效，绝不批量拉取其他音效
        await loadAudioBufferForCurrent();
    }

    async function previewCurrentSound(btnEl) {
        unlockAudioContext();
        const audio = hookAudioElement();
        if (!audio) return;

        if (btnEl) btnEl.classList.add('st-msr-loading');
        try {
            audio.pause();
            audio.currentTime = 0;
            await audio.play();
        } catch (err) {
            console.warn('[ST提示音替换] 试听播放失败:', err);
        } finally {
            if (btnEl) btnEl.classList.remove('st-msr-loading');
        }
    }

    function injectStyles() {
        if (topDoc.getElementById(STYLE_ID)) return;
        const style = topDoc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
#${PANEL_ID} {
    margin: 6px 0 10px 0;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.14));
    background: var(--SmartThemeBlurTintColor, rgba(0, 0, 0, 0.18));
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 12px;
    box-sizing: border-box;
}
#${PANEL_ID} .st-msr-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
}
#${PANEL_ID} .st-msr-select {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    margin: 0;
    font-size: 12px;
    border-radius: 4px;
    border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.18));
    background: var(--SmartThemeBlurTintColor, rgba(0, 0, 0, 0.25));
    color: var(--SmartThemeBodyColor, inherit);
    outline: none;
    cursor: pointer;
}
#${PANEL_ID} .st-msr-btn {
    flex-shrink: 0;
    height: 28px;
    min-width: 30px;
    padding: 0 8px;
    margin: 0;
    border-radius: 4px;
    border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.18));
    background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.08));
    color: var(--SmartThemeBodyColor, inherit);
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    transition: opacity 0.15s ease, background 0.15s ease;
}
#${PANEL_ID} .st-msr-btn:hover {
    background: rgba(255, 255, 255, 0.16);
}
#${PANEL_ID} .st-msr-btn.st-msr-loading {
    opacity: 0.55;
    pointer-events: none;
}
#${PANEL_ID} .st-msr-vol-icon {
    width: 16px;
    text-align: center;
    opacity: 0.8;
    flex-shrink: 0;
}
#${PANEL_ID} .st-msr-slider {
    flex: 1;
    min-width: 0;
    margin: 0;
    height: 4px;
    accent-color: var(--SmartThemeQuoteColor, #7aa2f7);
    cursor: pointer;
}
#${PANEL_ID} .st-msr-vol-val {
    width: 40px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
    flex-shrink: 0;
    transition: color 0.15s ease;
}
#${PANEL_ID} .st-msr-vol-val.st-msr-boost {
    color: var(--SmartThemeQuoteColor, #7aa2f7);
    font-weight: 600;
    opacity: 1;
}
#${PANEL_ID} .st-msr-custom {
    display: none;
    flex-direction: column;
    gap: 5px;
    padding-top: 4px;
    border-top: 1px dashed var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.12));
}
#${PANEL_ID} .st-msr-custom.st-msr-show {
    display: flex;
}
#${PANEL_ID} .st-msr-input {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 7px;
    margin: 0;
    font-size: 11px;
    border-radius: 4px;
    border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.18));
    background: var(--SmartThemeBlurTintColor, rgba(0, 0, 0, 0.25));
    color: var(--SmartThemeBodyColor, inherit);
    outline: none;
}
#${PANEL_ID} .st-msr-hint {
    font-size: 11px;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
        `;
        topDoc.head.appendChild(style);
    }

    function populateSelectOptions(selectEl) {
        selectEl.innerHTML = '';

        const optDefault = topDoc.createElement('option');
        optDefault.value = 'default';
        optDefault.textContent = '酒馆默认提示音';
        selectEl.appendChild(optDefault);

        const groupMap = new Map();
        for (const s of soundsList) {
            const g = s.group || '预设音效';
            if (!groupMap.has(g)) groupMap.set(g, []);
            groupMap.get(g).push(s);
        }

        for (const [groupName, items] of groupMap.entries()) {
            const og = topDoc.createElement('optgroup');
            og.label = groupName;
            for (const item of items) {
                const opt = topDoc.createElement('option');
                opt.value = item.id;
                opt.textContent = item.name;
                og.appendChild(opt);
            }
            selectEl.appendChild(og);
        }

        const optCustom = topDoc.createElement('option');
        optCustom.value = 'custom';
        optCustom.textContent = '自定义音频 (链接 / 本地上传)';
        selectEl.appendChild(optCustom);

        const validIds = new Set(['default', 'custom', ...soundsList.map(s => s.id)]);
        if (!validIds.has(config.soundId)) {
            config.soundId = 'default';
            saveConfig();
        }
        selectEl.value = config.soundId;
    }

    function updateVolumeUI(iconEl, valEl, vol) {
        const pct = Math.round(vol * 100);
        valEl.textContent = `${pct}%`;
        valEl.classList.toggle('st-msr-boost', pct > 100);
        if (pct <= 0) {
            iconEl.className = 'fa-solid fa-volume-xmark st-msr-vol-icon';
        } else if (pct < 50) {
            iconEl.className = 'fa-solid fa-volume-low st-msr-vol-icon';
        } else {
            iconEl.className = 'fa-solid fa-volume-high st-msr-vol-icon';
        }
    }

    function buildPanel() {
        const panel = topDoc.createElement('div');
        panel.id = PANEL_ID;
        panel.setAttribute('data-version', SCRIPT_VERSION);

        // 第一行：音效选择 + 试听按钮
        const rowSelect = topDoc.createElement('div');
        rowSelect.className = 'st-msr-row';

        const selectEl = topDoc.createElement('select');
        selectEl.className = 'st-msr-select';
        selectEl.title = '选择消息提示音';
        populateSelectOptions(selectEl);

        const playBtn = topDoc.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'st-msr-btn';
        playBtn.title = '试听当前提示音';
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';

        rowSelect.appendChild(selectEl);
        rowSelect.appendChild(playBtn);

        // 第二行：音量图标 + 滑块 (0%~300%) + 百分比
        const rowVol = topDoc.createElement('div');
        rowVol.className = 'st-msr-row';

        const volIcon = topDoc.createElement('i');

        const volSlider = topDoc.createElement('input');
        volSlider.type = 'range';
        volSlider.className = 'st-msr-slider';
        volSlider.min = '0';
        volSlider.max = String(Math.round(MAX_VOLUME * 100));
        volSlider.step = '1';
        volSlider.value = String(Math.round(config.volume * 100));
        volSlider.title = '调节提示音音量 (0% - 300% 增益)';

        const volVal = topDoc.createElement('span');
        volVal.className = 'st-msr-vol-val';
        updateVolumeUI(volIcon, volVal, config.volume);

        rowVol.appendChild(volIcon);
        rowVol.appendChild(volSlider);
        rowVol.appendChild(volVal);

        // 第三行（按需展开）：自定义音频 URL / 本地上传
        const customBox = topDoc.createElement('div');
        customBox.className = 'st-msr-custom' + (config.soundId === 'custom' ? ' st-msr-show' : '');

        const rowCustom = topDoc.createElement('div');
        rowCustom.className = 'st-msr-row';

        const urlInput = topDoc.createElement('input');
        urlInput.type = 'text';
        urlInput.className = 'st-msr-input';
        urlInput.placeholder = '粘贴音频直链 (.mp3/.wav/.ogg)';
        urlInput.value = config.customUrl || '';

        const uploadBtn = topDoc.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'st-msr-btn';
        uploadBtn.title = '上传本地音频文件 (≤2MB)';
        uploadBtn.innerHTML = '<i class="fa-solid fa-upload"></i>';

        const fileInput = topDoc.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.style.display = 'none';

        rowCustom.appendChild(urlInput);
        rowCustom.appendChild(uploadBtn);
        rowCustom.appendChild(fileInput);

        const hintEl = topDoc.createElement('div');
        hintEl.className = 'st-msr-hint';
        const refreshHint = () => {
            if (config.customDataUrl && config.customFileName) {
                hintEl.textContent = `已加载本地音频: ${config.customFileName}`;
            } else if (config.customUrl) {
                hintEl.textContent = '使用自定义链接';
            } else {
                hintEl.textContent = '支持填入直链或上传本地短音频';
            }
        };
        refreshHint();

        customBox.appendChild(rowCustom);
        customBox.appendChild(hintEl);

        // 事件绑定
        selectEl.addEventListener('change', async () => {
            config.soundId = selectEl.value;
            saveConfig();
            customBox.classList.toggle('st-msr-show', config.soundId === 'custom');
            await preloadCurrentSound();
        });

        playBtn.addEventListener('click', () => {
            previewCurrentSound(playBtn);
        });

        volSlider.addEventListener('input', () => {
            const pct = clamp(parseInt(volSlider.value, 10) || 0, 0, Math.round(MAX_VOLUME * 100));
            config.volume = pct / 100;
            updateVolumeUI(volIcon, volVal, config.volume);
        });

        volSlider.addEventListener('change', () => {
            saveConfig();
        });

        urlInput.addEventListener('change', async () => {
            const val = urlInput.value.trim();
            config.customUrl = val;
            if (val) {
                config.customDataUrl = '';
                config.customFileName = '';
            }
            saveConfig();
            refreshHint();
            await preloadCurrentSound();
        });

        uploadBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            if (file.size > MAX_UPLOAD_BYTES) {
                hintEl.textContent = '文件超过 2MB，请选择更短的提示音';
                return;
            }
            const reader = new FileReader();
            reader.onload = async () => {
                config.customDataUrl = String(reader.result || '');
                config.customFileName = file.name;
                config.customUrl = '';
                urlInput.value = '';
                saveConfig();
                refreshHint();
                await preloadCurrentSound();
                previewCurrentSound(playBtn);
            };
            reader.readAsDataURL(file);
        });

        panel.appendChild(rowSelect);
        panel.appendChild(rowVol);
        panel.appendChild(customBox);

        panel._selectEl = selectEl;
        return panel;
    }

    function mountUI() {
        if (destroyed) return true;

        const audio = hookAudioElement();
        const unfocusedLabel = topDoc.querySelector('label[for="play_sound_unfocused"]');
        const soundLabel = topDoc.querySelector('label[for="play_message_sound"]');
        const anchor = unfocusedLabel || soundLabel;

        if (!audio && !anchor) {
            return false;
        }

        injectStyles();

        let existing = topDoc.getElementById(PANEL_ID);
        if (!existing) {
            const panel = buildPanel();
            if (anchor && anchor.parentNode) {
                anchor.insertAdjacentElement('afterend', panel);
            } else {
                const container = topDoc.getElementById('user-settings-block-content');
                if (container) container.appendChild(panel);
            }
        }

        // 仅按需预加载当前选中的 1 个音效
        preloadCurrentSound();
        return true;
    }

    async function refreshRemoteManifest() {
        try {
            const data = await fetchJsonWithFallback(getManifestUrls());
            if (destroyed || !data || !Array.isArray(data.sounds) || !data.sounds.length) return;
            soundsList = data.sounds;
            const panel = topDoc.getElementById(PANEL_ID);
            if (panel && panel._selectEl) {
                populateSelectOptions(panel._selectEl);
            }
            preloadCurrentSound();
        } catch (err) {
            console.warn('[ST提示音替换] 拉取远程音效清单失败，使用内置列表:', err);
        }
    }

    function onUserGesture() {
        unlockAudioContext();
    }

    function start() {
        topDoc.addEventListener('pointerdown', onUserGesture, { passive: true, capture: true });
        topDoc.addEventListener('keydown', onUserGesture, { passive: true, capture: true });

        let attempts = 0;
        const tryMount = () => {
            if (destroyed) return;
            if (mountUI()) {
                refreshRemoteManifest();
                return;
            }
            if (++attempts < 40) {
                mountTimer = setTimeout(tryMount, 500);
            }
        };
        tryMount();
    }

    function cleanup() {
        destroyed = true;
        topDoc.removeEventListener('pointerdown', onUserGesture, true);
        topDoc.removeEventListener('keydown', onUserGesture, true);

        if (mountTimer) {
            clearTimeout(mountTimer);
            mountTimer = null;
        }
        if (activeSource) {
            try { activeSource.stop(); } catch {}
            activeSource = null;
        }
        if (audioCtx) {
            try { audioCtx.close(); } catch {}
            audioCtx = null;
        }

        const panel = topDoc.getElementById(PANEL_ID);
        if (panel) panel.remove();
        const style = topDoc.getElementById(STYLE_ID);
        if (style) style.remove();

        if (hookedAudio && hookedAudio.__stMsrHooked) {
            try {
                delete hookedAudio.play;
                delete hookedAudio.__stMsrHooked;
                hookedAudio.src = originalAudioSrc;
            } catch {}
        }

        for (const url of blobCache.values()) {
            try { topWin.URL.revokeObjectURL(url); } catch {}
        }
        blobCache.clear();
        bufferCache.clear();
    }

    topWin[GLOBAL_KEY] = {
        version: SCRIPT_VERSION,
        cleanup,
        preview: () => previewCurrentSound(null),
    };

    start();
})();
