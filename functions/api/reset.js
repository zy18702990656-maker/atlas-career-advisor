/* ============================================================
   Cloudflare Pages Functions · 一次性清零统计数据
   ------------------------------------------------------------
   路由：自动映射到  /api/reset
   作用：清空 KV 里所有统计数据（counters/dims/days/recent_q/uv_set/day:*），
        用于清掉测试样本，让看板从零开始只记真实访客。
   ------------------------------------------------------------
   【安全】必须带正确密钥才能清零，防止被人乱调：
     GET /api/reset?key=你的密钥
   密钥来源（二选一）：
     1) 环境变量 RESET_KEY（推荐，改一下就能换）
     2) 未设置环境变量时，回退用下面的 DEFAULT_KEY
   依赖同一个 KV 绑定：ATLAS_STATS
   ============================================================ */

const DEFAULT_KEY = 'atlas-reset-2026';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest({ request, env }) {
  const kv = env.ATLAS_STATS;
  if (!kv) return json({ ok: false, error: 'no_kv', message: 'KV 未绑定' }, 200);

  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const expect = env.RESET_KEY || DEFAULT_KEY;
  if (key !== expect) {
    return json({ ok: false, error: 'forbidden', message: '密钥错误，禁止清零' }, 403);
  }

  // 收集所有需要删除的 key
  const toDelete = ['counters', 'dims', 'days', 'recent_q', 'uv_set'];

  // day:* 全量清（KV list 可能分页，循环取完）
  let cursor;
  do {
    const res = await kv.list({ prefix: 'day:', cursor });
    for (const k of res.keys) toDelete.push(k.name);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);

  // 执行删除
  let deleted = 0;
  for (const k of toDelete) {
    try { await kv.delete(k); deleted += 1; } catch {}
  }

  return json({
    ok: true,
    message: '已清零，看板将从零开始只记录真实访客',
    deleted,
    keys: toDelete,
  });
}
