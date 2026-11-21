/**
 * SillyTavern 消息提示音替换脚本（酒馆助手 / JS-Slash-Runner）
 * 仓库: https://github.com/cone97218-alt/sounds
 * 说明: 仅替换酒馆自带的提示音音源并支持音量调节，开关仍由酒馆「用户设置 -> 杂项」控制。
 */
(function () {
    'use strict';

    const SCRIPT_VERSION = '1.0.0';
    const REPO = 'cone97218-alt/sounds';
    const BRANCH = 'main';
    const STORAGE_KEY = 'st_msg_sound_replacer_v1';
    const GLOBAL_KEY = '__ST_MSG_SOUND_REPLACER__';
    const STYLE_ID = 'st-msr-style';
    const PANEL_ID = 'st-msr-panel';
    const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB

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

    // 内置保底音效列表（远程 sounds.json 拉取成功时会被最新清单替换）
    const FALLBACK_SOUNDS = [
        { id: 'zelda-secret', name: '解谜成功', group: '塞尔达传说', file: 'sounds/zelda-secret.mp3' },
        { id: 'zelda-korok', name: '发现克洛格 (Yahaha!)', group: '塞尔达传说', file: 'sounds/zelda-korok.mp3' },
        { id: 'zelda-item', name: '获得道具', group: '塞尔达传说', file: 'sounds/zelda-item.mp3' },
        { id: 'zelda-rupee', name: '拾取卢比', group: '塞尔达传说', file: 'sounds/zelda-rupee.mp3' },
        { id: 'stardew-fishing', name: '钓鱼上钩', group: '星露谷物语', file: 'sounds/stardew-fishing.mp3' },
        { id: 'stardew-valley', name: '经典提示', group: '星露谷物语', file: 'sounds/stardew-valley.mp3' },
        { id: 'mc-xp', name: '经验球', group: 'Minecraft', file: 'sounds/mc-xp.mp3' },
        { id: 'mc-levelup', name: '升级提示', group: 'Minecraft', file: 'sounds/mc-levelup.mp3' },
        { id: 'pokemon-heal', name: '精灵中心回复', group: '宝可梦', file: 'sounds/pokemon-heal.mp3' },
        { id: 'pokemon-levelup', name: '升级音效', group: '宝可梦', file: 'sounds/pokemon-levelup.mp3' },
        { id: 'mario-coin', name: '超级马里奥 · 吃金币', group: '其他经典', file: 'sounds/mario-coin.mp3' },
        { id: 'ac-greetings', name: '动物森友会 · 打招呼', group: '其他经典', file: 'sounds/ac-greetings.mp3' },
        { id: 'discord-notify', name: 'Discord · 消息提示', group: '其他经典', file: 'sounds/discord-notify.mp3' },
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
    const blobCache = new Map(); // soundId -> blobUrl
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
                    ? clamp(parsed.volume, 0, 1)
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

    async function fetchWithFallback(urls, asBlob = false) {
        let lastErr = null;
        for (const url of urls) {
            try {
                const res = await fetch(url, { cache: asBlob ? 'force-cache' : 'no-cache' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return asBlob ? await res.blob() : await res.json();
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || new Error('所有远程源均不可用');
    }

    async function resolveSoundSrc(soundId) {
        if (!soundId || soundId === 'default') {
            return originalAudioSrc;
        }
        if (soundId === 'custom') {
            if (config.customDataUrl) return config.customDataUrl;
            if (config.customUrl && config.customUrl.trim()) return config.customUrl.trim();
            return originalAudioSrc;
        }
        if (blobCache.has(soundId)) {
            return blobCache.get(soundId);
        }

        const item = soundsList.find(s => s.id === soundId);
        if (!item) return originalAudioSrc;

        const urls = item.url ? [item.url] : getAssetUrls(item.file);
        try {
            const blob = await fetchWithFallback(urls, true);
            if (destroyed) return originalAudioSrc;
            const blobUrl = topWin.URL.createObjectURL(blob);
            blobCache.set(soundId, blobUrl);
            return blobUrl;
        } catch (err) {
            console.warn(`[ST提示音替换] 加载音效 "${item.name}" 失败，回退直链:`, err);
            return urls[0];
        }
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
            const vol = clamp(Number(config.volume), 0, 1);
            this.volume = vol;
            if (vol <= 0) {
                return Promise.resolve();
            }
            return nativePlay.call(this);
        };

        hookedAudio = audio;
        return audio;
    }

    async function applyCurrentSound() {
        const audio = hookAudioElement();
        if (!audio) return;

        const targetSrc = await resolveSoundSrc(config.soundId);
        if (destroyed) return;

        if (audio.getAttribute('src') !== targetSrc) {
            audio.src = targetSrc;
            try {
                audio.load();
            } catch {
                // ignore
            }
        }
        audio.volume = clamp(Number(config.volume), 0, 1);
    }

    async function previewCurrentSound(btnEl) {
        const audio = hookAudioElement();
        if (!audio) return;

        if (btnEl) btnEl.classList.add('st-msr-loading');
        try {
            await applyCurrentSound();
            if (destroyed) return;
            audio.pause();
            audio.currentTime = 0;
            const p = audio.play();
            if (p && typeof p.catch === 'function') {
                p.catch(err => console.warn('[ST提示音替换] 试听播放被拦截:', err));
            }
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
    width: 34px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
    flex-shrink: 0;
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

        // 按游戏分组
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

        // 恢复当前选中项
        const validIds = new Set(['default', 'custom', ...soundsList.map(s => s.id)]);
        selectEl.value = validIds.has(config.soundId) ? config.soundId : 'default';
    }

    function updateVolumeIcon(iconEl, vol) {
        if (vol <= 0) {
            iconEl.className = 'fa-solid fa-volume-xmark st-msr-vol-icon';
        } else if (vol < 0.5) {
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

        // 第二行：音量图标 + 滑块 + 百分比
        const rowVol = topDoc.createElement('div');
        rowVol.className = 'st-msr-row';

        const volIcon = topDoc.createElement('i');
        updateVolumeIcon(volIcon, config.volume);

        const volSlider = topDoc.createElement('input');
        volSlider.type = 'range';
        volSlider.className = 'st-msr-slider';
        volSlider.min = '0';
        volSlider.max = '100';
        volSlider.step = '1';
        volSlider.value = String(Math.round(config.volume * 100));
        volSlider.title = '调节提示音音量';

        const volVal = topDoc.createElement('span');
        volVal.className = 'st-msr-vol-val';
        volVal.textContent = `${Math.round(config.volume * 100)}%`;

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
            await applyCurrentSound();
        });

        playBtn.addEventListener('click', () => {
            previewCurrentSound(playBtn);
        });

        volSlider.addEventListener('input', () => {
            const pct = clamp(parseInt(volSlider.value, 10) || 0, 0, 100);
            config.volume = pct / 100;
            volVal.textContent = `${pct}%`;
            updateVolumeIcon(volIcon, config.volume);
            if (hookedAudio) {
                hookedAudio.volume = config.volume;
            }
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
            await applyCurrentSound();
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
                await applyCurrentSound();
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

        applyCurrentSound();
        return true;
    }

    async function refreshRemoteManifest() {
        try {
            const data = await fetchWithFallback(getManifestUrls(), false);
            if (destroyed || !data || !Array.isArray(data.sounds) || !data.sounds.length) return;
            soundsList = data.sounds;
            const panel = topDoc.getElementById(PANEL_ID);
            if (panel && panel._selectEl) {
                populateSelectOptions(panel._selectEl);
            }
            applyCurrentSound();
        } catch (err) {
            console.warn('[ST提示音替换] 拉取远程音效清单失败，使用内置列表:', err);
        }
    }

    function start() {
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
        if (mountTimer) {
            clearTimeout(mountTimer);
            mountTimer = null;
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
            } catch {
                // ignore
            }
        }
        for (const url of blobCache.values()) {
            try {
                topWin.URL.revokeObjectURL(url);
            } catch {
                // ignore
            }
        }
        blobCache.clear();
    }

    topWin[GLOBAL_KEY] = {
        version: SCRIPT_VERSION,
        cleanup,
        preview: () => previewCurrentSound(null),
    };

    start();
})();
