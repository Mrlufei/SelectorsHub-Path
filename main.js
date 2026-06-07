// main.js - Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const { exec } = require('child_process');

let mainWindow = null;
let wss = null;
let extensionSocket = null; // 当前连接的扩展 WebSocket

let WS_PORT = 9527;

// ========== Electron 窗口 ==========
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 800,
    minWidth: 350,
    minHeight: 600,
    title: 'Xpath Repair',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('renderer/index.html');
  Menu.setApplicationMenu(null);
}

// ========== WebSocket 服务 ==========
function startWebSocket(retryPort) {
  var port = retryPort || WS_PORT;
  try {
    wss = new WebSocketServer({ port: port });
  } catch (e) {
    console.error("[WS] 端口 "+port+" 启动失败: "+e.message);
    if (port === WS_PORT) { startWebSocket(WS_PORT + 1); }
    return;
  }
  console.log("[WS] 服务已启动，端口 "+port);
  WS_PORT = port;

  wss.on('error', function(err) { console.error('[WS] 错误:', err.message); });
  wss.on('connection', (ws) => {
    console.log('Chrome 扩展已连接');
    extensionSocket = ws;

    // 通知渲染进程扩展已连接
    if (mainWindow) {
      mainWindow.webContents.send('extension-status', true);
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // 转发给渲染进程
        if (mainWindow) {
          mainWindow.webContents.send('from-extension', msg);
        }
      } catch (e) {
        console.error('解析消息失败:', e);
      }
    });

    ws.on('close', () => {
      console.log('Chrome 扩展已断开');
      extensionSocket = null;
      if (mainWindow) {
        mainWindow.webContents.send('extension-status', false);
      }
    });
  });
}

// ========== IPC 处理 ==========

// 渲染进程 → 扩展
ipcMain.on('to-extension', (event, msg) => {
  if (extensionSocket && extensionSocket.readyState === 1) {
    // 如果是开始捕获，先把 Chrome 窗口拉到前台
    if (msg.action === 'start_picking') {
      focusChromeWindow(() => {
        extensionSocket.send(JSON.stringify(msg));
      });
    } else {
      extensionSocket.send(JSON.stringify(msg));
    }
  }
});

// 聚焦 Chrome 浏览器窗口（Windows 平台）
function focusChromeWindow(callback) {
  // 使用 PowerShell 激活 Chrome 窗口
  const ps = `powershell -Command "(New-Object -ComObject WScript.Shell).AppActivate('Chrome')"`;
  exec(ps, (err) => {
    // 不管成功失败都继续，延迟一点确保窗口切换完成
    setTimeout(() => { if (callback) callback(); }, 200);
  });
}

// 打开桥接扩展目录（用于安装）
ipcMain.handle('open-extension-dir', async () => {
  const extDir = path.join(__dirname, 'chrome-extension');
  const { shell } = require('electron');
  shell.openPath(extDir);
  return extDir;
});

app.whenReady().then(() => {
  startWebSocket();
  createWindow();
});

// ========== 优雅退出 ==========
function gracefulShutdown() {
  if (wss) {
    try { wss.close(); } catch(e) { /* 忽略 */ }
    wss = null;
  }
  if (mainWindow) {
    try { mainWindow.close(); } catch(e) { /* 忽略 */ }
    mainWindow = null;
  }
  app.quit();
}

// 处理 IDE/用户 手动停止（SIGINT / SIGTERM）
process.on('SIGINT', () => {
  console.log('[Main] 收到 SIGINT，正在关闭...');
  gracefulShutdown();
});
process.on('SIGTERM', () => {
  console.log('[Main] 收到 SIGTERM，正在关闭...');
  gracefulShutdown();
});

app.on('window-all-closed', () => {
  gracefulShutdown();
});
