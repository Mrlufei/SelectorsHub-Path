// repair.js - 自愈修复逻辑
// 依赖: state.js, saved-elements.js

// ========== 自愈修复逻辑 ==========
function handleValidationFailure(item, container) {
  var repairPanel = document.getElementById('repair-' + item.id);
  if (!repairPanel) {
    repairPanel = document.createElement('div');
    repairPanel.id = 'repair-' + item.id;
    repairPanel.className = 'repair-panel';
    container.appendChild(repairPanel);
  }

  if (!item.fingerprint) {
    renderRepairPanel(repairPanel, [], 'no_fingerprint', item);
    return;
  }

  renderRepairPanel(repairPanel, [], 'generating', item);

  var candidates = Utils.generateRepairCandidates(item.fingerprint, item.ancestorChain || []);
  var requestId = Utils.uuid();

  pendingValidations.set(requestId, function(results) {
    if (!results) { renderRepairPanel(repairPanel, [], 'error', item); return; }
    var processed = results.sort(function(a, b) {
      var aValid = a.matchCount === 1 && a.secondaryCheck.pass;
      var bValid = b.matchCount === 1 && b.secondaryCheck.pass;
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      return b.score - a.score;
    });
    renderRepairPanel(repairPanel, processed, 'done', item);
  });

  sendToExtension({ action: 'validate_candidates', requestId: requestId, candidates: candidates, fingerprint: item.fingerprint });
}

function renderRepairPanel(container, candidates, status, item) {
  container.innerHTML = '';
  var header = document.createElement('div');
  header.className = 'repair-header';
  var title = document.createElement('h3');
  title.innerHTML = t('header_repair') + ' <span class="arrow-icon">▼</span>';
  var closeBtn = document.createElement('span');
  closeBtn.innerText = '×';
  closeBtn.style.cssText = 'cursor:pointer; margin-left:auto;';
  closeBtn.onclick = function(e) { e.stopPropagation(); container.remove(); };
  header.appendChild(title);
  header.appendChild(closeBtn);
  container.appendChild(header);

  var contentDiv = document.createElement('div');
  contentDiv.className = 'repair-content';
  container.appendChild(contentDiv);

  var isExpanded = true;
  header.onclick = function(e) {
    if (e.target === closeBtn) return;
    isExpanded = !isExpanded;
    contentDiv.style.display = isExpanded ? 'block' : 'none';
    var arrow = title.querySelector('.arrow-icon');
    if (arrow) { if (isExpanded) arrow.classList.remove('collapsed'); else arrow.classList.add('collapsed'); }
  };

  if (status === 'generating') { contentDiv.innerHTML = '<div class="loading">' + t('msg_analyzing') + '</div>'; return; }
  if (status === 'no_fingerprint') { contentDiv.innerHTML = '<div class="empty" style="color:#ff4d4f">' + t('msg_no_fingerprint') + '</div>'; return; }

  var validCandidates = candidates.filter(function(c) { return c.matchCount === 1; });
  if (status === 'error' || validCandidates.length === 0) { contentDiv.innerHTML = '<div class="empty">' + t('msg_repair_empty') + '</div>'; return; }

  var list = document.createElement('div');
  list.className = 'candidate-list';

  validCandidates.forEach(function(cand) {
    var row = document.createElement('div');
    var isSafe = cand.matchCount === 1 && cand.secondaryCheck.pass;
    var isRisk = cand.matchCount === 1 && !cand.secondaryCheck.pass;
    row.className = 'candidate-row ' + (isSafe ? 'safe' : (isRisk ? 'risky' : ''));

    var statusIcon = isSafe ? '✅' : '⚠️';
    var statusText = isSafe ? t('status_perfect') : t('status_risk', { reason: cand.secondaryCheck.reason });

    row.innerHTML = '<div class="cand-info"><div class="cand-type">' + cand.type + '</div><div class="cand-value" title="' + cand.value + '">' + cand.value + '</div></div>' +
      '<div class="cand-status-row"><div class="cand-reason">' + cand.reason + '</div><div class="cand-status" title="' + statusText + '">' + statusIcon + '</div></div>' +
      '<div class="cand-actions-row"><button class="btn-adopt ' + (isSafe ? 'primary' : 'danger') + '">' + t('btn_adopt') + '</button></div>';

    row.querySelector('.btn-adopt').onclick = function(e) {
      e.stopPropagation();
      if (!isSafe && !confirm(t('confirm_force_adopt', { reason: cand.secondaryCheck.reason }))) return;
      adoptLocator(item, cand);
    };
    list.appendChild(row);
  });

  contentDiv.appendChild(list);
}

function adoptLocator(item, newLocator) {
  if (!item.history) item.history = [];
  item.history.push({ at: Date.now(), oldLocator: item.locator, reason: 'self-healing' });
  item.locator = { type: newLocator.type, value: newLocator.value };
  saveToStorage(item);
  alert(t('alert_repaired'));
  loadSavedElements();
}
