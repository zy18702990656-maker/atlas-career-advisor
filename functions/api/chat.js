/* ============================================================
   EdgeOne Pages 边缘函数 · Claude 代理
   ------------------------------------------------------------
   路由：自动映射到  /api/chat
   作用：作为前端与 Anthropic 官方 API 之间的安全代理。
        真实 API Key 只存在这里（通过环境变量读取），
        前端永远拿不到，避免被扒源码盗刷。
   ------------------------------------------------------------
   【你需要做的唯一一件事】
   在 EdgeOne Pages 控制台 → 项目 → 设置 → 环境变量，新增：
       变量名：ANTHROPIC_API_KEY
       值    ：你的 Anthropic API Key（sk-ant-...）
   （可选）ANTHROPIC_MODEL = claude-opus-4.8   不填则用默认值
   配好后重新部署即可生效。
   ============================================================ */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-4.8';
const MAX_TOKENS = 1500;

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
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({
      reply: '⚠️ 服务端尚未配置 API Key。请在 EdgeOne 控制台为项目添加环境变量 ANTHROPIC_API_KEY 后重新部署。',
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
  const model = payload.model || env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  // 规整为 Anthropic 官方 messages 格式：只保留 user / assistant，内容转字符串
  const messages = rawMessages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({ role: m.role, content: String(m.content) }));

  if (messages.length === 0) {
    return json({ error: '没有可用的对话内容。' }, 400);
  }

  // 调用 Anthropic 官方 API
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000); // 55s 超时保护

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: system || undefined,
        messages,
      }),
    });
    clearTimeout(timer);

    const data = await upstream.json();

    if (!upstream.ok) {
      const msg = (data && data.error && data.error.message) || `上游返回 ${upstream.status}`;
      return json({ reply: `调用模型出错：${msg}`, error: 'upstream_error', status: upstream.status }, 200);
    }

    // 提取文本回复
    const reply = Array.isArray(data.content)
      ? data.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
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
