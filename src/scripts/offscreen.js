chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.offscreen === 'playSound') {
        const audio = new Audio(msg.url);
        audio.volume = msg.volume ?? 1;
        audio.play();
    }
});
