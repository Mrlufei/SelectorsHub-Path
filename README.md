# SelectorsHub-Path 🔧

一款面向自动化测试工程师的**元素定位采集、验证与自修复**桌面工具。

基于 Electron 28 + Chrome 扩展桥接架构，支持在网页上实时捕获元素，自动生成多种定位器（XPath / CSS / ID / Name / ClassName），并提供定位失效时的本地智能修复能力。

![Electron](https://img.shields.io/badge/Electron-28-47848f)
![Platform](https://img.shields.io/badge/平台-Windows-lightgrey)

---

## ✨ 核心功能

- **元素捕获** — 点击网页元素，自动生成 XPath、CSS、ID、Name、ClassName 等多种定位器
- **多候选 + 自动校验** — 勾选属性后生成多个候选定位器，扩展端自动校验并选最优（方案C混合流程）
- **属性编辑器** — 可视化编辑 9 种属性 + data-* 自定义属性，支持等于/包含/起始/正则匹配
- **DOM 层级树** — 完整祖先链展示，支持节点勾选参与路径生成
- **实时验证** — 一键验证定位器是否唯一匹配，支持单个验证和批量验证
- **自愈修复** — 定位器失效时，基于元素指纹（标签、属性、祖先链）自动生成修复候选
- **分组管理** — 按页面 URL 自动分组，支持自定义别名、父组合并、批量操作
- **相似元素捕获** — 二步采样 + 自动计算共同特征，扫描全页匹配元素
- **多主题配色** — 内置 7 种主题（默认 / Violet / Ocean / Forest / Orange / Pink / Dark）
- **中英双语** — 完整的中文/英文界面切换
- **优雅退出** — SIGINT/SIGTERM 信号处理，防止端口残留

## 🏗️ 架构

```
┌─────────────────────────────────┐     WebSocket (9527)     ┌──────────────────────┐
│        Electron 桌面端           │ ◄──────────────────────► │  Chrome 桥接扩展      │
│                                 │                          │                      │
│  main.js        (主进程)         │                          │  service_worker.js   │
│  preload.js     (安全桥接)        │                          │  content_script.js   │
│  renderer/      (渲染进程)        │                          │  offscreen.js (保活)  │
│    ├─ app.js                    │                          └──────────┬───────────┘
│    ├─ state.js                  │                                     │
│    ├─ extension.js              │                              注入到网页中
│    ├─ dom-hierarchy.js          │                                     ▼
│    ├─ locator-generator.js      │                          ┌──────────────────────┐
│    ├─ candidates.js             │                          │    目标网页 DOM       │
│    ├─ saved-elements.js         │                          └──────────────────────┘
│    ├─ repair.js                 │
│    ├─ utils.js                  │
│    ├─ i18n.js                   │
│    ├─ settings.js               │
│    ├─ io.js                     │
│    └─ yingdao.js                │
└─────────────────────────────────┘
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

# 启动桌面端（生产模式）
npm start

# 启动桌面端（开发模式）
npm run dev
```

**依赖信息：**
- 运行时依赖：`ws` (^8.16.0) — WebSocket 通信
- 开发依赖：`electron` (^28.0.0)、`electron-builder` (^26.7.0)

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

### 属性编辑 + 智能生成定位器

1. 捕获元素后展开 DOM 层级树
2. 在属性编辑器中勾选需要的属性（id / class / name / innerText 等）
3. 设置匹配方式（等于 / 包含 / 起始）
4. 点击「🔄 生成定位器」→ 系统自动生成多候选 → 页面验证 → 选最优

### 验证与修复

- 点击已保存元素的「验证」按钮，检查定位器是否仍然有效
- 分组标题栏的 ⏩ 按钮可批量验证整组元素
- 验证失败时点击「本地修复」，工具会基于元素指纹自动生成修复候选

## 🗂️ 项目结构

```
xpath-repair-desktop/
├── main.js                  # Electron 主进程（WebSocket 服务、IPC、文件操作）
├── preload.js               # 安全桥接（contextBridge）
├── package.json
├── renderer/                # 渲染进程（UI）
│   ├── index.html           # 主页面
│   ├── app.js               # 应用逻辑（UI 引用 + 事件绑定 + 初始化）
│   ├── state.js             # 全局状态变量
│   ├── extension.js         # 扩展 WebSocket 通信
│   ├── dom-hierarchy.js     # DOM 层级树展示 + 属性编辑器
│   ├── locator-generator.js # 定位器生成（多候选 + 自动校验混合流程）
│   ├── candidates.js        # 候选定位器渲染与验证
│   ├── saved-elements.js    # 已保存元素 CRUD
│   ├── repair.js            # 自愈修复
│   ├── utils.js             # 工具函数（定位器生成、修复候选、指纹校验）
│   ├── i18n.js              # 国际化（中英双语）
│   ├── settings.js          # 设置模块（主题、语言、颜色）
│   ├── io.js                # 数据导入导出
│   ├── yingdao.js           # 影刀 XML 解析与生成
│   └── styles.css           # 样式与主题
└── chrome-extension/        # Chrome 桥接扩展
    ├── manifest.json         # Manifest V3
    ├── service_worker.js     # 后台脚本（WebSocket 客户端、消息路由）
    ├── content_script.js     # 内容脚本（DOM 操作、元素拾取）
    ├── offscreen.html/js     # 保活文档
    └── utils.js              # 共享工具函数
```

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 桌面端 | Electron 28 |
| 通信协议 | WebSocket (ws ^8.16.0) |
| 浏览器扩展 | Chrome Manifest V3 |
| 数据存储 | localStorage |
| 打包工具 | electron-builder |

## 📝 已完成的功能亮点

### locator-generator 混合流程（方案C）
- 每个勾选属性独立生成候选定位器（不拼接），按可靠性评分排序
- 扩展已连接时：多候选 → `validate_candidates` → 按 matchCount + secondaryCheck 选最优
- 未连接时：取评分最高的候选降级使用
- 5 秒超时保护，防止校验无响应

### 定位器评分表
| 属性 | 定位器 | 评分 |
|------|--------|------|
| id | `#id` (CSS) + `//*[@id="id"]` (XPath) | 100 |
| data-* | `[data-*="val"]` (CSS) | 95 |
| name/type/role/placeholder | `[attr="val"]` (CSS) | 85-90 |
| className | `.class1.class2` (CSS) | 75 |
| innerText 精确/包含 | XPath `normalize-space()` / `contains()` | 70 / 60 |
| indexOfType | XPath 位置 | 50 |
| 全属性组合（兜底） | 拼接 XPath | 40 |

### 其他优化
- **DOM 层级提取**：动态深度控制、智能剪枝、特征缓存
- **优雅退出**：SIGINT/SIGTERM 信号处理，防止端口残留
- **信息区增强**：展示字段改为可编辑文本框，修复折叠状态失步 bug
- **移除 alert 阻塞**：生成定位器不再弹窗冻结界面

---

## 致谢

本项目基于 **步月** 的原作 [Xpath Repair](https://github.com/lwhx/Xpath-Repair) 进行功能增强与优化。感谢原作者的卓越工作，为本项目奠定了坚实的基础。

## 📄 License

MIT
