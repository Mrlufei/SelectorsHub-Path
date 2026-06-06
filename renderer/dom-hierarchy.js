// dom-hierarchy.js - DOM 层级树展示与属性编辑器
// 依赖: state.js

// ========== 元素拾取处理 ==========
function handleElementPicked(payload) {
  currentElementInfo = payload;
  currentCandidates = payload.candidates;
  btnPick.innerText = t('btn_pick');
  btnPick.disabled = !extensionConnected;

  infoCollapse.expand();
  candidatesCollapse.expand();

  infoTag.value = payload.tagName;
  infoId.value = payload.id || '';
  infoClass.value = payload.className || '';
  infoName.value = payload.name || '';
  infoText.value = payload.innerText || '';

  elementNameInput.value = payload.innerText ?
    payload.innerText.substring(0, 20) :
    (payload.id ? payload.tagName + '#' + payload.id : payload.tagName);

  // DOM 层级树渲染
  renderDomHierarchy(payload);

  renderCandidates();
  if (currentCandidates.length > 0) {
    validateCandidate(0);
  }
}

// ========== DOM 层级树渲染 ==========
function renderDomHierarchy(payload) {
    var pane = document.getElementById('dom-hierarchy-pane');
    var container = document.getElementById('dom-tree-container');
    var attributeEditor = document.getElementById('attribute-editor');

    if (!payload.ancestorChain || payload.ancestorChain.length === 0) {
        pane.style.display = 'none';
        return;
    }

    pane.style.display = 'block';
    container.innerHTML = '';

    payload.ancestorChain.forEach(function(ancestor, index) {
        var nodeEl = createDomTreeNode(ancestor, index, false);
        container.appendChild(nodeEl);
    });

    var targetNodeEl = createDomTreeNode({
        tagName: payload.tagName.toLowerCase(),
        id: payload.id || '',
        className: payload.className || '',
        index: 1,
        depth: payload.ancestorChain.length,
        innerText: payload.innerText || ''
    }, payload.ancestorChain.length, true);
    container.appendChild(targetNodeEl);

    attributeEditor.style.display = 'block';
    renderAttributeEditor(payload);
}

function createDomTreeNode(nodeData, depth, isTarget) {
    var nodeEl = document.createElement('div');
    nodeEl.className = 'dom-tree-node' + (isTarget ? ' target-element' : '');
    nodeEl.dataset.depth = depth;
    nodeEl.dataset.tagName = nodeData.tagName;
    // 存储节点数据供点击时使用
    nodeEl._nodeData = nodeData;
    nodeEl._isTarget = isTarget;

    var indent = document.createTextNode('  '.repeat(depth));
    nodeEl.appendChild(indent);

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'dom-tree-checkbox';
    checkbox.checked = isTarget;

    var tagSpan = document.createElement('span');
    tagSpan.className = 'dom-tree-tag';
    tagSpan.textContent = '<' + nodeData.tagName;

    var attrParts = [];
    if (nodeData.id) {
        var idKey = document.createElement('span');
        idKey.className = 'attr-key';
        idKey.textContent = ' id=';
        var idValue = document.createElement('span');
        idValue.className = 'attr-value';
        idValue.textContent = '"' + nodeData.id + '"';
        attrParts.push(idKey);
        attrParts.push(idValue);
    }
    if (nodeData.className) {
        var classKey = document.createElement('span');
        classKey.className = 'attr-key';
        classKey.textContent = ' class=';
        var classes = nodeData.className.split(' ').slice(0, 2);
        var classValue = document.createElement('span');
        classValue.className = 'attr-value';
        classValue.textContent = '"' + classes.join(' ') + (nodeData.className.split(' ').length > 2 ? '...' : '') + '"';
        attrParts.push(classKey);
        attrParts.push(classValue);
    }
    if (nodeData.role) {
        var roleKey = document.createElement('span');
        roleKey.className = 'attr-key';
        roleKey.textContent = ' role=';
        var roleValue = document.createElement('span');
        roleValue.className = 'attr-value';
        roleValue.textContent = '"' + nodeData.role + '"';
        attrParts.push(roleKey);
        attrParts.push(roleValue);
    }

    var attrSpan = document.createElement('span');
    attrSpan.className = 'dom-tree-attr';
    
    // 将属性键值对追加到 attrSpan
    attrParts.forEach(function(part) {
        attrSpan.appendChild(part);
    });

    var closeSpan = document.createElement('span');
    closeSpan.className = 'dom-tree-tag';
    closeSpan.textContent = '>';

    nodeEl.appendChild(checkbox);
    nodeEl.appendChild(tagSpan);
    nodeEl.appendChild(attrSpan);
    nodeEl.appendChild(closeSpan);

    if (nodeData.innerText && nodeData.innerText.length > 0) {
        var textSpan = document.createElement('span');
        textSpan.className = 'dom-tree-text';
        textSpan.textContent = '"' + nodeData.innerText.substring(0, 30) + (nodeData.innerText.length > 30 ? '...' : '') + '"';
        nodeEl.appendChild(textSpan);
    }

    nodeEl.addEventListener('click', function(e) {
        if (e.target.type === 'checkbox') return;
        
        // 移除所有节点的选中状态
        document.querySelectorAll('.dom-tree-node').forEach(function(n) { 
            n.classList.remove('selected'); 
        });
        
        // 添加当前节点的选中状态
        nodeEl.classList.add('selected');
        
        // 确保属性编辑器可见
        var attributeEditor = document.getElementById('attribute-editor');
        attributeEditor.style.display = 'block';
        
        // 更新属性编辑器显示当前节点的属性
        renderNodeAttributes(nodeEl._nodeData, nodeEl._isTarget);
    });

    return nodeEl;
}

// ========== 属性编辑器 ==========
function renderAttributeEditor(payload) {
    var attributeList = document.getElementById('attribute-list');
    var targetAttrs = payload.targetAttributes;

    if (!targetAttrs) {
        attributeList.innerHTML = '<div style="color:#999;text-align:center;padding:20px;">' + t('msg_no_fingerprint') + '</div>';
        return;
    }

    attributeList.innerHTML = '';

    var editableAttrs = [
        { name: 'tagName', label: t('label_attr_tagName'), type: 'text' },
        { name: 'id', label: t('label_attr_id'), type: 'text' },
        { name: 'className', label: t('label_attr_className'), type: 'text' },
        { name: 'name', label: t('label_attr_name'), type: 'text' },
        { name: 'type', label: t('label_attr_type'), type: 'text' },
        { name: 'role', label: t('label_attr_role'), type: 'text' },
        { name: 'placeholder', label: t('label_attr_placeholder'), type: 'text' },
        { name: 'innerText', label: t('label_attr_innerText'), type: 'textarea' },
        { name: 'indexOfType', label: t('label_attr_indexOfType'), type: 'number' }
    ];

    editableAttrs.forEach(function(attr) {
        var row = createAttributeRow(attr, targetAttrs);
        attributeList.appendChild(row);
    });

    if (targetAttrs.dataAttributes && targetAttrs.dataAttributes.length > 0) {
        var sep = document.createElement('div');
        sep.style.cssText = 'padding:8px 0;font-weight:600;color:#8c8c8c;font-size:12px;';
        sep.textContent = t('label_attr_data');
        attributeList.appendChild(sep);

        targetAttrs.dataAttributes.forEach(function(dataAttr) {
            var row = createAttributeRow({
                name: dataAttr.name,
                label: dataAttr.name,
                type: 'text'
            }, targetAttrs, dataAttr.value);
            attributeList.appendChild(row);
        });
    }
}

function createAttributeRow(attr, targetAttrs, overrideValue) {
    var row = document.createElement('div');
    row.className = 'attribute-row';

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    var val = overrideValue || (targetAttrs[attr.name] !== undefined ? targetAttrs[attr.name] : '');
    checkbox.checked = val !== '' && val !== undefined;
    checkbox.dataset.attrName = attr.name;

    var nameSpan = document.createElement('span');
    nameSpan.className = 'attribute-name';
    nameSpan.textContent = attr.label;

    var matchType = document.createElement('select');
    matchType.className = 'attribute-match-type';
    matchType.dataset.attrName = attr.name;
    var matchOptions = attr.name === 'innerText' ?
        [t('match_equals'), t('match_contains'), t('match_starts')] :
        [t('match_equals'), t('match_contains'), t('match_starts'), t('match_regex')];
    matchOptions.forEach(function(option) {
        var opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        if (option === t('match_equals')) opt.selected = true;
        matchType.appendChild(opt);
    });

    var valueInput;
    if (attr.type === 'textarea') {
        valueInput = document.createElement('textarea');
        valueInput.rows = 2;
    } else if (attr.type === 'number') {
        valueInput = document.createElement('input');
        valueInput.type = 'number';
        if (attr.name === 'indexOfType') valueInput.min = 1;
    } else {
        valueInput = document.createElement('input');
        valueInput.type = 'text';
    }
    valueInput.className = 'attribute-value';
    valueInput.dataset.attrName = attr.name;
    valueInput.value = val !== null && val !== undefined ? String(val) : '';
    valueInput.disabled = !checkbox.checked;

    checkbox.addEventListener('change', function() {
        valueInput.disabled = !checkbox.checked;
    });

    row.appendChild(checkbox);
    row.appendChild(nameSpan);
    row.appendChild(matchType);
    row.appendChild(valueInput);
    var emptyCell = document.createElement('span');
    emptyCell.style.cssText = 'font-size:11px;color:#ccc;text-align:center;';
    row.appendChild(emptyCell);

    return row;
}

// ========== 显示节点属性（支持任意节点） ==========
function renderNodeAttributes(nodeData, isTarget) {
    var attributeList = document.getElementById('attribute-list');
    
    // 构建节点属性对象
    var nodeAttrs = {
        tagName: nodeData.tagName || '',
        id: nodeData.id || '',
        className: nodeData.className || '',
        name: nodeData.name || '',
        type: nodeData.type || '',
        role: nodeData.role || '',
        placeholder: nodeData.placeholder || '',
        innerText: nodeData.innerText || '',
        indexOfType: nodeData.index || 1
    };
    
    // 如果有 dataAttributes，也加入
    if (nodeData.dataAttributes) {
        nodeAttrs.dataAttributes = nodeData.dataAttributes;
    }
    
    if (isTarget && currentElementInfo && currentElementInfo.targetAttributes) {
        // 目标元素：使用完整的 targetAttributes
        renderAttributeEditor(currentElementInfo);
    } else {
        // 非目标节点：显示该节点的基本属性
        attributeList.innerHTML = '';
        
        var editableAttrs = [
            { name: 'tagName', label: t('label_attr_tagName'), type: 'text' },
            { name: 'id', label: t('label_attr_id'), type: 'text' },
            { name: 'className', label: t('label_attr_className'), type: 'text' },
            { name: 'name', label: t('label_attr_name'), type: 'text' },
            { name: 'type', label: t('label_attr_type'), type: 'text' },
            { name: 'role', label: t('label_attr_role'), type: 'text' },
            { name: 'placeholder', label: t('label_attr_placeholder'), type: 'text' },
            { name: 'innerText', label: t('label_attr_innerText'), type: 'textarea' },
            { name: 'indexOfType', label: t('label_attr_indexOfType'), type: 'number' }
        ];
        
        editableAttrs.forEach(function(attr) {
            var row = createAttributeRow(attr, nodeAttrs);
            attributeList.appendChild(row);
        });
        
        // 显示提示信息
        var hint = document.createElement('div');
        hint.style.cssText = 'padding:8px;color:#8c8c8c;font-size:11px;text-align:center;margin-top:8px;';
        hint.textContent = isTarget ? '' : '（祖先节点属性仅供参考，无法用于生成定位器）';
        attributeList.appendChild(hint);
    }
}


