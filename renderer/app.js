// app.js - 桌面端主入口
// UI 引用 + 事件绑定 + 初始化

// ========== UI 元素引用 ==========
const btnPick = document.getElementById('btn-pick');
const btnSave = document.getElementById('btn-save');
const btnDeleteSelected = document.getElementById('btn-delete-selected');
const infoTag = document.getElementById('info-tag');
const infoId = document.getElementById('info-id');
const infoClass = document.getElementById('info-class');
const infoName = document.getElementById('info-name');
const infoText = document.getElementById('info-text');
const elementNameInput = document.getElementById('element-name-input');
const candidatesList = document.getElementById('candidates-list');
const savedList = document.getElementById('saved-list');
const searchInput = document.getElementById('search-input');
const connectionBar = document.getElementById('connection-bar');
const connectionText = document.getElementById('connection-text');

// ========== 初始化 ==========
loadSavedElements();

// ========== 扩展通信初始化 ==========
initExtensionCommunication();

// ========== 折叠逻辑 ==========
function setupCollapse(headerId, containerId, defaultExpanded = false) {
  const header = document.getElementById(headerId);
  const container = document.getElementById(containerId);
  if (!header || !container) return { isExpanded: defaultExpanded };

  let isExpanded = defaultExpanded;
  container.style.display = isExpanded ? (container.classList.contains('locator-list') ? 'flex' : 'block') : 'none';
  const arrow = header.querySelector('.arrow-icon');
  if (arrow && !isExpanded) arrow.classList.add('collapsed');

  header.addEventListener('click', (e) => {
    if (e.target.closest('input, button, [onclick]')) return;
    isExpanded = !isExpanded;
    container.style.display = isExpanded ? (container.classList.contains('locator-list') ? 'flex' : 'block') : 'none';
    const arrow = header.querySelector('.arrow-icon');
    if (arrow) {
      if (isExpanded) arrow.classList.remove('collapsed');
      else arrow.classList.add('collapsed');
    }
  });

  return {
    get isExpanded() { return isExpanded; },
    expand: () => {
      isExpanded = true;
      container.style.display = container.classList.contains('locator-list') ? 'flex' : 'block';
      const arrow = header.querySelector('.arrow-icon');
      if (arrow) arrow.classList.remove('collapsed');
    }
  };
}

infoCollapse = setupCollapse('info-header', 'info-content-container');
candidatesCollapse = setupCollapse('candidates-header', 'candidates-list');
savedCollapse = setupCollapse('saved-header', 'saved-list');

// ========== 拾取按钮 ==========
btnPick.addEventListener('click', () => {
  if (sendToExtension({ action: 'start_picking' })) {
    btnPick.innerText = t('btn_picking');
    btnPick.disabled = true;
  }
});

// ========== 保存按钮 ==========
btnSave.addEventListener('click', () => {
  if (selectedLocatorIndex >= 0 && currentElementInfo) {
    saveElement(currentCandidates[selectedLocatorIndex]);
  }
});

searchInput.addEventListener('input', loadSavedElements);

// ========== 批量删除 ==========
if (btnDeleteSelected) {
  btnDeleteSelected.addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectedSavedItems.size === 0) return;
    if (confirm(t('confirm_delete_selected', { n: selectedSavedItems.size }))) {
      savedElementsCache = savedElementsCache.filter(x => !selectedSavedItems.has(x.id));
      persistData();
      selectedSavedItems.clear();
      updateBulkActionState();
      loadSavedElements();
    }
  });
}

// ========== 合并为新组 ==========
const btnMergeGroups = document.getElementById('btn-merge-groups');

loadParentGroups();

if (btnMergeGroups) {
  btnMergeGroups.addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectedSavedItems.size === 0) return;

    const selectedGroupKeys = new Set();
    savedElementsCache.forEach(item => {
      if (selectedSavedItems.has(item.id)) {
        const key = item._customGroup || (item.domain + item.path);
        selectedGroupKeys.add(key);
      }
    });

    if (selectedGroupKeys.size < 1) return;

    showInputDialog(
      currentLang === 'zh' ? '请输入父组名称：' : 'Enter parent group name:',
      '',
      (groupName) => {
        if (!groupName || !groupName.trim()) return;

        const parentId = '__parent__' + Utils.uuid();
        parentGroupsCache[parentId] = {
          name: groupName.trim(),
          children: Array.from(selectedGroupKeys)
        };
        saveParentGroups();
        selectedSavedItems.clear();
        updateBulkActionState();
        loadSavedElements();
      }
    );
  });
}

// ========== 蒙版上的安装插件按钮 ==========
const btnInstallOverlay = document.getElementById('btn-install-overlay');
if (btnInstallOverlay) {
  btnInstallOverlay.addEventListener('click', async () => {
    await window.electronAPI.openExtensionDir();
    const tip = document.getElementById('install-tip-overlay');
    if (tip) tip.style.display = 'block';
  });
}

// ========== 绑定生成定位器按钮 ==========
const btnGenerateLocator = document.getElementById('btn-generate-locator');
if (btnGenerateLocator) {
  btnGenerateLocator.addEventListener('click', function() {
    generateLocatorFromAttributes();
  });
}

// ========== 捕获相似元素按钮 ==========
const btnSimilarCapture = document.getElementById('btn-similar-capture');
if (btnSimilarCapture) {
  btnSimilarCapture.addEventListener('click', function() {
    if (!currentElementInfo) {
      alert(t('msg_pick_first'));
      return;
    }
    firstElementInfo = currentElementInfo;
    isSimilarCaptureMode = true;
    if (sendToExtension({ action: 'start_picking' })) {
      btnPick.innerText = t('btn_picking');
      btnPick.disabled = true;
    }
  });
}

// ========== 设置初始化 ==========
initSettings();

// ========== 数据导入导出初始化 ==========
initIO();

// ========== 延迟加载设置 ==========
loadSettings();
