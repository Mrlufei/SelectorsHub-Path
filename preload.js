// preload.js - 安全桥接主进程与渲染进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 扩展通信
  sendToExtension: (msg) => ipcRenderer.send('to-extension', msg),
  onFromExtension: (callback) => ipcRenderer.on('from-extension', (_, data) => callback(data)),
  onExtensionStatus: (callback) => ipcRenderer.on('extension-status', (_, connected) => callback(connected)),

  // 安装扩展
  openExtensionDir: () => ipcRenderer.invoke('open-extension-dir')
});
