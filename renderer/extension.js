// extension.js - 扩展 WebSocket 通信
// 依赖: state.js

// ========== 扩展通信初始化 ==========
function initExtensionCommunication() {
  // 监听扩展连接状态
  window.electronAPI.onExtensionStatus((connected) => {
    extensionConnected = connected;
    connectionBar.className = 'connection-bar ' + (connected ? 'connected' : 'disconnected');
    connectionText.textContent = t(connected ? 'extension_connected' : 'extension_disconnected');
    btnPick.disabled = !connected;

    if (connected && !hasEverConnected) {
      hasEverConnected = true;
      var overlay = document.getElementById('loading-overlay');
      if (overlay) {
        overlay.style.transition = 'opacity 0.3s';
        overlay.style.opacity = '0';
        setTimeout(function() { overlay.remove(); }, 300);
      }
    }
  });

  // 监听来自扩展的消息
  window.electronAPI.onFromExtension(function(msg) {
    if (msg.action === 'element_picked') {
      handleElementPicked(msg.payload);
    } else if (msg.action === 'picking_stopped') {
      btnPick.innerText = t('btn_pick');
      btnPick.disabled = !extensionConnected;
    } else if (msg.action === 'validate_response') {
      handleValidateResponse(msg);
    } else if (msg.action === 'validate_many_response') {
      handleValidateManyResponse(msg);
    } else if (msg.action === 'validate_candidates_response') {
      handleValidateCandidatesResponse(msg);
    } else if (msg.action === 'get_current_url_response') {
      var cb = pendingValidations.get(msg.requestId);
      if (cb) { cb(msg.url); pendingValidations.delete(msg.requestId); }
    } else if (msg.action === 'navigate_response') {
      var cb = pendingValidations.get(msg.requestId);
      if (cb) { cb(msg.success); pendingValidations.delete(msg.requestId); }
    }
  });
}

// 向扩展发送消息
function sendToExtension(msg) {
  if (!extensionConnected) {
    alert(t('alert_connection_failed'));
    return false;
  }
  window.electronAPI.sendToExtension(msg);
  return true;
}

// ========== 验证响应处理 ==========
function handleValidateResponse(msg) {
  var cb = pendingValidations.get(msg.requestId);
  if (cb) {
    cb(msg.result);
    pendingValidations.delete(msg.requestId);
  }
}

function handleValidateManyResponse(msg) {
  var cb = pendingValidations.get(msg.requestId);
  if (cb) {
    cb(msg.results);
    pendingValidations.delete(msg.requestId);
  }
}

function handleValidateCandidatesResponse(msg) {
  var cb = pendingValidations.get(msg.requestId);
  if (cb) {
    cb(msg.results);
    pendingValidations.delete(msg.requestId);
  }
}
