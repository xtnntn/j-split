// J-Split 日文意群翻译 - Content Script

(function () {
  let hostElement = null;
  let shadowRoot = null;
  let currentSelectionText = '';
  let lastRange = null;

  // 初始化 Shadow DOM 容器
  function initHost() {
    if (hostElement) return;

    hostElement = document.createElement('div');
    hostElement.id = 'j-split-translator-host';
    document.body.appendChild(hostElement);

    shadowRoot = hostElement.attachShadow({ mode: 'open' });

    // 引入隔离的 CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/content.css');
    shadowRoot.appendChild(link);
  }

  // 判断是否含有日文字符（平假名、片假名、常用汉字）
  function containsJapanese(text) {
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
  }

  // 获取配置
  async function getConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (response) => {
        resolve(response || { triggerMode: 'bubble' });
      });
    });
  }

  // 监听鼠标抬起事件
  document.addEventListener('mouseup', async (e) => {
    // 如果点击的是我们自己的插件浮窗内部，不重新触发划词检测
    if (hostElement && hostElement.contains(e.target)) {
      return;
    }

    const selection = window.getSelection();
    const text = selection.toString().trim();

    // 如果没有选中文本，或纯标点/空格
    if (!text || text.length < 2) {
      // 延时关闭触发小气泡（避免点击气泡时被判定为空而关掉）
      setTimeout(() => {
        const bubble = shadowRoot?.querySelector('.trigger-bubble');
        if (bubble && !bubble.contains(e.target)) {
          removeBubble();
        }
      }, 150);
      return;
    }

    // 只对包含日文字符的文本响应
    if (!containsJapanese(text)) {
      removeBubble();
      return;
    }

    initHost();
    currentSelectionText = text;

    try {
      const range = selection.getRangeAt(0);
      lastRange = range.cloneRange();
      const rect = range.getBoundingClientRect();

      const config = await getConfig();

      if (config.triggerMode === 'auto') {
        removeBubble();
        showPopupCard(rect, text);
      } else {
        // 气泡模式：在选区末尾显示小气泡
        showTriggerBubble(rect, text);
      }
    } catch (err) {
      console.error('[J-Split] Selection error:', err);
    }
  });

  // 点击页面任意空白处关闭浮层和气泡
  document.addEventListener('mousedown', (e) => {
    if (!hostElement) return;

    // 点击事件的目标如果是宿主元素内的节点，则不关闭
    const path = e.composedPath();
    if (path.includes(hostElement)) {
      return;
    }

    removeBubble();
    removePopupCard();
  });

  // 移除气泡
  function removeBubble() {
    const bubble = shadowRoot?.querySelector('.trigger-bubble');
    if (bubble) bubble.remove();
  }

  // 移除主卡片
  function removePopupCard() {
    const card = shadowRoot?.querySelector('.popup-card');
    if (card) card.remove();
  }

  // 计算浮层绝对坐标（防边缘溢出）
  function calculatePosition(rect, elementWidth, elementHeight) {
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let left = rect.left + scrollX;
    let top = rect.bottom + scrollY + 8; // 在选区下方 8px

    const viewportWidth = window.innerWidth;
    const maxLeft = scrollX + viewportWidth - elementWidth - 16;

    if (left > maxLeft) {
      left = Math.max(scrollX + 16, maxLeft);
    }

    return { top, left };
  }

  // 显示触发小气泡
  function showTriggerBubble(rect, text) {
    removeBubble();

    const bubble = document.createElement('div');
    bubble.className = 'trigger-bubble';
    bubble.innerHTML = `
      <span class="bubble-icon">🌸</span>
      <span>意群翻译</span>
    `;

    // 放置在选区右下角
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    const top = rect.bottom + scrollY + 4;
    const left = Math.min(rect.right + scrollX + 4, window.innerWidth + scrollX - 100);

    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;

    bubble.addEventListener('click', (e) => {
      e.stopPropagation();
      removeBubble();
      showPopupCard(rect, text);
    });

    shadowRoot.appendChild(bubble);
  }

  // 显示主翻译卡片
  function showPopupCard(rect, text) {
    removePopupCard();

    const card = document.createElement('div');
    card.className = 'popup-card';

    const cardWidth = 440;
    const { top, left } = calculatePosition(rect, cardWidth, 400);

    card.style.top = `${top}px`;
    card.style.left = `${left}px`;

    // 初始骨架 Loading 状态
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">
          <span class="card-title-icon">🌸</span>
          <span>J-Split 日文意群拆解</span>
        </div>
        <div class="card-actions">
          <button class="action-btn close" title="关闭">✕</button>
        </div>
      </div>
      <div class="card-body">
        <div class="original-box">
          <div class="original-sentence">${escapeHtml(text)}</div>
        </div>
        <div class="loading-box">
          <div class="spinner"></div>
          <div>AI 正在深度拆解句法与意群...</div>
          <div style="width: 100%; margin-top: 10px;">
            <div class="skeleton-line" style="width: 90%;"></div>
            <div class="skeleton-line" style="width: 75%;"></div>
            <div class="skeleton-line" style="width: 85%;"></div>
          </div>
        </div>
      </div>
    `;

    // 绑定关闭按钮
    card.querySelector('.close').addEventListener('click', (e) => {
      e.stopPropagation();
      removePopupCard();
    });

    shadowRoot.appendChild(card);

    // 请求大模型进行意群拆解翻译
    chrome.runtime.sendMessage(
      { action: 'TRANSLATE_SENTENCE', text: text },
      (response) => {
        if (!shadowRoot.contains(card)) return; // 已经被用户关闭了

        if (!response || !response.success) {
          renderError(card, response?.error || '请求失败，请稍后重试。');
        } else {
          renderResult(card, text, response.data);
        }
      }
    );
  }

  // 渲染成功结果
  function renderResult(card, originalText, data) {
    const cardBody = card.querySelector('.card-body');
    const header = card.querySelector('.card-header');

    // 在头部增加复制按钮
    const actions = card.querySelector('.card-actions');
    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn';
    copyBtn.title = '复制翻译结果';
    copyBtn.innerHTML = '📋';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const copyContent = `${data.translation}\n\n[短语拆解]\n` + 
        (data.phrases || []).map(p => `${p.japanese} (${p.reading || ''}): ${p.meaning} [${p.role || ''}]`).join('\n');
      navigator.clipboard.writeText(copyContent).then(() => {
        copyBtn.innerHTML = '✅';
        setTimeout(() => copyBtn.innerHTML = '📋', 2000);
      });
    });
    actions.insertBefore(copyBtn, actions.firstChild);

    // 生成短语卡片列表 HTML
    let phrasesHtml = '';
    if (data.phrases && Array.isArray(data.phrases) && data.phrases.length > 0) {
      phrasesHtml = data.phrases.map(p => `
        <div class="phrase-card">
          <div class="phrase-top-row">
            <div class="phrase-term-group">
              <span class="phrase-japanese">${escapeHtml(p.japanese || '')}</span>
              ${p.reading ? `<span class="phrase-reading">[${escapeHtml(p.reading)}]</span>` : ''}
            </div>
            ${p.role ? `<span class="phrase-role-badge">${escapeHtml(p.role)}</span>` : ''}
          </div>
          <div class="phrase-meaning">${escapeHtml(p.meaning || '')}</div>
          ${p.notes ? `
            <div class="phrase-notes">
              <span class="phrase-notes-icon">💡</span>
              <span>${escapeHtml(p.notes)}</span>
            </div>
          ` : ''}
        </div>
      `).join('');
    } else {
      phrasesHtml = '<div style="color: #9ca3af; font-size: 12px;">未能提取到独立短语</div>';
    }

    cardBody.innerHTML = `
      <!-- 原文与全句假名 -->
      <div class="original-box">
        <div class="original-sentence">${escapeHtml(originalText)}</div>
        ${data.hiragana ? `<div class="original-hiragana">📖 读音：${escapeHtml(data.hiragana)}</div>` : ''}
      </div>

      <!-- 整句自然翻译 -->
      <div class="translation-hero">
        <div class="section-label">🎯 整句翻译</div>
        <div class="translation-text">${escapeHtml(data.translation || '（暂无整句翻译）')}</div>
      </div>

      <!-- 短语意群拆解 -->
      <div class="phrase-section-title">
        <span>🧩 短语意群拆解 (${data.phrases ? data.phrases.length : 0})</span>
      </div>
      <div class="phrases-list">
        ${phrasesHtml}
      </div>
    `;

    // 增加底部状态栏（耗时与模型名称）
    let footer = card.querySelector('.card-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'card-footer';
      card.appendChild(footer);
    }

    const duration = data._meta?.duration || '0.8';
    const modelName = data._meta?.model || 'AI';
    footer.innerHTML = `
      <div class="footer-meta">
        <span class="model-tag">${escapeHtml(modelName)}</span>
        <span>⏱️ ${duration}s</span>
      </div>
      <span style="font-size: 11px;">J-Split Assistant</span>
    `;
  }

  // 渲染错误信息
  function renderError(card, errorMessage) {
    const cardBody = card.querySelector('.card-body');
    cardBody.innerHTML = `
      <div class="error-box">
        <div class="error-title">⚠️ 分析失败</div>
        <div>${escapeHtml(errorMessage)}</div>
        <div style="margin-top: 10px; font-size: 11px; color: #4b5563;">
          提示：请点击浏览器右上角的扩展图标 🌸，检查是否已正确填写 <strong>API Key</strong> 和选择模型。
        </div>
      </div>
    `;
  }

  // HTML 字符转义防止 XSS
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
