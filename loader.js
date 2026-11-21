/**
 * SillyTavern 消息提示音替换 - 酒馆助手远程加载器
 * 使用方法：在 SillyTavern「酒馆助手 (JS-Slash-Runner) -> 脚本库」中新建全局脚本并粘贴本文件内容即可。
 * 以后仓库推送任何更新（脚本优化、新增音效等），刷新酒馆即自动生效，无需重复导入。
 */
(async function () {
    'use strict';

    const REPO = 'cone97218-alt/sounds';
    const BRANCH = 'main';
    const CACHE_KEY = 'st_msg_sound_replacer_remote_code_v1';
    const ts = Date.now();

    const SOURCES = [
        `https://raw.githubusercontent.com/${REPO}/${BRANCH}/sound-replacer.js?t=${ts}`,
        `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/sound-replacer.js?t=${ts}`,
        `https://fastly.jsdelivr.net/gh/${REPO}@${BRANCH}/sound-replacer.js?t=${ts}`,
        `https://gh-proxy.com/https://raw.githubusercontent.com/${REPO}/${BRANCH}/sound-replacer.js?t=${ts}`,
    ];

    const topWin = (window.parent && window.parent !== window) ? window.parent : window;
    let code = null;

    for (const url of SOURCES) {
        try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (!res.ok) continue;
            const text = await res.text();
            if (text && text.includes('__ST_MSG_SOUND_REPLACER__')) {
                code = text;
                try {
                    topWin.localStorage.setItem(CACHE_KEY, code);
                } catch {}
                break;
            }
        } catch {
            // 尝试下一个镜像源
        }
    }

    if (!code) {
        try {
            code = topWin.localStorage.getItem(CACHE_KEY);
        } catch {}
    }

    if (!code) {
        console.error('[ST提示音替换] 远程脚本加载失败，且无本地缓存。');
        return;
    }

    try {
        new Function(code)();
    } catch (err) {
        console.error('[ST提示音替换] 脚本执行出错:', err);
    }
})();
