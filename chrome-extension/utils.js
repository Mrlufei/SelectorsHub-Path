var Utils = window.Utils || {
  uuid: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  // --- Heuristics: Class 过滤 ---
  isStableClass: (cls) => {
      if (!cls) return false;
      if (cls.length > 25) return false; // 太长通常是生成的
      if (/\d{3,}/.test(cls)) return false; // 包含连续3个以上数字
      if (/[-_]{2,}/.test(cls)) return false; // 包含 -- 或 __
      if (/^[a-z0-9]{5,}$/i.test(cls)) return false; // 纯随机字符像 hash
      // 常见框架的不稳定前缀/后缀
      const unstablePatterns = [/css-\w+/, /s-\w+/, /react-/, /ng-/, /vue-/];
      if (unstablePatterns.some(p => p.test(cls))) return false;
      return true;
  },

  // --- Data Collection: 指纹与祖先 ---
  getFingerprint: (el) => {
      const fp = {
          tagName: el.tagName.toLowerCase(),
          id: el.id || null,
          name: el.name || null,
          type: el.type || null,
          role: el.getAttribute('role') || null,
          innerText: (el.innerText || "").trim().substring(0, 50), // 截断
          attributes: {}
      };
      
      // 收集稳定属性 data-*, aria-*
      Array.from(el.attributes).forEach(attr => {
          if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
              fp.attributes[attr.name] = attr.value;
          }
      });

      // 过滤 Class
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
              // 计算 index-of-type
              index: Array.from(curr.parentElement ? curr.parentElement.children : []).filter(c => c.tagName === curr.tagName).indexOf(curr) + 1
          };
          
          // 收集稳定 data 属性作为锚点依据
          Array.from(curr.attributes).forEach(attr => {
              if (attr.name.startsWith('data-testid') || attr.name.startsWith('data-id')) {
                  if(!info.stableAttr) info.stableAttr = {};
                  info.stableAttr[attr.name] = attr.value;
              }
          });

          chain.push(info);
          curr = curr.parentElement;
          depth++;
      }
      return chain;
  },

  // --- Repair: 候选生成 ---
  generateRepairCandidates: (fingerprint, ancestorChain) => {
      const candidates = [];
      const add = (type, value, score, reason) => {
          // 简单去重
          if (!candidates.some(c => c.value === value)) {
              candidates.push({ type, value, score, reason });
          }
      };

      const tag = fingerprint.tagName;

      // 1. 单属性候选 (Score: 80-100)
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

      // 2. 文本候选 (Score: 60-70)
      // 只有文本短且不是纯数字时才用
      if (fingerprint.innerText && fingerprint.innerText.length <= 20 && !/^\d+$/.test(fingerprint.innerText)) {
          const txt = fingerprint.innerText.replace(/"/g, '\\"');
          add('xpath', `//${tag}[normalize-space(text())="${txt}"]`, 70, 'Exact Text Match');
          add('xpath', `//${tag}[contains(text(), "${txt}")]`, 60, 'Contains Text');
      }

      // 3. 组合属性 (Score: 75)
      // 比如 tag + class (filtered)
      if (fingerprint.classList && fingerprint.classList.length > 0) {
          const clsSelector = '.' + fingerprint.classList.map(c => CSS.escape(c)).join('.');
          add('css', `${tag}${clsSelector}`, 75, 'Tag + Stable Classes');
      }

      // 4. 上下文锚点 (Score: 50-80)
      ancestorChain.forEach((anc, idx) => {
          // 找一个有强特征的祖先
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
              // CSS: Ancestor descendent
              add('css', `${ancestorSelector} ${tag}`, 80 - idx * 5, `${ancestorReason} > Target`);
              
              // XPath with text
              if (fingerprint.innerText && fingerprint.innerText.length <= 20) {
                   add('xpath', `//${anc.tagName}[@id="${anc.id}"]//${tag}[contains(text(), "${fingerprint.innerText}")]`, 75 - idx*5, `${ancestorReason} + Text`);
              }
          }
      });

      return candidates.sort((a, b) => b.score - a.score);
  },

  // --- Guardrails: 二次校验 ---
  checkSecondaryMatch: (element, fingerprint) => {
      if (!element || !fingerprint) return { pass: false, reason: 'No element or fingerprint' };
      
      // 1. Tag Check
      if (element.tagName.toLowerCase() !== fingerprint.tagName) {
          return { pass: false, reason: `Tag mismatch: found ${element.tagName}, expected ${fingerprint.tagName}` };
      }

      // 2. Critical Attr Check (Name, Role, Type)
      const checks = ['name', 'type', 'role'];
      for (const attr of checks) {
          if (fingerprint[attr]) {
              const val = element.getAttribute(attr) || element[attr];
              if (val !== fingerprint[attr]) {
                  // 允许包含关系？暂时严格一点
                  return { pass: false, reason: `${attr} mismatch` };
              }
          }
      }

      // 3. Text Check (Loose)
      if (fingerprint.innerText) {
          const currentText = (element.innerText || "").trim();
          const similarity = Utils.similarity(currentText, fingerprint.innerText);
          if (similarity < 0.5 && !currentText.includes(fingerprint.innerText) && !fingerprint.innerText.includes(currentText)) {
              return { pass: false, reason: `Text mismatch (${Math.round(similarity*100)}% match)` };
          }
      }

      return { pass: true };
  },

  // 简单的文本相似度 (Levenshtein based or simple intersection)
  similarity: (s1, s2) => {
      if (!s1 || !s2) return 0;
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      if (longer.length === 0) return 1.0;
      return (longer.length - Utils.editDistance(longer, shorter)) / parseFloat(longer.length);
  },
  
  editDistance: (s1, s2) => {
      // 简化版 Levenshtein
      const track = Array(s2.length + 1).fill(null).map(() =>
      Array(s1.length + 1).fill(null));
      for (let i = 0; i <= s1.length; i += 1) {
         track[0][i] = i;
      }
      for (let j = 0; j <= s2.length; j += 1) {
         track[j][0] = j;
      }
      for (let j = 1; j <= s2.length; j += 1) {
         for (let i = 1; i <= s1.length; i += 1) {
            const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
            track[j][i] = Math.min(
               track[j][i - 1] + 1,
               track[j - 1][i] + 1,
               track[j - 1][i - 1] + indicator,
            );
         }
      }
      return track[s2.length][s1.length];
  },

  // 生成 CSS 选择器
  generateCssSelectors: (element) => {
    const candidates = [];
    
    // 1. ID
    if (element.id) {
      candidates.push({
        type: 'css',
        subtype: 'id-based',
        description: 'ID选择器',
        descriptionEn: 'ID selector',
        value: `#${CSS.escape(element.id)}`,
        score: 100
      });
    }

    // 2. 常用稳定属性
    const stableAttrs = ['name', 'data-testid', 'data-id', 'data-cy', 'role', 'aria-label', 'placeholder'];
    stableAttrs.forEach(attr => {
      if (element.hasAttribute(attr)) {
        candidates.push({
          type: 'css',
          subtype: 'attribute-based',
          description: `属性选择器 (${attr})`,
          descriptionEn: `Attribute (${attr})`,
          value: `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(element.getAttribute(attr))}"]`,
          score: 90
        });
      }
    });

    // 3. Class (避免太通用的 class)
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        // 尝试组合所有 class
        const classSelector = '.' + classes.map(c => CSS.escape(c)).join('.');
        candidates.push({
          type: 'css',
          subtype: 'class-based',
          description: 'Class选择器',
          descriptionEn: 'Class selector',
          value: `${element.tagName.toLowerCase()}${classSelector}`,
          score: 80
        });
      }
    }

    // 4. 层级路径 (作为备选)
    let path = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break; // 遇到 ID 就停止向上
      } else {
        let sibling = current;
        let nth = 1;
        while (sibling = sibling.previousElementSibling) {
          if (sibling.tagName === current.tagName) nth++;
        }
        if (nth > 1) selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      current = current.parentNode;
      if (current && current.tagName === 'BODY') break; // 避免太长
    }
    candidates.push({
      type: 'css',
      subtype: 'hierarchy-path',
      description: '层级路径',
      descriptionEn: 'Hierarchy path',
      value: path.join(' > '),
      score: 60
    });

    return candidates;
  },

  // 生成 XPath
  generateXPaths: (element) => {
    const candidates = [];

    // 1. ID
    if (element.id) {
      candidates.push({
        type: 'xpath',
        subtype: 'id-based',
        description: 'ID定位',
        descriptionEn: 'ID-based',
        value: `//*[@id="${element.id}"]`,
        score: 100
      });
    }

    // 2. 文本内容 (优化：处理引号、空白字符、使用 contains)
    const text = element.innerText ? element.innerText.trim() : '';
    if (text && text.length < 50) {
      // 辅助函数：生成安全的 XPath 字符串
      const escapeXPathString = (str) => {
        if (!str.includes("'")) return `'${str}'`;
        if (!str.includes('"')) return `"${str}"`;
        // 如果同时包含单双引号，使用 concat
        return "concat('" + str.replace(/'/g, "', \"'\", '") + "')";
      };

      const safeText = escapeXPathString(text);
      
      // 方案 A: normalize-space 精确匹配 (适合文本较短且确定的情况)
      // candidates.push({
      //   type: 'xpath',
      //   value: `//${element.tagName.toLowerCase()}[normalize-space(text())=${safeText}]`,
      //   score: 85
      // });

      // 方案 B: contains 模糊匹配 (容错率更高，但可能匹配到父元素，需结合 tagName)
      // 如果文本包含单引号，concat 后的字符串不能直接拼接到 contains 中
      // 所以如果包含单引号，我们简化处理，或者只取前一部分文本
      
      if (!text.includes("'") && !text.includes('"')) {
          candidates.push({
            type: 'xpath',
            subtype: 'text-contains',
            description: '文本包含匹配',
            descriptionEn: 'Text contains',
            value: `//${element.tagName.toLowerCase()}[contains(text(), '${text}')]`,
            score: 85
          });
      } else {
          // 复杂文本，尝试使用 normalize-space
           candidates.push({
            type: 'xpath',
            subtype: 'text-exact',
            description: '文本精确匹配',
            descriptionEn: 'Text exact',
            value: `//${element.tagName.toLowerCase()}[normalize-space()=${safeText}]`,
            score: 80
          });
      }
    }

    // 3. 属性
    const stableAttrs = ['name', 'data-testid', 'data-id', 'placeholder', 'title', 'alt'];
    stableAttrs.forEach(attr => {
      if (element.hasAttribute(attr)) {
        candidates.push({
          type: 'xpath',
          subtype: 'attribute-based',
          description: `属性定位 (${attr})`,
          descriptionEn: `Attribute (${attr})`,
          value: `//${element.tagName.toLowerCase()}[@${attr}='${element.getAttribute(attr)}']`,
          score: 90
        });
      }
    });

    // 4. 绝对/相对路径
    const getPath = (el) => {
      const paths = [];
      for (; el && el.nodeType === Node.ELEMENT_NODE; el = el.parentNode) {
        let index = 0;
        let hasSameTagSibling = false;
        for (let sibling = el.previousSibling; sibling; sibling = sibling.previousSibling) {
          if (sibling.nodeType === Node.DOCUMENT_TYPE_NODE) continue;
          if (sibling.nodeName === el.nodeName) {
            index++;
            hasSameTagSibling = true;
          }
        }
        // 检查后续兄弟
        if (!hasSameTagSibling) {
            for (let sibling = el.nextSibling; sibling; sibling = sibling.nextSibling) {
                if (sibling.nodeName === el.nodeName) {
                    hasSameTagSibling = true;
                    break;
                }
            }
        }

        const tagName = el.nodeName.toLowerCase();
        const pathIndex = (hasSameTagSibling || index > 0) ? `[${index + 1}]` : '';
        // 遇到 ID 可以截断
        if (el.id) {
            paths.splice(0, 0, `//*[@id="${el.id}"]`);
            return paths.join('/');
        }
        paths.splice(0, 0, tagName + pathIndex);
      }
      return paths.length ? '/' + paths.join('/') : null;
    };
    
    const fullPath = getPath(element);
    if (fullPath) {
        candidates.push({
            type: 'xpath',
            subtype: 'absolute-path',
            description: '路径定位',
            descriptionEn: 'Path-based',
            value: fullPath,
            score: 50
        });
    }

    return candidates;
  }
};
