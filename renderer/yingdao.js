// yingdao.js - 影刀 selectorsV2.xml 解析与生成

var YingDao = {

  /**
   * 解析影刀 XML 字符串，提取 Web 类型的选择器
   * 返回 { elements: [...], skippedDesktop: number }
   */
  parseXml: (xmlString) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const elements = [];
    let skippedDesktop = 0;

    const groups = doc.querySelectorAll('group');
    groups.forEach(group => {
      const groupName = group.getAttribute('name') || '未命名分组';
      const groupType = group.getAttribute('type') || '';
      const criteria = group.getAttribute('criteria') || '';

      const selectors = group.querySelectorAll('selector');
      selectors.forEach(selector => {
        const framework = selector.getAttribute('framework') || '';

        // 只处理 Web 类型（chrome / chromium）
        if (!['chrome', 'chromium'].includes(framework)) {
          skippedDesktop++;
          return;
        }

        const name = selector.getAttribute('name') || '未命名元素';
        const winTitle = selector.getAttribute('winTitle') || '';

        // 提取定位器：优先 xpath，否则从 web 链路生成
        let locator = null;

        // 检查是否有 xpath 节点
        const xpathNode = selector.querySelector('xpath[enable="true"]');
        if (xpathNode) {
          const segment = xpathNode.querySelector('segment');
          if (segment) {
            let xpathValue = segment.getAttribute('value') || '';
            // 解码 XML 实体
            xpathValue = YingDao._decodeXmlEntities(xpathValue);
            if (xpathValue) {
              locator = { type: 'xpath', value: xpathValue };
            }
          }
        }

        // 如果没有 xpath，从 web 链路生成 CSS 选择器
        if (!locator) {
          const webNodes = selector.querySelectorAll('web');
          if (webNodes.length > 0) {
            const cssPath = YingDao._webChainToCss(webNodes);
            if (cssPath) {
              locator = { type: 'css', value: cssPath };
            }
          }
        }

        if (!locator) return; // 无法提取定位器，跳过

        // 构造指纹（从最后一个 web 节点提取）
        const webNodes = selector.querySelectorAll('web');
        const fingerprint = YingDao._extractFingerprint(webNodes);
        const ancestorChain = YingDao._extractAncestorChain(webNodes);

        // 推断 URL
        let url = '';
        if (criteria) {
          url = criteria;
        }

        let domain = '';
        let path = '/';
        if (url) {
          try {
            const u = new URL(url);
            domain = u.hostname;
            path = u.pathname;
          } catch (e) {
            domain = url;
          }
        }

        elements.push({
          id: Utils.uuid(),
          name: name,
          url: url,
          domain: domain,
          path: path,
          locator: locator,
          timestamp: Date.now(),
          fingerprint: fingerprint,
          ancestorChain: ancestorChain,
          history: [],
          // 额外元数据
          _yingdao: {
            groupName: groupName,
            groupType: groupType,
            framework: framework,
            winTitle: winTitle,
            selectorId: selector.getAttribute('id')
          }
        });
      });
    });

    return { elements, skippedDesktop };
  },

  /**
   * 影刀 XML 的完整命名空间声明
   */
  _xmlNamespaces: 'xmlns:x="rpa://selector/core" xmlns:regex="rpa://selector/operator/regex" xmlns:wildcard="rpa://selector/operator/wildcard" xmlns:contains="rpa://selector/operator/contains" xmlns:notContains="rpa://selector/operator/notContains" xmlns:startsWith="rpa://selector/operator/startsWith" xmlns:notStartsWith="rpa://selector/operator/notStartsWith" xmlns:endsWith="rpa://selector/operator/endsWith" xmlns:notEndsWith="rpa://selector/operator/notEndsWith" xmlns:notEquals="rpa://selector/operator/notEquals" xmlns:greaterThan="rpa://selector/operator/greaterThan" xmlns:greaterThanOrEqual="rpa://selector/operator/greaterThanOrEqual" xmlns:lessThan="rpa://selector/operator/lessThan" xmlns:lessThanOrEqual="rpa://selector/operator/lessThanOrEqual"',

  /**
   * 从零生成完整的影刀 selectorsV2.xml（支持多个 group）
   * @param {Object} groupsMap - { groupKey: items[] }
   * @param {Object} aliases - 页面别名
   */
  generateFullXml: (groupsMap, aliases) => {
    let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
    xml += `<repository ${YingDao._xmlNamespaces}>\n`;

    Object.entries(groupsMap).forEach(([groupKey, items]) => {
      if (!items || items.length === 0) return;
      const groupId = Utils.uuid();
      // 组名：优先用别名，否则用页面标题（从 _yingdao 元数据），最后用 groupKey
      const groupName = aliases[groupKey]
        || (items[0]._yingdao && items[0]._yingdao.groupName)
        || groupKey;
      // criteria：用 URL 的 origin
      let criteria = '';
      if (items[0].url) {
        try { criteria = new URL(items[0].url).origin; } catch (e) { criteria = items[0].url; }
      }

      xml += `  <group id="${groupId}" name="${YingDao._escapeXml(groupName)}" type="Web" processName="chrome" icon="" criteria="${YingDao._escapeXml(criteria)}">\n`;
      items.forEach(item => {
        xml += YingDao._buildSelectorXml(item);
      });
      xml += `  </group>\n`;
    });

    xml += '</repository>\n';
    return xml;
  },

  /**
   * 将多个分组的新 selector 合并到已有的 xbot_robot/selectorsV2.xml 中
   * @param {string|null} existingXml - 现有 XML 内容
   * @param {Object} groupsMap - { groupKey: items[] }
   * @param {Object} aliases - 页面别名
   */
  mergeGroupsIntoXml: (existingXml, groupsMap, aliases) => {
    if (!existingXml) {
      return YingDao.generateFullXml(groupsMap, aliases);
    }

    // 解析现有 XML，收集已有的 group 和 selector name
    const parser = new DOMParser();
    const doc = parser.parseFromString(existingXml, 'text/xml');
    const existingGroups = doc.querySelectorAll('group');

    // 构建 criteria → group 映射，以及已有 selector name 集合
    // 影刀用 criteria（URL origin）来匹配 group
    const criteriaToGroupInfo = {};
    existingGroups.forEach(g => {
      const criteria = g.getAttribute('criteria') || '';
      const names = new Set();
      g.querySelectorAll('selector').forEach(s => names.add(s.getAttribute('name')));
      criteriaToGroupInfo[criteria] = { element: g, names };
    });

    // 用字符串方式操作，避免命名空间序列化问题
    let xmlStr = existingXml;

    Object.entries(groupsMap).forEach(([groupKey, items]) => {
      if (!items || items.length === 0) return;

      let criteria = '';
      if (items[0].url) {
        try { criteria = new URL(items[0].url).origin; } catch (e) { criteria = items[0].url; }
      }

      const existingInfo = criteriaToGroupInfo[criteria];

      if (existingInfo) {
        // 已有同 criteria 的 group，追加新 selector（去重）
        let newSelectorsXml = '';
        items.forEach(item => {
          if (existingInfo.names.has(item.name)) return; // 同名跳过
          newSelectorsXml += YingDao._buildSelectorXml(item);
          existingInfo.names.add(item.name);
        });

        if (newSelectorsXml) {
          // 找到对应 group 的 </group> 标签并在其前面插入
          // 用 group id 来精确定位
          const groupId = existingInfo.element.getAttribute('id');
          const groupIdPattern = `id="${groupId}"`;
          const groupStartIdx = xmlStr.indexOf(groupIdPattern);
          if (groupStartIdx !== -1) {
            // 从 group 开始位置找到对应的 </group>
            const closeIdx = xmlStr.indexOf('</group>', groupStartIdx);
            if (closeIdx !== -1) {
              xmlStr = xmlStr.substring(0, closeIdx) + newSelectorsXml + '  ' + xmlStr.substring(closeIdx);
            }
          }
        }
      } else {
        // 没有匹配的 group，创建新 group
        const groupId = Utils.uuid();
        const groupName = aliases[groupKey]
          || (items[0]._yingdao && items[0]._yingdao.groupName)
          || groupKey;

        let groupXml = `  <group id="${groupId}" name="${YingDao._escapeXml(groupName)}" type="Web" processName="chrome" icon="" criteria="${YingDao._escapeXml(criteria)}">\n`;
        items.forEach(item => {
          groupXml += YingDao._buildSelectorXml(item);
        });
        groupXml += `  </group>\n`;

        // 在 </repository> 前插入
        xmlStr = xmlStr.replace('</repository>', groupXml + '</repository>');

        // 记录新 group 以便后续去重
        const names = new Set(items.map(i => i.name));
        criteriaToGroupInfo[criteria] = { element: null, names };
      }
    });

    return xmlStr;
  },

  // ========== 内部工具方法 ==========

  /**
   * 为单个元素构建影刀 <selector> XML 字符串
   * 核心策略：始终生成 xpath 节点（影刀最可靠的定位方式），同时尽量生成 web 链路
   */
  _buildSelectorXml: (item) => {
    const selectorId = Utils.uuid();
    // 影刀格式：添加 version="2"，winTitle 用页面标题
    const winTitle = (item._yingdao && item._yingdao.winTitle) || '';
    let xml = `    <selector id="${selectorId}" name="${YingDao._escapeXml(item.name)}" type="simple" framework="chrome" processName="chrome" productName="Google Chrome" winTitle="${YingDao._escapeXml(winTitle)}" version="2">\n`;

    // 生成 web 链路（从 ancestorChain + fingerprint）
    const webChain = YingDao._buildWebChain(item);
    webChain.forEach((node, idx) => {
      const isLast = idx === webChain.length - 1;
      // 最后一个节点（目标元素）不加 x:selected，其余加 x:selected="false"
      const selectedAttr = isLast ? '' : ' x:selected="false"';
      const innerTextAttr = node.innerText ? ` innerText="${YingDao._escapeXml(node.innerText)}"` : '';
      xml += `      <web x:name="${YingDao._escapeXml(node.tagName)}"${selectedAttr}${innerTextAttr}>\n`;
      xml += `        <optional`;
      Object.entries(node.attrs).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') {
          xml += ` ${k}="${YingDao._escapeXml(String(v))}"`;
        }
      });
      // 确保有 index 和 index-of-type（影刀必需）
      if (!node.attrs.hasOwnProperty('index')) {
        xml += ` index="0"`;
      }
      if (!node.attrs.hasOwnProperty('index-of-type')) {
        xml += ` index-of-type="0"`;
      }
      xml += ` />\n`;
      xml += `      </web>\n`;
    });

    // 始终生成 xpath 节点
    let xpathValue = '';
    if (item.locator.type === 'xpath') {
      xpathValue = item.locator.value;
    } else if (item.locator.type === 'css') {
      xpathValue = YingDao._cssToXpath(item.locator.value);
    }

    if (xpathValue) {
      xml += `      <xpath enable="true">\n`;
      xml += `        <segment value="${YingDao._escapeXml(xpathValue)}" />\n`;
      xml += `      </xpath>\n`;
    }

    xml += `    </selector>\n`;
    return xml;
  },

  /**
   * 简单的 CSS 选择器转 XPath
   */
  _cssToXpath: (css) => {
    if (!css) return '';
    try {
      // 按 > 或空格分割
      const parts = css.split(/\s*>\s*/).map(p => p.trim()).filter(p => p);
      const xpathParts = parts.map(part => {
        // 解析 tag#id.class[attr=val]
        let tag = '*';
        let conditions = [];

        // 提取 tag
        const tagMatch = part.match(/^([a-zA-Z][\w-]*)/);
        if (tagMatch) {
          tag = tagMatch[1];
          part = part.substring(tagMatch[0].length);
        }

        // 提取 #id
        const idMatch = part.match(/#([^\s.[\]]+)/);
        if (idMatch) {
          conditions.push(`@id="${idMatch[1]}"`);
        }

        // 提取 .class
        const classMatches = part.matchAll(/\.([^\s.#[\]]+)/g);
        for (const m of classMatches) {
          conditions.push(`contains(@class,"${m[1]}")`);
        }

        // 提取 [attr="val"]
        const attrMatches = part.matchAll(/\[([^\]]+)\]/g);
        for (const m of attrMatches) {
          const attrPart = m[1];
          const eqMatch = attrPart.match(/^([\w-]+)="([^"]*)"$/);
          if (eqMatch) {
            conditions.push(`@${eqMatch[1]}="${eqMatch[2]}"`);
          }
        }

        if (conditions.length > 0) {
          return `${tag}[${conditions.join(' and ')}]`;
        }
        return tag;
      });

      return '//' + xpathParts.join('/');
    } catch (e) {
      return '';
    }
  },

  _decodeXmlEntities: (str) => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
  },

  _escapeXml: (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  },

  /**
   * 从影刀 <web> 链路生成 CSS 选择器
   */
  _webChainToCss: (webNodes) => {
    const parts = [];
    webNodes.forEach(node => {
      // 获取 x:name 属性（tagName），兼容多种命名空间解析方式
      const tagName = node.getAttribute('x:name')
        || node.getAttributeNS('rpa://selector/core', 'name')
        || '';
      if (!tagName || tagName === 'xbotShadowRoot') return; // 跳过 Shadow DOM 标记

      let selector = tagName.toLowerCase();
      const optional = node.querySelector('optional');

      // 收集所有可用属性（optional 节点 + web 节点自身）
      const id = (optional && optional.getAttribute('id')) || node.getAttribute('id') || '';
      const cls = (optional && optional.getAttribute('class')) || node.getAttribute('class') || '';
      const role = (optional && optional.getAttribute('role')) || node.getAttribute('role') || '';
      const name = (optional && optional.getAttribute('name')) || node.getAttribute('name') || '';
      const dataTestId = (optional && optional.getAttribute('data-test-id')) || node.getAttribute('data-test-id') || '';
      const innerText = node.getAttribute('innerText') || '';
      const label = (optional && optional.getAttribute('label')) || node.getAttribute('label') || '';

      // 构建选择器：优先 id > data-test-id > role+class > class
      if (id) {
        selector += `#${CSS.escape(id)}`;
      } else {
        if (dataTestId) {
          selector += `[data-test-id="${dataTestId}"]`;
        }
        if (cls) {
          // 取第一个稳定的 class
          const classes = cls.split(' ').filter(c => c.trim());
          const stableClass = classes.find(c => !(/\d{4,}/.test(c) || /^css-/.test(c))) || classes[0];
          if (stableClass) selector += `.${CSS.escape(stableClass)}`;
        }
        if (role) {
          selector += `[role="${role}"]`;
        }
        if (label) {
          selector += `[label="${CSS.escape(label)}"]`;
        }
      }

      parts.push(selector);
    });

    if (parts.length === 0) return null;
    // 取最后 4 层构建选择器，提高精确度
    const tail = parts.slice(-4);
    return tail.join(' > ');
  },

  /**
   * 从最后一个 <web> 节点提取指纹
   */
  _extractFingerprint: (webNodes) => {
    if (webNodes.length === 0) return null;
    const lastWeb = webNodes[webNodes.length - 1];
    const tagName = (lastWeb.getAttribute('x:name') || lastWeb.getAttributeNS('rpa://selector/core', 'name') || 'div').toLowerCase();
    const optional = lastWeb.querySelector('optional');

    const fp = {
      tagName: tagName,
      id: null, name: null, type: null, role: null,
      innerText: lastWeb.getAttribute('innerText') || '',
      attributes: {}
    };

    if (optional) {
      fp.id = optional.getAttribute('id') || null;
      fp.role = optional.getAttribute('role') || null;
      const cls = optional.getAttribute('class');
      if (cls) {
        fp.classList = cls.split(' ').filter(c => c.trim());
      }
      // 收集 data-* 属性
      Array.from(optional.attributes).forEach(attr => {
        if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
          fp.attributes[attr.name] = attr.value;
        }
      });
    }

    return fp;
  },

  /**
   * 从 <web> 链路提取祖先链（倒数第 2~5 个节点）
   */
  _extractAncestorChain: (webNodes) => {
    const chain = [];
    // 从倒数第二个开始，取最多 4 层
    for (let i = webNodes.length - 2; i >= 0 && chain.length < 4; i--) {
      const node = webNodes[i];
      const tagName = (node.getAttribute('x:name') || node.getAttributeNS('rpa://selector/core', 'name') || '').toLowerCase();
      if (!tagName || tagName === 'xbotshadowroot') continue;

      const optional = node.querySelector('optional');
      const info = {
        tagName: tagName,
        id: optional ? optional.getAttribute('id') : null,
        role: optional ? optional.getAttribute('role') : null,
        index: optional ? parseInt(optional.getAttribute('index-of-type') || '0') + 1 : 1
      };
      chain.push(info);
    }
    return chain;
  },

  /**
   * 从插件元素数据构建影刀 <web> 链路
   */
  _buildWebChain: (item) => {
    const chain = [];

    // 从 ancestorChain 构建（倒序，因为 ancestorChain 是从父到祖）
    if (item.ancestorChain && item.ancestorChain.length > 0) {
      const reversed = [...item.ancestorChain].reverse();
      reversed.forEach(anc => {
        const attrs = {};
        if (anc.id) attrs.id = anc.id;
        if (anc.role) attrs.role = anc.role;
        attrs['index-of-type'] = String((anc.index || 1) - 1);
        attrs.index = attrs['index-of-type'];
        chain.push({ tagName: anc.tagName || 'div', attrs });
      });
    }

    // 目标元素自身（从 fingerprint）
    if (item.fingerprint) {
      const fp = item.fingerprint;
      const attrs = {};
      if (fp.id) attrs.id = fp.id;
      if (fp.classList && fp.classList.length > 0) attrs.class = fp.classList.join(' ');
      if (fp.role) attrs.role = fp.role;
      if (fp.name) attrs.name = fp.name;
      Object.entries(fp.attributes || {}).forEach(([k, v]) => {
        attrs[k] = v;
      });
      chain.push({
        tagName: fp.tagName || 'div',
        attrs,
        innerText: fp.innerText || null
      });
    } else {
      // 没有指纹，用 locator 信息尽量构建
      chain.push({ tagName: 'div', attrs: {} });
    }

    return chain;
  }
};
