// ==UserScript==
// @name         J-Split 日文意群助读与划词翻译 (零间距纯净虚线版)
// @namespace    https://github.com/xtnntn/j-split
// @version      2.7.0
// @description  无感日文沉浸阅读：零排版变形、间断精致小虚线自然切分、整句上下文感知精准翻译、底部小字平假名注音、macOS Dock级高透玻璃气泡。
// @author       xtnntn
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      tokendance.space
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ==================== 默认配置与存储 ====================
  const DEFAULT_CONFIG = {
    baseUrl: 'https://tokendance.space/gateway/v1',
    apiKey: '',
    model: 'qwen3.8-flash',
    separatorStyle: 'dash-only', // 'dash-only' (纯虚线零间距，推荐) 或 'compact-slash' (紧凑微斜杠)
    cachedModels: []
  };

  const TRANSLATE_CACHE = new Map();

  async function getStoredConfig() {
    try {
      if (typeof GM_getValue !== 'undefined') {
        const conf = await GM_getValue('JSPLIT_CONFIG', null);
        if (conf) return { ...DEFAULT_CONFIG, ...conf };
      }
    } catch (e) {}
    try {
      const local = localStorage.getItem('JSPLIT_CONFIG');
      if (local) return { ...DEFAULT_CONFIG, ...JSON.parse(local) };
    } catch (e) {}
    return { ...DEFAULT_CONFIG };
  }

  async function setStoredConfig(conf) {
    try {
      if (typeof GM_setValue !== 'undefined') {
        await GM_setValue('JSPLIT_CONFIG', conf);
      }
    } catch (e) {}
    try {
      localStorage.setItem('JSPLIT_CONFIG', JSON.stringify(conf));
    } catch (e) {}
  }

  function requestNet(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: options.method || 'GET',
          url: options.url,
          headers: options.headers || {},
          data: options.body || null,
          onload: (response) => {
            if (response.status >= 200 && response.status < 300) {
              resolve({
                status: response.status,
                text: () => Promise.resolve(response.responseText),
                json: () => Promise.resolve(JSON.parse(response.responseText))
              });
            } else {
              reject(new Error(`HTTP ${response.status}: ${response.responseText}`));
            }
          },
          onerror: () => reject(new Error('网络请求异常'))
        });
      } else {
        fetch(options.url, {
          method: options.method || 'GET',
          headers: options.headers || {},
          body: options.body || null
        }).then(res => {
          if (!res.ok) return res.text().then(t => { throw new Error(`HTTP ${res.status}: ${t}`); });
          resolve(res);
        }).catch(reject);
      }
    });
  }

  // ==================== CSS 样式 (零排版膨胀，文字紧贴，纯靠间断虚线) ====================
  const GLOBAL_STYLES = `
    /* 控制条胶囊 */
    #jsplit-control-bar {
      position: fixed !important;
      right: 20px !important;
      bottom: 60px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      background: rgba(30, 30, 36, 0.45) !important;
      backdrop-filter: blur(8px) saturate(160%) !important;
      -webkit-backdrop-filter: blur(8px) saturate(160%) !important;
      border: 0.5px solid rgba(255, 255, 255, 0.4) !important;
      border-radius: 30px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), inset 0 0.5px 0.5px rgba(255, 255, 255, 0.5) !important;
      user-select: none !important;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      color: #ffffff !important;
      overflow: hidden !important;
    }
    #jsplit-toggle-btn {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 8px 14px !important;
      cursor: pointer !important;
      transition: all 0.2s !important;
      text-shadow: 0 1px 2px rgba(0,0,0,0.7) !important;
    }
    #jsplit-toggle-btn:hover {
      background: rgba(255, 255, 255, 0.15) !important;
    }
    #jsplit-control-bar.active #jsplit-toggle-btn {
      background: rgba(232, 90, 113, 0.85) !important;
      color: #ffffff !important;
    }
    #jsplit-settings-trigger {
      padding: 8px 11px !important;
      border-left: 0.5px solid rgba(255, 255, 255, 0.25) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.2s !important;
    }
    #jsplit-settings-trigger:hover {
      background: rgba(255, 255, 255, 0.15) !important;
    }

    /* 核心：纯净间断虚线短语 (零文字间距，字距100%保持原网页紧凑，绝不撑大排版！) */
    .jsplit-chunk {
      display: inline !important;
      position: relative !important;
      cursor: pointer !important;
      border-bottom: 2px dashed rgba(232, 90, 113, 0.55) !important;
      padding-bottom: 1px !important;
      margin: 0 !important; /* 彻底去除边距，文字完全紧贴原版 */
      transition: background 0.15s ease, border-color 0.15s ease !important;
      border-radius: 2px !important;
    }
    .jsplit-chunk:hover {
      background-color: rgba(232, 90, 113, 0.12) !important;
      border-bottom: 2px solid #e85a71 !important;
      color: #d4485f !important;
    }
    .jsplit-chunk.active-chunk {
      background-color: rgba(232, 90, 113, 0.22) !important;
      border-bottom: 2px solid #e85a71 !important;
    }

    /* 微距斜杠（仅在紧凑斜杠模式下显示，微小克制） */
    .jsplit-slash {
      display: inline !important;
      margin: 0 1px !important;
      color: rgba(185, 190, 200, 0.45) !important;
      font-size: 0.75em !important;
      font-weight: 300 !important;
      user-select: none !important;
    }

    /* macOS Dock 高透水晶玻璃气泡 */
    .jsplit-apple-bubble {
      position: fixed !important;
      z-index: 2147483647 !important;
      min-width: 80px !important;
      max-width: 280px !important;
      padding: 6px 14px !important;
      border-radius: 13px !important;
      
      background: rgba(28, 28, 34, 0.28) !important;
      backdrop-filter: blur(3.5px) saturate(150%) !important;
      -webkit-backdrop-filter: blur(3.5px) saturate(150%) !important;
      border: 0.5px solid rgba(255, 255, 255, 0.45) !important;
      box-shadow: 
        0 6px 18px rgba(0, 0, 0, 0.16),
        0 1px 3px rgba(0, 0, 0, 0.08),
        inset 0 0.5px 0.5px rgba(255, 255, 255, 0.65) !important;
      
      color: #ffffff !important;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif !important;
      animation: applePopIn 0.16s cubic-bezier(0.16, 1, 0.3, 1) !important;
      pointer-events: auto !important;
      box-sizing: border-box !important;
      text-align: center !important;
      transform: translate3d(0, 0, 0) !important;
      will-change: backdrop-filter !important;
    }

    @keyframes applePopIn {
      0% { opacity: 0; transform: translateY(3px) scale(0.97); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }

    .jsplit-apple-bubble::after {
      content: '' !important;
      position: absolute !important;
      bottom: -4px !important;
      left: var(--arrow-left, 50%) !important;
      margin-left: -4px !important;
      width: 8px !important;
      height: 8px !important;
      background: rgba(28, 28, 34, 0.28) !important;
      border-right: 0.5px solid rgba(255, 255, 255, 0.45) !important;
      border-bottom: 0.5px solid rgba(255, 255, 255, 0.45) !important;
      transform: rotate(45deg) !important;
      backdrop-filter: blur(3.5px) !important;
      -webkit-backdrop-filter: blur(3.5px) !important;
    }
    .jsplit-apple-bubble.flip-top::after {
      bottom: auto !important;
      top: -4px !important;
      border-right: none !important;
      border-bottom: none !important;
      border-left: 0.5px solid rgba(255, 255, 255, 0.45) !important;
      border-top: 0.5px solid rgba(255, 255, 255, 0.45) !important;
    }

    .apple-trans-main {
      font-size: 14.5px !important;
      font-weight: 600 !important;
      color: #ffffff !important;
      line-height: 1.25 !important;
      letter-spacing: 0.2px !important;
      word-break: break-word !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 3px rgba(0, 0, 0, 0.7) !important;
    }

    .apple-reading-sub {
      font-size: 10.5px !important;
      color: rgba(255, 255, 255, 0.85) !important;
      margin-top: 2px !important;
      letter-spacing: 0.5px !important;
      font-weight: 400 !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9) !important;
      font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif !important;
    }

    .apple-loading-row {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      padding: 2px 0 !important;
      color: #ffffff !important;
      font-size: 11.5px !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8) !important;
    }
    .apple-spinner {
      display: inline-block !important;
      width: 11px !important;
      height: 11px !important;
      border: 1.5px solid rgba(255, 255, 255, 0.3) !important;
      border-top-color: #ffffff !important;
      border-radius: 50% !important;
      animation: appleSpin 0.6s linear infinite !important;
    }
    @keyframes appleSpin { to { transform: rotate(360deg); } }

    /* 设置模态窗 */
    .jsplit-settings-modal {
      position: fixed !important;
      top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
      background: rgba(0, 0, 0, 0.4) !important;
      backdrop-filter: blur(14px) !important;
      -webkit-backdrop-filter: blur(14px) !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .jsplit-settings-card {
      width: 390px !important;
      max-width: 90vw !important;
      background: rgba(34, 34, 40, 0.85) !important;
      backdrop-filter: blur(35px) !important;
      -webkit-backdrop-filter: blur(35px) !important;
      border-radius: 20px !important;
      box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.5) !important;
      border: 0.5px solid rgba(255, 255, 255, 0.25) !important;
      padding: 22px !important;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif !important;
      box-sizing: border-box !important;
      color: #ffffff !important;
    }
    .jsplit-settings-card input, .jsplit-settings-card select {
      width: 100% !important;
      box-sizing: border-box !important;
      padding: 9px 12px !important;
      border-radius: 10px !important;
      border: 0.5px solid rgba(255, 255, 255, 0.25) !important;
      font-size: 12px !important;
      background: rgba(20, 20, 24, 0.5) !important;
      color: #ffffff !important;
      outline: none !important;
    }
    .jsplit-settings-card input:focus, .jsplit-settings-card select:focus {
      border-color: #e85a71 !important;
      box-shadow: 0 0 0 2px rgba(232, 90, 113, 0.3) !important;
    }
    .apple-close-btn {
      background: rgba(255, 255, 255, 0.12) !important;
      border: none !important;
      width: 22px !important;
      height: 22px !important;
      border-radius: 50% !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      color: rgba(255, 255, 255, 0.8) !important;
      font-size: 11px !important;
      line-height: 1 !important;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = GLOBAL_STYLES;
  document.head.appendChild(styleEl);

  // ==================== 智能日文意群切分算法 ====================
  function chunkJapaneseSentence(text) {
    if (!text || text.trim().length === 0) return [];
    
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    const rawSegments = Array.from(segmenter.segment(text)).map(s => s.segment);

    const particles = new Set([
      'は', 'が', 'を', 'に', 'へ', 'で', 'と', 'から', 'より', 'まで', 'も', 'の', 'や', 'か', 'ね', 'よ', 'ぞ', 'ぜ', 'な', 'わ'
    ]);

    const auxVerbs = new Set([
      'て', 'で', 'た', 'だ', 'ない', 'ず', 'ぬ', 'れる', 'られる', 'せる', 'させる', 'ます', 'たい', 'らしい', 'そう', 'ようだ', 'ような', 'ように',
      'いる', 'いた', 'おる', 'ある', 'いく', 'いっ', 'くる', 'き', 'しまう', 'しまっ', 'おく', 'みる', 'み', '間', '間に', '時', '時に', '事', 'こと', '物', 'もの'
    ]);

    const chunks = [];
    let current = '';

    for (let i = 0; i < rawSegments.length; i++) {
      const w = rawSegments[i];

      // 标点符号吸附在词尾
      if (/^[、。，．！？!?…\s]+$/.test(w)) {
        if (current) {
          current += w;
          chunks.push(current);
          current = '';
        } else {
          chunks.push(w);
        }
        continue;
      }

      if (!current) {
        current = w;
        continue;
      }

      const isSingleKana = /^[ぁ-ん]$/.test(w);
      const isAux = auxVerbs.has(w) || particles.has(w);
      const prevEndsWithSmallKana = /[ぁぃぅぇぉっゃゅょゎん]$/.test(current);
      const isStemJoining = /^[一-龥]$/.test(current) && /^[ぁ-ん]+$/.test(w);
      const isPrefixKanji = /^[一-龥]$/.test(current) && (/^[一-龥]/.test(w) || w === 'い' || w === '出');

      if (isAux || isSingleKana || prevEndsWithSmallKana || isStemJoining || isPrefixKanji) {
        current += w;
      } else {
        chunks.push(current);
        current = w;
      }
    }

    if (current) chunks.push(current);
    return chunks.filter(c => c.trim().length > 0);
  }

  // ==================== 上下文提取器 ====================
  function getSentenceContextForChunk(chunkEl, chunkText) {
    try {
      const container = chunkEl.closest('p, div, li, article, td') || chunkEl.parentElement;
      if (!container) return chunkText;

      const fullText = container.innerText.replace(/\s*\/\s*/g, '').replace(/\s+/g, ' ');

      const sentences = fullText.split(/(?<=[。！？!?\n])/);
      for (const s of sentences) {
        if (s.includes(chunkText)) {
          return s.trim();
        }
      }
      return fullText.slice(0, 80).trim();
    } catch {
      return chunkText;
    }
  }

  // ==================== 前端就地 DOM 切分与恢复 (支持纯虚线零间距) ====================
  let isChunkModeActive = false;
  const backupNodeMap = new Map();

  function findStoryContainers() {
    const selectors = [
      '#novel_honbun',
      '.novel_sublist2',
      '.p-novel__body',
      '#novel_view',
      '.js-novel-text',
      'article',
      '.entry-content',
      '.content-body',
      '#main-content'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.length > 50) return [el];
    }

    return Array.from(document.querySelectorAll('p')).filter(p => p.innerText.length > 20 && containsJapanese(p.innerText));
  }

  function containsJapanese(text) {
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
  }

  async function enableChunkMode() {
    const containers = findStoryContainers();
    if (!containers || containers.length === 0) {
      alert('未找到可断句的日文小说段落');
      return;
    }

    const config = await getStoredConfig();

    containers.forEach((container) => {
      if (!backupNodeMap.has(container)) {
        backupNodeMap.set(container, container.innerHTML);
      }
      processTextNodesInContainer(container, config.separatorStyle);
    });

    isChunkModeActive = true;
    updateControlBarUI();
  }

  function disableChunkMode() {
    backupNodeMap.forEach((originalHtml, container) => {
      container.innerHTML = originalHtml;
    });
    backupNodeMap.clear();
    isChunkModeActive = false;
    removeActiveAppleBubble();
    updateControlBarUI();
  }

  function processTextNodesInContainer(element, separatorStyle) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeValue && containsJapanese(node.nodeValue) && node.nodeValue.trim().length > 3) {
        const parentTag = node.parentElement?.tagName?.toLowerCase();
        if (parentTag !== 'script' && parentTag !== 'style' && !node.parentElement.classList.contains('jsplit-chunk')) {
          textNodes.push(node);
        }
      }
    }

    const useSlash = (separatorStyle === 'compact-slash');

    textNodes.forEach(node => {
      const text = node.nodeValue;
      const chunks = chunkJapaneseSentence(text);
      if (chunks.length <= 1) return;

      const fragment = document.createDocumentFragment();
      chunks.forEach((chunk, i) => {
        // 如果是纯标点或空白，不加虚线
        if (/^[、。，．！？!?…\s]+$/.test(chunk)) {
          fragment.appendChild(document.createTextNode(chunk));
        } else {
          const span = document.createElement('span');
          span.className = 'jsplit-chunk';
          span.textContent = chunk;
          span.dataset.chunk = chunk;
          fragment.appendChild(span);
        }

        // 仅在紧凑斜杠模式下才插入微距斜杠，默认纯虚线模式不插入斜杠（零排版膨胀）
        if (useSlash && i < chunks.length - 1) {
          const slash = document.createElement('span');
          slash.className = 'jsplit-slash';
          slash.textContent = '/';
          fragment.appendChild(slash);
        }
      });

      node.parentNode.replaceChild(fragment, node);
    });
  }

  // ==================== Apple 高透气泡交互 ====================
  let activeAppleBubble = null;
  let activeChunkEl = null;

  function removeActiveAppleBubble() {
    if (activeAppleBubble) {
      activeAppleBubble.remove();
      activeAppleBubble = null;
    }
    if (activeChunkEl) {
      activeChunkEl.classList.remove('active-chunk');
      activeChunkEl = null;
    }
  }

  document.addEventListener('click', (e) => {
    const chunkSpan = e.target.closest('.jsplit-chunk');
    
    if (chunkSpan) {
      e.stopPropagation();
      const chunkText = chunkSpan.dataset.chunk;
      const sentenceContext = getSentenceContextForChunk(chunkSpan, chunkText);
      showAppleBubble(chunkSpan, chunkText, sentenceContext);
      return;
    }

    if (e.target.closest('.jsplit-apple-bubble') || e.target.closest('.jsplit-settings-modal')) {
      return;
    }

    removeActiveAppleBubble();
  });

  window.addEventListener('scroll', () => {
    if (activeAppleBubble && activeChunkEl) {
      positionBubbleFixed(activeChunkEl, activeAppleBubble);
    }
  }, { passive: true });

  async function showAppleBubble(targetEl, chunkText, sentenceContext) {
    removeActiveAppleBubble();

    activeChunkEl = targetEl;
    targetEl.classList.add('active-chunk');

    const bubble = document.createElement('div');
    bubble.className = 'jsplit-apple-bubble';

    // 初始 Loading 状态
    bubble.innerHTML = `
      <div class="apple-loading-row">
        <span class="apple-spinner"></span>
        <span>查询中...</span>
      </div>
      <div class="apple-reading-sub">···</div>
    `;

    document.body.appendChild(bubble);
    activeAppleBubble = bubble;
    positionBubbleFixed(targetEl, bubble);

    const cacheKey = `${sentenceContext}::${chunkText}`;
    if (TRANSLATE_CACHE.has(cacheKey)) {
      renderBubbleContent(bubble, TRANSLATE_CACHE.get(cacheKey));
      positionBubbleFixed(targetEl, bubble);
      return;
    }

    const config = await getStoredConfig();
    if (!config.apiKey || !config.apiKey.trim()) {
      bubble.innerHTML = `
        <div style="font-size: 12px; color: #f87171; margin-bottom: 4px; font-weight: 600;">未配置 API Key</div>
        <button id="apple-open-settings" style="padding: 4px 8px; background: #e85a71; color: #fff; border: none; border-radius: 6px; font-size: 10px; cursor: pointer; font-weight: 600;">
          点此配置 ⚙️
        </button>
      `;
      bubble.querySelector('#apple-open-settings').addEventListener('click', () => {
        removeActiveAppleBubble();
        openSettingsModal();
      });
      positionBubbleFixed(targetEl, bubble);
      return;
    }

    try {
      const result = await fetchContextAwareTranslation(chunkText, sentenceContext, config);
      TRANSLATE_CACHE.set(cacheKey, result);
      if (activeAppleBubble === bubble) {
        renderBubbleContent(bubble, result);
        positionBubbleFixed(targetEl, bubble);
      }
    } catch (err) {
      if (activeAppleBubble === bubble) {
        bubble.innerHTML = `
          <div style="color: #f87171; font-size: 11px;">⚠️ ${escapeHtml(err.message)}</div>
        `;
        positionBubbleFixed(targetEl, bubble);
      }
    }
  }

  function renderBubbleContent(bubble, data) {
    bubble.innerHTML = `
      <div class="apple-trans-main">${escapeHtml(data.meaning || '无释义')}</div>
      <div class="apple-reading-sub">${escapeHtml(data.reading || '')}</div>
    `;
  }

  function positionBubbleFixed(targetEl, bubble) {
    const rect = targetEl.getBoundingClientRect();
    const bubbleWidth = bubble.offsetWidth || 90;
    const bubbleHeight = bubble.offsetHeight || 38;

    let left = rect.left + (rect.width / 2) - (bubbleWidth / 2);
    let top = rect.top - bubbleHeight - 8;
    let flipTop = false;

    if (top < 10) {
      top = rect.bottom + 8;
      flipTop = true;
    }

    const margin = 10;
    const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - bubbleWidth - margin));
    const arrowCenter = (rect.left + rect.width / 2) - clampedLeft;
    const safeArrowLeft = Math.max(10, Math.min(arrowCenter, bubbleWidth - 10));

    bubble.style.setProperty('--arrow-left', `${safeArrowLeft}px`);
    bubble.style.left = `${clampedLeft}px`;
    bubble.style.top = `${top}px`;

    if (flipTop) {
      bubble.classList.add('flip-top');
    } else {
      bubble.classList.remove('flip-top');
    }
  }

  // ==================== 结合上下文的极速 API 翻译 ====================
  async function fetchContextAwareTranslation(chunkText, sentenceContext, config) {
    const baseUrl = (config.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, '');
    const model = config.model || DEFAULT_CONFIG.model;

    const systemPrompt = `你是一个精准的日文助读工具。
结合日语句子语境，翻译指定的日文短语，并给出该短语纯平假名读音。
严格输出紧凑单行JSON，禁止输出任何其他文字：
{"meaning":"中文释义","reading":"纯平假名读音"}`;

    const userPrompt = `句子上下文：${sentenceContext}
短语：${chunkText}`;

    const res = await requestNet({
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 45,
        thinking: { type: "disabled" }
      })
    });

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content || '{}';
    return cleanJson(text, chunkText);
  }

  function cleanJson(str, fallbackText) {
    let cleaned = str.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch (e) {}
      }
      return { meaning: cleaned.replace(/["'{}]/g, '').trim(), reading: fallbackText };
    }
  }

  // ==================== 右下角控制条 ====================
  let controlBarEl = null;

  function initControlBarUI() {
    if (controlBarEl) return;
    controlBarEl = document.createElement('div');
    controlBarEl.id = 'jsplit-control-bar';
    controlBarEl.innerHTML = `
      <div id="jsplit-toggle-btn" title="快捷键 Alt + S 开启/关闭">
        <span>🌸 意群助读</span>
      </div>
      <div id="jsplit-settings-trigger" title="打开 API Key 与模型配置">
        <span>⚙️</span>
      </div>
    `;
    document.body.appendChild(controlBarEl);

    controlBarEl.querySelector('#jsplit-toggle-btn').addEventListener('click', () => {
      if (isChunkModeActive) {
        disableChunkMode();
      } else {
        enableChunkMode();
      }
    });

    controlBarEl.querySelector('#jsplit-settings-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      openSettingsModal();
    });

    updateControlBarUI();
  }

  function updateControlBarUI() {
    if (!controlBarEl) return;
    const toggleBtn = controlBarEl.querySelector('#jsplit-toggle-btn');
    if (isChunkModeActive) {
      controlBarEl.classList.add('active');
      toggleBtn.innerHTML = `<span>🌸 助读中 (点击还原)</span>`;
    } else {
      controlBarEl.classList.remove('active');
      toggleBtn.innerHTML = `<span>🌸 意群助读</span>`;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
      e.preventDefault();
      if (isChunkModeActive) disableChunkMode(); else enableChunkMode();
    }
  });

  // ==================== 设置面板 (增加视觉样式单选) ====================
  async function openSettingsModal() {
    const existing = document.querySelector('.jsplit-settings-modal');
    if (existing) existing.remove();

    const config = await getStoredConfig();

    const overlay = document.createElement('div');
    overlay.className = 'jsplit-settings-modal';
    overlay.innerHTML = `
      <div class="jsplit-settings-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #ffffff;">🌸 J-Split 助读设置</h3>
          <button class="apple-close-btn" id="close-cfg">✕</button>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="font-size: 11px; font-weight: 500; color: rgba(235, 235, 245, 0.7); display: block; margin-bottom: 5px;">断句展现形态</label>
          <div style="display: flex; gap: 12px; margin-top: 4px;">
            <label style="font-size: 12px; color: #fff; cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="cfg-style" value="dash-only" ${config.separatorStyle !== 'compact-slash' ? 'checked' : ''}>
              <span>纯净断点虚线 (零间距，排版100%还原)</span>
            </label>
            <label style="font-size: 12px; color: #fff; cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="cfg-style" value="compact-slash" ${config.separatorStyle === 'compact-slash' ? 'checked' : ''}>
              <span>微距斜杠 /</span>
            </label>
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="font-size: 11px; font-weight: 500; color: rgba(235, 235, 245, 0.7); display: block; margin-bottom: 5px;">接口地址 (Base URL)</label>
          <input type="text" id="cfg-url" value="${escapeHtml(config.baseUrl)}" placeholder="https://tokendance.space/gateway/v1">
        </div>

        <div style="margin-bottom: 12px;">
          <label style="font-size: 11px; font-weight: 500; color: rgba(235, 235, 245, 0.7); display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>API Key</span>
            <a href="https://tokendance.space/keys" target="_blank" style="color: #f472b6; text-decoration: none;">去获取 Key ↗</a>
          </label>
          <input type="password" id="cfg-key" value="${escapeHtml(config.apiKey)}" placeholder="在此填入 sk-... 密钥">
        </div>

        <div style="margin-bottom: 18px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
            <label style="font-size: 11px; font-weight: 500; color: rgba(235, 235, 245, 0.7);">选择大模型 (Model)</label>
            <a href="javascript:void(0)" id="cfg-fetch" style="color: #f472b6; text-decoration: none; font-size: 11px; font-weight: 500;">🔄 自动检索模型</a>
          </div>
          <select id="cfg-model">
            <option value="${config.model}">${config.model}</option>
          </select>
          <div id="cfg-status" style="font-size: 11px; color: rgba(235, 235, 245, 0.6); margin-top: 5px;"></div>
        </div>

        <div style="display: flex; gap: 8px;">
          <button id="cfg-save" style="flex: 1; padding: 10px; background: #e85a71; color: #fff; border: none; border-radius: 12px; font-weight: 600; font-size: 13px; cursor: pointer; box-shadow: 0 4px 12px rgba(232, 90, 113, 0.4);">
            💾 保存配置
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#close-cfg').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const modelSelect = overlay.querySelector('#cfg-model');
    const fetchLink = overlay.querySelector('#cfg-fetch');
    const statusDiv = overlay.querySelector('#cfg-status');

    fetchLink.addEventListener('click', async () => {
      const bUrl = overlay.querySelector('#cfg-url').value.trim().replace(/\/+$/, '');
      const key = overlay.querySelector('#cfg-key').value.trim();
      statusDiv.style.color = '#60a5fa';
      statusDiv.textContent = '正在检索平台模型...';

      try {
        const res = await requestNet({
          method: 'GET',
          url: `${bUrl}/models`,
          headers: key ? { 'Authorization': `Bearer ${key}` } : {}
        });
        const d = await res.json();
        let list = (d.data || []).map(m => m.id);

        modelSelect.innerHTML = '';
        list.forEach(id => {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = id.includes('flash') || id.includes('speed') ? `⚡ ${id}` : id;
          modelSelect.appendChild(opt);
        });

        if (list.includes('qwen3.8-flash')) {
          modelSelect.value = 'qwen3.8-flash';
        } else if (list.includes(config.model)) {
          modelSelect.value = config.model;
        }

        statusDiv.style.color = '#34d399';
        statusDiv.textContent = `✅ 已加载 ${list.length} 个模型 (推荐 qwen3.8-flash)`;
      } catch (e) {
        statusDiv.style.color = '#f87171';
        statusDiv.textContent = `❌ ${e.message}`;
      }
    });

    overlay.querySelector('#cfg-save').addEventListener('click', async () => {
      const selectedStyle = overlay.querySelector('input[name="cfg-style"]:checked')?.value || 'dash-only';
      await setStoredConfig({
        baseUrl: overlay.querySelector('#cfg-url').value.trim(),
        apiKey: overlay.querySelector('#cfg-key').value.trim(),
        model: modelSelect.value || config.model,
        separatorStyle: selectedStyle
      });
      overlay.remove();

      // 如果当前正开着助读，重刷新一下当前排版
      if (isChunkModeActive) {
        disableChunkMode();
        enableChunkMode();
      }
    });
  }

  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('⚙️ J-Split 助读设置', openSettingsModal);
    GM_registerMenuCommand('🌸 切换意群助读 (Alt+S)', () => {
      if (isChunkModeActive) disableChunkMode(); else enableChunkMode();
    });
  }

  window.addEventListener('DOMContentLoaded', initControlBarUI);
  setTimeout(initControlBarUI, 800);

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
