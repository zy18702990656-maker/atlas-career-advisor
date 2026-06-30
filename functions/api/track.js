/* ============================================================
   Cloudflare Pages Functions · 真实使用数据记录
   ------------------------------------------------------------
   路由：自动映射到  /api/track
   作用：接收前端上报的真实使用事件，累加写入 KV 存储。
   ------------------------------------------------------------
   【你需要做的一件事】
   在 Cloudflare Pages 控制台为项目绑定一个 KV 命名空间，
   变量名（Binding name）填：  ATLAS_STATS
   未绑定时本函数会安全跳过，不报错、不影响网站。
   ------------------------------------------------------------
   前端上报的事件 event（与 app.js 的 track() 一一对应）：
     pageview      打开网站（PV + 唯一访客 UV）
     profile_save  保存背景档案
     assess_done   完成职业测评（meta.top1 = 核心 RIASEC 类型）
     path_gen      生成职业路径图谱
     ai_chat       发起一次 AI 咨询（meta.q = 用户提问，仅留存最近若干条）
     report_export 导出报告
   ============================================================ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// 北京时间日期 YYYY-MM-DD
function todayBJ() {
  const now = new Date(Date.now() + 8 * 3600 * 1000); // UTC+8
  return now.toISOString().slice(0, 10);
}

async function kvGetJSON(kv, key, def) {
  try {
    const v = await kv.get(key);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  const kv = env.ATLAS_STATS;
  // 未绑定 KV：安全跳过，前端不受影响
  if (!kv) return json({ ok: false, skipped: 'no_kv' }, 200);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const event = String(body.event || '').slice(0, 24);
  const vid = String(body.vid || '').slice(0, 40);     // 前端生成的匿名访客ID
  const meta = (body.meta && typeof body.meta === 'object') ? body.meta : {};
  if (!event) return json({ ok: false, error: 'no_event' }, 400);

  const day = todayBJ();

  // ---- 总览计数 ----
  const counters = await kvGetJSON(kv, 'counters', {
    total_pv: 0, total_uv: 0, total_chat: 0, total_assess: 0,
    total_path: 0, total_report: 0, total_profile: 0,
    riasec: { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
  });

  // ---- 当日数据 ----
  const dayData = await kvGetJSON(kv, 'day:' + day, {
    pv: 0, uv: 0, chat: 0, assess: 0, path: 0, report: 0, profile: 0, visitors: {},
  });

  let firstSeenToday = false;

  switch (event) {
    case 'pageview': {
      counters.total_pv += 1;
      dayData.pv += 1;
      if (vid && !dayData.visitors[vid]) {
        dayData.visitors[vid] = 1;
        dayData.uv += 1;
        firstSeenToday = true;
      }
      break;
    }
    case 'profile_save': {
      counters.total_profile += 1;
      dayData.profile += 1;
      break;
    }
    case 'assess_done': {
      counters.total_assess += 1;
      dayData.assess += 1;
      const top1 = String(meta.top1 || '').slice(0, 2);
      if (counters.riasec[top1] !== undefined) counters.riasec[top1] += 1;
      break;
    }
    case 'path_gen': {
      counters.total_path += 1;
      dayData.path += 1;
      break;
    }
    case 'ai_chat': {
      counters.total_chat += 1;
      dayData.chat += 1;
      // 记录最近 30 条真实提问（供你看"用户都在咨询什么"）
      const q = String(meta.q || '').slice(0, 120).trim();
      if (q) {
        const recent = await kvGetJSON(kv, 'recent_q', []);
        recent.unshift({ q, t: Date.now() });
        if (recent.length > 30) recent.length = 30;
        try { await kv.put('recent_q', JSON.stringify(recent)); } catch {}
      }
      break;
    }
    case 'report_export': {
      counters.total_report += 1;
      dayData.report += 1;
      break;
    }
    default:
      return json({ ok: false, error: 'unknown_event' }, 400);
  }

  // 累计唯一访客（首次出现的访客 +1）
  if (firstSeenToday) {
    const seen = await kvGetJSON(kv, 'uv_set', {});
    if (!seen[vid]) { seen[vid] = day; counters.total_uv += 1; try { await kv.put('uv_set', JSON.stringify(seen)); } catch {} }
  }

  // ---- 日期索引（保留最近 60 天）----
  let days = await kvGetJSON(kv, 'days', []);
  if (!days.includes(day)) {
    days.push(day); days.sort();
    if (days.length > 60) { const drop = days.shift(); try { await kv.delete('day:' + drop); } catch {} }
  }

  try {
    await Promise.all([
      kv.put('counters', JSON.stringify(counters)),
      kv.put('day:' + day, JSON.stringify(dayData)),
      kv.put('days', JSON.stringify(days)),
    ]);
  } catch (e) {
    return json({ ok: false, error: 'kv_write' }, 200);
  }

  return json({ ok: true });
}
