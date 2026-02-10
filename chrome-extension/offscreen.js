// offscreen.js - 持久保活，每 3 秒唤醒 Service Worker
setInterval(() => {
  chrome.runtime.sendMessage({ action: 'heartbeat' }, () => {
    if (chrome.runtime.lastError) { /* 忽略 */ }
  });
}, 3000);
