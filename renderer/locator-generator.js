// locator-generator.js - 基于属性配置的定位器生成（混合流程）
// 依赖: state.js, dom-hierarchy.js, extension.js

// ========== 属性评分表 ==========
var ATTR_SCORES = {
  id: 100,
  data: 95,
  name: 90,
  type: 85,
  role: 85,
  placeholder: 80,
  className: 75,
  innerTextExact: 70,
  innerTextContains: 60,
  indexOfType: 50,
  combinedFallback: 40
};

// ========== 定位器生成（混合流程）==========
// 扩展已连接时：生成多候选 → 自动校验 → 选最优
// 未连接时：生成多候选 → 取评分最高的
function generateLocatorFromAttributes() {
    var attributeList = document.getElementById('attribute-list');
    var rows = attributeList.querySelectorAll('.attribute-row');
    var selectedAttrs = [];

    rows.forEach(function(row) {
        var checkbox = row.querySelector('input[type="checkbox"]');
        if (!checkbox || !checkbox.checked) return;

        var attrName = checkbox.dataset.attrName;
        var matchTypeEl = row.querySelector('.attribute-match-type');
        var valueInput = row.querySelector('.attribute-value');
        var value = valueInput ? valueInput.value.trim() : '';

        if (!value) return;

        selectedAttrs.push({
            name: attrName,
            matchType: matchTypeEl ? matchTypeEl.value : t('match_equals'),
            value: value
        });
    });

    // 读取 DOM 树中勾选的节点链（按 depth 排序）
    var checkedNodes = [];
    try {
      document.querySelectorAll(".dom-tree-node input[type=checkbox]:checked").forEach(function(cb) {
        var nodeEl = cb.closest(".dom-tree-node");
        if (!nodeEl) return;
        checkedNodes.push({
          tagName: nodeEl.dataset.tagName,
          depth: parseInt(nodeEl.dataset.depth) || 0
        });
      });
      checkedNodes.sort(function(a,b) { return a.depth - b.depth; });
    } catch(e) { /* 忽略 */ }

    if (selectedAttrs.length === 0 && checkedNodes.length === 0) {
        alert(t('msg_select_one_attr'));
        return;
    }

    // 生成候选列表（每个属性独立候选，按可靠性评分）
    var candidates = buildCandidateList(selectedAttrs, checkedNodes);
    if (candidates.length === 0) return;

    var pseudoFingerprint = buildFingerprintFromAttrs(selectedAttrs);

    if (extensionConnected) {
        // ===== 扩展已连接：自动校验后选最优 =====
        var requestId = Utils.uuid();
        var timeoutId = null;

        pendingValidations.set(requestId, function(results) {
            if (timeoutId) clearTimeout(timeoutId);
            if (!results || results.length === 0) {
                adoptBestCandidate(candidates[0]);
                return;
            }

            // 排序：有效(matchCount===1 + secondaryCheck.pass) > 唯一(matchCount===1) > 评分降序
            var sorted = results.slice().sort(function(a, b) {
                var aValid = a.matchCount === 1 && a.secondaryCheck && a.secondaryCheck.pass;
                var bValid = b.matchCount === 1 && b.secondaryCheck && b.secondaryCheck.pass;
                if (aValid && !bValid) return -1;
                if (!aValid && bValid) return 1;
                var aUnique = a.matchCount === 1;
                var bUnique = b.matchCount === 1;
                if (aUnique && !bUnique) return -1;
                if (!aUnique && bUnique) return 1;
                return (b.score || 0) - (a.score || 0);
            });

            var best = sorted[0];
            if (best && best.matchCount === 1) {
                adoptBestCandidate(best);
            } else {
                // 没有精确匹配的候选，用评分最高的原始候选
                adoptBestCandidate(candidates[0]);
            }
        });

        sendToExtension({
            action: 'validate_candidates',
            requestId: requestId,
            candidates: candidates,
            fingerprint: pseudoFingerprint
        });

        // 超时保护：5 秒内无响应则降级使用最佳候选
        timeoutId = setTimeout(function() {
            pendingValidations.delete(requestId);
            adoptBestCandidate(candidates[0]);
        }, 5000);
        // 响应异步到达 callback，不阻塞
    } else {
        // ===== 未连接：直接用评分最高的 =====
        adoptBestCandidate(candidates[0]);
    }
}

// 推入最佳候选到 currentCandidates 并渲染
function adoptBestCandidate(cand) {
    var finalScore = 85;
    if (cand.matchCount === 1) {
        finalScore = cand.secondaryCheck && cand.secondaryCheck.pass ? 95 : 90;
    }

    var newCandidates = [{
        type: cand.type,
        subtype: 'user-generated',
        description: t('btn_generate_locator'),
        descriptionEn: 'User generated',
        value: cand.value,
        score: finalScore
    }];

    currentCandidates = newCandidates;
    renderCandidates();
    if (currentCandidates.length > 0) {
        validateCandidate(0);
    }
}

// ========== 候选定位器列表生成 ==========
// 从勾选的属性中拆解出多个独立候选，每个候选只用一个属性，按可靠性评分
function buildCandidateList(attrs, checkedNodes) {
    var list = [];
    var tag = null;

    // 提取标签名
    attrs.forEach(function(a) {
        if (a.name === 'tagName') tag = a.value;
    });
    if (!tag && checkedNodes && checkedNodes.length > 0) {
        tag = checkedNodes[checkedNodes.length - 1].tagName;
    }

    // 为每个属性生成独立候选（每个候选只用单个属性，不拼接）
    attrs.forEach(function(attr) {
        if (attr.name === 'tagName') return; // 标签名作为前缀使用，不单独生成

        if (attr.name === 'id') {
            addUnique(list, { type: 'css', value: '#' + CSS.escape(attr.value), score: 100, reason: 'ID' });
            addUnique(list, { type: 'xpath', value: '//*[@id="' + attr.value.replace(/"/g, '\\"') + '"]', score: 100, reason: 'ID' });

        } else if (attr.name === 'className') {
            var classes = attr.value.split(/\s+/);
            var cssVal = '';
            classes.forEach(function(cls) { if (cls) cssVal += '.' + CSS.escape(cls); });
            if (tag) cssVal = tag + cssVal;
            addUnique(list, { type: 'css', value: cssVal, score: 75, reason: 'Class Name' });

        } else if (attr.name === 'innerText') {
            var escaped = attr.value.replace(/"/g, '\\"');
            var prefix = '//' + (tag || '*');
            if (attr.matchType === t('match_equals')) {
                addUnique(list, { type: 'xpath', value: prefix + '[normalize-space(text())="' + escaped + '"]', score: 70, reason: 'Exact Text' });
            } else if (attr.matchType === t('match_starts')) {
                addUnique(list, { type: 'xpath', value: prefix + '[starts-with(text(), "' + escaped + '")]', score: 65, reason: 'Starts Text' });
            }
            // 始终添加 contains 兜底
            addUnique(list, { type: 'xpath', value: prefix + '[contains(text(), "' + escaped + '")]', score: 60, reason: 'Contains Text' });

        } else if (attr.name === 'indexOfType') {
            addUnique(list, { type: 'xpath', value: '//' + (tag || '*') + '[' + attr.value + ']', score: 50, reason: 'Index of Type' });

        } else if (attr.name.startsWith('data-')) {
            var cssVal = tag ? (tag + '[' + attr.name + '="' + CSS.escape(attr.value) + '"]') : ('[' + attr.name + '="' + CSS.escape(attr.value) + '"]');
            addUnique(list, { type: 'css', value: cssVal, score: 95, reason: 'Data: ' + attr.name });

        } else if (['name', 'type', 'role', 'placeholder'].indexOf(attr.name) >= 0) {
            var label = attr.name.charAt(0).toUpperCase() + attr.name.slice(1);
            var score = ATTR_SCORES[attr.name] || 80;
            if (attr.matchType === t('match_equals')) {
                var cssVal = tag ? (tag + '[' + attr.name + '="' + CSS.escape(attr.value) + '"]') : ('[' + attr.name + '="' + CSS.escape(attr.value) + '"]');
                addUnique(list, { type: 'css', value: cssVal, score: score, reason: label });
            } else if (attr.matchType === t('match_contains')) {
                var cssVal = tag ? (tag + '[' + attr.name + '*="' + CSS.escape(attr.value) + '"]') : ('[' + attr.name + '*="' + CSS.escape(attr.value) + '"]');
                addUnique(list, { type: 'css', value: cssVal, score: score - 5, reason: label + ' (contains)' });
            } else if (attr.matchType === t('match_starts')) {
                var cssVal = tag ? (tag + '[' + attr.name + '^="' + CSS.escape(attr.value) + '"]') : ('[' + attr.name + '^="' + CSS.escape(attr.value) + '"]');
                addUnique(list, { type: 'css', value: cssVal, score: score - 5, reason: label + ' (starts-with)' });
            }
        }
    });

    // 兜底：所有属性组合的 XPath
    var combinedXpath = buildCombinedXpath(attrs, checkedNodes);
    if (combinedXpath) {
        addUnique(list, { type: 'xpath', value: combinedXpath, score: 40, reason: 'Combined Fallback' });
    }

    // 按评分降序排列（最高分的在最前面，优先被校验）
    list.sort(function(a, b) { return b.score - a.score; });
    return list;
}

function addUnique(list, item) {
    if (!list.some(function(c) { return c.value === item.value; })) {
        list.push(item);
    }
}

// ========== 从勾选的 attrs 构建伪指纹（用于二次校验）==========
function buildFingerprintFromAttrs(attrs) {
    var fp = { tagName: '', classList: [] };
    attrs.forEach(function(a) {
        if (a.name === 'tagName') fp.tagName = a.value;
        else if (a.name === 'id') fp.id = a.value;
        else if (a.name === 'className') fp.classList = a.value.split(/\s+/);
        else if (a.name === 'innerText') fp.innerText = a.value;
        else if (['name', 'type', 'role'].indexOf(a.name) >= 0) fp[a.name] = a.value;
    });
    return fp;
}

// ========== 兜底：所有属性组合的完整 XPath ==========
function buildCombinedXpath(attrs, checkedNodes) {
    var pathParts = [];
    if (checkedNodes && checkedNodes.length > 0) {
        checkedNodes.forEach(function(n) { pathParts.push(n.tagName); });
    }
    if (pathParts.length === 0) pathParts.push('*');

    var conditions = [];
    attrs.forEach(function(attr) {
        if (attr.name === 'tagName') {
            if (pathParts.length === 1 && pathParts[0] === '*') {
                pathParts[0] = attr.value;
            }
            return;
        }
        var attrName = attr.name === 'className' ? 'class' : attr.name;
        var escaped = attr.value.replace(/"/g, '\\"');

        if (attr.name === 'id') {
            conditions.push('@id="' + escaped + '"');
        } else if (attr.name === 'innerText') {
            if (attr.matchType === t('match_equals')) {
                conditions.push('normalize-space()="' + escaped + '"');
            } else if (attr.matchType === t('match_contains')) {
                conditions.push('contains(text(), "' + escaped + '")');
            } else if (attr.matchType === t('match_starts')) {
                conditions.push('starts-with(text(), "' + escaped + '")');
            } else {
                conditions.push('contains(text(), "' + escaped + '")');
            }
        } else if (attr.name === 'indexOfType') {
            conditions.push(attr.value);
        } else {
            if (attr.matchType === t('match_equals')) {
                conditions.push('@' + attrName + '="' + escaped + '"');
            } else if (attr.matchType === t('match_contains')) {
                conditions.push('contains(@' + attrName + ', "' + escaped + '")');
            } else if (attr.matchType === t('match_starts')) {
                conditions.push('starts-with(@' + attrName + ', "' + escaped + '")');
            } else {
                conditions.push('contains(@' + attrName + ', "' + escaped + '")');
            }
        }
    });

    if (conditions.length === 0) return null;
    return '//' + pathParts.join('/') + '[' + conditions.join('][') + ']';
}
