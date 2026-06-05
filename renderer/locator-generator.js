// locator-generator.js - 基于属性配置的定位器生成
// 依赖: state.js, dom-hierarchy.js

// ========== 定位器生成 ==========
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

    if (selectedAttrs.length === 0) {
        alert(t('msg_select_one_attr'));
        return;
    }

    var xpath = buildXPathFromAttrs(selectedAttrs);
    var cssSelector = buildCssSelectorFromAttrs(selectedAttrs);

    var newCandidates = [];
    if (xpath) {
        newCandidates.push({
            type: 'xpath',
            subtype: 'user-generated',
            description: t('btn_generate_locator'),
            descriptionEn: 'User generated',
            value: xpath,
            score: 85
        });
    }
    if (cssSelector) {
        newCandidates.push({
            type: 'css',
            subtype: 'user-generated',
            description: t('btn_generate_locator'),
            descriptionEn: 'User generated',
            value: cssSelector,
            score: 85
        });
    }

    currentCandidates = newCandidates.concat(currentCandidates);
    renderCandidates();
    if (currentCandidates.length > 0) {
        validateCandidate(0);
    }
    alert(t('msg_locator_generated'));
}

function buildXPathFromAttrs(attrs) {
    var xpath = '//';
    attrs.forEach(function(attr, index) {
        if (index > 0) xpath += '/';
        var tagName = attr.name === 'tagName' ? attr.value : '*';

        if (attr.name === 'tagName') {
            xpath += tagName;
        } else if (attr.name === 'id') {
            xpath += '*[@id="' + attr.value.replace(/"/g, '\\"') + '"]';
        } else if (attr.name === 'innerText') {
            var escaped = attr.value.replace(/"/g, '\\"');
            if (attr.matchType === t('match_equals')) {
                xpath += tagName + '[normalize-space()="' + escaped + '"]';
            } else if (attr.matchType === t('match_contains')) {
                xpath += tagName + '[contains(text(), "' + escaped + '")]';
            } else if (attr.matchType === t('match_starts')) {
                xpath += tagName + '[starts-with(text(), "' + escaped + '")]';
            } else {
                xpath += tagName + '[contains(text(), "' + escaped + '")]';
            }
        } else if (attr.name === 'indexOfType') {
            xpath += tagName + '[' + attr.value + ']';
        } else {
            var attrName = attr.name === 'className' ? 'class' : attr.name;
            var escaped = attr.value.replace(/"/g, '\\"');
            if (attr.matchType === t('match_equals')) {
                xpath += tagName + '[@' + attrName + '="' + escaped + '"]';
            } else if (attr.matchType === t('match_contains')) {
                xpath += tagName + '[contains(@' + attrName + ', "' + escaped + '")]';
            } else if (attr.matchType === t('match_starts')) {
                xpath += tagName + '[starts-with(@' + attrName + ', "' + escaped + '")]';
            } else {
                xpath += tagName + '[contains(@' + attrName + ', "' + escaped + '")]';
            }
        }
    });
    return xpath;
}

function buildCssSelectorFromAttrs(attrs) {
    var css = '';
    attrs.forEach(function(attr) {
        if (attr.name === 'tagName') {
            css = attr.value;
        } else if (attr.name === 'id') {
            css += '#' + CSS.escape(attr.value);
        } else if (attr.name === 'className') {
            var classes = attr.value.split(/\s+/);
            classes.forEach(function(cls) {
                if (cls) css += '.' + CSS.escape(cls);
            });
        } else if (['name', 'type', 'role', 'placeholder'].indexOf(attr.name) >= 0) {
            if (attr.matchType === t('match_equals')) {
                css += '[' + attr.name + '="' + CSS.escape(attr.value) + '"]';
            } else if (attr.matchType === t('match_contains')) {
                css += '[' + attr.name + '*="' + CSS.escape(attr.value) + '"]';
            } else if (attr.matchType === t('match_starts')) {
                css += '[' + attr.name + '^="' + CSS.escape(attr.value) + '"]';
            }
        } else if (attr.name.startsWith('data-')) {
            css += '[' + attr.name + '="' + CSS.escape(attr.value) + '"]';
        }
    });
    return css || null;
}
