/* ============================================================
   Cloudflare Pages Functions · DeepSeek 代理
   ------------------------------------------------------------
   路由：自动映射到  /api/chat
   作用：作为前端与 DeepSeek API 之间的安全代理。
        真实 API Key 只存在这里（通过环境变量读取），
        前端永远拿不到，避免被扒源码盗刷。
   ------------------------------------------------------------
   【你需要做的唯一一件事】
   在 Cloudflare Pages 控制台 → 你的项目 → Settings →
   Environment variables（环境变量）中新增：
       变量名：DEEPSEEK_API_KEY
       值    ：你的 DeepSeek API Key（sk-...）
   （可选）DEEPSEEK_MODEL = deepseek-chat   不填则用默认值
   配好后重新部署（或触发一次 retry deployment）即可生效。
   ------------------------------------------------------------
   说明：DeepSeek 使用 OpenAI 兼容格式。
        - deepseek-chat     ：通用对话（推荐，速度快、便宜）
        - deepseek-reasoner ：深度推理（更强但更慢更贵）
   ============================================================ */

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';
const MAX_TOKENS = 2000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export async function onRequest({ request, env }) {
  // 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method Not Allowed，请用 POST。' }, 405);
  }

  // 读取密钥（环境变量）
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json({
      reply: '⚠️ 服务端尚未配置 API Key。请在 Cloudflare Pages 控制台为项目添加环境变量 DEEPSEEK_API_KEY 后重新部署。',
      error: 'missing_api_key',
    }, 200);
  }

  // 解析前端请求体：{ model, system, messages }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON。' }, 400);
  }

  const system = typeof payload.system === 'string' ? payload.system : '';
  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const model = env.DEEPSEEK_MODEL || DEFAULT_MODEL;

  // 规整为 OpenAI 兼容 messages 格式
  const chatMessages = [];
  if (system) chatMessages.push({ role: 'system', content: system });
  for (const m of rawMessages) {
    if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
      chatMessages.push({ role: m.role, content: String(m.content) });
    }
  }

  if (chatMessages.filter(m => m.role !== 'system').length === 0) {
    return json({ error: '没有可用的对话内容。' }, 400);
  }

  // 调用 DeepSeek API
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000); // 55s 超时保护

    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        messages: chatMessages,
      }),
    });
    clearTimeout(timer);

    const data = await upstream.json();

    if (!upstream.ok) {
      const msg = (data && data.error && data.error.message) || `上游返回 ${upstream.status}`;
      return json({ reply: `调用模型出错：${msg}`, error: 'upstream_error', status: upstream.status }, 200);
    }

    // 提取文本回复（OpenAI 兼容格式）
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
      ? String(data.choices[0].message.content).trim()
      : '';

    return json({
      reply: reply || '（模型未返回文本内容）',
      model,
      usage: data.usage || null,
    });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return json({
      reply: aborted ? '请求超时，请稍后重试或精简问题。' : '服务端调用模型时发生异常，请稍后重试。',
      error: aborted ? 'timeout' : 'exception',
    }, 200);
  }
}
