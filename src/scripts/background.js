importScripts('browser-polyfill.min.js', 'feedly.api.js', 'core.js');

async function ensureOffscreen() {
    if (chrome.offscreen && !(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
            justification: 'play notification sounds'
        });
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'playSound') {
        ensureOffscreen().then(() => {
            chrome.runtime.sendMessage({offscreen: 'playSound', url: msg.url, volume: msg.volume});
        });
    }
});
