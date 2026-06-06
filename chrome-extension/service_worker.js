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
var retryDelay = 1000;
var maxRetryDelay = 30000;

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
  retryDelay = 1000; // 主动触发时重置退避
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

// ========== 动态脚本注入 ==========
// 替代静态 content_scripts：按需注入，降低内存占用
async function injectContentScripts(tabId) {
  const files = ['utils.js', 'content_script.js'];
  for (const file of files) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [file]
      });
    } catch (e) {
      // 可能已注入，忽略重复注入错误
    }
  }
}

// ========== chrome.debugger 增强验证 ==========
// 当 content_script 被 CSP 限制导致验证失败时，用 CDP 降级重试
async function validateViaDebugger(tabId, locator) {
  let result = { count: 0, time: 0, debuggerFallback: true };
  const startTime = performance.now();

  try {
    // 附加调试器
    await chrome.debugger.attach({ tabId }, '1.3');

    // 构建 CDP 查询表达式
    let expression;
    if (locator.type === 'css') {
      expression = `document.querySelectorAll(${JSON.stringify(locator.value)}).length`;
    } else if (locator.type === 'xpath') {
      expression = `document.evaluate(${JSON.stringify(locator.value)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength`;
    } else {
      expression = '0';
    }

    // 通过 CDP 的 Runtime.evaluate 执行 DOM 查询（绕过 CSP）
    const evalResult = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: expression,
      returnByValue: true,
      replMode: false
    });

    if (evalResult && evalResult.result && evalResult.result.value !== undefined) {
      result.count = evalResult.result.value;
    }

    await chrome.debugger.detach({ tabId });
  } catch (e) {
    console.error('[Bridge] debugger 验证失败:', e);
    // 确保 detach
    try { await chrome.debugger.detach({ tabId }); } catch (e2) { /* 忽略 */ }
  }

  result.time = Math.round(performance.now() - startTime);
  return result;
}



// ========== 安全发送消息（自动注入 + 重试） ==========
/** 向 tab 发送消息，若接收端不存在则先注入再重试 */
function sendMessageSafe(tabId, msg, callback) {
  chrome.tabs.sendMessage(tabId, msg, function(response) {
    if (chrome.runtime.lastError) {
      var err = chrome.runtime.lastError.message || '';
      if (err.indexOf('Receiving end does not exist') >= 0 || err.indexOf('Could not establish connection') >= 0) {
        // 接收端不存在，尝试注入后重试
        injectContentScripts(tabId).then(function() {
          chrome.tabs.sendMessage(tabId, msg, function(retryResponse) {
            if (callback) {
              if (chrome.runtime.lastError) { callback(null); return; }
              callback(retryResponse);
            }
          });
        });
        return;
      }
      if (callback) { callback(null); return; }
      return;
    }
    if (callback) { callback(response); }
  });
}

// ========== 处理来自桌面端的消息 ==========
async function handleDesktopMessage(msg) {
  const tab = await getCurrentTab();
  if (!tab) {
    sendToDesktop({ action: msg.action + '_response', requestId: msg.requestId, error: '无法获取当前标签页' });
    return;
  }

  await injectContentScripts(tab.id);

  if (msg.action === 'start_picking') {
    sendMessageSafe(tab.id, { action: 'start_picking' });

  } else if (msg.action === 'get_current_url') {
    sendToDesktop({ action: 'get_current_url_response', requestId: msg.requestId, url: tab.url });

  } else if (msg.action === 'navigate') {
    chrome.tabs.update(tab.id, { url: msg.url }, () => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            injectContentScripts(tab.id).then(() => {
              sendToDesktop({ action: 'navigate_response', requestId: msg.requestId, success: true });
            });
          }, 500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

  } else if (msg.action === 'validate') {
    sendMessageSafe(tab.id, {
      action: 'validate',
      locator: msg.locator,
      fingerprint: msg.fingerprint,
      collectFingerprint: msg.collectFingerprint
    }, (response) => {
      if (!response) {
        sendToDesktop({ action: 'validate_response', requestId: msg.requestId, result: null });
        return;
      }
      delete response.elements;
      sendToDesktop({ action: 'validate_response', requestId: msg.requestId, result: response });
    });

  } else if (msg.action === 'validate_many') {
    sendMessageSafe(tab.id, {
      action: 'validate_many',
      locators: msg.locators
    }, (results) => {
      if (!results) {
        sendToDesktop({ action: 'validate_many_response', requestId: msg.requestId, results: null });
        return;
      }
      sendToDesktop({ action: 'validate_many_response', requestId: msg.requestId, results: results });
    });

  } else if (msg.action === 'validate_candidates') {
    sendMessageSafe(tab.id, {
      action: 'validate_candidates',
      candidates: msg.candidates,
      fingerprint: msg.fingerprint
    }, (results) => {
      if (!results) {
        sendToDesktop({ action: 'validate_candidates_response', requestId: msg.requestId, results: null });
        return;
      }
      sendToDesktop({ action: 'validate_candidates_response', requestId: msg.requestId, results: results });
    });

  } else if (msg.action === 'clear_highlight') {
    sendMessageSafe(tab.id, { action: 'clear_highlight' });

  } else if (msg.action === 'clear_all_highlights') {
    sendMessageSafe(tab.id, { action: 'clear_all_highlights' });

  } else if (msg.action === 'update_colors') {
    sendMessageSafe(tab.id, { action: 'update_colors', colors: msg.colors });
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
  } else if (request.action === 'validate_via_debugger') {
    // content_script 验证失败后请求 debugger 降级重试
    var tab = sender.tab;
    if (tab && tab.id) {
      validateViaDebugger(tab.id, request.locator).then(function(result) {
        sendResponse(result);
      });
      return true; // 异步响应
    } else {
      sendResponse({ count: 0, time: 0, debuggerFallback: true, error: 'no tab' });
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
