// candidates.js - 候选定位器渲染与验证
// 依赖: state.js, extension.js

// ========== 候选定位器渲染 ==========
function renderCandidates() {
  candidatesList.innerHTML = '';
  currentCandidates.forEach(function(cand, index) {
    var item = document.createElement('div');
    item.className = 'locator-item';
    item.dataset.index = index;

    var header = document.createElement('div');
    header.className = 'locator-header';
    var typeTag = document.createElement('span');
    typeTag.className = 'type-tag type-' + cand.type;

    if (cand.subtype && cand.description) {
      var lang = currentLang || 'zh';
      var desc = lang === 'zh' ? cand.description : (cand.descriptionEn || cand.description);
      typeTag.textContent = cand.type.toUpperCase() + ' · ' + desc;
    } else {
      typeTag.textContent = cand.type.toUpperCase();
    }

    header.appendChild(typeTag);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'locator-value';
    input.value = cand.value;
    input.readOnly = false;

    input.addEventListener('change', function(e) {
      currentCandidates[index].value = e.target.value;
      var statusEl = item.querySelector('.validation-status');
      if (statusEl) {
        statusEl.textContent += ' (已修改)';
      }
    });

    var actions = document.createElement('div');
    actions.className = 'actions';

    var btnVal = document.createElement('button');
    btnVal.className = 'btn secondary';
    btnVal.style.cssText = 'padding: 2px 8px; font-size: 12px;';
    btnVal.textContent = t('btn_validate');
    btnVal.onclick = function(e) { e.stopPropagation(); validateCandidate(index); };

    var btnCopy = document.createElement('button');
    btnCopy.className = 'btn secondary';
    btnCopy.style.cssText = 'padding: 2px 8px; font-size: 12px;';
    btnCopy.textContent = t('btn_copy');
    btnCopy.onclick = function(e) {
      e.stopPropagation();
      navigator.clipboard.writeText(cand.value);
      btnCopy.textContent = t('btn_copied');
      setTimeout(function() { btnCopy.textContent = t('btn_copy'); }, 1000);
    };

    actions.appendChild(btnCopy);
    actions.appendChild(btnVal);

    var status = document.createElement('div');
    status.className = 'validation-status';
    status.style.cssText = 'font-size: 11px; margin-top: 4px;';

    item.appendChild(header);
    item.appendChild(input);
    item.appendChild(actions);
    item.appendChild(status);

    item.addEventListener('click', function() {
      document.querySelectorAll('.locator-item').forEach(function(el) { el.style.border = '1px solid var(--border-color)'; });
      item.style.border = '2px solid var(--primary-color)';
      selectedLocatorIndex = index;
      btnSave.disabled = false;
      btnSave.textContent = t('btn_save_with_type', { type: cand.type });
      sendToExtension({ action: 'clear_highlight' });
    });

    candidatesList.appendChild(item);
  });
}

// ========== 验证逻辑 ==========
function validateCandidate(index) {
  var locator = currentCandidates[index];
  var itemEl = candidatesList.children[index];
  if (!itemEl) return;
  var statusEl = itemEl.querySelector('.validation-status');
  statusEl.textContent = t('tag_validating');
  statusEl.style.color = '#666';

  var requestId = Utils.uuid();
  pendingValidations.set(requestId, function(response) {
    if (!response) { statusEl.textContent = t('status_error'); return; }
    itemEl.classList.remove('valid', 'invalid', 'multiple');
    if (response.count === 1) {
      statusEl.textContent = t('status_unique') + ' (' + response.time + 'ms)';
      statusEl.style.color = 'green';
      itemEl.classList.add('valid');
      if (selectedLocatorIndex === -1) itemEl.click();
    } else if (response.count === 0) {
      statusEl.textContent = t('status_not_found') + ' (' + response.time + 'ms)';
      statusEl.style.color = 'red';
      itemEl.classList.add('invalid');
    } else {
      statusEl.textContent = t('status_multiple', { n: response.count }) + ' (' + response.time + 'ms)';
      statusEl.style.color = '#faad14';
      itemEl.classList.add('multiple');
    }
  });

  sendToExtension({ action: 'validate', requestId: requestId, locator: locator });
}
