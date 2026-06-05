// content_script.js

(function() {
    if (window.locatorLabInitialized) {
        return; // 已经注入过，直接退出，防止变量重复声明报错
    }
    window.locatorLabInitialized = true;

    let isPicking = false;
    let lastHighlightedElement = null;
    let highlightTimer = null;
    let currentAnimation = null;
    let customColors = { pick: '#1890ff', verify: '#52c41a' };

    // 初始化加载颜色设置
    chrome.storage.local.get(['customColors'], (res) => {
        if (res.customColors) {
            customColors = res.customColors;
        }
    });

    // 初始化注入样式
    function injectStyles() {
        if (!document.getElementById('locator-lab-style')) {
            const style = document.createElement('style');
            style.id = 'locator-lab-style';
            style.textContent = `
                @keyframes locator-lab-breathe {
                    0% { box-shadow: 0 0 0 0 var(--verify-color); opacity: 1; }
                    50% { box-shadow: 0 0 0 6px rgba(0,0,0,0); opacity: 0.8; }
                    100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); opacity: 1; }
                }
                .locator-lab-overlay-instance.animated {
                    animation: locator-lab-breathe 1.5s infinite ease-out;
                }
            `;
            document.head.appendChild(style);
        }
    }
    injectStyles();

    // 监听颜色更新消息
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'update_colors') {
            customColors = msg.colors;
        }
    });

    // 创建高亮覆盖层
    function createOverlay(id = 'locator-lab-overlay') {
        let overlay = document.getElementById(id);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = id;
            overlay.className = 'locator-lab-overlay-instance'; // Add class for batch removal
            overlay.style.position = 'absolute'; // Changed from fixed to absolute for scrolling support
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '2147483647'; // Max z-index
            overlay.style.transition = 'all 0.1s ease';
            overlay.style.display = 'none';
            overlay.style.boxSizing = 'border-box'; // Ensure border is included in size
            document.body.appendChild(overlay);
        }
        return overlay;
    }

    function updateOverlay(element, color = 'red', label = '', uniqueId = null) {
        if (!element) return;
        
        // 如果没有提供 uniqueId，则使用单例模式（用于拾取模式或单次验证）
        // 如果提供了 uniqueId，则创建新的 overlay（用于批量验证）
        const overlayId = uniqueId ? `locator-lab-overlay-${uniqueId}` : 'locator-lab-overlay';

        const rect = element.getBoundingClientRect();
        // 忽略不可见元素
        if (rect.width === 0 && rect.height === 0) return;

        // 如果已存在同名 overlay，先移除它的定时器（如果有的话）
        // 注意：这里需要从 DOM 元素上获取 timer ID，因为我们不再使用全局 highlightTimer 管理多实例
        let existingOverlay = document.getElementById(overlayId);
        if (existingOverlay && existingOverlay.dataset.timerId) {
            clearTimeout(parseInt(existingOverlay.dataset.timerId));
        }

        const overlay = createOverlay(overlayId);
        
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        const padding = 4; // Padding to expand the box

        overlay.style.border = `3px solid ${color}`;
        overlay.style.top = `${rect.top + scrollY - padding}px`;
        overlay.style.left = `${rect.left + scrollX - padding}px`;
        overlay.style.width = `${rect.width + (padding * 2)}px`;
        overlay.style.height = `${rect.height + (padding * 2)}px`;
        overlay.style.display = 'block';
        
        // 添加动态效果
        // overlay.style.boxShadow = `0 0 8px ${color}`; // Removed static shadow to rely on animation
        overlay.classList.add('animated');
        overlay.style.setProperty('--verify-color', color);
        
        // 废弃旧的 JS 动画，改用 CSS 动画
        /*
        const animation = overlay.animate([
            { 
                boxShadow: `0 0 0 0 ${color}`,
                opacity: 1 
            },
            { 
                boxShadow: `0 0 0 10px rgba(0,0,0,0)`, // 扩散并变透明
                opacity: 0.8
            },
            { 
                boxShadow: `0 0 0 0 rgba(0,0,0,0)`,
                opacity: 1 
            }
        ], {
            duration: 1500,
            iterations: Infinity,
            easing: 'ease-out'
        });
        */
        
        // 可以添加 Label 显示信息
        overlay.setAttribute('title', label || '');
        
        // 自动消失逻辑：3秒后自动消失
        // 只有在非拾取模式下才自动消失
        if (!isPicking) {
            const timerId = setTimeout(() => {
                hideOverlay(overlayId);
            }, 3000);
            // 将 timer ID 绑定到 DOM 元素上
            overlay.dataset.timerId = timerId;
        }
    }

    function hideOverlay(id = 'locator-lab-overlay') {
        const overlay = document.getElementById(id);
        if (overlay) {
            if (overlay.dataset.timerId) {
                clearTimeout(parseInt(overlay.dataset.timerId));
            }
            overlay.remove(); // 直接移除
        }
    }

    function clearAllHighlights() {
        document.querySelectorAll('.locator-lab-overlay-instance').forEach(el => {
            if (el.dataset.timerId) {
                clearTimeout(parseInt(el.dataset.timerId));
            }
            el.remove();
        });
    }

// 拾取模式事件处理
function onMouseOver(e) {
    if (!isPicking) return;
    e.preventDefault();
    e.stopPropagation();
    lastHighlightedElement = e.target;
    updateOverlay(e.target, customColors.pick, '点击选中');
}

function onClick(e) {
    if (!isPicking) return;
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target;
    stopPicking();
    
    // 生成定位器
    const cssCandidates = Utils.generateCssSelectors(target);
    const xpathCandidates = Utils.generateXPaths(target);
    const candidates = [...cssCandidates, ...xpathCandidates].sort((a, b) => b.score - a.score);

    // 提取基本信息
    const info = {
        tagName: target.tagName,
        id: target.id,
        className: target.className,
        name: target.getAttribute('name'),
        innerText: target.innerText ? target.innerText.substring(0, 80) : '',
        href: target.getAttribute('href'),
        type: target.getAttribute('type'),
        url: window.location.href,
        candidates: candidates,
        // 新增自愈数据采集
        fingerprint: Utils.getFingerprint(target),
        ancestorChain: Utils.getAncestorChain(target)
    };

    // 发送回 Panel
    chrome.runtime.sendMessage({
        action: 'element_picked',
        payload: info
    });
}

function onKeyDown(e) {
    if (!isPicking) return;
    if (e.key === 'Escape') {
        stopPicking();
        hideOverlay();
    }
}

function startPicking() {
    if (isPicking) return;
    isPicking = true;
    document.addEventListener('mouseover', onMouseOver, { capture: true });
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('keydown', onKeyDown, { capture: true });
    document.body.style.cursor = 'crosshair';
}

function stopPicking() {
    isPicking = false;
    document.removeEventListener('mouseover', onMouseOver, { capture: true });
    document.removeEventListener('click', onClick, { capture: true });
    document.removeEventListener('keydown', onKeyDown, { capture: true });
    document.body.style.cursor = 'default';
    hideOverlay(); // 暂时隐藏，点击后由 Panel 决定是否高亮验证结果
    
    // 通知 Side Panel 拾取已停止
    chrome.runtime.sendMessage({
        action: 'picking_stopped'
    });
}

// 验证定位器
function validateLocator(locator, uniqueId = null) {
    // 只有在非批量（单例）验证时才清除旧高亮
    if (!uniqueId) {
        hideOverlay();
    }

    const startTime = performance.now();
    let elements = [];
    
    try {
        if (locator.type === 'css') {
            elements = Array.from(document.querySelectorAll(locator.value));
        } else if (locator.type === 'xpath') {
            const result = document.evaluate(locator.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < result.snapshotLength; i++) {
                elements.push(result.snapshotItem(i));
            }
        }
    } catch (e) {
        console.error("Invalid locator:", locator.value, e);
        if (!uniqueId) hideOverlay(); 
        return { count: 0, time: 0, error: e.message };
    }

    const duration = performance.now() - startTime;

    if (elements.length === 1) {
        updateOverlay(elements[0], customColors.verify, '唯一匹配', uniqueId); // 使用自定义验证颜色
        // 仅在单例验证时自动滚动
        if (!uniqueId) {
             elements[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    } else if (elements.length > 1) {
        // 多匹配时高亮全部元素
        clearAllHighlights();
        elements.forEach((el, i) => {
            updateOverlay(el, customColors.verify, `匹配 ${i + 1}/${elements.length}`, uniqueId ? `${uniqueId}-multi-${i}` : `multi-${i}`);
        });
        if (!uniqueId) {
             elements[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    }

    return {
        count: elements.length,
        time: Math.round(duration),
        elements: elements 
    };
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start_picking') {
        startPicking();
    } else if (request.action === 'validate') {
        const result = validateLocator(request.locator, request.uniqueId); // Pass uniqueId
        
        // 增强：二次校验
        if (result.count === 1 && request.fingerprint) {
            const check = Utils.checkSecondaryMatch(result.elements[0], request.fingerprint);
            result.secondaryCheck = check;
        }
        
        // 增强：补录指纹 (Migration)
        if (result.count === 1 && request.collectFingerprint) {
            result.newFingerprint = Utils.getFingerprint(result.elements[0]);
            result.newAncestorChain = Utils.getAncestorChain(result.elements[0]);
        }
        
        // 删除 elements 引用避免序列化错误
        delete result.elements;
        
        sendResponse(result);
    } else if (request.action === 'validate_many') {
        // 新增：批量验证接口 (Synchronous & Optimized)
        // 回滚了异步分片逻辑，改用同步计算+异步渲染，确保消息即时返回
        clearAllHighlights(); 
        
        // 样式已在初始化时注入
        
        const locators = request.locators || [];
        const results = [];
        const overlaysToRender = [];
        
        // 1. 同步计算所有结果 (Pure JS, Fast)
        locators.forEach(item => {
            const start = performance.now();
            let elements = [];
            let error = null;
            
            try {
                if (item.locator.type === 'css') {
                    elements = Array.from(document.querySelectorAll(item.locator.value));
                } else if (item.locator.type === 'xpath') {
                    const res = document.evaluate(item.locator.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    for (let j = 0; j < res.snapshotLength; j++) elements.push(res.snapshotItem(j));
                }
            } catch (e) {
                error = e.message;
            }
            
            const time = Math.round(performance.now() - start);
            
            results.push({
                id: item.id,
                count: elements.length,
                time: time,
                error: error
            });

            // 准备渲染数据 - 高亮所有匹配的元素
            if (elements.length > 0) {
                elements.forEach((el, idx) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        let color = customColors.verify;
                        
                        overlaysToRender.push({
                            rect: rect,
                            color: color,
                            id: `locator-lab-overlay-${item.id}-${idx}`
                        });
                    }
                });
            }
        });

        // 2. 立即返回结果给 Sidepanel (防止超时)
        sendResponse(results);

        // 3. 异步批量渲染 DOM (High Performance)
        if (overlaysToRender.length > 0) {
            requestAnimationFrame(() => {
                const fragment = document.createDocumentFragment();
                const scrollX = window.scrollX || window.pageXOffset;
                const scrollY = window.scrollY || window.pageYOffset;
                const padding = 4;

                overlaysToRender.forEach(data => {
                    const overlay = document.createElement('div');
                    overlay.id = data.id;
                    overlay.className = 'locator-lab-overlay-instance animated'; 
                    overlay.style.position = 'absolute';
                    overlay.style.pointerEvents = 'none';
                    overlay.style.zIndex = '2147483647';
                    overlay.style.boxSizing = 'border-box';
                    
                    overlay.style.setProperty('--verify-color', data.color);
                    
                    overlay.style.border = `3px solid ${data.color}`;
                    overlay.style.top = `${data.rect.top + scrollY - padding}px`;
                    overlay.style.left = `${data.rect.left + scrollX - padding}px`;
                    overlay.style.width = `${data.rect.width + (padding * 2)}px`;
                    overlay.style.height = `${data.rect.height + (padding * 2)}px`;
                    
                    const timerId = setTimeout(() => {
                        const el = document.getElementById(data.id);
                        if (el) el.remove();
                    }, 3000);
                    overlay.dataset.timerId = timerId;

                    fragment.appendChild(overlay);
                });
                
                document.body.appendChild(fragment);
            });
        }
        
        // 不需要 return true，因为是同步 sendResponse
    } else if (request.action === 'validate_candidates') {
        // 新增：批量验证候选
        const candidates = request.candidates;
        const fingerprint = request.fingerprint;
        
        const results = candidates.map(cand => {
            // 复用 validateLocator 但不触发高亮和滚动（除非需要？）
            // 这里我们只需要数据
            let elements = [];
            const start = performance.now();
            try {
                if (cand.type === 'css') {
                    elements = Array.from(document.querySelectorAll(cand.value));
                } else if (cand.type === 'xpath') {
                    const res = document.evaluate(cand.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    for (let i = 0; i < res.snapshotLength; i++) elements.push(res.snapshotItem(i));
                }
            } catch(e) {}
            const time = Math.round(performance.now() - start);
            
            let check = { pass: false, reason: 'Match count != 1' };
            if (elements.length === 1 && fingerprint) {
                check = Utils.checkSecondaryMatch(elements[0], fingerprint);
            }
            
            return {
                ...cand,
                matchCount: elements.length,
                time: time,
                secondaryCheck: check
            };
        });
        
        sendResponse(results);
    } else if (request.action === 'highlight') {
        // 直接高亮逻辑（用于回放）
        validateLocator(request.locator);
    } else if (request.action === 'clear_highlight') {
        clearAllHighlights();
    } else if (request.action === 'clear_all_highlights') {
        clearAllHighlights();
    }
    return true; // 支持异步 sendResponse
});

// ========== 心跳保活：定期 ping Service Worker 防止休眠 ==========
// 注意：此心跳仅在页面加载后生效，不保证所有场景都能唤醒 Service Worker
// 主要保活机制在 Service Worker 的 offscreen document 中
setInterval(() => {
  try {
    chrome.runtime.sendMessage({ action: 'heartbeat' }, () => {
      if (chrome.runtime.lastError) { /* 忽略 */ }
    });
  } catch (e) { /* 忽略 */ }
}, 3000);

})();
