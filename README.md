# Xpath Repair 🔧

一款面向自动化测试工程师的**元素定位采集、验证与自修复**桌面工具。

基于 Electron + Chrome 扩展桥接架构，支持在网页上实时捕获元素，自动生成多种定位器（XPath / CSS / ID / Name / ClassName），并提供定位失效时的本地智能修复能力。

![测试版](https://img.shields.io/badge/版本-测试版_v0.2-blue)
![Electron](https://img.shields.io/badge/Electron-28-47848f)
![Platform](https://img.shields.io/badge/平台-Windows-lightgrey)

---

## ✨ 核心功能

- **元素捕获** — 点击网页元素，自动生成 XPath、CSS、ID、Name、ClassName 等多种定位器
- **实时验证** — 一键验证定位器是否唯一匹配，支持单个验证和批量验证
- **自愈修复** — 定位器失效时，基于元素指纹（标签、属性、祖先链）自动生成修复候选
- **分组管理** — 按页面 URL 自动分组，支持自定义别名、父组合并、批量操作
- **影刀集成** — 直接导入/导出影刀 RPA 的 `selectorsV2.xml`，无缝对接影刀流程
- **数据持久化** — 本地存储，支持 JSON 格式导入导出备份
- **多主题配色** — 内置 7 种主题（默认 / Violet / Ocean / Forest / Orange / Pink / Dark）
- **中英双语** — 完整的中文/英文界面切换

## 🏗️ 架构

```
┌─────────────────────┐     WebSocket (9527)     ┌──────────────────────┐
│   Electron 桌面端    │ ◄──────────────────────► │  Chrome 桥接扩展      │
│                     │                          │                      │
│  main.js (主进程)    │                          │  service_worker.js   │
│  preload.js         │                          │  content_script.js   │
│  renderer/          │                          │  offscreen.js (保活)  │
│    ├─ app.js        │                          └──────────┬───────────┘
│    ├─ yingdao.js    │                                     │
│    ├─ utils.js      │                              注入到网页中
│    └─ i18n.js       │                                     ▼
└─────────────────────┘                          ┌──────────────────────┐
                                                 │    目标网页 DOM       │
                                                 └──────────────────────┘
```

- **桌面端**：Electron 应用，提供 UI 界面和数据管理
- **桥接扩展**：Chrome Manifest V3 扩展，通过 WebSocket 与桌面端通信，负责操作网页 DOM
- **自动重连**：扩展通过 offscreen document 心跳 + chrome.alarms 兜底，桌面端重启后自动恢复连接

## 📦 快速开始

### 环境要求

- Node.js 18+
- Google Chrome 浏览器

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/your-username/xpath-repair-desktop.git
cd xpath-repair-desktop

# 安装依赖
npm install

# 启动桌面端
npx electron .
```

### 安装 Chrome 桥接扩展

1. 启动桌面端后，在加载页面点击「安装浏览器插件」（或在设置中点击）
2. 在 Chrome 地址栏输入 `chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择项目中的 `chrome-extension` 文件夹
5. 安装完成后桌面端将自动连接

## 📖 使用说明

### 元素捕获

1. 确保桌面端显示「扩展已连接」
2. 点击「🖱️ 捕获元素」按钮
3. 在 Chrome 网页上点击目标元素
4. 桌面端自动生成多种定位器候选，点击选择后保存

### 验证与修复

- 点击已保存元素的「验证」按钮，检查定位器是否仍然有效
- 分组标题栏的 ⏩ 按钮可批量验证整组元素
- 验证失败时点击「本地修复」，工具会基于元素指纹自动生成修复候选

### 影刀集成

- **导出**：勾选要导出的元素 → 点击「勾选导出至影刀」→ 自动写入影刀流程的 `xbot_robot/selectorsV2.xml`
- **导入**：点击「从影刀导入」→ 选择影刀流程目录 → 自动解析 Web 类型选择器

## 🗂️ 项目结构

```
xpath-repair-desktop/
├── main.js                  # Electron 主进程（WebSocket 服务、IPC、文件操作）
├── preload.js               # 安全桥接（contextBridge）
├── package.json
├── renderer/                # 渲染进程（UI）
│   ├── index.html           # 主页面
│   ├── app.js               # 应用逻辑
│   ├── utils.js             # 工具函数（定位器生成、修复候选）
│   ├── yingdao.js           # 影刀 XML 解析与生成
│   ├── i18n.js              # 国际化
│   └── styles.css           # 样式与主题
└── chrome-extension/        # Chrome 桥接扩展
    ├── manifest.json         # Manifest V3
    ├── service_worker.js     # 后台脚本（WebSocket 客户端）
    ├── content_script.js     # 内容脚本（DOM 操作）
    ├── offscreen.html/js     # 保活文档
    └── utils.js              # 共享工具函数
```

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 桌面端 | Electron 28 |
| 通信协议 | WebSocket (ws) |
| 浏览器扩展 | Chrome Manifest V3 |
| 数据存储 | localStorage |
| 影刀集成 | selectorsV2.xml 读写 |
| 打包工具 | electron-builder |

## 📝 开发计划

- [ ] 打包为独立可执行文件（.exe）
- [ ] 支持更多浏览器（Edge、Firefox）
- [ ] 云端同步元素库
- [ ] 批量修复策略优化

## 👤 作者

**步月**

联系微信：lyh2czy

## 📄 License

MIT

