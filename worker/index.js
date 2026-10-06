// ============================================================
// 百科档案馆 - 一体化 Worker（Cloudflare Pages 高级模式）
// 这个文件同时负责：
//   1. /api/* 接口（创建/编辑/删除/搜索/随机/统计）
//   2. 其余请求交给静态资源（index.html / app.js / style.css）
//
// 数据库：Cloudflare D1，绑定变量名必须为 DB
// 可选环境变量：EDIT_PASSWORD（设置后编辑/删除需输入口令）
// 首次访问自动建表，并写入两篇入门条目。
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Password',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function nowCN() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function makeSlug(title) {
  const kebab = String(title).trim().toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (kebab && kebab.length >= 4 && !/^[0-9-]+$/.test(kebab)) return kebab;
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 首次访问自动建表 + 种子内容
let schemaReady = false;
async function ensureSchema(DB) {
  if (schemaReady) return;
  await DB.prepare(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '未分类',
    content TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).bind().run();
  // 图片表：二进制直接存 D1（免配置对象存储），article_slug 用于条目删除时级联清理
  await DB.prepare(`CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    bytes BLOB NOT NULL,
    size INTEGER NOT NULL,
    article_slug TEXT,
    ts INTEGER NOT NULL
  )`).bind().run();
  const row = await DB.prepare('SELECT COUNT(*) AS n FROM articles').bind().first();
  if (!row || !row.n) {
    for (const a of SEED_ARTICLES) {
      await DB.prepare(
        'INSERT INTO articles (slug, title, category, content, author, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(a.slug, a.title, a.category, a.content, a.author || '', nowCN(), nowCN()).run();
    }
  }
  schemaReady = true;
}

// ---------------- 内置的入门条目（可在下方直接修改） ----------------
const SEED_ARTICLES = [
  {
    slug: 'welcome',
    title: '欢迎来到本百科',
    category: '指南',
    author: '站长',
    content: `这里是你的**个人百科**，任何人都可以自由阅读、创建和编辑条目，无需注册登录。

## 从这里开始

1. 点击右上角**创建条目**，写下你的第一条内容
2. 在顶部的搜索框里可以全文检索所有条目
3. **内容列表**页可以按分类浏览全部条目
4. **随机阅读**会带你去一个随机条目，也许有惊喜

## 写作建议

- 一个条目只讲一个主题，标题简短明确
- 善用分类功能，条目多了以后按分类整理会清晰很多
- 正文支持 Markdown 语法，用法见《编辑指南》

> 建议定期备份重要内容：内容列表页右上角有**导出备份**按钮，可以一键下载全部条目的 JSON 文件。`,
  },
  {
    slug: 'guide',
    title: '编辑指南',
    category: '指南',
    author: '站长',
    content: `正文支持 **Markdown** 语法。编辑框上方有快捷按钮，常用语法如下：

## 标题

行首加 \`#\` 是一级标题，\`##\` 二级，\`###\` 三级（最多六级）：

\`\`\`
## 这是一个二级标题
\`\`\`

## 文字样式

- **加粗**：\`**文字**\`
- *斜体*：\`*文字*\`
- \`行内代码\`：用反引号包裹

## 列表

无序列表（行首 \`-\` 或 \`*\`）：

- 第一项
- 第二项

有序列表（行首 \`1.\` \`2.\`）：

1. 第一步
2. 第二步

## 引用与分隔

行首 \`>\` 是引用块：

> 这是一段引用

单独一行 \`---\` 是分隔线。

## 链接与图片

- 链接：\`[文字](https://example.com)\`
- **插图**：点击编辑框上方「图片」按钮选择图片，或**直接把截图粘贴 / 拖拽进编辑框**，会自动压缩并插入
- 也可以手写 Markdown 使用网络图片：\`![说明](图片地址)\`

> 手机照片和截图会被自动压缩（最长边 1600px、优先转 WebP），既省流量又加快打开速度。`,
  },
];

// ---------------- 图片辅助：引用提取 / 孤儿清理 ----------------
function extractImageIds(content) {
  const set = new Set();
  const re = /\/api\/images\/([A-Za-z0-9_-]+)/g;
  const s = String(content || '');
  let m;
  while ((m = re.exec(s))) set.add(m[1]);
  return [...set];
}

// 清理：从未随条目保存的图片（上传后放弃编辑）48 小时后回收
async function imageJanitor(DB) {
  try {
    await DB.prepare('DELETE FROM images WHERE article_slug IS NULL AND ts < ?')
      .bind(Date.now() - 48 * 3600 * 1000).run();
  } catch { /* 清理失败不影响主流程 */ }
}

// ---------------- API 路由 ----------------
async function handleApi(request, env, seg, ctx) {
  const DB = env.DB;
  const method = request.method;

  // ---------- /api/config ----------
  if (seg[0] === 'config' && method === 'GET') {
    return json({ editPasswordRequired: !!env.EDIT_PASSWORD, now: nowCN() });
  }

  // ---------- 写操作口令校验 ----------
  if (env.EDIT_PASSWORD && ['POST', 'PUT', 'DELETE'].includes(method)) {
    const pwd = request.headers.get('X-Edit-Password') || '';
    if (pwd !== env.EDIT_PASSWORD) {
      return json({ error: '需要编辑口令', needPassword: true }, 401);
    }
  }

  // ---------- /api/articles ----------
  if (seg[0] === 'articles') {
    // 随机
    if (seg[1] === 'random' && method === 'GET') {
      const r = await DB.prepare('SELECT slug FROM articles ORDER BY RANDOM() LIMIT 1').bind().first();
      return json({ slug: r ? r.slug : null });
    }

    // 列表
    if (!seg[1] && method === 'GET') {
      const r = await DB.prepare(
        'SELECT slug, title, category, author, created_at, updated_at FROM articles ORDER BY updated_at DESC, id DESC'
      ).bind().all();
      return json({ articles: r.results || [] });
    }

    // 创建
    if (!seg[1] && method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
      const title = String(body.title || '').trim();
      const content = String(body.content || '');
      if (!title || !content.trim()) return json({ error: '标题和正文不能为空' }, 400);
      const category = String(body.category || '').trim() || '未分类';
      const author = String(body.author || '').trim().slice(0, 60);
      // 原子化创建：直接插入；若地址冲突（如双击重复提交）则换随机地址重试
      let slug = makeSlug(title);
      let ok = false;
      for (let i = 0; i < 6; i++) {
        try {
          await DB.prepare(
            'INSERT INTO articles (slug, title, category, content, author, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
          ).bind(slug, title, category, content, author, nowCN(), nowCN()).run();
          ok = true;
          break;
        } catch (e) {
          const msg = String(e && e.message || e);
          if (/UNIQUE|CONSTRAINT/i.test(msg)) {
            slug = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            continue;
          }
          throw e;
        }
      }
      if (!ok) return json({ error: '创建失败：地址生成冲突，请重试' }, 500);
      // 认领正文中引用的图片（归属到本条目，便于级联删除）
      const ids = extractImageIds(content);
      if (ids.length) {
        await DB.prepare(
          `UPDATE images SET article_slug = ? WHERE article_slug IS NULL AND id IN (${ids.map(() => '?').join(',')})`
        ).bind(slug, ...ids).run();
      }
      imageJanitor(DB);
      return json({ ok: true, slug, message: '创建成功' }, 201);
    }

    // 读取 / 编辑 / 删除
    const slug = seg[1];
    if (method === 'GET') {
      const r = await DB.prepare('SELECT * FROM articles WHERE slug = ?').bind(slug).first();
      if (!r) return json({ error: '条目不存在，可能已被删除' }, 404);
      return json({ article: r });
    }
    if (method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
      const title = String(body.title || '').trim();
      const content = String(body.content || '');
      if (!title || !content.trim()) return json({ error: '标题和正文不能为空' }, 400);
      const category = String(body.category || '').trim() || '未分类';
      const author = String(body.author || '').trim().slice(0, 60);
      const exists = await DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(slug).first();
      if (!exists) return json({ error: '条目不存在' }, 404);
      await DB.prepare(
        'UPDATE articles SET title=?, category=?, content=?, author=?, updated_at=? WHERE slug=?'
      ).bind(title, category, content, author, nowCN(), slug).run();
      // 认领新引用的图片，并删除本条目不再引用的旧图片
      const ids = extractImageIds(content);
      if (ids.length) {
        await DB.prepare(
          `UPDATE images SET article_slug = ? WHERE article_slug IS NULL AND id IN (${ids.map(() => '?').join(',')})`
        ).bind(slug, ...ids).run();
      }
      await DB.prepare(
        `DELETE FROM images WHERE article_slug = ?${ids.length ? ` AND id NOT IN (${ids.map(() => '?').join(',')})` : ''}`
      ).bind(...[slug, ...ids]).run();
      imageJanitor(DB);
      return json({ ok: true, slug, message: '保存成功' });
    }
    if (method === 'DELETE') {
      await DB.prepare('DELETE FROM articles WHERE slug = ?').bind(slug).run();
      // 级联清理本条目上传的图片
      await DB.prepare('DELETE FROM images WHERE article_slug = ?').bind(slug).run();
      return json({ ok: true, message: '已删除' });
    }
  }

  // ---------- /api/search ----------
  if (seg[0] === 'search' && method === 'GET') {
    const q = (new URL(request.url).searchParams.get('q') || '').trim();
    if (!q) return json({ results: [], q });
    const like = '%' + q.replace(/[%_]/g, '\\$&') + '%';
    const r = await DB.prepare(
      `SELECT slug, title, category, updated_at,
              substr(content, 1, 160) AS excerpt
       FROM articles
       WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC LIMIT 50`
    ).bind(like, like).all();
    return json({ results: r.results || [], q });
  }

  // ---------- /api/stats ----------
  if (seg[0] === 'stats' && method === 'GET') {
    const a = await DB.prepare('SELECT COUNT(*) AS n FROM articles').bind().first();
    const c = await DB.prepare('SELECT COUNT(DISTINCT category) AS n FROM articles').bind().first();
    const u = await DB.prepare('SELECT MAX(updated_at) AS t FROM articles').bind().first();
    return json({ articles: a ? a.n : 0, categories: c ? c.n : 0, lastUpdate: u ? u.t : null });
  }

  // ---------- /api/categories ----------
  if (seg[0] === 'categories' && method === 'GET') {
    const r = await DB.prepare(
      'SELECT category, COUNT(*) AS count FROM articles GROUP BY category ORDER BY count DESC, category ASC'
    ).bind().all();
    return json({ categories: r.results || [] });
  }

  // ---------- /api/images ----------
  if (seg[0] === 'images') {
    // 上传（写口令校验已在函数开头统一处理）
    if (!seg[1] && method === 'POST') {
      const cl = Number(request.headers.get('content-length') || 0);
      if (cl > 6_000_000) return json({ error: '图片太大：请上传 4MB 以内的图片（正常手机照片会自动压缩）' }, 413);
      let form;
      try { form = await request.formData(); } catch { return json({ error: '上传数据格式错误' }, 400); }
      const file = form.get('file');
      if (!file || typeof file === 'string') return json({ error: '缺少图片文件' }, 400);
      const ALLOWED = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1 };
      if (!ALLOWED[file.type]) return json({ error: '仅支持 JPG / PNG / WebP / GIF 图片' }, 415);
      if (file.size > 1_800_000) return json({ error: '图片超过 1.5MB（客户端压缩失败或原图过大），请换小一点的图' }, 413);
      const buf = new Uint8Array(await file.arrayBuffer());
      let id = '';
      for (let i = 0; i < 5 && !id; i++) {
        const candidate = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
        const hit = await DB.prepare('SELECT id FROM images WHERE id = ?').bind(candidate).first();
        if (!hit) id = candidate;
      }
      if (!id) return json({ error: '生成图片编号失败，请重试' }, 500);
      await DB.prepare('INSERT INTO images (id, mime, bytes, size, article_slug, ts) VALUES (?,?,?,?,NULL,?)')
        .bind(id, file.type, buf, file.size, Date.now()).run();
      return json({ ok: true, id, url: '/api/images/' + id, mime: file.type, size: file.size }, 201);
    }

    // 读取：先查边缘缓存，再查数据库（id 唯一 → 浏览器与边缘均可永久缓存）
    if (seg[1] && method === 'GET') {
      const id = seg[1];
      const base = new URL(request.url);
      const target = new URL(base.origin + '/api/images/' + encodeURIComponent(id));
      const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
      if (cache) {
        try {
          const hit = await cache.match(target);
          if (hit) return hit;
        } catch { /* 缓存读取失败则回源 */ }
      }
      const r = await DB.prepare('SELECT mime, bytes FROM images WHERE id = ?').bind(id).first();
      if (!r || !r.bytes) return json({ error: '图片不存在' }, 404);
      const resp = new Response(r.bytes, {
        status: 200,
        headers: {
          'Content-Type': r.mime || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
          ...CORS,
        },
      });
      if (cache) {
        try {
          const put = cache.put(target, resp.clone());
          if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
        } catch { /* 缓存写入失败不影响返回 */ }
      }
      return resp;
    }
  }

  return json({ error: '接口不存在', path: '/' + seg.join('/') }, 404);
}

// ---------------- 入口 ----------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        if (!env.DB) {
          return json({
            error: '尚未绑定 D1 数据库：请在 Pages 项目 → 设置 → 绑定 中添加 D1 数据库，变量名必须为 DB，保存后重新部署。'
          }, 500);
        }
        await ensureSchema(env.DB);
        const seg = url.pathname.slice(4).split('/').filter(Boolean).map(decodeURIComponent);
        return await handleApi(request, env, seg, ctx);
      } catch (e) {
        return json({ error: '服务器内部错误：' + String(e && e.message || e) }, 500);
      }
    }

    // 其余请求：交给静态资源
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('静态资源未找到', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
