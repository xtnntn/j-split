// 默认配置
const DEFAULT_CONFIG = {
  baseUrl: 'https://tokendance.space/gateway/v1',
  apiKey: '',
  model: 'deepseek-v3.2',
  triggerMode: 'bubble', // 'bubble' 或 'auto'
  isManualModel: false,
  cachedModels: []
};

// DOM 元素
const baseUrlInput = document.getElementById('base-url');
const apiKeyInput = document.getElementById('api-key');
const toggleKeyBtn = document.getElementById('toggle-key-visibility');
const modelSelect = document.getElementById('model-select');
const fetchModelsBtn = document.getElementById('fetch-models-btn');
const modelStatus = document.getElementById('model-status');
const manualModelCheckbox = document.getElementById('manual-model-checkbox');
const manualModelInput = document.getElementById('manual-model-input');
const triggerModeRadios = document.querySelectorAll('input[name="trigger-mode"]');
const testBtn = document.getElementById('test-btn');
const saveBtn = document.getElementById('save-btn');
const globalStatus = document.getElementById('global-status');
const quickTags = document.querySelectorAll('.tag-btn');

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  bindEvents();
});

// 加载设置
async function loadSettings() {
  const config = await chrome.storage.sync.get(DEFAULT_CONFIG);

  baseUrlInput.value = config.baseUrl || DEFAULT_CONFIG.baseUrl;
  apiKeyInput.value = config.apiKey || '';
  
  // 恢复快捷标签的高亮
  updateQuickTagActive(baseUrlInput.value);

  // 恢复单选框
  const currentRadio = document.querySelector(`input[name="trigger-mode"][value="${config.triggerMode}"]`);
  if (currentRadio) currentRadio.checked = true;

  // 恢复手动模型选项
  manualModelCheckbox.checked = !!config.isManualModel;
  if (config.isManualModel) {
    manualModelInput.style.display = 'block';
    manualModelInput.value = config.model || '';
  }

  // 恢复模型下拉列表
  if (config.cachedModels && config.cachedModels.length > 0) {
    renderModelOptions(config.cachedModels, config.model);
  } else if (config.apiKey) {
    // 如果已经有 key 但没缓存过，尝试自动拉取一次
    fetchModels(false);
  }
}

// 事件绑定
function bindEvents() {
  // 查看/隐藏 API Key
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '🙈';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '👁️';
    }
  });

  // 快捷 URL 标签
  quickTags.forEach(tag => {
    tag.addEventListener('click', () => {
      baseUrlInput.value = tag.getAttribute('data-url');
      updateQuickTagActive(baseUrlInput.value);
      if (apiKeyInput.value.trim()) {
        fetchModels(true);
      }
    });
  });

  baseUrlInput.addEventListener('input', () => {
    updateQuickTagActive(baseUrlInput.value);
  });

  // 点击检索模型按钮
  fetchModelsBtn.addEventListener('click', () => {
    fetchModels(true);
  });

  // 手动输入模型切换
  manualModelCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      manualModelInput.style.display = 'block';
      if (!manualModelInput.value && modelSelect.value) {
        manualModelInput.value = modelSelect.value;
      }
      manualModelInput.focus();
    } else {
      manualModelInput.style.display = 'none';
    }
  });

  // 保存按钮
  saveBtn.addEventListener('click', saveSettings);

  // 测试连接按钮
  testBtn.addEventListener('click', testConnection);
}

// 规范化 Base URL（去除末尾多余斜杠）
function normalizeBaseUrl(url) {
  let trimmed = url.trim().replace(/\/+$/, '');
  return trimmed;
}

// 更新快捷标签状态
function updateQuickTagActive(currentUrl) {
  const normalized = normalizeBaseUrl(currentUrl);
  quickTags.forEach(tag => {
    if (normalizeBaseUrl(tag.getAttribute('data-url')) === normalized) {
      tag.classList.add('active');
    } else {
      tag.classList.remove('active');
    }
  });
}

// 获取模型列表
async function fetchModels(isManualClick = true) {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  const apiKey = apiKeyInput.value.trim();

  if (!baseUrl) {
    showModelStatus('请先填写接口地址 (Base URL)', 'error');
    return;
  }

  fetchModelsBtn.disabled = true;
  showModelStatus('正在检索平台支持的模型...', 'loading');

  try {
    const modelsUrl = `${baseUrl}/models`;
    const headers = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: headers
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('鉴权失败 (401)：请检查 API Key 是否正确填写。');
      } else if (response.status === 404) {
        throw new Error('未找到 /models 端点 (404)：请检查 Base URL 是否正确。');
      } else {
        throw new Error(`获取模型列表失败 HTTP ${response.status}`);
      }
    }

    const data = await response.json();
    let rawList = data.data || [];

    if (!Array.isArray(rawList) || rawList.length === 0) {
      throw new Error('该服务商返回的模型列表为空。');
    }

    // 针对 tokendance 等平台过滤：优先保留支持 chat completions 的模型
    let chatModels = rawList.filter(item => {
      if (item.supported_protocols && Array.isArray(item.supported_protocols)) {
        return item.supported_protocols.some(p => p.includes('chat-completions') || p.includes('messages'));
      }
      // 如果没有标注协议，排除明显的纯语音、嵌入或视频模型
      const id = (item.id || '').toLowerCase();
      if (id.includes('embedding') || id.includes('tts') || id.includes('video') || id.includes('dall-e')) {
        return false;
      }
      return true;
    });

    // 如果过滤后没了，就使用完整列表
    const finalModels = chatModels.length > 0 ? chatModels : rawList;

    // 格式化为标准模型对象列表
    const models = finalModels.map(item => ({
      id: item.id,
      name: item.name || item.id,
      description: item.description || ''
    }));

    // 获取当前已选中的模型
    const currentSelected = manualModelCheckbox.checked ? manualModelInput.value : modelSelect.value;
    
    // 渲染下拉选项
    renderModelOptions(models, currentSelected);

    // 存入本地缓存
    chrome.storage.sync.set({ cachedModels: models });

    showModelStatus(`✅ 已成功检索到 ${models.length} 个对话模型`, 'success');

  } catch (err) {
    console.error('Fetch models error:', err);
    showModelStatus(`❌ ${err.message}`, 'error');
  } finally {
    fetchModelsBtn.disabled = false;
  }
}

// 渲染模型下拉列表
function renderModelOptions(models, selectedId) {
  modelSelect.innerHTML = '';

  if (!models || models.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- 暂无可用模型，请点击检索 --';
    modelSelect.appendChild(opt);
    return;
  }

  // 排序：将推荐的高性价比模型（如 deepseek、qwen、minimax、gpt-4o-mini 等）排在前面
  const sorted = [...models].sort((a, b) => {
    const score = (m) => {
      const id = m.id.toLowerCase();
      if (id.includes('deepseek-v3')) return 100;
      if (id.includes('qwen3-max') || id.includes('qwen-2.5')) return 90;
      if (id.includes('minimax-m2.5')) return 80;
      if (id.includes('glm-5') || id.includes('glm-4.7')) return 70;
      if (id.includes('gpt-4o-mini') || id.includes('gemini-2.0-flash')) return 60;
      return 10;
    };
    return score(b) - score(a);
  });

  sorted.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id;
    modelSelect.appendChild(opt);
  });

  // 恢复之前的选中项
  if (selectedId && sorted.some(m => m.id === selectedId)) {
    modelSelect.value = selectedId;
  } else if (!selectedId && sorted.length > 0) {
    modelSelect.value = sorted[0].id;
  }
}

// 显示模型状态文字
function showModelStatus(msg, type) {
  modelStatus.textContent = msg;
  modelStatus.className = `status-msg ${type}`;
}

// 显示全局保存/测试状态提示
function showGlobalStatus(msg, type, duration = 4000) {
  globalStatus.textContent = msg;
  globalStatus.className = `global-status ${type}`;
  if (duration > 0) {
    setTimeout(() => {
      globalStatus.style.display = 'none';
    }, duration);
  }
}

// 获取当前用户设置
function getFormConfig() {
  const isManual = manualModelCheckbox.checked;
  const selectedModel = isManual ? manualModelInput.value.trim() : modelSelect.value;
  const triggerMode = document.querySelector('input[name="trigger-mode"]:checked')?.value || 'bubble';

  return {
    baseUrl: normalizeBaseUrl(baseUrlInput.value),
    apiKey: apiKeyInput.value.trim(),
    model: selectedModel,
    triggerMode: triggerMode,
    isManualModel: isManual
  };
}

// 保存设置
async function saveSettings() {
  const config = getFormConfig();

  if (!config.baseUrl) {
    showGlobalStatus('请填写 Base URL', 'error');
    return;
  }

  if (!config.model) {
    showGlobalStatus('请选择或输入要使用的模型', 'error');
    return;
  }

  try {
    saveBtn.disabled = true;
    await chrome.storage.sync.set(config);
    showGlobalStatus('✅ 配置保存成功！可在网页中划选日文体验。', 'success');
  } catch (err) {
    showGlobalStatus(`❌ 保存失败: ${err.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

// 测试连接
async function testConnection() {
  const config = getFormConfig();

  if (!config.baseUrl) {
    showGlobalStatus('请先填写 Base URL', 'error');
    return;
  }
  if (!config.apiKey) {
    showGlobalStatus('请先填写 API Key', 'error');
    return;
  }
  if (!config.model) {
    showGlobalStatus('请先选择一个模型', 'error');
    return;
  }

  testBtn.disabled = true;
  showGlobalStatus('正在测试调用大模型 API...', 'loading', 0);

  try {
    const testSentence = 'こんにちは、世界！';
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'user', content: `请将这句日语简要翻译成中文：“${testSentence}”` }
        ],
        max_tokens: 60
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      let detail = '';
      try {
        const parsed = JSON.parse(errBody);
        detail = parsed.error?.message || errBody;
      } catch {
        detail = errBody;
      }
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '无返回内容';
    showGlobalStatus(`🎉 测试成功！模型 ${config.model} 响应正常: "${reply.trim()}"`, 'success', 6000);
  } catch (err) {
    console.error('Test connection error:', err);
    showGlobalStatus(`❌ 测试失败: ${err.message}`, 'error', 7000);
  } finally {
    testBtn.disabled = false;
  }
}
