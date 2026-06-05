// io.js - 数据导入导出 + 对话框
// 依赖: state.js, saved-elements.js

// ========== 数据导入导出 ==========
function initIO() {
  var btnExport = document.getElementById('btn-export');
  var btnImport = document.getElementById('btn-import');
  var fileImport = document.getElementById('file-import');
  var btnExportYingdao = document.getElementById('btn-export-yingdao');
  var btnImportYingdao = document.getElementById('btn-import-yingdao');

  // JSON 导出
  if (btnExport) {
    btnExport.addEventListener('click', function() {
      if (savedElementsCache.length === 0) { alert(t('msg_no_data_to_export')); return; }
      var blob = new Blob([JSON.stringify(savedElementsCache, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'xpath-repair-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // JSON 导入
  if (btnImport && fileImport) {
    btnImport.addEventListener('click', function() { fileImport.click(); });
    fileImport.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(event) {
        try {
          var importedData = JSON.parse(event.target.result);
          if (!Array.isArray(importedData)) throw new Error('格式错误');
          if (!confirm(t('confirm_import', { n: importedData.length }))) { fileImport.value = ''; return; }

          var currentMap = new Map(savedElementsCache.map(function(item) { return [item.id, item]; }));
          var addedCount = 0, updatedCount = 0;
          importedData.forEach(function(item) {
            if (currentMap.has(item.id)) { currentMap.set(item.id, item); updatedCount++; }
            else { currentMap.set(item.id, item); addedCount++; }
          });
          savedElementsCache = Array.from(currentMap.values());
          persistData();
          loadSavedElements();
          alert(t('alert_imported', { added: addedCount, updated: updatedCount }));
          fileImport.value = '';
        } catch (err) {
          alert(t('alert_import_failed'));
          fileImport.value = '';
        }
      };
      reader.readAsText(file);
    });
  }

  // 影刀导入
  if (btnImportYingdao) {
    btnImportYingdao.addEventListener('click', async function() {
      var dirPath = yingdaoDirPath;
      if (!dirPath) {
        dirPath = await window.electronAPI.selectYingdaoDir();
        if (!dirPath) return;
        yingdaoDirPath = dirPath;
        var yingdaoDirDisplay = document.getElementById('yingdao-dir-display');
        yingdaoDirDisplay.textContent = dirPath.split(/[/\\]/).pop();
        yingdaoDirDisplay.title = dirPath;
        saveSettings();
      }

      try {
        var result = await window.electronAPI.importYingdao(dirPath);
        if (!result || !result.xmlContents || result.xmlContents.length === 0) {
          alert(t('yingdao_import_empty'));
          return;
        }

        var totalElements = [];
        var totalSkipped = 0;

        result.xmlContents.forEach(function(xmlStr) {
          var parsed = YingDao.parseXml(xmlStr);
          totalElements = totalElements.concat(parsed.elements);
          totalSkipped += parsed.skippedDesktop;
        });

        if (totalElements.length === 0) {
          var msg = t('yingdao_import_empty');
          if (totalSkipped > 0) msg += '\n' + t('yingdao_skipped_desktop', { n: totalSkipped });
          alert(msg);
          return;
        }

        var existingKeys = new Set(savedElementsCache.map(function(e) { return e.name + '|' + e.domain; }));
        var addedCount = 0;
        totalElements.forEach(function(el) {
          var key = el.name + '|' + el.domain;
          if (!existingKeys.has(key)) {
            savedElementsCache.push(el);
            existingKeys.add(key);
            addedCount++;
          }
        });

        persistData();
        loadSavedElements();

        var msg = t('yingdao_import_success', { n: addedCount });
        if (totalSkipped > 0) msg += '\n' + t('yingdao_skipped_desktop', { n: totalSkipped });
        alert(msg);
      } catch (err) {
        console.error('影刀导入失败:', err);
        alert(t('alert_import_failed'));
      }
    });
  }

  // 影刀导出
  if (btnExportYingdao) {
    btnExportYingdao.addEventListener('click', async function() {
      if (selectedSavedItems.size === 0) {
        alert(t('yingdao_export_no_selection'));
        return;
      }

      var selectedElements = savedElementsCache.filter(function(x) { return selectedSavedItems.has(x.id); });

      var dirPath = yingdaoDirPath;
      if (!dirPath) {
        dirPath = await window.electronAPI.selectYingdaoDir();
        if (!dirPath) return;
        yingdaoDirPath = dirPath;
        var yingdaoDirDisplay = document.getElementById('yingdao-dir-display');
        yingdaoDirDisplay.textContent = dirPath.split(/[/\\]/).pop();
        yingdaoDirDisplay.title = dirPath;
        saveSettings();
      }

      try {
        var exportResult = await window.electronAPI.exportYingdao({
          dirPath: dirPath,
          elements: selectedElements,
          aliases: pageAliasesCache
        });

        if (!exportResult || !exportResult.robotXmlPath) {
          alert(t('yingdao_export_empty'));
          return;
        }

        var robotXmlPath = exportResult.robotXmlPath;
        var existingContent = exportResult.existingContent;
        var groups = exportResult.groups;
        var aliases = exportResult.aliases;
        var groupCount = Object.keys(groups).length;

        if (groupCount === 0) {
          alert(t('yingdao_export_empty'));
          return;
        }

        var xmlContent = YingDao.mergeGroupsIntoXml(existingContent, groups, aliases);
        var writeResult = await window.electronAPI.writeYingdaoXml({
          xmlPath: robotXmlPath,
          content: xmlContent
        });

        if (writeResult.success) {
          alert(t('yingdao_export_success', { n: groupCount }));
        } else {
          alert(t('alert_import_failed') + ': ' + (writeResult.error || ''));
        }
      } catch (err) {
        console.error('影刀导出失败:', err);
        alert(t('alert_import_failed'));
      }
    });
  }
}

// ========== 自定义输入对话框 ==========
function showInputDialog(message, defaultValue, callback) {
  var existing = document.getElementById('custom-input-dialog');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'custom-input-dialog';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:9999;';

  var dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--pane-bg); border-radius:8px; padding:20px; min-width:300px; max-width:400px; box-shadow:0 4px 12px rgba(0,0,0,0.15);';

  var label = document.createElement('div');
  label.textContent = message;
  label.style.cssText = 'margin-bottom:12px; font-size:13px; color:var(--text-color);';

  var input = document.createElement('input');
  input.type = 'text';
  input.value = defaultValue || '';
  input.style.cssText = 'width:100%; padding:8px; border:1px solid var(--border-color); border-radius:4px; box-sizing:border-box; font-size:13px; background:var(--bg-color); color:var(--text-color);';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:12px;';

  var btnCancel = document.createElement('button');
  btnCancel.className = 'btn secondary';
  btnCancel.textContent = currentLang === 'zh' ? '取消' : 'Cancel';
  btnCancel.onclick = function() { overlay.remove(); callback(null); };

  var btnOk = document.createElement('button');
  btnOk.className = 'btn';
  btnOk.textContent = currentLang === 'zh' ? '确定' : 'OK';
  btnOk.onclick = function() { overlay.remove(); callback(input.value); };

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') btnOk.click();
    if (e.key === 'Escape') btnCancel.click();
  });

  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnOk);
  dialog.appendChild(label);
  dialog.appendChild(input);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  input.focus();
  input.select();
}
