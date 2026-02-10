// service_worker.js - 桥接扩展的后台脚本
// 通过 WebSocket 连接桌面端，转发消息
// 使用 chrome.alarms 保活，防止 Service Worker 休眠后断连

let ws = null;
const WS_PORT = 9527;
const WS_URL = `ws://127.0.0.1:${WS_PORT}`;
const ALARM_NAME = 'ws-keepalive';

// ========== WebSocket 连接管理 ==========

let lastConnectAttempt = 0;
const CONNECT_COOLDOWN = 3000;
let isConnecting = false;

async function connectWebSocket() {
  if (isConnecting) return;
  if (ws && ws.readyState === WebSocket.OPEN) return;
  const now = Date.now();
  if (now - lastConnectAttempt < CONNECT_COOLDOWN) return;
  lastConnectAttempt = now;
  isConnecting = true;

  // 清理残留
  if (ws) {
    try { ws.close(); } catch (e) { /* 忽略 */ }
    ws = null;
  }

  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    ws = null;
    isConnecting = false;
    return;
  }

  ws.onopen = () => {
    console.log('[Bridge] 已连接桌面端');
    isConnecting = false;
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      await handleDesktopMessage(msg);
    } catch (e) {
      console.error('[Bridge] 解析消息失败:', e);
    }
  };

  ws.onclose = () => {
    ws = null;
    isConnecting = false;
  };

  ws.onerror = () => {
    ws = null;
    isConnecting = false;
  };
}

function ensureConnection() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
}

// ========== chrome.alarms 兜底保活 ==========
chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    ensureConnection();
  }
});

// ========== 向桌面端发送消息 ==========
function sendToDesktop(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ========== 获取当前活动标签页 ==========
async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: false });
  const normalTab = tabs.find(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
  if (normalTab) return normalTab;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// 确保 content script 已注入
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['utils.js', 'content_script.js']
    });
  } catch (e) {
    // 可能已注入，忽略
  }
}

// ========== 处理来自桌面端的消息 ==========
async function handleDesktopMessage(msg) {
  const tab = await getCurrentTab();
  if (!tab) {
    sendToDesktop({ action: msg.action + '_response', requestId: msg.requestId, error: '无法获取当前标签页' });
    return;
  }

  await ensureContentScript(tab.id);

  if (msg.action === 'start_picking') {
    chrome.tabs.sendMessage(tab.id, { action: 'start_picking' });

  } else if (msg.action === 'get_current_url') {
    sendToDesktop({ action: 'get_current_url_response', requestId: msg.requestId, url: tab.url });

  } else if (msg.action === 'navigate') {
    chrome.tabs.update(tab.id, { url: msg.url }, () => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            ensureContentScript(tab.id).then(() => {
              sendToDesktop({ action: 'navigate_response', requestId: msg.requestId, success: true });
            });
          }, 500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

  } else if (msg.action === 'validate') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'validate',
      locator: msg.locator,
      fingerprint: msg.fingerprint,
      collectFingerprint: msg.collectFingerprint
    }, (response) => {
      if (chrome.runtime.lastError) {
        sendToDesktop({ action: 'validate_response', requestId: msg.requestId, result: null });
        return;
      }
      if (response) delete response.elements;
      sendToDesktop({ action: 'validate_response', requestId: msg.requestId, result: response });
    });

  } else if (msg.action === 'validate_many') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'validate_many',
      locators: msg.locators
    }, (results) => {
      if (chrome.runtime.lastError) {
        sendToDesktop({ action: 'validate_many_response', requestId: msg.requestId, results: null });
        return;
      }
      sendToDesktop({ action: 'validate_many_response', requestId: msg.requestId, results });
    });

  } else if (msg.action === 'validate_candidates') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'validate_candidates',
      candidates: msg.candidates,
      fingerprint: msg.fingerprint
    }, (results) => {
      if (chrome.runtime.lastError) {
        sendToDesktop({ action: 'validate_candidates_response', requestId: msg.requestId, results: null });
        return;
      }
      sendToDesktop({ action: 'validate_candidates_response', requestId: msg.requestId, results });
    });

  } else if (msg.action === 'clear_highlight') {
    chrome.tabs.sendMessage(tab.id, { action: 'clear_highlight' }, () => {
      if (chrome.runtime.lastError) { /* 忽略 */ }
    });

  } else if (msg.action === 'clear_all_highlights') {
    chrome.tabs.sendMessage(tab.id, { action: 'clear_all_highlights' }, () => {
      if (chrome.runtime.lastError) { /* 忽略 */ }
    });

  } else if (msg.action === 'update_colors') {
    chrome.tabs.sendMessage(tab.id, { action: 'update_colors', colors: msg.colors }, () => {
      if (chrome.runtime.lastError) { /* 忽略 */ }
    });
  }
}

// ========== 监听 content script 消息 ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'element_picked') {
    sendToDesktop(request);
  } else if (request.action === 'picking_stopped') {
    sendToDesktop(request);
  } else if (request.action === 'heartbeat') {
    // content script 心跳唤醒，仅在断开时重连
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ensureConnection();
    }
  }
});

// 点击扩展图标时手动重连
chrome.action.onClicked.addListener(() => {
  connectWebSocket();
});

// Chrome 浏览器启动时连接
chrome.runtime.onStartup.addListener(() => {
  setupOffscreen();
  connectWebSocket();
});

// 扩展安装/更新时连接
chrome.runtime.onInstalled.addListener(() => {
  setupOffscreen();
  connectWebSocket();
});

// 创建 offscreen document 保活
async function setupOffscreen() {
  try {
    const existing = await chrome.offscreen.hasDocument();
    if (!existing) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: '保持 Service Worker 活跃以维持 WebSocket 连接'
      });
    }
  } catch (e) {
    // 忽略（可能已存在）
  }
}

// 启动时立即连接并创建 offscreen
setupOffscreen();
connectWebSocket();
