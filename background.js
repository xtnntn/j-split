// J-Split 日文意群翻译 - Background Service Worker (极速优化版)

const DEFAULT_CONFIG = {
  baseUrl: 'https://tokendance.space/gateway/v1',
  apiKey: '',
  model: 'qwen3.8-flash',
  triggerMode: 'bubble'
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TRANSLATE_SENTENCE') {
    handleTranslate(request.text)
      .then(res => sendResponse({ success: true, data: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'GET_CONFIG') {
    chrome.storage.sync.get(DEFAULT_CONFIG, (config) => {
      sendResponse(config);
    });
    return true;
  }
});

function buildPrompt(sentence) {
  const systemPrompt = `你是一个超快速日语助教。严禁输出任何思考链或过程(No thinking process)，直接输出单行紧凑JSON：
{"sentence":"原文","hiragana":"读音","translation":"地道整句中文","phrases":[{"japanese":"短语","reading":"读音","role":"成分","meaning":"含义","notes":"动词变形或助词简析"}]}
原则：按自然意群切分(如“人生を”“後悔している間に”)，短小精悍。`;

  const userPrompt = sentence;
  return { systemPrompt, userPrompt };
}

async function handleTranslate(text) {
  const config = await chrome.storage.sync.get(DEFAULT_CONFIG);

  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error('请先点击浏览器右上角插件图标，配置 API Key。');
  }

  const baseUrl = (config.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, '');
  const model = config.model || DEFAULT_CONFIG.model;
  const { systemPrompt, userPrompt } = buildPrompt(text);

  const startTime = Date.now();

  const requestBody = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.1,
    max_tokens: 450,
    thinking: { type: "disabled" }
  };

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify(requestBody)
    });
  } catch (e) {
    throw new Error('网络请求异常: ' + e.message);
  }

  if (!response.ok) {
    // 如果是因为 thinking 参数不兼容报错，剔除后重试
    const errText = await response.text();
    if (errText.includes('thinking')) {
      delete requestBody.thinking;
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey.trim()}`
        },
        body: JSON.stringify(requestBody)
      });
    } else {
      let errMsg = `API 请求失败 (${response.status})`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) errMsg = errJson.error.message;
      } catch {}
      throw new Error(errMsg);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content || '';

  if (!rawContent) {
    throw new Error('模型未返回内容。');
  }

  const parsed = extractJson(rawContent);
  parsed._meta = {
    duration: duration,
    model: model
  };

  return parsed;
}

function extractJson(content) {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerErr) {}
    }
    throw new Error('解析 JSON 失败：' + cleaned.slice(0, 100));
  }
}
