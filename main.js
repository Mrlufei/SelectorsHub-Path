// main.js - Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const { exec } = require('child_process');

let mainWindow = null;
let wss = null;
let extensionSocket = null; // 当前连接的扩展 WebSocket

const WS_PORT = 9527;

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
function startWebSocket() {
  wss = new WebSocketServer({ port: WS_PORT });
  console.log(`WebSocket 服务已启动，端口 ${WS_PORT}`);

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

// 选择影刀流程目录
ipcMain.handle('select-yingdao-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择影刀流程文件夹',
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// 扫描影刀目录
ipcMain.handle('scan-yingdao-dir', async (event, dirPath) => {
  return scanYingdaoDir(dirPath);
});

// 导入影刀选择器
ipcMain.handle('import-yingdao', async (event, dirPath) => {
  return importFromYingdao(dirPath);
});

// 导出到影刀
ipcMain.handle('export-yingdao', async (event, { dirPath, elements, aliases }) => {
  return exportToYingdao(dirPath, elements, aliases);
});

// ========== 影刀文件操作 ==========

function scanYingdaoDir(dirPath) {
  const result = { selectors: [], robot: null, elementDirs: [] };

  // 扫描 xbot_selectors
  const selectorsDir = path.join(dirPath, 'xbot_selectors');
  if (fs.existsSync(selectorsDir)) {
    const entries = fs.readdirSync(selectorsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('element_')) {
        const xmlPath = path.join(selectorsDir, entry.name, 'selectorsV2.xml');
        if (fs.existsSync(xmlPath)) {
          result.elementDirs.push(entry.name);
          result.selectors.push({
            dir: entry.name,
            path: xmlPath,
            content: fs.readFileSync(xmlPath, 'utf-8')
          });
        }
      }
    }
  }

  // 扫描 xbot_robot
  const robotXml = path.join(dirPath, 'xbot_robot', 'selectorsV2.xml');
  if (fs.existsSync(robotXml)) {
    result.robot = {
      path: robotXml,
      content: fs.readFileSync(robotXml, 'utf-8')
    };
  }

  return result;
}

function importFromYingdao(dirPath) {
  const scanResult = scanYingdaoDir(dirPath);
  const allXmlContents = scanResult.selectors.map(s => s.content);
  if (scanResult.robot) allXmlContents.push(scanResult.robot.content);

  // 返回原始 XML 内容，由渲染进程解析（因为 DOMParser 在浏览器环境更方便）
  return { xmlContents: allXmlContents, dirPath };
}

function exportToYingdao(dirPath, elements, aliases) {
  // 影刀的元素主要存在 xbot_robot/selectorsV2.xml 中
  console.log('[导出] dirPath:', dirPath);
  console.log('[导出] 元素数量:', elements.length);
  const robotDir = path.join(dirPath, 'xbot_robot');
  const robotXmlPath = path.join(robotDir, 'selectorsV2.xml');
  console.log('[导出] robotXmlPath:', robotXmlPath);
  console.log('[导出] robotDir 存在:', fs.existsSync(robotDir));
  console.log('[导出] robotXml 存在:', fs.existsSync(robotXmlPath));

  if (!fs.existsSync(robotDir)) {
    fs.mkdirSync(robotDir, { recursive: true });
  }

  // 读取现有 XML
  let existingContent = null;
  if (fs.existsSync(robotXmlPath)) {
    existingContent = fs.readFileSync(robotXmlPath, 'utf-8');
  }

  // 按 domain+path 分组
  const groups = {};
  elements.forEach(item => {
    const key = item.domain + item.path;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  return {
    robotXmlPath,
    existingContent,
    groups,
    aliases
  };
}

// 写入最终 XML（由渲染进程调用）
ipcMain.handle('write-yingdao-xml', async (event, { xmlPath, content }) => {
  try {
    console.log('[写入XML] 路径:', xmlPath);
    console.log('[写入XML] 内容长度:', content ? content.length : 0);
    console.log('[写入XML] 内容前200字符:', content ? content.substring(0, 200) : '空');
    fs.writeFileSync(xmlPath, content, 'utf-8');
    console.log('[写入XML] 写入成功');
    // 验证写入
    const verify = fs.readFileSync(xmlPath, 'utf-8');
    console.log('[写入XML] 验证读回长度:', verify.length);
    return { success: true };
  } catch (e) {
    console.error('[写入XML] 写入失败:', e.message);
    return { success: false, error: e.message };
  }
});

// ========== 启动 ==========
app.whenReady().then(() => {
  startWebSocket();
  createWindow();
});

app.on('window-all-closed', () => {
  if (wss) wss.close();
  app.quit();
});
