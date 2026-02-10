// app.js - 桌面端主应用逻辑
// 替代原 sidepanel.js，通过 electronAPI 与主进程/扩展通信

let currentCandidates = [];
let currentElementInfo = null;
let selectedLocatorIndex = -1;
let selectedSavedItems = new Set();
let extensionConnected = false;
let savedElementsCache = []; // 本地缓存
let pageAliasesCache = {};
let yingdaoDirPath = '';

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

// ========== 扩展通信 ==========

// 监听扩展连接状态
let hasEverConnected = false;

window.electronAPI.onExtensionStatus((connected) => {
  extensionConnected = connected;
  connectionBar.className = `connection-bar ${connected ? 'connected' : 'disconnected'}`;
  connectionText.textContent = t(connected ? 'extension_connected' : 'extension_disconnected');
  btnPick.disabled = !connected;

  // 首次连接成功后隐藏加载蒙版，之后不再显示
  if (connected && !hasEverConnected) {
    hasEverConnected = true;
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.3s';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }
  }
});

// 监听来自扩展的消息
window.electronAPI.onFromExtension((msg) => {
  if (msg.action === 'element_picked') {
    handleElementPicked(msg.payload);
  } else if (msg.action === 'picking_stopped') {
    btnPick.innerText = t('btn_pick');
    btnPick.disabled = !extensionConnected;
  } else if (msg.action === 'validate_response') {
    handleValidateResponse(msg);
  } else if (msg.action === 'validate_many_response') {
    handleValidateManyResponse(msg);
  } else if (msg.action === 'validate_candidates_response') {
    handleValidateCandidatesResponse(msg);
  } else if (msg.action === 'get_current_url_response') {
    const cb = pendingValidations.get(msg.requestId);
    if (cb) { cb(msg.url); pendingValidations.delete(msg.requestId); }
  } else if (msg.action === 'navigate_response') {
    const cb = pendingValidations.get(msg.requestId);
    if (cb) { cb(msg.success); pendingValidations.delete(msg.requestId); }
  }
});

// 向扩展发送消息
function sendToExtension(msg) {
  if (!extensionConnected) {
    alert(t('alert_connection_failed'));
    return false;
  }
  window.electronAPI.sendToExtension(msg);
  return true;
}

// ========== 拾取按钮 ==========
btnPick.addEventListener('click', () => {
  if (sendToExtension({ action: 'start_picking' })) {
    btnPick.innerText = t('btn_picking');
    btnPick.disabled = true;
  }
});

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
      if (!isExpanded) {
        isExpanded = true;
        container.style.display = container.classList.contains('locator-list') ? 'flex' : 'block';
        const arrow = header.querySelector('.arrow-icon');
        if (arrow) arrow.classList.remove('collapsed');
      }
    }
  };
}

const infoCollapse = setupCollapse('info-header', 'info-content-container');
const candidatesCollapse = setupCollapse('candidates-header', 'candidates-list');
const savedCollapse = setupCollapse('saved-header', 'saved-list');

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

    // 找出选中元素所属的 groupKey 集合
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

// ========== 元素拾取处理 ==========
function handleElementPicked(payload) {
  currentElementInfo = payload;
  currentCandidates = payload.candidates;
  btnPick.innerText = t('btn_pick');
  btnPick.disabled = !extensionConnected;

  infoCollapse.expand();
  candidatesCollapse.expand();

  infoTag.textContent = payload.tagName;
  infoId.textContent = payload.id || '-';
  infoClass.textContent = payload.className || '-';
  infoName.textContent = payload.name || '-';
  infoText.textContent = payload.innerText || '-';

  elementNameInput.value = payload.innerText ?
    payload.innerText.substring(0, 20) :
    (payload.id ? payload.tagName + '#' + payload.id : payload.tagName);

  renderCandidates();
  if (currentCandidates.length > 0) {
    validateCandidate(0);
  }
}

// ========== 候选定位器渲染 ==========
function renderCandidates() {
  candidatesList.innerHTML = '';
  currentCandidates.forEach((cand, index) => {
    const item = document.createElement('div');
    item.className = 'locator-item';
    item.dataset.index = index;

    const header = document.createElement('div');
    header.className = 'locator-header';
    const typeTag = document.createElement('span');
    typeTag.className = `type-tag type-${cand.type}`;
    typeTag.textContent = cand.type;
    header.appendChild(typeTag);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'locator-value';
    input.value = cand.value;
    input.readOnly = true;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const btnVal = document.createElement('button');
    btnVal.className = 'btn secondary';
    btnVal.style.cssText = 'padding: 2px 8px; font-size: 12px;';
    btnVal.textContent = t('btn_validate');
    btnVal.onclick = (e) => { e.stopPropagation(); validateCandidate(index); };

    const btnCopy = document.createElement('button');
    btnCopy.className = 'btn secondary';
    btnCopy.style.cssText = 'padding: 2px 8px; font-size: 12px;';
    btnCopy.textContent = t('btn_copy');
    btnCopy.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(cand.value);
      btnCopy.textContent = t('btn_copied');
      setTimeout(() => btnCopy.textContent = t('btn_copy'), 1000);
    };

    actions.appendChild(btnCopy);
    actions.appendChild(btnVal);

    const status = document.createElement('div');
    status.className = 'validation-status';
    status.style.cssText = 'font-size: 11px; margin-top: 4px;';

    item.appendChild(header);
    item.appendChild(input);
    item.appendChild(actions);
    item.appendChild(status);

    item.addEventListener('click', () => {
      document.querySelectorAll('.locator-item').forEach(el => el.style.border = '1px solid var(--border-color)');
      item.style.border = '2px solid var(--primary-color)';
      selectedLocatorIndex = index;
      btnSave.disabled = false;
      btnSave.textContent = t('btn_save_with_type', { type: cand.type });
      sendToExtension({ action: 'clear_highlight' });
    });

    candidatesList.appendChild(item);
  });
}

// ========== 验证逻辑（通过 WebSocket 发给扩展） ==========
let pendingValidations = new Map(); // requestId -> callback

function validateCandidate(index) {
  const locator = currentCandidates[index];
  const itemEl = candidatesList.children[index];
  if (!itemEl) return;
  const statusEl = itemEl.querySelector('.validation-status');
  statusEl.textContent = t('tag_validating');
  statusEl.style.color = '#666';

  const requestId = Utils.uuid();
  pendingValidations.set(requestId, (response) => {
    if (!response) { statusEl.textContent = t('status_error'); return; }
    itemEl.classList.remove('valid', 'invalid', 'multiple');
    if (response.count === 1) {
      statusEl.textContent = `${t('status_unique')} (${response.time}ms)`;
      statusEl.style.color = 'green';
      itemEl.classList.add('valid');
      if (selectedLocatorIndex === -1) itemEl.click();
    } else if (response.count === 0) {
      statusEl.textContent = `${t('status_not_found')} (${response.time}ms)`;
      statusEl.style.color = 'red';
      itemEl.classList.add('invalid');
    } else {
      statusEl.textContent = `${t('status_multiple', { n: response.count })} (${response.time}ms)`;
      statusEl.style.color = '#faad14';
      itemEl.classList.add('multiple');
    }
  });

  sendToExtension({ action: 'validate', requestId, locator });
}

function handleValidateResponse(msg) {
  const cb = pendingValidations.get(msg.requestId);
  if (cb) {
    cb(msg.result);
    pendingValidations.delete(msg.requestId);
  }
}

function handleValidateManyResponse(msg) {
  const cb = pendingValidations.get(msg.requestId);
  if (cb) {
    cb(msg.results);
    pendingValidations.delete(msg.requestId);
  }
}

function handleValidateCandidatesResponse(msg) {
  const cb = pendingValidations.get(msg.requestId);
  if (cb) {
    cb(msg.results);
    pendingValidations.delete(msg.requestId);
  }
}

// ========== 数据持久化（使用 localStorage 替代 chrome.storage） ==========
function persistData() {
  localStorage.setItem('savedElements', JSON.stringify(savedElementsCache));
  localStorage.setItem('pageAliases', JSON.stringify(pageAliasesCache));
}

function loadPersistedData() {
  try {
    savedElementsCache = JSON.parse(localStorage.getItem('savedElements') || '[]');
    pageAliasesCache = JSON.parse(localStorage.getItem('pageAliases') || '{}');
  } catch (e) {
    savedElementsCache = [];
    pageAliasesCache = {};
  }
}

function saveElement(locator) {
  const data = {
    id: Utils.uuid(),
    name: elementNameInput.value || '未命名元素',
    url: currentElementInfo.url,
    domain: new URL(currentElementInfo.url).hostname,
    path: new URL(currentElementInfo.url).pathname,
    locator: locator,
    timestamp: Date.now(),
    fingerprint: currentElementInfo.fingerprint,
    ancestorChain: currentElementInfo.ancestorChain,
    history: []
  };
  savedElementsCache.push(data);
  persistData();
  loadSavedElements();
  alert(t('alert_saved'));
}

function saveToStorage(item) {
  const idx = savedElementsCache.findIndex(x => x.id === item.id);
  if (idx !== -1) {
    savedElementsCache[idx] = item;
    persistData();
  }
}

function updateBulkActionState() {
  const btnMerge = document.getElementById('btn-merge-groups');
  if (btnDeleteSelected && searchInput) {
    if (selectedSavedItems.size > 0) {
      searchInput.style.display = 'none';
      btnDeleteSelected.style.display = 'block';
      btnDeleteSelected.innerText = `🗑️ 删除(${selectedSavedItems.size})`;
      if (btnMerge) btnMerge.style.display = 'block';
    } else {
      searchInput.style.display = 'block';
      btnDeleteSelected.style.display = 'none';
      if (btnMerge) btnMerge.style.display = 'none';
    }
  }
}

// ========== 已保存元素列表渲染 ==========
function loadSavedElements() {
  loadPersistedData();
  const list = savedElementsCache;
  const aliases = pageAliasesCache;
  const filter = searchInput.value.toLowerCase();

  const groups = {};
  list.forEach(item => {
    if (filter && !item.name.toLowerCase().includes(filter)) return;
    // 优先使用自定义分组，否则按 domain+path 分组
    const key = item._customGroup || (item.domain + item.path);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  savedList.innerHTML = '';
  if (list.length === 0) {
    savedList.innerHTML = `<div style="padding:10px; color:#999; font-size: 12px; text-align: center;">${t('msg_no_saved')}</div>`;
    return;
  }

  // 构建 groupKey → parentId 的映射
  loadParentGroups();
  const groupKeyToParent = {};
  Object.entries(parentGroupsCache).forEach(([parentId, pg]) => {
    pg.children.forEach(gk => { groupKeyToParent[gk] = parentId; });
  });

  // 按父组归类
  const parentBuckets = {}; // parentId → { groupKey → items[] }
  const orphanGroups = {};  // 没有父组的 groupKey → items[]

  Object.keys(groups).forEach(key => {
    const parentId = groupKeyToParent[key];
    if (parentId && parentGroupsCache[parentId]) {
      if (!parentBuckets[parentId]) parentBuckets[parentId] = {};
      parentBuckets[parentId][key] = groups[key];
    } else {
      orphanGroups[key] = groups[key];
    }
  });

  // 渲染父组
  Object.entries(parentBuckets).forEach(([parentId, childGroups]) => {
    const pg = parentGroupsCache[parentId];
    const parentDiv = document.createElement('div');
    parentDiv.className = 'parent-group';
    parentDiv.style.cssText = 'margin-bottom:12px; border:1px solid var(--border-color); border-radius:6px; overflow:hidden;';

    // 父组标题
    const parentHeader = document.createElement('div');
    parentHeader.style.cssText = 'display:flex; align-items:center; background:var(--primary-color); color:white; padding:6px 10px; cursor:pointer; font-size:13px; font-weight:600;';

    const parentArrow = document.createElement('span');
    parentArrow.className = 'arrow-icon';
    parentArrow.textContent = '▼';
    parentArrow.style.cssText = 'color:white; margin-right:6px;';

    const parentName = document.createElement('span');
    parentName.textContent = pg.name;
    parentName.style.flex = '1';

    // 父组重命名
    const btnParentRename = document.createElement('span');
    btnParentRename.textContent = '✏️';
    btnParentRename.style.cssText = 'cursor:pointer; margin-left:8px; font-size:12px;';
    btnParentRename.onclick = (e) => {
      e.stopPropagation();
      showInputDialog(
        currentLang === 'zh' ? '重命名父组：' : 'Rename parent group:',
        pg.name,
        (newName) => {
          if (newName && newName.trim()) {
            parentGroupsCache[parentId].name = newName.trim();
            saveParentGroups();
            loadSavedElements();
          }
        }
      );
    };

    // 父组解散
    const btnParentDisband = document.createElement('span');
    btnParentDisband.textContent = '✖';
    btnParentDisband.title = currentLang === 'zh' ? '解散父组（不删除元素）' : 'Disband group';
    btnParentDisband.style.cssText = 'cursor:pointer; margin-left:8px; font-size:12px;';
    btnParentDisband.onclick = (e) => {
      e.stopPropagation();
      delete parentGroupsCache[parentId];
      saveParentGroups();
      loadSavedElements();
    };

    parentHeader.appendChild(parentArrow);
    parentHeader.appendChild(parentName);
    parentHeader.appendChild(btnParentRename);
    parentHeader.appendChild(btnParentDisband);
    parentDiv.appendChild(parentHeader);

    // 父组内容
    const parentContent = document.createElement('div');
    parentContent.style.cssText = 'padding:4px;';
    let parentExpanded = true;

    parentHeader.addEventListener('click', () => {
      parentExpanded = !parentExpanded;
      parentContent.style.display = parentExpanded ? 'block' : 'none';
      if (parentExpanded) parentArrow.classList.remove('collapsed');
      else parentArrow.classList.add('collapsed');
    });

    // 渲染父组内的子组
    Object.keys(childGroups).forEach(key => {
      const groupDiv = renderGroup(key, childGroups[key], aliases);
      parentContent.appendChild(groupDiv);
    });

    parentDiv.appendChild(parentContent);
    savedList.appendChild(parentDiv);
  });

  // 渲染未归组的
  Object.keys(orphanGroups).forEach(key => {
    const groupDiv = renderGroup(key, orphanGroups[key], aliases);
    savedList.appendChild(groupDiv);
  });

  updateBulkActionState();
}

// 渲染单个链接组（提取为独立函数）
function renderGroup(key, items, aliases) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'saved-group';

    // 分组标题栏
    const titleContainer = document.createElement('div');
    titleContainer.className = 'group-header-container';
    titleContainer.style.cssText = 'display:flex; align-items:center; background:var(--bg-color); padding:4px 8px; border-radius:4px; margin-bottom:4px;';

    const groupCheckbox = document.createElement('input');
    groupCheckbox.type = 'checkbox';
    groupCheckbox.style.marginRight = '8px';
    groupCheckbox.addEventListener('change', (e) => {
      items.forEach(item => {
        if (e.target.checked) selectedSavedItems.add(item.id);
        else selectedSavedItems.delete(item.id);
      });
      updateBulkActionState();
      groupDiv.querySelectorAll('.item-checkbox').forEach(cb => cb.checked = e.target.checked);
    });

    const title = document.createElement('div');
    title.className = 'group-title';
    const displayName = aliases[key] || key;
    title.innerHTML = '<span class="arrow-icon">▼</span> ' + displayName;
    title.style.cssText = 'flex:1; cursor:pointer; margin:0; background:none;';
    title.title = t('title_expand_collapse');

    // 重命名按钮
    const btnRename = document.createElement('span');
    btnRename.innerText = '✏️';
    btnRename.title = t('title_rename_group');
    btnRename.style.cssText = 'cursor:pointer; font-size:12px; margin-left:8px; opacity:0.6;';
    btnRename.onclick = (e) => {
      e.stopPropagation();
      const currentName = aliases[key] || "";
      showInputDialog(t('prompt_rename'), currentName, (newName) => {
        if (newName !== null) {
          if (newName.trim() === "") delete pageAliasesCache[key];
          else pageAliasesCache[key] = newName.trim();
          persistData();
          loadSavedElements();
        }
      });
    };

    // 批量验证
    const btnValidateAll = document.createElement('span');
    btnValidateAll.innerText = '⏩';
    btnValidateAll.title = t('btn_validate_all');
    btnValidateAll.style.cssText = 'cursor:pointer; font-size:12px; margin-left:8px; opacity:0.8;';
    btnValidateAll.onclick = (e) => {
      e.stopPropagation();
      if (!extensionConnected) { alert(t('alert_connection_failed')); return; }

      // 先获取当前浏览器 URL，检查是否需要跳转
      const targetUrl = items[0].url;
      const urlRequestId = Utils.uuid();

      pendingValidations.set(urlRequestId, (currentUrl) => {
        // currentUrl 是字符串，从 get_current_url_response 传来
        const needNavigate = targetUrl && currentUrl && !currentUrl.startsWith(new URL(targetUrl).origin);

        const doValidate = () => {
          const requestId = Utils.uuid();
          const locators = items.map(item => ({ id: item.id, locator: item.locator }));

          // 设置 loading 状态
          items.forEach(item => {
            const itemEl = document.getElementById(`item-${item.id}`);
            if (!itemEl) return;
            const statusTag = itemEl.querySelector('.status-tag');
            if (statusTag) { statusTag.className = 'status-tag loading'; statusTag.textContent = t('tag_validating'); }
          });

          pendingValidations.set(requestId, (results) => {
            if (!results) {
              items.forEach(item => {
                const itemEl = document.getElementById(`item-${item.id}`);
                if (!itemEl) return;
                const statusTag = itemEl.querySelector('.status-tag');
                if (statusTag) { statusTag.className = 'status-tag error'; statusTag.textContent = t('tag_error'); }
              });
              return;
            }
            const resultMap = new Map(results.map(r => [r.id, r]));
            items.forEach(item => {
              const itemEl = document.getElementById(`item-${item.id}`);
              if (!itemEl) return;
              const statusTag = itemEl.querySelector('.status-tag');
              const response = resultMap.get(item.id);
              statusTag.className = 'status-tag';
              if (!response) { statusTag.classList.add('error'); statusTag.textContent = t('tag_error'); return; }
              if (response.count === 1) { statusTag.classList.add('success'); statusTag.textContent = t('tag_success'); }
              else if (response.count === 0) { statusTag.classList.add('error'); statusTag.textContent = t('tag_failure'); }
              else { statusTag.classList.add('warning'); statusTag.textContent = t('tag_warning'); }
            });
          });

          sendToExtension({ action: 'validate_many', requestId, locators });
        };

        if (needNavigate) {
          if (!confirm(t('confirm_page_mismatch_batch', { url: targetUrl }))) return;
          const navRequestId = Utils.uuid();
          pendingValidations.set(navRequestId, () => {
            doValidate();
          });
          sendToExtension({ action: 'navigate', requestId: navRequestId, url: targetUrl });
        } else {
          doValidate();
        }
      });

      // 获取当前 URL
      sendToExtension({ action: 'get_current_url', requestId: urlRequestId });
    };

    // 删除分组
    const btnDelGroup = document.createElement('span');
    btnDelGroup.innerText = '🗑️';
    btnDelGroup.title = t('title_delete_group');
    btnDelGroup.style.cssText = 'cursor:pointer; font-size:12px; margin-left:8px;';
    btnDelGroup.onclick = (e) => {
      e.stopPropagation();
      if (confirm(t('confirm_delete_group', { n: items.length }))) {
        const idsToRemove = new Set(items.map(i => i.id));
        savedElementsCache = savedElementsCache.filter(x => !idsToRemove.has(x.id));
        persistData();
        loadSavedElements();
      }
    };

    titleContainer.appendChild(groupCheckbox);
    titleContainer.appendChild(title);
    titleContainer.appendChild(btnRename);
    titleContainer.appendChild(btnValidateAll);
    titleContainer.appendChild(btnDelGroup);
    groupDiv.appendChild(titleContainer);

    // 分组内容
    const contentDiv = document.createElement('div');
    contentDiv.className = 'group-content';
    let isExpanded = true;
    title.addEventListener('click', () => {
      isExpanded = !isExpanded;
      contentDiv.style.display = isExpanded ? 'block' : 'none';
      const arrow = title.querySelector('.arrow-icon');
      if (arrow) { if (isExpanded) arrow.classList.remove('collapsed'); else arrow.classList.add('collapsed'); }
    });

    items.forEach(item => {
      const elDiv = document.createElement('div');
      elDiv.className = 'saved-item';
      elDiv.id = `item-${item.id}`;
      elDiv.style.cssText = 'display:flex; align-items:flex-start;';

      const itemCheckbox = document.createElement('input');
      itemCheckbox.type = 'checkbox';
      itemCheckbox.className = 'item-checkbox';
      itemCheckbox.style.cssText = 'margin-top:10px; margin-right:8px;';
      itemCheckbox.checked = selectedSavedItems.has(item.id);
      itemCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) selectedSavedItems.add(item.id);
        else selectedSavedItems.delete(item.id);
        updateBulkActionState();
        const allChecked = Array.from(groupDiv.querySelectorAll('.item-checkbox')).every(cb => cb.checked);
        groupCheckbox.checked = allChecked;
      });

      const itemContent = document.createElement('div');
      itemContent.style.flex = '1';

      const header = document.createElement('div');
      header.className = 'saved-item-header';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;
      const actionsSpan = document.createElement('span');
      actionsSpan.className = 'saved-item-actions';
      const statusTag = document.createElement('span');
      statusTag.className = 'status-tag';

      // 验证按钮
      const btnValidate = document.createElement('span');
      btnValidate.innerText = t('btn_validate');
      btnValidate.className = 'btn-text';
      btnValidate.onclick = (e) => {
        e.stopPropagation();
        if (!extensionConnected) { alert(t('alert_connection_failed')); return; }
        statusTag.className = 'status-tag loading';
        statusTag.textContent = t('tag_validating');
        const requestId = Utils.uuid();
        pendingValidations.set(requestId, (response) => {
          statusTag.className = 'status-tag';
          if (!response) { statusTag.classList.add('error'); statusTag.textContent = t('tag_error'); return; }
          if (response.count === 1) {
            statusTag.classList.add('success'); statusTag.textContent = t('tag_success');
            if (response.newFingerprint) { item.fingerprint = response.newFingerprint; item.ancestorChain = response.newAncestorChain; saveToStorage(item); }
          } else if (response.count === 0) {
            statusTag.classList.add('error'); statusTag.textContent = t('tag_failure');
            handleValidationFailure(item, itemContent);
          } else {
            statusTag.classList.add('warning'); statusTag.textContent = t('tag_warning');
          }
        });
        sendToExtension({ action: 'validate', requestId, locator: item.locator, fingerprint: item.fingerprint, collectFingerprint: !item.fingerprint });
      };

      // 复制按钮
      const btnCopy = document.createElement('span');
      btnCopy.innerText = t('btn_copy');
      btnCopy.className = 'btn-text';
      btnCopy.style.marginLeft = '4px';
      btnCopy.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(item.locator.value);
        const orig = btnCopy.innerText;
        btnCopy.innerText = t('btn_copied');
        setTimeout(() => btnCopy.innerText = orig, 1000);
      };

      // 修复按钮
      const btnRepair = document.createElement('span');
      btnRepair.innerText = t('btn_repair');
      btnRepair.className = 'btn-text';
      btnRepair.style.marginLeft = '4px';
      btnRepair.onclick = (e) => {
        e.stopPropagation();
        handleValidationFailure(item, itemContent);
      };

      actionsSpan.appendChild(statusTag);
      actionsSpan.appendChild(btnValidate);
      actionsSpan.appendChild(btnCopy);
      actionsSpan.appendChild(btnRepair);
      header.appendChild(nameSpan);
      header.appendChild(actionsSpan);

      const loc = document.createElement('div');
      loc.className = 'saved-item-loc';
      const typeTagEl = document.createElement('span');
      typeTagEl.className = `type-tag type-${item.locator.type}`;
      typeTagEl.style.cssText = 'margin-right:6px; font-size:9px;';
      typeTagEl.textContent = item.locator.type;
      const locValue = document.createElement('span');
      locValue.textContent = item.locator.value;
      loc.appendChild(typeTagEl);
      loc.appendChild(locValue);

      itemContent.appendChild(header);
      itemContent.appendChild(loc);

      itemContent.addEventListener('click', () => {
        sendToExtension({ action: 'validate', requestId: Utils.uuid(), locator: item.locator });
      });

      elDiv.appendChild(itemCheckbox);
      elDiv.appendChild(itemContent);
      contentDiv.appendChild(elDiv);
    });

    groupDiv.appendChild(contentDiv);
    return groupDiv;
}

// ========== 自愈修复逻辑 ==========
function handleValidationFailure(item, container) {
  let repairPanel = document.getElementById(`repair-${item.id}`);
  if (!repairPanel) {
    repairPanel = document.createElement('div');
    repairPanel.id = `repair-${item.id}`;
    repairPanel.className = 'repair-panel';
    container.appendChild(repairPanel);
  }

  if (!item.fingerprint) {
    renderRepairPanel(repairPanel, [], 'no_fingerprint', item);
    return;
  }

  renderRepairPanel(repairPanel, [], 'generating', item);

  const candidates = Utils.generateRepairCandidates(item.fingerprint, item.ancestorChain || []);
  const requestId = Utils.uuid();

  pendingValidations.set(requestId, (results) => {
    if (!results) { renderRepairPanel(repairPanel, [], 'error', item); return; }
    const processed = results.sort((a, b) => {
      const aValid = a.matchCount === 1 && a.secondaryCheck.pass;
      const bValid = b.matchCount === 1 && b.secondaryCheck.pass;
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      return b.score - a.score;
    });
    renderRepairPanel(repairPanel, processed, 'done', item);
  });

  sendToExtension({ action: 'validate_candidates', requestId, candidates, fingerprint: item.fingerprint });
}

function renderRepairPanel(container, candidates, status, item) {
  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'repair-header';
  const title = document.createElement('h3');
  title.innerHTML = `${t('header_repair')} <span class="arrow-icon">▼</span>`;
  const closeBtn = document.createElement('span');
  closeBtn.innerText = '×';
  closeBtn.style.cssText = 'cursor:pointer; margin-left:auto;';
  closeBtn.onclick = (e) => { e.stopPropagation(); container.remove(); };
  header.appendChild(title);
  header.appendChild(closeBtn);
  container.appendChild(header);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'repair-content';
  container.appendChild(contentDiv);

  let isExpanded = true;
  header.onclick = (e) => {
    if (e.target === closeBtn) return;
    isExpanded = !isExpanded;
    contentDiv.style.display = isExpanded ? 'block' : 'none';
    const arrow = title.querySelector('.arrow-icon');
    if (arrow) { if (isExpanded) arrow.classList.remove('collapsed'); else arrow.classList.add('collapsed'); }
  };

  if (status === 'generating') { contentDiv.innerHTML = `<div class="loading">${t('msg_analyzing')}</div>`; return; }
  if (status === 'no_fingerprint') { contentDiv.innerHTML = `<div class="empty" style="color:#ff4d4f">${t('msg_no_fingerprint')}</div>`; return; }

  const validCandidates = candidates.filter(c => c.matchCount === 1);
  if (status === 'error' || validCandidates.length === 0) { contentDiv.innerHTML = `<div class="empty">${t('msg_repair_empty')}</div>`; return; }

  const list = document.createElement('div');
  list.className = 'candidate-list';

  validCandidates.forEach(cand => {
    const row = document.createElement('div');
    const isSafe = cand.matchCount === 1 && cand.secondaryCheck.pass;
    const isRisk = cand.matchCount === 1 && !cand.secondaryCheck.pass;
    row.className = `candidate-row ${isSafe ? 'safe' : (isRisk ? 'risky' : '')}`;

    let statusIcon = isSafe ? '✅' : '⚠️';
    let statusText = isSafe ? t('status_perfect') : t('status_risk', { reason: cand.secondaryCheck.reason });

    row.innerHTML = `
      <div class="cand-info"><div class="cand-type">${cand.type}</div><div class="cand-value" title="${cand.value}">${cand.value}</div></div>
      <div class="cand-status-row"><div class="cand-reason">${cand.reason}</div><div class="cand-status" title="${statusText}">${statusIcon}</div></div>
      <div class="cand-actions-row"><button class="btn-adopt ${isSafe ? 'primary' : 'danger'}">${t('btn_adopt')}</button></div>
    `;

    row.querySelector('.btn-adopt').onclick = (e) => {
      e.stopPropagation();
      if (!isSafe && !confirm(t('confirm_force_adopt', { reason: cand.secondaryCheck.reason }))) return;
      adoptLocator(item, cand);
    };
    list.appendChild(row);
  });

  contentDiv.appendChild(list);
}

function adoptLocator(item, newLocator) {
  if (!item.history) item.history = [];
  item.history.push({ at: Date.now(), oldLocator: item.locator, reason: 'self-healing' });
  item.locator = { type: newLocator.type, value: newLocator.value };
  saveToStorage(item);
  alert(t('alert_repaired'));
  loadSavedElements();
}

// ========== 设置模块 ==========
const settingsHeader = document.getElementById('settings-header');
const settingsContent = document.getElementById('settings-content');
const settingsArrow = document.getElementById('settings-arrow');
const btnLangs = document.querySelectorAll('.btn-lang');
const themeOptions = document.querySelectorAll('.theme-option');
const colorPick = document.getElementById('color-pick');
const colorVerify = document.getElementById('color-verify');
let isSettingsExpanded = false;

settingsHeader.addEventListener('click', () => {
  isSettingsExpanded = !isSettingsExpanded;
  settingsContent.style.display = isSettingsExpanded ? 'block' : 'none';
  settingsArrow.style.transform = isSettingsExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
});

btnLangs.forEach(btn => {
  btn.addEventListener('click', () => {
    btnLangs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentLang = btn.dataset.lang;
    updatePageLanguage();
    loadSavedElements();
    if (currentCandidates.length > 0) renderCandidates();
    saveSettings();
  });
});

themeOptions.forEach(opt => {
  opt.addEventListener('click', () => {
    themeOptions.forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    if (opt.dataset.theme === 'default') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', opt.dataset.theme);
    }
    saveSettings();
  });
});

[colorPick, colorVerify].forEach(input => {
  input.addEventListener('change', () => {
    saveSettings();
    sendToExtension({ action: 'update_colors', colors: { pick: colorPick.value, verify: colorVerify.value } });
  });
});

// 影刀目录选择
const btnSelectYingdaoDir = document.getElementById('btn-select-yingdao-dir');
const yingdaoDirDisplay = document.getElementById('yingdao-dir-display');

btnSelectYingdaoDir.addEventListener('click', async () => {
  const dir = await window.electronAPI.selectYingdaoDir();
  if (dir) {
    yingdaoDirPath = dir;
    yingdaoDirDisplay.textContent = dir.split(/[/\\]/).pop();
    yingdaoDirDisplay.title = dir;
    saveSettings();
  }
});

// 安装浏览器插件
const btnInstallExtension = document.getElementById('btn-install-extension');
if (btnInstallExtension) {
  btnInstallExtension.addEventListener('click', async () => {
    await window.electronAPI.openExtensionDir();
    alert(t('install_extension_tip'));
  });
}

function loadSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    currentLang = settings.lang || 'zh';
    updatePageLanguage();
    btnLangs.forEach(btn => { btn.classList.toggle('active', btn.dataset.lang === currentLang); });

    const theme = settings.theme || 'default';
    if (theme === 'default') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    themeOptions.forEach(opt => { opt.classList.toggle('active', opt.dataset.theme === theme); });

    colorPick.value = settings.pickColor || '#ff0000';
    colorVerify.value = settings.verifyColor || '#52c41a';

    yingdaoDirPath = settings.yingdaoDir || '';
    if (yingdaoDirPath) {
      yingdaoDirDisplay.textContent = yingdaoDirPath.split(/[/\\]/).pop();
      yingdaoDirDisplay.title = yingdaoDirPath;
    }
  } catch (e) { /* 忽略 */ }
  loadPersistedData();
}

function saveSettings() {
  localStorage.setItem('settings', JSON.stringify({
    lang: currentLang,
    theme: document.documentElement.getAttribute('data-theme') || 'default',
    pickColor: colorPick.value,
    verifyColor: colorVerify.value,
    yingdaoDir: yingdaoDirPath
  }));
}

// ========== 数据导入导出 ==========
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const fileImport = document.getElementById('file-import');
const btnExportYingdao = document.getElementById('btn-export-yingdao');
const btnImportYingdao = document.getElementById('btn-import-yingdao');

// JSON 导出
if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (savedElementsCache.length === 0) { alert(t('msg_no_data_to_export')); return; }
    const blob = new Blob([JSON.stringify(savedElementsCache, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xpath-repair-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// JSON 导入
if (btnImport && fileImport) {
  btnImport.addEventListener('click', () => fileImport.click());
  fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (!Array.isArray(importedData)) throw new Error('格式错误');
        if (!confirm(t('confirm_import', { n: importedData.length }))) { fileImport.value = ''; return; }

        const currentMap = new Map(savedElementsCache.map(item => [item.id, item]));
        let addedCount = 0, updatedCount = 0;
        importedData.forEach(item => {
          if (currentMap.has(item.id)) { currentMap.set(item.id, item); updatedCount++; }
          else { currentMap.set(item.id, item); addedCount++; }
        });
        savedElementsCache = Array.from(currentMap.values());
        persistData();
        loadSavedElements();
        alert(t('alert_imported', { added: addedCount, updated: updatedCount }));
        fileImport.value = '';
      } catch (err) {
        alert(t('alert_import_failed'));
        fileImport.value = '';
      }
    };
    reader.readAsText(file);
  });
}

// ========== 影刀导入 ==========
if (btnImportYingdao) {
  btnImportYingdao.addEventListener('click', async () => {
    // 如果没有预设目录，让用户现场选择
    let dirPath = yingdaoDirPath;
    if (!dirPath) {
      dirPath = await window.electronAPI.selectYingdaoDir();
      if (!dirPath) return;
      yingdaoDirPath = dirPath;
      yingdaoDirDisplay.textContent = dirPath.split(/[/\\]/).pop();
      yingdaoDirDisplay.title = dirPath;
      saveSettings();
    }

    try {
      const result = await window.electronAPI.importYingdao(dirPath);
      if (!result || !result.xmlContents || result.xmlContents.length === 0) {
        alert(t('yingdao_import_empty'));
        return;
      }

      let totalElements = [];
      let totalSkipped = 0;

      result.xmlContents.forEach(xmlStr => {
        const parsed = YingDao.parseXml(xmlStr);
        totalElements = totalElements.concat(parsed.elements);
        totalSkipped += parsed.skippedDesktop;
      });

      if (totalElements.length === 0) {
        let msg = t('yingdao_import_empty');
        if (totalSkipped > 0) msg += '\n' + t('yingdao_skipped_desktop', { n: totalSkipped });
        alert(msg);
        return;
      }

      // 合并到现有数据（按 name + domain 去重）
      const existingKeys = new Set(savedElementsCache.map(e => e.name + '|' + e.domain));
      let addedCount = 0;
      totalElements.forEach(el => {
        const key = el.name + '|' + el.domain;
        if (!existingKeys.has(key)) {
          savedElementsCache.push(el);
          existingKeys.add(key);
          addedCount++;
        }
      });

      persistData();
      loadSavedElements();

      let msg = t('yingdao_import_success', { n: addedCount });
      if (totalSkipped > 0) msg += '\n' + t('yingdao_skipped_desktop', { n: totalSkipped });
      alert(msg);
    } catch (err) {
      console.error('影刀导入失败:', err);
      alert(t('alert_import_failed'));
    }
  });
}

// ========== 影刀导出 ==========
if (btnExportYingdao) {
  btnExportYingdao.addEventListener('click', async () => {
    // 只导出勾选的元素
    if (selectedSavedItems.size === 0) {
      alert(t('yingdao_export_no_selection'));
      return;
    }

    const selectedElements = savedElementsCache.filter(x => selectedSavedItems.has(x.id));

    let dirPath = yingdaoDirPath;
    if (!dirPath) {
      dirPath = await window.electronAPI.selectYingdaoDir();
      if (!dirPath) return;
      yingdaoDirPath = dirPath;
      yingdaoDirDisplay.textContent = dirPath.split(/[/\\]/).pop();
      yingdaoDirDisplay.title = dirPath;
      saveSettings();
    }

    try {
      // 主进程返回 { robotXmlPath, existingContent, groups, aliases }
      const exportResult = await window.electronAPI.exportYingdao({
        dirPath,
        elements: selectedElements,
        aliases: pageAliasesCache
      });

      if (!exportResult || !exportResult.robotXmlPath) {
        alert(t('yingdao_export_empty'));
        return;
      }

      const { robotXmlPath, existingContent, groups, aliases } = exportResult;
      const groupCount = Object.keys(groups).length;

      if (groupCount === 0) {
        alert(t('yingdao_export_empty'));
        return;
      }

      // 使用 mergeGroupsIntoXml 将所有分组合并写入单个 xbot_robot/selectorsV2.xml
      const xmlContent = YingDao.mergeGroupsIntoXml(existingContent, groups, aliases);

      const writeResult = await window.electronAPI.writeYingdaoXml({
        xmlPath: robotXmlPath,
        content: xmlContent
      });

      if (writeResult.success) {
        alert(t('yingdao_export_success', { n: groupCount }));
      } else {
        alert(t('alert_import_failed') + ': ' + (writeResult.error || ''));
      }
    } catch (err) {
      console.error('影刀导出失败:', err);
      alert(t('alert_import_failed'));
    }
  });
}


// ========== 自定义输入对话框（替代 prompt，Electron 不支持 prompt） ==========
function showInputDialog(message, defaultValue, callback) {
  // 移除已有的对话框
  const existing = document.getElementById('custom-input-dialog');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'custom-input-dialog';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:9999;';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--pane-bg); border-radius:8px; padding:20px; min-width:300px; max-width:400px; box-shadow:0 4px 12px rgba(0,0,0,0.15);';

  const label = document.createElement('div');
  label.textContent = message;
  label.style.cssText = 'margin-bottom:12px; font-size:13px; color:var(--text-color);';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultValue || '';
  input.style.cssText = 'width:100%; padding:8px; border:1px solid var(--border-color); border-radius:4px; box-sizing:border-box; font-size:13px; background:var(--bg-color); color:var(--text-color);';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:12px;';

  const btnCancel = document.createElement('button');
  btnCancel.className = 'btn secondary';
  btnCancel.textContent = currentLang === 'zh' ? '取消' : 'Cancel';
  btnCancel.onclick = () => { overlay.remove(); callback(null); };

  const btnOk = document.createElement('button');
  btnOk.className = 'btn';
  btnOk.textContent = currentLang === 'zh' ? '确定' : 'OK';
  btnOk.onclick = () => { overlay.remove(); callback(input.value); };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnOk.click();
    if (e.key === 'Escape') btnCancel.click();
  });

  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnOk);
  dialog.appendChild(label);
  dialog.appendChild(input);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  input.focus();
  input.select();
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

// ========== 延迟初始化（确保所有 DOM 引用已就绪） ==========
loadSettings();
