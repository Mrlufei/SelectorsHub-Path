// settings.js - 设置模块（主题、语言、颜色）
// 依赖: state.js

// ========== 设置模块 ==========
function initSettings() {
  var settingsHeader = document.getElementById('settings-header');
  var settingsContent = document.getElementById('settings-content');
  var settingsArrow = document.getElementById('settings-arrow');
  var btnLangs = document.querySelectorAll('.btn-lang');
  var themeOptions = document.querySelectorAll('.theme-option');
  var colorPick = document.getElementById('color-pick');
  var colorVerify = document.getElementById('color-verify');
  var isSettingsExpanded = false;

  settingsHeader.addEventListener('click', function() {
    isSettingsExpanded = !isSettingsExpanded;
    settingsContent.style.display = isSettingsExpanded ? 'block' : 'none';
    settingsArrow.style.transform = isSettingsExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
  });

  btnLangs.forEach(function(btn) {
    btn.addEventListener('click', function() {
      btnLangs.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentLang = btn.dataset.lang;
      updatePageLanguage();
      loadSavedElements();
      if (currentCandidates.length > 0) renderCandidates();
      saveSettings();
    });
  });

  themeOptions.forEach(function(opt) {
    opt.addEventListener('click', function() {
      themeOptions.forEach(function(o) { o.classList.remove('active'); });
      opt.classList.add('active');
      if (opt.dataset.theme === 'default') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', opt.dataset.theme);
      }
      saveSettings();
    });
  });

  colorPick.addEventListener('change', function() {
    saveSettings();
    sendToExtension({ action: 'update_colors', colors: { pick: colorPick.value, verify: colorVerify.value } });
  });
  colorVerify.addEventListener('change', function() {
    saveSettings();
    sendToExtension({ action: 'update_colors', colors: { pick: colorPick.value, verify: colorVerify.value } });
  });

  var btnInstallExtension = document.getElementById('btn-install-extension');
  if (btnInstallExtension) {
    btnInstallExtension.addEventListener('click', async function() {
      await window.electronAPI.openExtensionDir();
      alert(t('install_extension_tip'));
    });
  }
}

function loadSettings() {
  try {
    var settings = JSON.parse(localStorage.getItem('settings') || '{}');
    currentLang = settings.lang || 'zh';
    updatePageLanguage();
    var btnLangs = document.querySelectorAll('.btn-lang');
    btnLangs.forEach(function(btn) { btn.classList.toggle('active', btn.dataset.lang === currentLang); });

    var theme = settings.theme || 'default';
    if (theme === 'default') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    var themeOptions = document.querySelectorAll('.theme-option');
    themeOptions.forEach(function(opt) { opt.classList.toggle('active', opt.dataset.theme === theme); });

    var colorPick = document.getElementById('color-pick');
    var colorVerify = document.getElementById('color-verify');
    colorPick.value = settings.pickColor || '#ff0000';
    colorVerify.value = settings.verifyColor || '#52c41a';
  } catch (e) { /* 忽略 */ }
  loadPersistedData();
}

function saveSettings() {
  var colorPick = document.getElementById('color-pick');
  var colorVerify = document.getElementById('color-verify');
  localStorage.setItem('settings', JSON.stringify({
    lang: currentLang,
    theme: document.documentElement.getAttribute('data-theme') || 'default',
    pickColor: colorPick ? colorPick.value : '#ff0000',
    verifyColor: colorVerify ? colorVerify.value : '#52c41a'
  }));
}
