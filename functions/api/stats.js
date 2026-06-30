/* ============================================================
   Cloudflare Pages Functions · 读取真实使用数据汇总
   ------------------------------------------------------------
   路由：自动映射到  /api/stats
   作用：供私人看板 dashboard.html 拉取，返回汇总后的真实数据。
   依赖同一个 KV 绑定：ATLAS_STATS
   （字段与 track.js 写入结构严格对齐）
   ============================================================ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

function todayBJ() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

async function kvGetJSON(kv, key, def) {
  try { const v = await kv.get(key); return v ? JSON.parse(v) : def; } catch { return def; }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const kv = env.ATLAS_STATS;
  if (!kv) {
    return json({
      ok: false,
      error: 'no_kv',
      message: 'KV 未绑定。请在 Cloudflare Pages 项目设置中创建并绑定 KV 命名空间，变量名填 ATLAS_STATS，然后重新部署。',
    }, 200);
  }

  const counters = await kvGetJSON(kv, 'counters', {
    total_pv: 0, total_uv: 0, total_chat: 0, total_assess: 0,
    total_path: 0, total_report: 0, total_profile: 0,
    riasec: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  });

  const days = await kvGetJSON(kv, 'days', []);
  const today = todayBJ();

  // 取最近 14 天的趋势
  const recent = days.slice(-14);
  const trend = [];
  for (const d of recent) {
    const dd = await kvGetJSON(kv, 'day:' + d, {});
    trend.push({
      date: d,
      uv: dd.uv || 0,
      pv: dd.pv || 0,
      chat: dd.chat || 0,
      assess: dd.assess || 0,
      path: dd.path || 0,
      report: dd.report || 0,
      profile: dd.profile || 0,
    });
  }

  const todayData = trend.find(t => t.date === today)
    || { date: today, uv: 0, pv: 0, chat: 0, assess: 0, path: 0, report: 0, profile: 0 };

  // 最近真实提问
  const recentQ = await kvGetJSON(kv, 'recent_q', []);

  return json({
    ok: true,
    updatedAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' (北京时间)',
    total: {
      uv: counters.total_uv || 0,
      pv: counters.total_pv || 0,
      chat: counters.total_chat || 0,
      assess: counters.total_assess || 0,
      path: counters.total_path || 0,
      report: counters.total_report || 0,
      profile: counters.total_profile || 0,
    },
    today: todayData,
    riasec: counters.riasec || { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
    recentQ: recentQ.slice(0, 30),
    trend,
  });
}
