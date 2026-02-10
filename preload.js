// preload.js - 安全桥接主进程与渲染进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 扩展通信
  sendToExtension: (msg) => ipcRenderer.send('to-extension', msg),
  onFromExtension: (callback) => ipcRenderer.on('from-extension', (_, data) => callback(data)),
  onExtensionStatus: (callback) => ipcRenderer.on('extension-status', (_, connected) => callback(connected)),

  // 安装扩展
  openExtensionDir: () => ipcRenderer.invoke('open-extension-dir'),

  // 影刀文件操作
  selectYingdaoDir: () => ipcRenderer.invoke('select-yingdao-dir'),
  scanYingdaoDir: (dirPath) => ipcRenderer.invoke('scan-yingdao-dir', dirPath),
  importYingdao: (dirPath) => ipcRenderer.invoke('import-yingdao', dirPath),
  exportYingdao: (data) => ipcRenderer.invoke('export-yingdao', data),
  writeYingdaoXml: (data) => ipcRenderer.invoke('write-yingdao-xml', data)
});
