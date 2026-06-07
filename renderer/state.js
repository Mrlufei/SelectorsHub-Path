// state.js - 全局状态变量
// 必须在其他模块之前加载

// ========== 全局状态 ==========
let currentCandidates = [];
let currentElementInfo = null;
let selectedLocatorIndex = -1;
let selectedSavedItems = new Set();
let extensionConnected = false;
let savedElementsCache = [];
let pageAliasesCache = {};

// 父组数据
let parentGroupsCache = {};

function loadParentGroups() {
  try {
    parentGroupsCache = JSON.parse(localStorage.getItem('parentGroups') || '{}');
  } catch (e) { parentGroupsCache = {}; }
}

function saveParentGroups() {
  localStorage.setItem('parentGroups', JSON.stringify(parentGroupsCache));
}

// 验证请求队列
let pendingValidations = new Map();

// 折叠状态管理
let candidatesCollapse = null;
let savedCollapse = null;

// 连接状态
let hasEverConnected = false;

// 相似捕获流程
let firstElementInfo = null;
let isSimilarCaptureMode = false;

// 当前语言（定义于 i18n.js，此处不重复声明）
