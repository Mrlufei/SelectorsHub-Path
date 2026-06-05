// saved-elements.js - 已保存元素管理与渲染
// 依赖: state.js, candidates.js, repair.js

// ========== 数据持久化 ==========
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
  var data = {
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
  var idx = savedElementsCache.findIndex(function(x) { return x.id === item.id; });
  if (idx !== -1) {
    savedElementsCache[idx] = item;
    persistData();
  }
}

function updateBulkActionState() {
  var btnMerge = document.getElementById('btn-merge-groups');
  if (btnDeleteSelected && searchInput) {
    if (selectedSavedItems.size > 0) {
      searchInput.style.display = 'none';
      btnDeleteSelected.style.display = 'block';
      btnDeleteSelected.innerText = '🗑️ 删除(' + selectedSavedItems.size + ')';
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
  var list = savedElementsCache;
  var aliases = pageAliasesCache;
  var filter = searchInput.value.toLowerCase();

  var groups = {};
  list.forEach(function(item) {
    if (filter && item.name.toLowerCase().indexOf(filter) < 0) return;
    var key = item._customGroup || (item.domain + item.path);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  savedList.innerHTML = '';
  if (list.length === 0) {
    savedList.innerHTML = '<div style="padding:10px; color:#999; font-size: 12px; text-align: center;">' + t('msg_no_saved') + '</div>';
    return;
  }

  loadParentGroups();
  var groupKeyToParent = {};
  Object.keys(parentGroupsCache).forEach(function(parentId) {
    var pg = parentGroupsCache[parentId];
    pg.children.forEach(function(gk) { groupKeyToParent[gk] = parentId; });
  });

  var parentBuckets = {};
  var orphanGroups = {};

  Object.keys(groups).forEach(function(key) {
    var parentId = groupKeyToParent[key];
    if (parentId && parentGroupsCache[parentId]) {
      if (!parentBuckets[parentId]) parentBuckets[parentId] = {};
      parentBuckets[parentId][key] = groups[key];
    } else {
      orphanGroups[key] = groups[key];
    }
  });

  Object.keys(parentBuckets).forEach(function(parentId) {
    var childGroups = parentBuckets[parentId];
    var pg = parentGroupsCache[parentId];
    var parentDiv = document.createElement('div');
    parentDiv.className = 'parent-group';
    parentDiv.style.cssText = 'margin-bottom:12px; border:1px solid var(--border-color); border-radius:6px; overflow:hidden;';

    var parentHeader = document.createElement('div');
    parentHeader.style.cssText = 'display:flex; align-items:center; background:var(--primary-color); color:white; padding:6px 10px; cursor:pointer; font-size:13px; font-weight:600;';

    var parentArrow = document.createElement('span');
    parentArrow.className = 'arrow-icon';
    parentArrow.textContent = '▼';
    parentArrow.style.cssText = 'color:white; margin-right:6px;';

    var parentName = document.createElement('span');
    parentName.textContent = pg.name;
    parentName.style.flex = '1';

    var btnParentRename = document.createElement('span');
    btnParentRename.textContent = '✏️';
    btnParentRename.style.cssText = 'cursor:pointer; margin-left:8px; font-size:12px;';
    btnParentRename.onclick = function(e) {
      e.stopPropagation();
      showInputDialog(
        currentLang === 'zh' ? '重命名父组：' : 'Rename parent group:',
        pg.name,
        function(newName) {
          if (newName && newName.trim()) {
            parentGroupsCache[parentId].name = newName.trim();
            saveParentGroups();
            loadSavedElements();
          }
        }
      );
    };

    var btnParentDisband = document.createElement('span');
    btnParentDisband.textContent = '✖';
    btnParentDisband.title = currentLang === 'zh' ? '解散父组（不删除元素）' : 'Disband group';
    btnParentDisband.style.cssText = 'cursor:pointer; margin-left:8px; font-size:12px;';
    btnParentDisband.onclick = function(e) {
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

    var parentContent = document.createElement('div');
    parentContent.style.cssText = 'padding:4px;';
    var parentExpanded = true;

    parentHeader.addEventListener('click', function() {
      parentExpanded = !parentExpanded;
      parentContent.style.display = parentExpanded ? 'block' : 'none';
      if (parentExpanded) parentArrow.classList.remove('collapsed');
      else parentArrow.classList.add('collapsed');
    });

    Object.keys(childGroups).forEach(function(key) {
      var groupDiv = renderGroup(key, childGroups[key], aliases);
      parentContent.appendChild(groupDiv);
    });

    parentDiv.appendChild(parentContent);
    savedList.appendChild(parentDiv);
  });

  Object.keys(orphanGroups).forEach(function(key) {
    var groupDiv = renderGroup(key, orphanGroups[key], aliases);
    savedList.appendChild(groupDiv);
  });

  updateBulkActionState();
}

// 渲染单个链接组
function renderGroup(key, items, aliases) {
    var groupDiv = document.createElement('div');
    groupDiv.className = 'saved-group';

    var titleContainer = document.createElement('div');
    titleContainer.className = 'group-header-container';
    titleContainer.style.cssText = 'display:flex; align-items:center; background:var(--bg-color); padding:4px 8px; border-radius:4px; margin-bottom:4px;';

    var groupCheckbox = document.createElement('input');
    groupCheckbox.type = 'checkbox';
    groupCheckbox.style.marginRight = '8px';
    groupCheckbox.addEventListener('change', function(e) {
      items.forEach(function(item) {
        if (e.target.checked) selectedSavedItems.add(item.id);
        else selectedSavedItems.delete(item.id);
      });
      updateBulkActionState();
      groupDiv.querySelectorAll('.item-checkbox').forEach(function(cb) { cb.checked = e.target.checked; });
    });

    var title = document.createElement('div');
    title.className = 'group-title';
    var displayName = aliases[key] || key;
    title.innerHTML = '<span class="arrow-icon">▼</span> ' + displayName;
    title.style.cssText = 'flex:1; cursor:pointer; margin:0; background:none;';
    title.title = t('title_expand_collapse');

    var btnRename = document.createElement('span');
    btnRename.innerText = '✏️';
    btnRename.title = t('title_rename_group');
    btnRename.style.cssText = 'cursor:pointer; font-size:12px; margin-left:8px; opacity:0.6;';
    btnRename.onclick = function(e) {
      e.stopPropagation();
      var currentName = aliases[key] || '';
      showInputDialog(t('prompt_rename'), currentName, function(newName) {
        if (newName !== null) {
          if (newName.trim() === '') delete pageAliasesCache[key];
          else pageAliasesCache[key] = newName.trim();
          persistData();
          loadSavedElements();
        }
      });
    };

    var btnValidateAll = document.createElement('span');
    btnValidateAll.innerText = '⏩';
    btnValidateAll.title = t('btn_validate_all');
    btnValidateAll.style.cssText = 'cursor:pointer; font-size:12px; margin-left:8px; opacity:0.8;';
    btnValidateAll.onclick = function(e) {
      e.stopPropagation();
      if (!extensionConnected) { alert(t('alert_connection_failed')); return; }

      var targetUrl = items[0].url;
      var urlRequestId = Utils.uuid();

      pendingValidations.set(urlRequestId, function(currentUrl) {
        var needNavigate = targetUrl && currentUrl && currentUrl.indexOf(new URL(targetUrl).origin) !== 0;

        var doValidate = function() {
          var requestId = Utils.uuid();
          var locators = items.map(function(item) { return { id: item.id, locator: item.locator }; });

          items.forEach(function(item) {
            var itemEl = document.getElementById('item-' + item.id);
            if (!itemEl) return;
            var statusTag = itemEl.querySelector('.status-tag');
            if (statusTag) { statusTag.className = 'status-tag loading'; statusTag.textContent = t('tag_validating'); }
          });

          pendingValidations.set(requestId, function(results) {
            if (!results) {
              items.forEach(function(item) {
                var itemEl = document.getElementById('item-' + item.id);
                if (!itemEl) return;
                var statusTag = itemEl.querySelector('.status-tag');
                if (statusTag) { statusTag.className = 'status-tag error'; statusTag.textContent = t('tag_error'); }
              });
              return;
            }
            var resultMap = new Map(results.map(function(r) { return [r.id, r]; }));
            items.forEach(function(item) {
              var itemEl = document.getElementById('item-' + item.id);
              if (!itemEl) return;
              var statusTag = itemEl.querySelector('.status-tag');
              var response = resultMap.get(item.id);
              statusTag.className = 'status-tag';
              if (!response) { statusTag.classList.add('error'); statusTag.textContent = t('tag_error'); return; }
              if (response.count === 1) { statusTag.classList.add('success'); statusTag.textContent = t('tag_success'); }
              else if (response.count === 0) { statusTag.classList.add('error'); statusTag.textContent = t('tag_failure'); }
              else { statusTag.classList.add('warning'); statusTag.textContent = t('tag_warning'); }
            });
          });

          sendToExtension({ action: 'validate_many', requestId: requestId, locators: locators });
        };

        if (needNavigate) {
          if (!confirm(t('confirm_page_mismatch_batch', { url: targetUrl }))) return;
          var navRequestId = Utils.uuid();
          pendingValidations.set(navRequestId, function() { doValidate(); });
          sendToExtension({ action: 'navigate', requestId: navRequestId, url: targetUrl });
        } else {
          doValidate();
        }
      });

      sendToExtension({ action: 'get_current_url', requestId: urlRequestId });
    };

    var btnDelGroup = document.createElement('span');
    btnDelGroup.innerText = '🗑️';
    btnDelGroup.title = t('title_delete_group');
    btnDelGroup.style.cssText = 'cursor:pointer; font-size:12px; margin-left:8px;';
    btnDelGroup.onclick = function(e) {
      e.stopPropagation();
      if (confirm(t('confirm_delete_group', { n: items.length }))) {
        var idsToRemove = new Set(items.map(function(i) { return i.id; }));
        savedElementsCache = savedElementsCache.filter(function(x) { return !idsToRemove.has(x.id); });
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

    var contentDiv = document.createElement('div');
    contentDiv.className = 'group-content';
    var isExpanded = true;
    title.addEventListener('click', function() {
      isExpanded = !isExpanded;
      contentDiv.style.display = isExpanded ? 'block' : 'none';
      var arrow = title.querySelector('.arrow-icon');
      if (arrow) { if (isExpanded) arrow.classList.remove('collapsed'); else arrow.classList.add('collapsed'); }
    });

    items.forEach(function(item) {
      var elDiv = document.createElement('div');
      elDiv.className = 'saved-item';
      elDiv.id = 'item-' + item.id;
      elDiv.style.cssText = 'display:flex; align-items:flex-start;';

      var itemCheckbox = document.createElement('input');
      itemCheckbox.type = 'checkbox';
      itemCheckbox.className = 'item-checkbox';
      itemCheckbox.style.cssText = 'margin-top:10px; margin-right:8px;';
      itemCheckbox.checked = selectedSavedItems.has(item.id);
      itemCheckbox.addEventListener('change', function(e) {
        if (e.target.checked) selectedSavedItems.add(item.id);
        else selectedSavedItems.delete(item.id);
        updateBulkActionState();
        var allChecked = Array.from(groupDiv.querySelectorAll('.item-checkbox')).every(function(cb) { return cb.checked; });
        groupCheckbox.checked = allChecked;
      });

      var itemContent = document.createElement('div');
      itemContent.style.flex = '1';

      var header = document.createElement('div');
      header.className = 'saved-item-header';
      var nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;
      var actionsSpan = document.createElement('span');
      actionsSpan.className = 'saved-item-actions';
      var statusTag = document.createElement('span');
      statusTag.className = 'status-tag';

      var btnValidate = document.createElement('span');
      btnValidate.innerText = t('btn_validate');
      btnValidate.className = 'btn-text';
      btnValidate.onclick = function(e) {
        e.stopPropagation();
        if (!extensionConnected) { alert(t('alert_connection_failed')); return; }
        statusTag.className = 'status-tag loading';
        statusTag.textContent = t('tag_validating');
        var requestId = Utils.uuid();
        pendingValidations.set(requestId, function(response) {
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
        sendToExtension({ action: 'validate', requestId: requestId, locator: item.locator, fingerprint: item.fingerprint, collectFingerprint: !item.fingerprint });
      };

      var btnCopy = document.createElement('span');
      btnCopy.innerText = t('btn_copy');
      btnCopy.className = 'btn-text';
      btnCopy.style.marginLeft = '4px';
      btnCopy.onclick = function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(item.locator.value);
        var orig = btnCopy.innerText;
        btnCopy.innerText = t('btn_copied');
        setTimeout(function() { btnCopy.innerText = orig; }, 1000);
      };

      var btnRepair = document.createElement('span');
      btnRepair.innerText = t('btn_repair');
      btnRepair.className = 'btn-text';
      btnRepair.style.marginLeft = '4px';
      btnRepair.onclick = function(e) {
        e.stopPropagation();
        handleValidationFailure(item, itemContent);
      };

      actionsSpan.appendChild(statusTag);
      actionsSpan.appendChild(btnValidate);
      actionsSpan.appendChild(btnCopy);
      actionsSpan.appendChild(btnRepair);
      header.appendChild(nameSpan);
      header.appendChild(actionsSpan);

      var loc = document.createElement('div');
      loc.className = 'saved-item-loc';
      var typeTagEl = document.createElement('span');
      typeTagEl.className = 'type-tag type-' + item.locator.type;
      typeTagEl.style.cssText = 'margin-right:6px; font-size:9px;';
      typeTagEl.textContent = item.locator.type;
      var locValue = document.createElement('span');
      locValue.textContent = item.locator.value;
      loc.appendChild(typeTagEl);
      loc.appendChild(locValue);

      itemContent.appendChild(header);
      itemContent.appendChild(loc);

      itemContent.addEventListener('click', function() {
        sendToExtension({ action: 'validate', requestId: Utils.uuid(), locator: item.locator });
      });

      elDiv.appendChild(itemCheckbox);
      elDiv.appendChild(itemContent);
      contentDiv.appendChild(elDiv);
    });

    groupDiv.appendChild(contentDiv);
    return groupDiv;
}
