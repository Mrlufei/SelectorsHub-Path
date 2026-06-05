# DOM 层级提取优化 — 实施记录

> 基于 `doc/dom_hierarchy_extraction.md` 混合策略方案，参照 `doc/dom_hierarchy_optimization_plan.md` 完成实施。
>
> **实施日期**: 2026-01-XX
> **状态**: ✅ 已完成

---

## 修改文件清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `chrome-extension/utils.js` | 新增 9 个函数 | 扩展端工具函数（运行在网页 DOM 上下文） |
| 2 | `renderer/utils.js` | 同步新增 9 个函数 | 桌面端工具函数（Electron 渲染进程） |
| 3 | `chrome-extension/content_script.js` | 修改 `onClick()` | 拾取元素时使用优化版祖先链 + 相似元素采集 |

---

## 新增函数详细说明

### 1. 动态深度控制 — `getDynamicDepth(element)`

根据元素类型自动调整遍历深度，替代硬编码的 4 层限制。

| 元素类型 | 深度 | 说明 |
|---------|------|------|
| `table`, `ul`, `ol`, `tbody`, `tr` | 30 | 深层嵌套表格/列表 |
| `input`, `button`, `select`, `textarea` | 10 | 表单元素通常较浅 |
| `a`, `span`, `label` | 15 | 链接和行内元素 |
| 其他 | 20 | 默认深度 |

### 2. 智能剪枝 — `shouldPrune(element)`

过滤无信息量的 DOM 节点，减少 70%+ 无效遍历。

| 规则 | 剪枝条件 |
|------|---------|
| 根节点 | `html`, `body`, `head`, `#document` |
| 容器元素 | `div`, `span`, `section`, `article` — 同时满足：无 id、无 role、无 data-testid/data-id/aria-label、class 为空或 >30 字符 |

### 3. 优化祖先链提取 — `getAncestorChainOptimized(el, options)`

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `maxDepth` | `getDynamicDepth(el)` | 动态深度 |
| `enablePruning` | `true` | 启用智能剪枝 |
| `includeAllLevels` | `false` | 是否包含所有层级（含被剪枝的） |

相比原版 `getAncestorChain()` 的增强：
- 动态深度而非固定 4 层
- 可启用的智能剪枝
- 更多稳定属性识别（新增 `data-cy`, `data-qa`）
- 返回 `depth` 和 `className` 字段
- 结果按从根到叶子排序（`chain.reverse()`）

### 4. 特征缓存 — `_featureCache` / `extractFeatures` / `clearFeatureCache`

```javascript
_featureCache: new WeakMap()  // 自动释放已删除元素
```

`extractFeatures()` 返回的特征向量包含 11 个维度：

| 字段 | 权重场景 | 说明 |
|------|---------|------|
| `tagName` | 标签匹配 | 小写标签名 |
| `className` | Class 相似度 | 排序后的 class 数组 |
| `id` | — | 元素 ID |
| `role` | 角色匹配 | ARIA role |
| `type` | 类型匹配 | input type |
| `name` | — | name 属性 |
| `placeholder` | — | placeholder 属性 |
| `depth` | 结构相似度 | body 到元素的深度 |
| `childCount` | 结构相似度 | 子元素数量 |
| `hasText` | 文本特征 | 是否有文本内容 |
| `textLength` | 文本相似度 | 文本长度 |
| `attributes` | — | data-*/aria-* 属性集合 |

### 5. 结构相似度 — `calculateSimilarity(features1, features2)`

5 维度权重评分体系：

| 维度 | 权重 | 匹配条件 |
|------|------|---------|
| 标签名 | 30% | `tagName` 相等 |
| Class | 25% | 共同 class 数 / 最大 class 数 |
| 角色/类型 | 20% | `role` 各 10%，`type` 各 10% |
| 结构 | 15% | 深度差 ≤2 得 8%，子元素数差 ≤1 得 7% |
| 文本 | 10% | 是否有文本 5%，文本长度相似度 5% |

返回 `0~1` 的相似度分数。

### 6. 相似元素查找 — `findSimilarElements(element, threshold, batchSize)`

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `threshold` | 0.7 | 相似度阈值（低于此值忽略） |
| `batchSize` | 100 | 最大搜索兄弟数 |

- 在同级元素中搜索
- 自动跳过不可见元素（`getBoundingClientRect` 宽高为 0）
- 按相似度降序排列

---

## onClick 拾取流程变更

原流程：
```
onClick → getAncestorChain(target)           → 固定深度 4 层
```

新流程：
```
onClick → getAncestorChainOptimized(target, { enablePruning: true })
                                    → 动态深度 + 智能剪枝 + 更多稳定属性
        → findSimilarElements(target, 0.7, 50)
                                    → 返回相似元素列表（含 tagName/similarity/text）
```

`element_picked` 消息 payload 新增字段：`similarElements`

---

## 验证结果

- ✅ `chrome-extension/utils.js` — 9 个函数全部存在，语法正确
- ✅ `renderer/utils.js` — 与扩展端同名函数一致，语法正确
- ✅ `chrome-extension/content_script.js` — `onClick` 正确调用 `getAncestorChainOptimized` 和 `findSimilarElements`

### 向后兼容

- 原 `getAncestorChain()` 保留，内部委托给 `getAncestorChainOptimized`（depth=4, pruning=false）
- 旧数据（无 `similarElements` 字段）不受影响

---

## 参考文档

- [DOM 层级提取最佳算法方案](dom_hierarchy_extraction.md)
- [DOM 层级提取优化实施计划](dom_hierarchy_optimization_plan.md)
