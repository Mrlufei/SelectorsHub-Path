// io.js - 自定义输入对话框
// 依赖: state.js

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
