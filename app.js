/* ============================================================
   ATLAS · AI 职业规划助手
   ------------------------------------------------------------
   全部交互逻辑 + 高保真模拟 AI 引擎 + 真实模型接入点
   ============================================================ */

/* ============================================================
   【真实模型接入点】★★★ 接入 DeepSeek 只需改这里 ★★★
   ------------------------------------------------------------
   默认 MODE = 'mock'，使用本地高保真模拟引擎，无需密钥即可演示。
   拿到 Claude API Key 后：
     1) 把 AI_CONFIG.mode 改为 'api'
     2) 部署一个后端/边缘函数代理（推荐 EdgeOne 边缘函数），
        把 endpoint 指向你的代理地址（代理里再持有真实密钥，
        切勿把密钥写进前端）。
   代理需返回 { reply: "..." } 或标准 Anthropic messages 响应。
   ============================================================ */
const AI_CONFIG = {
  mode: 'api',                  // 'mock' | 'api' —— 已切换为真实模型代理
  model: 'deepseek-chat',
  endpoint: '/api/chat',        // EdgeOne 边缘函数代理地址（functions/api/chat.js）
  fallbackToMock: true,         // 代理不可用/未配置Key时，自动降级为本地模拟，保证不空屏
};

/**
 * 统一的 AI 调用入口。其它模块只调用这个函数。
 * @param {Array<{role:string,content:string}>} messages 完整对话历史
 * @param {string} systemPrompt 系统提示（含用户档案上下文）
 * @param {(chunk:string)=>void} onToken 流式回调
 * @returns {Promise<string>} 完整回复
 */
async function streamOut(text, onToken, step = 1, delay = 14) {
  for (let i = 0; i < text.length; i += step) {
    onToken && onToken(text.slice(i, i + step));
    await sleep(text[i] === '\n' ? 40 : delay);
  }
  return text;
}

async function callAI(messages, systemPrompt, onToken) {
  if (AI_CONFIG.mode === 'api') {
    try {
      // —— 真实模型分支（接入 DeepSeek 的边缘函数代理）——
      const res = await fetch(AI_CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: AI_CONFIG.model, system: systemPrompt, messages }),
      });
      const data = await res.json();
      // 代理未配置 Key 或上游异常时，自动降级到本地模拟，保证体验不中断
      if (data.error && AI_CONFIG.fallbackToMock && (data.error === 'missing_api_key' || data.error === 'upstream_error')) {
        return streamOut(MockEngine.respond(messages, systemPrompt), onToken);
      }
      const text = data.reply || (data.content && data.content[0] && data.content[0].text) || '（未获取到模型回复）';
      return streamOut(text, onToken, 2, 12);
    } catch (e) {
      // 网络/代理彻底不可用 → 降级模拟
      if (AI_CONFIG.fallbackToMock) return streamOut(MockEngine.respond(messages, systemPrompt), onToken);
      return streamOut('网络异常，暂时无法连接 AI 服务，请稍后重试。', onToken);
    }
  }
  // —— 纯模拟分支 ——
  return streamOut(MockEngine.respond(messages, systemPrompt), onToken);
}

/* ============================================================
   通用工具
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem('atlas_' + k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem('atlas_' + k, JSON.stringify(v)),
};
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast._t); toast._t = setTimeout(() => {
    t.classList.remove('show'); setTimeout(() => t.hidden = true, 300);
  }, 2600);
}
function escapeHTML(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function mdLite(s){
  return escapeHTML(s)
    .replace(/^### (.*)$/gm,'<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/^- (.*)$/gm,'<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s,'<ul>$1</ul>')
    .replace(/\n{2,}/g,'<br/><br/>')
    .replace(/\n/g,'<br/>');
}

/* ============================================================
   状态：用户档案 / 测评 / 路径
   ============================================================ */
const State = {
  profile: store.get('profile') || {},
  assess: store.get('assess') || null,
  path: store.get('path') || null,
};

function buildSystemPrompt() {
  const p = State.profile, a = State.assess;
  let ctx = '你是 ATLAS，一名顶级的 AI 职业规划顾问，由 DeepSeek 驱动。回答专业、结构化、有同理心，给出可执行建议。';
  const bits = [];
  if (p.name) bits.push(`姓名:${p.name}`);
  if (p.age) bits.push(`年龄段:${p.age}`);
  if (p.education) bits.push(`学历:${p.education}`);
  if (p.major) bits.push(`专业:${p.major}`);
  if (p.role) bits.push(`当前:${p.role}`);
  if (p.years) bits.push(`年限:${p.years}`);
  if (p.skills) bits.push(`技能:${p.skills}`);
  if (p.goal) bits.push(`目标/困惑:${p.goal}`);
  if (bits.length) ctx += '\n【用户档案】' + bits.join('；');
  if (a && a.top) ctx += `\n【测评结果】职业适配画像偏向:${a.top.map(t => t.label).join('、')}`;
  return ctx;
}

/* ============================================================
   导航 / 滚动联动 / 平滑跳转
   ============================================================ */
function initNav() {
  $$('[data-goto]').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.goto;
    $('#' + id)?.scrollIntoView({ behavior: 'smooth' });
  }));
  $('#navStartBtn')?.addEventListener('click', () => $('#chat').scrollIntoView({ behavior: 'smooth' }));

  const burger = $('#burger'), links = $('.nav__links');
  burger?.addEventListener('click', () => links.classList.toggle('open'));
  $$('.nav__links a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));

  const sections = ['home', 'profile', 'assess', 'path', 'chat'].map(id => $('#' + id));
  const obs = new IntersectionObserver(es => {
    es.forEach(e => {
      if (e.isIntersecting) {
        $$('.nav__links a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(s => s && obs.observe(s));

  // 卡片光标光效
  $$('.feature-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
}

/* 数字滚动 */
function initCounters() {
  const obs = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target, target = +el.dataset.count, suffix = el.dataset.suffix || '';
      let cur = 0; const step = target / 40;
      const tick = () => { cur += step; if (cur >= target) { el.textContent = target + suffix; } else { el.textContent = Math.floor(cur) + suffix; requestAnimationFrame(tick); } };
      tick(); obs.unobserve(el);
    });
  }, { threshold: .5 });
  $$('.stat__num').forEach(el => obs.observe(el));
}

/* 背景粒子 */
function initParticles() {
  const c = $('#particles'), ctx = c.getContext('2d');
  let w, h, pts;
  const resize = () => { w = c.width = innerWidth; h = c.height = innerHeight; pts = Array.from({ length: Math.min(70, innerWidth / 22) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25 })); };
  resize(); addEventListener('resize', resize);
  (function loop() {
    ctx.clearRect(0, 0, w, h);
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, 7); ctx.fillStyle = 'rgba(58,214,200,.55)'; ctx.fill();
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy);
      if (d < 130) { ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.strokeStyle = `rgba(58,214,200,${.12 * (1 - d / 130)})`; ctx.stroke(); }
    }
    requestAnimationFrame(loop);
  })();
}

/* ============================================================
   背景档案
   ============================================================ */
function initProfile() {
  const form = $('#profileForm');
  // 回填
  Object.entries(State.profile).forEach(([k, v]) => { const el = form.elements[k]; if (el) el.value = v; });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    State.profile = data; store.set('profile', data);
    $('#profileSaved').hidden = false;
    renderChatCtx(); toast('档案已保存，AI 咨询已结合你的信息');
  });
  $('#profileClear').addEventListener('click', () => { form.reset(); State.profile = {}; store.set('profile', {}); $('#profileSaved').hidden = true; renderChatCtx(); });
}

/* ============================================================
   职业测评（14 题，霍兰德 RIASEC + 能力）
   ============================================================ */
const ASSESS_QUESTIONS = [
  { q: '面对一个全新问题，你更愿意：', d: 'R', opts: [['亲手拆解、动手实验', 'R'], ['查资料系统研究', 'I'], ['和人讨论寻找思路', 'S'], ['先规划流程再执行', 'C']] },
  { q: '理想的工作氛围是：', d: 'S', opts: [['独立深耕、少打扰', 'I'], ['团队协作、人际丰富', 'S'], ['竞争激烈、机会多', 'E'], ['自由创作、不拘一格', 'A']] },
  { q: '你最享受的成就感来自：', d: 'A', opts: [['做出一个能跑的作品', 'R'], ['想通一个复杂原理', 'I'], ['创造出独特的东西', 'A'], ['带领大家拿下目标', 'E']] },
  { q: '别人常评价你：', d: 'I', opts: [['务实、靠谱', 'R'], ['爱钻研、逻辑强', 'I'], ['有亲和力、会照顾人', 'S'], ['有主见、能带节奏', 'E']] },
  { q: '业余时间你更可能：', d: 'A', opts: [['修东西/做手工/运动', 'R'], ['看书/研究新知识', 'I'], ['写作/设计/音乐', 'A'], ['组织活动/社交', 'S']] },
  { q: '做决定时你更看重：', d: 'C', opts: [['数据与事实', 'I'], ['规则与稳妥', 'C'], ['影响力与回报', 'E'], ['对人的意义', 'S']] },
  { q: '你更想成为：', d: 'E', opts: [['领域专家', 'I'], ['团队领导者', 'E'], ['创意创作者', 'A'], ['可靠的执行者', 'C']] },
  { q: '面对不确定性，你：', d: 'E', opts: [['兴奋，喜欢探索', 'E'], ['谨慎，先评估风险', 'C'], ['寻求他人意见', 'S'], ['用分析降低不确定', 'I']] },
  { q: '你的能力更突出在：', d: 'I', opts: [['动手/工程实现', 'R'], ['分析/研究', 'I'], ['沟通/协调', 'S'], ['统筹/管理', 'E']] },
  { q: '理想成果的形态是：', d: 'A', opts: [['一个产品/系统', 'R'], ['一篇洞见/方案', 'I'], ['一件作品/品牌', 'A'], ['一套高效流程', 'C']] },
  { q: '你更容易被什么激励：', d: 'E', opts: [['解决难题的快感', 'I'], ['帮助到别人', 'S'], ['认可与晋升', 'E'], ['秩序与掌控感', 'C']] },
  { q: '团队里你常扮演：', d: 'S', opts: [['技术攻坚者', 'R'], ['出主意的智囊', 'I'], ['粘合大家的人', 'S'], ['推动落地的人', 'E']] },
  { q: '你对重复性事务的态度：', d: 'C', opts: [['能接受，求稳', 'C'], ['尽量自动化掉', 'I'], ['容易厌倦', 'A'], ['交给别人，我抓大事', 'E']] },
  { q: '长期来看，你最想要：', d: 'E', opts: [['深厚的专业壁垒', 'I'], ['广泛的影响力', 'E'], ['自由表达的空间', 'A'], ['稳定可期的成长', 'C']] },
];
const RIASEC = {
  R: { label: '实干型', desc: '偏好动手、工程与实践，擅长把想法变成可运行的成果。', jobs: ['软件/硬件工程师', '运维/SRE', '产品研发', '解决方案架构'] },
  I: { label: '研究型', desc: '喜欢分析、钻研与求真，适合需要深度思考的领域。', jobs: ['数据科学家', '算法工程师', '研究员', '战略分析'] },
  A: { label: '创意型', desc: '富有想象力与表达欲，擅长创造独特的事物。', jobs: ['产品设计', 'UX/品牌', '内容创作', '创意总监'] },
  S: { label: '社交型', desc: '善于沟通与协作，从帮助他人中获得意义。', jobs: ['项目/团队管理', 'HR/培训', '客户成功', '咨询顾问'] },
  E: { label: '领导型', desc: '有进取心与影响力，擅长推动目标与带领团队。', jobs: ['技术管理', '创业者', '商业拓展', '产品负责人'] },
  C: { label: '管理型', desc: '注重秩序、规范与稳健，擅长把事情做扎实。', jobs: ['项目管理(PMO)', '运营', '财务/合规', '质量管理'] },
};
let assessIdx = 0, assessScore = {};
function initAssess() {
  if (State.assess) { renderAssessResult(State.assess); return; }
  assessIdx = 0; assessScore = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
  $('#assessResult').hidden = true; $('#assessBody').hidden = false;
  renderAssessQ();
  $('#assessRetry')?.addEventListener('click', () => { State.assess = null; store.set('assess', null); initAssess(); });
}
function renderAssessQ() {
  const item = ASSESS_QUESTIONS[assessIdx];
  $('#assessBar').style.width = (assessIdx / ASSESS_QUESTIONS.length * 100) + '%';
  $('#assessBody').innerHTML = `
    <div class="assess-q"><span class="assess-q__idx">${String(assessIdx + 1).padStart(2, '0')}/${ASSESS_QUESTIONS.length}</span>${item.q}</div>
    <div class="assess-opts">
      ${item.opts.map((o, i) => `<button class="assess-opt" data-dim="${o[1]}">${o[0]}</button>`).join('')}
    </div>`;
  $$('.assess-opt').forEach(btn => btn.addEventListener('click', () => {
    assessScore[btn.dataset.dim] = (assessScore[btn.dataset.dim] || 0) + 1;
    assessIdx++;
    if (assessIdx >= ASSESS_QUESTIONS.length) finishAssess(); else renderAssessQ();
  }));
}
function finishAssess() {
  $('#assessBar').style.width = '100%';
  const sorted = Object.entries(assessScore).map(([k, v]) => ({ k, v, label: RIASEC[k].label })).sort((a, b) => b.v - a.v);
  const result = { score: assessScore, top: sorted.slice(0, 3), all: sorted };
  State.assess = result; store.set('assess', result);
  renderAssessResult(result); renderChatCtx();
}
function renderAssessResult(result) {
  $('#assessBody').hidden = true;
  const box = $('#assessResult'); box.hidden = false;
  const top = result.top;
  $('#assessText').innerHTML = `
    <h4>核心类型：${top[0].label}（${top[0].k}）</h4>
    <p>${RIASEC[top[0].k].desc}</p>
    <h4>次要倾向</h4>
    <p>${top[1].label}、${top[2].label}，构成你独特的职业组合 <b style="font-family:var(--mono);color:var(--accent)">${top.map(t=>t.k).join('')}</b>。</p>
    <h4>推荐职业方向</h4>
    <div class="tags">${[...new Set([...RIASEC[top[0].k].jobs, ...RIASEC[top[1].k].jobs])].slice(0, 6).map(j => `<span>${j}</span>`).join('')}</div>`;
  drawRadar(result.score);
}
function drawRadar(score) {
  const c = $('#radarChart'); if (!c) return; const ctx = c.getContext('2d');
  const dims = ['R', 'I', 'A', 'S', 'E', 'C']; const cx = 180, cy = 180, R = 120;
  const max = Math.max(4, ...dims.map(d => score[d] || 0));
  ctx.clearRect(0, 0, 360, 360);
  // 网格
  for (let g = 1; g <= 4; g++) {
    ctx.beginPath();
    dims.forEach((d, i) => { const a = -Math.PI / 2 + i * Math.PI / 3; const r = R * g / 4; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.stroke();
  }
  dims.forEach((d, i) => { const a = -Math.PI / 2 + i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.stroke();
    ctx.fillStyle = '#aab3c2'; ctx.font = '13px Sora'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lx = cx + Math.cos(a) * (R + 22), ly = cy + Math.sin(a) * (R + 22); ctx.fillText(RIASEC[d].label, lx, ly); });
  // 数据
  ctx.beginPath();
  dims.forEach((d, i) => { const a = -Math.PI / 2 + i * Math.PI / 3; const r = R * (score[d] || 0) / max; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath();
  const grad = ctx.createLinearGradient(60, 60, 300, 300); grad.addColorStop(0, 'rgba(58,214,200,.5)'); grad.addColorStop(1, 'rgba(54,185,240,.5)');
  ctx.fillStyle = grad; ctx.fill(); ctx.strokeStyle = '#3ad6c8'; ctx.lineWidth = 2; ctx.stroke();
  dims.forEach((d, i) => { const a = -Math.PI / 2 + i * Math.PI / 3; const r = R * (score[d] || 0) / max; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fillStyle = '#3ad6c8'; ctx.fill(); });
}

/* ============================================================
   职业路径图谱
   ============================================================ */
function initPath() {
  if (State.path) renderPath(State.path);
  $('#pathGen').addEventListener('click', genPath);
  $('#pathInput').addEventListener('keydown', e => { if (e.key === 'Enter') genPath(); });
}
function genPath() {
  const goal = $('#pathInput').value.trim() || State.profile.goal || '职业进阶';
  const data = MockEngine.buildPath(goal, State.profile, State.assess);
  State.path = data; store.set('path', data);
  renderPath(data); toast('路径图谱已生成');
}
function renderPath(data) {
  const el = $('#pathCanvas');
  el.innerHTML = `
    <div class="path-stages">
      ${data.stages.map(s => `
        <div class="path-stage">
          <div class="path-stage__phase">${s.phase}</div>
          <div class="path-stage__title">${s.title}</div>
          <div class="path-stage__time">${s.time}</div>
          <ul>${s.items.map(i => `<li>${i}</li>`).join('')}</ul>
        </div>`).join('')}
    </div>
    <div class="path-skills">
      <div class="path-skills__title">关键能力图谱 · 目标：${escapeHTML(data.goal)}</div>
      <div class="skill-bars">
        ${data.skills.map(sk => `
          <div class="skill-bar">
            <span>${sk.name}</span>
            <div class="skill-bar__track"><div class="skill-bar__fill" data-w="${sk.level}"></div></div>
            <span class="skill-bar__val">${sk.level}%</span>
          </div>`).join('')}
      </div>
    </div>`;
  requestAnimationFrame(() => $$('.skill-bar__fill').forEach(f => f.style.width = f.dataset.w + '%'));
}

/* ============================================================
   AI 咨询
   ============================================================ */
let chatHistory = [];
let chatBusy = false;
function initChat() {
  const stream = $('#chatStream'), text = $('#chatText'), send = $('#chatSend');
  // 欢迎语
  pushMsg('ai', greeting(), false);
  renderChatCtx();

  const auto = () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 120) + 'px'; };
  text.addEventListener('input', auto);
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  send.addEventListener('click', doSend);
  $$('.chip').forEach(c => c.addEventListener('click', () => { text.value = c.dataset.quick; auto(); doSend(); }));

  async function doSend() {
    const val = text.value.trim();
    if (!val || chatBusy) return;
    text.value = ''; auto();
    pushMsg('user', val);
    chatHistory.push({ role: 'user', content: val });
    chatBusy = true; send.disabled = true;

    // AI 流式回复
    const bodyEl = pushMsg('ai', '', true);
    bodyEl.innerHTML = '<span class="cursor"></span>';
    let acc = '';
    await callAI(chatHistory, buildSystemPrompt(), tok => {
      acc += tok; bodyEl.innerHTML = mdLite(acc) + '<span class="cursor"></span>';
      stream.scrollTop = stream.scrollHeight;
    });
    bodyEl.innerHTML = mdLite(acc);
    chatHistory.push({ role: 'assistant', content: acc });
    chatBusy = false; send.disabled = false;
    stream.scrollTop = stream.scrollHeight;
  }
}
function greeting() {
  const n = State.profile.name ? State.profile.name + '，' : '';
  return `你好${n}我是 **ATLAS**，由 DeepSeek 驱动的职业规划顾问。\n\n我已${State.profile.role || State.assess ? '结合你的背景档案与测评结果，' : ''}准备好为你提供职业咨询。你可以问我关于**能力补强、方向选择、晋升路径、转行风险**等任何问题——或点击左侧的快捷提问开始。`;
}
function pushMsg(role, content, returnBody) {
  const stream = $('#chatStream');
  const div = document.createElement('div');
  div.className = 'msg msg--' + role;
  div.innerHTML = `<div class="msg__av">${role === 'ai' ? 'AI' : '你'}</div><div class="msg__body">${returnBody ? '' : mdLite(content)}</div>`;
  stream.appendChild(div); stream.scrollTop = stream.scrollHeight;
  return $('.msg__body', div);
}
function renderChatCtx() {
  const p = State.profile, a = State.assess;
  const lines = [];
  if (p.role) lines.push(`身份：<b>${escapeHTML(p.role)}</b>`);
  if (p.years) lines.push(`年限：<b>${p.years}</b>`);
  if (a && a.top) lines.push(`测评：<b>${a.top.map(t => t.label).join('/')}</b>`);
  $('#chatCtx').innerHTML = lines.length ? '已载入上下文<br/>' + lines.join('<br/>') : '提示：先填写背景档案与测评，<br/>咨询会更精准。';
}

/* ============================================================
   报告导出
   ============================================================ */
function closeReport() { $('#reportModal').hidden = true; }
function initReport() {
  $('#exportBtn').addEventListener('click', openReport);
  $$('[data-close]').forEach(el => el.addEventListener('click', closeReport));
  $('#reportDownload').addEventListener('click', downloadReport);
  // ESC 关闭
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#reportModal').hidden) closeReport(); });
}
function openReport() {
  const p = State.profile, a = State.assess, path = State.path;
  const now = new Date().toLocaleDateString('zh-CN');
  const top = a && a.top;
  $('#reportBody').innerHTML = `
    <div class="report" id="reportPrintable">
      <h3>${escapeHTML(p.name || '我')}的职业规划报告</h3>
      <div class="report__meta">ATLAS · DeepSeek 生成 · ${now}</div>
      <section><h4>个人画像</h4>
        <p>${[p.age, p.education, p.major, p.role, p.years].filter(Boolean).join(' · ') || '（未填写完整档案）'}</p>
        ${p.skills ? `<p>核心技能：${escapeHTML(p.skills)}</p>` : ''}
        ${p.goal ? `<p>目标 / 困惑：${escapeHTML(p.goal)}</p>` : ''}
      </section>
      ${top ? `<section><h4>测评结论</h4>
        <p>职业类型：<strong>${top.map(t => t.label + '(' + t.k + ')').join(' · ')}</strong></p>
        <p>${RIASEC[top[0].k].desc}</p></section>` : ''}
      ${path ? `<section><h4>发展路径（目标：${escapeHTML(path.goal)}）</h4>
        ${path.stages.map(s => `<p><strong>${s.phase} ${s.title}</strong>（${s.time}）<ul>${s.items.map(i => `<li>${i}</li>`).join('')}</ul></p>`).join('')}
      </section>` : ''}
      <section><h4>行动建议</h4>
        <ul>${MockEngine.actionItems(p, a, path).map(i => `<li>${i}</li>`).join('')}</ul>
      </section>
    </div>`;
  $('#reportModal').hidden = false;
}
async function downloadReport() {
  const node = $('#reportPrintable');
  if (typeof html2canvas === 'undefined') { toast('导出组件加载中，请稍后重试'); return; }
  toast('正在生成图片…');
  const canvas = await html2canvas(node, { backgroundColor: '#0b0e14', scale: 2 });
  const a = document.createElement('a');
  a.download = 'ATLAS职业规划报告.png';
  a.href = canvas.toDataURL('image/png'); a.click();
}

/* ============================================================
   高保真模拟 AI 引擎（MockEngine）
   —— 接入真实模型后此模块不再被调用，可保留作降级备用 ——
   ============================================================ */
const MockEngine = {
  respond(messages, system) {
    const last = messages[messages.length - 1]?.content || '';
    const p = State.profile, a = State.assess;
    const name = p.name ? p.name : '你';
    const role = p.role || '当前的职业阶段';
    const topType = a && a.top ? a.top[0].label : null;

    // 意图识别
    const has = (...ks) => ks.some(k => last.includes(k));
    if (has('补强', '补哪些', '提升', '能力', '学什么')) {
      const skills = (p.skills || '').split(/[,，、]/).filter(Boolean);
      return `### 基于你的背景，三项最该补强的能力\n\n结合${role}的定位${topType ? `与「${topType}」的倾向` : ''}，我建议优先补强：\n\n- **结构化表达与影响力**：技术能力强但容易卡在"说不清价值"。刻意练习用 1 句话讲清结论 + 3 个支撑点。\n- **跨域视野（业务/产品感）**：单点技术天花板低，理解业务如何赚钱，会让你的方案更被采纳。\n- **${skills.length ? '系统化沉淀你已有的「' + skills[0] + '」，形成可复用方法论' : '项目管理与协作'}**：把隐性经验显性化，是从"做事"到"带事"的关键。\n\n要不要我针对其中某一项，给你一个 8 周的具体训练计划？`;
    }
    if (has('方向', '适合', '岗位', '职业', '选择')) {
      const jobs = a && a.top ? [...new Set([...RIASEC[a.top[0].k].jobs, ...RIASEC[a.top[1].k].jobs])].slice(0, 4) : ['技术专家', '技术管理', '解决方案', '产品方向'];
      return `### 适合你的职业方向\n\n${topType ? `你的测评偏向 **${a.top.map(t => t.label).join(' / ')}**，` : ''}据此最匹配的方向有：\n\n${jobs.map(j => `- **${j}**`).join('\n')}\n\n如果让我排序，我会建议你先在**当前赛道做深**，同时用 6 个月探索相邻方向的真实工作内容（约 3 次信息访谈），再做切换决策——这样风险最低、信息最充分。\n\n想深入聊哪一个方向？`;
    }
    if (has('晋升', '升职', '两年', '计划', '规划')) {
      return `### 你的两年晋升行动计划\n\n**第 1-6 月｜立稳脚跟**\n- 明确晋升评估标准，找直属上级对齐预期\n- 主动认领 1 个有显示度的项目，建立"可被看见的成果"\n\n**第 7-18 月｜扩大影响**\n- 从执行者转为"能带 1-2 人协作"的角色\n- 沉淀方法论，做内部分享，建立专业标签\n\n**第 19-24 月｜冲刺答辩**\n- 主导一个端到端项目，量化业务价值\n- 提前准备晋升材料，找 2-3 位推荐背书\n\n要我帮你把这份计划导出成可执行的报告吗？点右下角「导出规划报告」即可。`;
    }
    if (has('转行', '年龄', '风险', '担心', '焦虑')) {
      return `### 理性评估转行 / 年龄风险\n\n先给你吃颗定心丸：${name}的焦虑很常见，但**可被结构化拆解**。用三个问题自检：\n\n- **可迁移性**：你现有的哪些能力在新方向依然值钱？（往往比你以为的多）\n- **沉没成本**：不是"我已投入多少"，而是"未来 5 年哪个选择回报更高"。\n- **最小验证**：能否用业余时间做一个小项目 / 兼职，低成本验证兴趣与能力？\n\n年龄不是问题，**方向模糊 + 行动迟缓**才是。建议先做"最小验证"，用事实代替想象去决策。\n\n要不要我帮你把"最小验证"拆成具体的 4 周行动？`;
    }
    if (has('清单', '总结', '行动', '执行')) {
      return `### 你的职业行动清单\n\n${MockEngine.actionItems(p, a, State.path).map((i, n) => `- ${i}`).join('\n')}\n\n这份清单我可以一键生成为正式报告（含画像、测评、路径），点右下角「**导出规划报告**」即可保存为图片。`;
    }
    // 通用兜底
    return `谢谢你的提问。${topType ? `结合你「${topType}」的职业倾向${p.role ? '和' + p.role + '的身份' : ''}，` : ''}我的看法是：\n\n职业决策的本质，是在**「你擅长什么 × 市场需要什么 × 你想要什么」**这三个圆的交集里持续移动。针对你说的情况，我建议：\n\n- **先收敛问题**：把"我该怎么办"换成"在 A 和 B 之间怎么选"，决策会清晰很多。\n- **用行动获取信息**：很多纠结源于信息不足，一次信息访谈胜过十次空想。\n\n可以告诉我更多细节吗？比如你现在最纠结的具体选项是什么，我帮你一起拆。`;
  },

  buildPath(goal, p, a) {
    const g = goal;
    const base = {
      goal: g,
      stages: [
        { phase: 'PHASE 01', title: '夯实期', time: '0-12 个月', items: [`巩固${(p.skills || '核心技能').split(/[,，]/)[0]}的深度`, '建立可被看见的成果', '明确目标岗位的能力标准'] },
        { phase: 'PHASE 02', title: '拓展期', time: '1-3 年', items: [`向「${g}」所需的关键能力迁移`, '承担跨职能 / 带人的协作', '形成个人方法论与专业标签'] },
        { phase: 'PHASE 03', title: '跃迁期', time: '3-5 年', items: [`成为「${g}」方向的核心角色`, '主导端到端、可量化价值的项目', '建立行业影响力与人脉网络'] },
      ],
      skills: [
        { name: '专业深度', level: 80 },
        { name: '业务理解', level: 62 },
        { name: '沟通影响', level: 70 },
        { name: '项目统筹', level: 58 },
        { name: '领导力', level: 48 },
      ],
    };
    // 依据测评微调
    if (a && a.top) {
      const k = a.top[0].k;
      if (k === 'E') { base.skills[4].level = 75; base.skills[2].level = 80; }
      if (k === 'I') { base.skills[0].level = 90; }
      if (k === 'S') { base.skills[2].level = 85; }
    }
    return base;
  },

  actionItems(p, a, path) {
    const items = [];
    if (!p.role) items.push('完善背景档案：填写当前职位、年限与核心技能，让规划更精准');
    if (!a) items.push('完成 14 题职业测评，获取你的职业适配画像');
    items.push(`本周完成 1 次"最小验证"：就目标方向做一次信息访谈或小实验`);
    items.push(`未来 30 天补强 1 项关键能力${p.skills ? '（基于你的「' + p.skills.split(/[,，]/)[0] + '」继续深化）' : ''}`);
    items.push('每季度回顾一次：擅长/需要/想要 三圆是否仍对齐');
    if (path) items.push(`对照「${path.goal}」路径图谱，锁定本阶段的 2 个重点动作`);
    return items;
  },
};

/* ============================================================
   启动
   ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initNav();
  initCounters();
  initProfile();
  initAssess();
  initPath();
  initChat();
  initReport();
});
