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
- 图片：\`![说明](图片地址)\`（支持网络图片）`,
  },
];

// ---------------- API 路由 ----------------
async function handleApi(request, env, seg) {
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
      let slug = makeSlug(title);
      for (let i = 0; i < 5; i++) {
        const exists = await DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(slug).first();
        if (!exists) break;
        slug = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }
      await DB.prepare(
        'INSERT INTO articles (slug, title, category, content, author, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(slug, title, category, content, author, nowCN(), nowCN()).run();
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
      return json({ ok: true, slug, message: '保存成功' });
    }
    if (method === 'DELETE') {
      const r = await DB.prepare('DELETE FROM articles WHERE slug = ?').bind(slug).run();
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

  return json({ error: '接口不存在', path: '/' + seg.join('/') }, 404);
}

// ---------------- 入口 ----------------
export default {
  async fetch(request, env) {
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
        return await handleApi(request, env, seg);
      } catch (e) {
        return json({ error: '服务器内部错误：' + String(e && e.message || e) }, 500);
      }
    }

    // 其余请求：交给静态资源
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('静态资源未找到', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
