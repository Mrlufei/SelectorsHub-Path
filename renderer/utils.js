// utils.js - 工具函数（桌面端版本，与原插件共享核心逻辑）
var Utils = window.Utils || {
  uuid: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  // 类名稳定性判断
  isStableClass: (cls) => {
    if (!cls) return false;
    if (cls.length > 25) return false;
    if (/\d{3,}/.test(cls)) return false;
    if (/[-_]{2,}/.test(cls)) return false;
    if (/^[a-z0-9]{5,}$/i.test(cls)) return false;
    const unstablePatterns = [/css-\w+/, /s-\w+/, /react-/, /ng-/, /vue-/];
    if (unstablePatterns.some(p => p.test(cls))) return false;
    return true;
  },

  // 指纹采集（由扩展端执行，这里保留定义供参考）
  getFingerprint: (el) => {
    const fp = {
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.name || null,
      type: el.type || null,
      role: el.getAttribute('role') || null,
      innerText: (el.innerText || "").trim().substring(0, 50),
      attributes: {}
    };
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
        fp.attributes[attr.name] = attr.value;
      }
    });
    const classes = Array.from(el.classList).filter(Utils.isStableClass);
    if (classes.length > 0) fp.classList = classes;
    return fp;
  },

  getAncestorChain: (el) => {
    const chain = [];
    let curr = el.parentElement;
    let depth = 0;
    while (curr && curr.tagName !== 'BODY' && depth < 4) {
      const info = {
        tagName: curr.tagName.toLowerCase(),
        id: curr.id,
        role: curr.getAttribute('role'),
        index: Array.from(curr.parentElement ? curr.parentElement.children : []).filter(c => c.tagName === curr.tagName).indexOf(curr) + 1
      };
      Array.from(curr.attributes).forEach(attr => {
        if (attr.name.startsWith('data-testid') || attr.name.startsWith('data-id')) {
          if (!info.stableAttr) info.stableAttr = {};
          info.stableAttr[attr.name] = attr.value;
        }
      });
      chain.push(info);
      curr = curr.parentElement;
      depth++;
    }
    return chain;
  },

  // --- Optimization: Dynamic Depth & Smart Pruning ---
  getDynamicDepth: (element) => {
    const tagName = element.tagName ? element.tagName.toLowerCase() : '';
    if (['table', 'ul', 'ol', 'tbody', 'tr'].includes(tagName)) return 30;
    if (['input', 'button', 'select', 'textarea'].includes(tagName)) return 10;
    if (['a', 'span', 'label'].includes(tagName)) return 15;
    return 20;
  },

  shouldPrune: (element) => {
    if (!element || !element.tagName) return true;
    const tagName = element.tagName.toLowerCase();
    const pruneTags = ['html', 'body', '#document', 'head'];
    if (pruneTags.includes(tagName)) return true;
    if (['div', 'span', 'section', 'article'].includes(tagName)) {
      const hasMeaningfulAttrs =
        element.id ||
        element.getAttribute('role') ||
        element.getAttribute('data-testid') ||
        element.getAttribute('data-id') ||
        element.getAttribute('aria-label');
      if (!hasMeaningfulAttrs) {
        const className = element.className || '';
        if (!className || className.length > 30) return true;
      }
    }
    return false;
  },

  getAncestorChainOptimized: (el, options = {}) => {
    const {
      maxDepth = Utils.getDynamicDepth(el),
      enablePruning = true,
      includeAllLevels = false
    } = options;
    const chain = [];
    let curr = el.parentElement;
    let depth = 0;
    while (curr && curr.tagName !== 'BODY' && depth < maxDepth) {
      if (enablePruning && Utils.shouldPrune(curr)) {
        curr = curr.parentElement;
        depth++;
        continue;
      }
      const siblings = Array.from(curr.parentElement ? curr.parentElement.children : [])
        .filter(c => c.tagName === curr.tagName);
      const index = siblings.indexOf(curr) + 1;
      const info = {
        tagName: curr.tagName.toLowerCase(),
        id: curr.id || null,
        role: curr.getAttribute('role') || null,
        index: index,
        depth: depth,
        className: curr.className || null
      };
      const stableAttrs = {};
      Array.from(curr.attributes).forEach(attr => {
        if (attr.name.startsWith('data-testid') ||
            attr.name.startsWith('data-id') ||
            attr.name.startsWith('data-cy') ||
            attr.name.startsWith('data-qa')) {
          stableAttrs[attr.name] = attr.value;
        }
      });
      if (Object.keys(stableAttrs).length > 0) {
        info.stableAttr = stableAttrs;
      }
      chain.push(info);
      curr = curr.parentElement;
      depth++;
    }
    return chain.reverse();
  },

  // --- Feature Cache & Extraction ---
  _featureCache: new WeakMap(),

  extractFeatures: (element, useCache = true) => {
    if (useCache && Utils._featureCache.has(element)) {
      return Utils._featureCache.get(element);
    }
    const features = {
      tagName: element.tagName.toLowerCase(),
      className: element.className ? element.className.split(/\s+/).filter(c => c).sort() : [],
      id: element.id || null,
      role: element.getAttribute('role') || null,
      type: element.getAttribute('type') || null,
      name: element.getAttribute('name') || null,
      placeholder: element.getAttribute('placeholder') || null,
      depth: Utils._getElementDepth(element),
      childCount: element.children.length,
      hasText: !!(element.textContent && element.textContent.trim()),
      textLength: element.textContent ? element.textContent.trim().length : 0,
      attributes: {}
    };
    Array.from(element.attributes).forEach(attr => {
      if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
        features.attributes[attr.name] = attr.value;
      }
    });
    if (useCache) {
      Utils._featureCache.set(element, features);
    }
    return features;
  },

  _getElementDepth: (element) => {
    let depth = 0;
    let curr = element;
    while (curr && curr.tagName !== 'BODY') {
      depth++;
      curr = curr.parentElement;
    }
    return depth;
  },

  clearFeatureCache: () => {
    Utils._featureCache = new WeakMap();
  },

  // 修复候选生成
  generateRepairCandidates: (fingerprint, ancestorChain) => {
    const candidates = [];
    const add = (type, value, score, reason) => {
      if (!candidates.some(c => c.value === value)) {
        candidates.push({ type, value, score, reason });
      }
    };
    const tag = fingerprint.tagName;

    if (fingerprint.id && Utils.isStableClass(fingerprint.id)) {
      add('css', `#${CSS.escape(fingerprint.id)}`, 100, 'Stable ID');
      add('xpath', `//*[@id="${fingerprint.id}"]`, 100, 'Stable ID');
    }
    if (fingerprint.name) {
      add('css', `${tag}[name="${CSS.escape(fingerprint.name)}"]`, 90, 'Name Attribute');
    }
    Object.keys(fingerprint.attributes).forEach(attr => {
      const val = fingerprint.attributes[attr];
      add('css', `${tag}[${attr}="${CSS.escape(val)}"]`, 95, `Stable Attribute: ${attr}`);
    });
    if (fingerprint.innerText && fingerprint.innerText.length <= 20 && !/^\d+$/.test(fingerprint.innerText)) {
      const txt = fingerprint.innerText.replace(/"/g, '\\"');
      add('xpath', `//${tag}[normalize-space(text())="${txt}"]`, 70, 'Exact Text Match');
      add('xpath', `//${tag}[contains(text(), "${txt}")]`, 60, 'Contains Text');
    }
    if (fingerprint.classList && fingerprint.classList.length > 0) {
      const clsSelector = '.' + fingerprint.classList.map(c => CSS.escape(c)).join('.');
      add('css', `${tag}${clsSelector}`, 75, 'Tag + Stable Classes');
    }
    ancestorChain.forEach((anc, idx) => {
      let ancestorSelector = null;
      let ancestorReason = '';
      if (anc.id && Utils.isStableClass(anc.id)) {
        ancestorSelector = `#${CSS.escape(anc.id)}`;
        ancestorReason = `Ancestor ID (#${anc.id})`;
      } else if (anc.stableAttr) {
        const k = Object.keys(anc.stableAttr)[0];
        ancestorSelector = `${anc.tagName}[${k}="${CSS.escape(anc.stableAttr[k])}"]`;
        ancestorReason = `Ancestor Attr (${k})`;
      }
      if (ancestorSelector) {
        add('css', `${ancestorSelector} ${tag}`, 80 - idx * 5, `${ancestorReason} > Target`);
        if (fingerprint.innerText && fingerprint.innerText.length <= 20) {
          add('xpath', `//${anc.tagName}[@id="${anc.id}"]//${tag}[contains(text(), "${fingerprint.innerText}")]`, 75 - idx * 5, `${ancestorReason} + Text`);
        }
      }
    });
    return candidates.sort((a, b) => b.score - a.score);
  },

  // 二次校验
  checkSecondaryMatch: (element, fingerprint) => {
    if (!element || !fingerprint) return { pass: false, reason: 'No element or fingerprint' };
    if (element.tagName.toLowerCase() !== fingerprint.tagName) {
      return { pass: false, reason: `Tag mismatch: found ${element.tagName}, expected ${fingerprint.tagName}` };
    }
    const checks = ['name', 'type', 'role'];
    for (const attr of checks) {
      if (fingerprint[attr]) {
        const val = element.getAttribute(attr) || element[attr];
        if (val !== fingerprint[attr]) return { pass: false, reason: `${attr} mismatch` };
      }
    }
    if (fingerprint.innerText) {
      const currentText = (element.innerText || "").trim();
      const similarity = Utils.similarity(currentText, fingerprint.innerText);
      if (similarity < 0.5 && !currentText.includes(fingerprint.innerText) && !fingerprint.innerText.includes(currentText)) {
        return { pass: false, reason: `Text mismatch (${Math.round(similarity * 100)}% match)` };
      }
    }
    return { pass: true };
  },

  // --- Structural Similarity ---
  calculateSimilarity: (features1, features2) => {
    let score = 0;
    let maxScore = 0;
    maxScore += 30;
    if (features1.tagName === features2.tagName) score += 30;
    maxScore += 25;
    if (features1.className.length > 0 && features2.className.length > 0) {
      const commonClasses = features1.className.filter(c => features2.className.includes(c));
      score += 25 * (commonClasses.length / Math.max(features1.className.length, features2.className.length));
    } else if (features1.className.length === 0 && features2.className.length === 0) {
      score += 25;
    }
    maxScore += 20;
    if (features1.role && features2.role && features1.role === features2.role) score += 10;
    if (features1.type && features2.type && features1.type === features2.type) score += 10;
    maxScore += 15;
    if (Math.abs(features1.depth - features2.depth) <= 2) score += 8;
    if (Math.abs(features1.childCount - features2.childCount) <= 1) score += 7;
    maxScore += 10;
    if (features1.hasText === features2.hasText) score += 5;
    if (features1.textLength > 0 && features2.textLength > 0) {
      const lengthSimilarity = 1 - Math.abs(features1.textLength - features2.textLength) / Math.max(features1.textLength, features2.textLength);
      score += 5 * lengthSimilarity;
    }
    return maxScore > 0 ? score / maxScore : 0;
  },

  findSimilarElements: (element, threshold = 0.7, batchSize = 100) => {
    if (!element || !element.parentElement) return [];
    const targetFeatures = Utils.extractFeatures(element);
    const similar = [];
    const siblings = Array.from(element.parentElement.children);
    const limit = Math.min(siblings.length, batchSize);
    for (let i = 0; i < limit; i++) {
      const sibling = siblings[i];
      if (sibling === element) continue;
      const rect = sibling.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const siblingFeatures = Utils.extractFeatures(sibling);
      const similarity = Utils.calculateSimilarity(targetFeatures, siblingFeatures);
      if (similarity >= threshold) {
        similar.push({ element: sibling, similarity: similarity, features: siblingFeatures });
      }
    }
    return similar.sort((a, b) => b.similarity - a.similarity);
  },

  similarity: (s1, s2) => {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;
    return (longer.length - Utils.editDistance(longer, shorter)) / parseFloat(longer.length);
  },

  editDistance: (s1, s2) => {
    const track = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(null));
    for (let i = 0; i <= s1.length; i++) track[0][i] = i;
    for (let j = 0; j <= s2.length; j++) track[j][0] = j;
    for (let j = 1; j <= s2.length; j++) {
      for (let i = 1; i <= s1.length; i++) {
        const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(track[j][i - 1] + 1, track[j - 1][i] + 1, track[j - 1][i - 1] + indicator);
      }
    }
    return track[s2.length][s1.length];
  }
};
