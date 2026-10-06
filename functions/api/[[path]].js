// ============================================================
// 百科档案馆 - API 路由（Cloudflare Pages Functions）
// 数据存储：Cloudflare D1（SQLite），变量名必须为 DB
// 所有表结构在首次访问时自动创建，并自动写入两篇入门条目
// 可选环境变量：EDIT_PASSWORD（设置后编辑/删除需输入口令）
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
  if (kebab && kebab.length >= 4 && !/^\d+$/.test(kebab)) return kebab.slice(0, 60);
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const SEED_ARTICLES = [
  {
    slug: 'welcome',
    title: '欢迎来到本百科',
    category: '指南',
    author: '站长',
    content: [
      '这是一个**免注册、开箱即用**的简易百科站，任何人都可以阅读，你也可以直接创建和编辑条目。',
      '',
      '## 它能做什么',
      '',
      '- 创建条目：点击顶部「创建条目」，填写标题、分类和正文（支持 Markdown）',
      '- 编辑条目：进入任意条目，点击右上角「编辑」按钮',
      '- 搜索：使用右上角搜索框，全文检索标题与正文',
      '- 随机阅读：点击「随机阅读」，看看缘分带你去哪',
      '',
      '## 内容用什么格式？',
      '',
      '正文支持 **Markdown 语法**：标题用 `#`，加粗用 `**文字**`，列表用 `- `，',
      '链接写作 `[文字](https://example.com)`，具体见「编辑指南」条目。',
      '',
      '## 建议从这里开始',
      '',
      '- [站内条目：编辑指南](#/article/guide)',
      '- [内容列表](#/list)',
      '',
      '> 提示：站长可在前端代码 public/app.js 顶部修改站点名称、口号和公告内容。',
    ].join('\n'),
  },
  {
    slug: 'guide',
    title: '编辑指南',
    category: '指南',
    author: '站长',
    content: [
      '本站正文使用 Markdown 语法，下面是常用写法速查。',
      '',
      '## 标题',
      '',
      '```',
      '# 一级标题',
      '## 二级标题',
      '### 三级标题',
      '```',
      '',
      '## 文字效果',
      '',
      '- **加粗**：`**加粗**`',
      '- *斜体*：`*斜体*`',
      '- `行内代码`：用反引号包裹',
      '',
      '## 列表',
      '',
      '```',
      '- 无序列表项',
      '- 无序列表项',
      '',
      '1. 有序列表项',
      '2. 有序列表项',
      '```',
      '',
      '## 链接与引用',
      '',
      '- 链接：`[站内条目](#/article/welcome)`',
      '- 外部链接：`[Cloudflare](https://www.cloudflare.com)`',
      '- 引用：在行首加 `>`',
      '',
      '## 分隔线与代码块',
      '',
      '---',
      '',
      '```',
      '三个反引号包裹的内容会显示为代码块',
      '```',
      '',
      '## 编辑小贴士',
      '',
      '1. 分类建议使用简短统一的词，方便「内容列表」页归类',
      '2. 写完记得点「保存」，保存前可以用「预览」检查排版',
      '3. 本站不设注册登录，请互相爱护内容',
    ].join('\n'),
  },
];

async function ensureSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '未分类',
      content TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ).bind().run();

  const row = await db.prepare('SELECT COUNT(*) AS n FROM articles').bind().first();
  if (!row || row.n === 0) {
    for (const a of SEED_ARTICLES) {
      await db.prepare(
        `INSERT INTO articles (slug, title, category, content, author, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(a.slug, a.title, a.category, a.content, a.author, nowCN(), nowCN()).run();
    }
  }
}

function excerpt(content, len = 120) {
  const plain = String(content)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`!\[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > len ? plain.slice(0, len) + '…' : plain;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  const seg = (context.params && context.params.path) || [];

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (!env || !env.DB) {
    return json({ error: '后端未绑定 D1 数据库：请到 Pages 项目 → 设置 → 绑定 → 添加 D1，变量名必须为 DB（详见 README）' }, 500);
  }

  try {
    await ensureSchema(env.DB);
  } catch (e) {
    return json({ error: '数据库初始化失败：' + String(e && e.message || e) }, 500);
  }

  // 可选编辑口令校验（所有写操作）
  const isWrite = ['POST', 'PUT', 'DELETE'].includes(method);
  if (isWrite && env.EDIT_PASSWORD) {
    const pwd = request.headers.get('X-Edit-Password') || '';
    if (pwd !== env.EDIT_PASSWORD) {
      return json({ error: '需要编辑口令', needPassword: true }, 401);
    }
  }

  const DB = env.DB;

  try {
    // ---------- /api/config ----------
    if (seg[0] === 'config' && method === 'GET') {
      return json({ editPasswordRequired: !!env.EDIT_PASSWORD, now: nowCN() });
    }

    // ---------- /api/articles ----------
    if (seg[0] === 'articles') {
      // GET /api/articles  列表
      if (seg.length === 1 && method === 'GET') {
        const r = await DB.prepare(
          `SELECT slug, title, category, author, created_at, updated_at FROM articles ORDER BY updated_at DESC, id DESC`
        ).bind().all();
        return json({ articles: r.results || [] });
      }

      // POST /api/articles  创建
      if (seg.length === 1 && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const title = String(body.title || '').trim();
        const content = String(body.content || '').trim();
        if (!title || !content) return json({ error: '标题和正文都不能为空' }, 400);
        const category = String(body.category || '').trim() || '未分类';
        const author = String(body.author || '').trim().slice(0, 40);

        let slug = makeSlug(title);
        for (let i = 0; i < 5; i++) {
          const exists = await DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(slug).first();
          if (!exists) break;
          slug = makeSlug(title) + '-' + Math.random().toString(36).slice(2, 5);
        }

        const t = nowCN();
        const ins = await DB.prepare(
          `INSERT INTO articles (slug, title, category, content, author, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(slug, title, category, content, author, t, t).run();

        return json({
          ok: true, slug, id: ins.meta && ins.meta.last_row_id,
          message: '创建成功',
        }, 201);
      }

      // GET /api/articles/random
      if (seg[1] === 'random' && method === 'GET') {
        const r = await DB.prepare('SELECT slug FROM articles ORDER BY RANDOM() LIMIT 1').bind().first();
        if (!r) return json({ error: '站内还没有任何条目' }, 404);
        return json({ slug: r.slug });
      }

      // GET /api/articles/:slug
      if (seg.length === 2 && method === 'GET') {
        const r = await DB.prepare('SELECT * FROM articles WHERE slug = ?').bind(seg[1]).first();
        if (!r) return json({ error: '条目不存在，可能已被删除' }, 404);
        return json({ article: { ...r, excerpt: excerpt(r.content) } });
      }

      // PUT /api/articles/:slug
      if (seg.length === 2 && method === 'PUT') {
        const exists = await DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(seg[1]).first();
        if (!exists) return json({ error: '条目不存在' }, 404);
        const body = await request.json().catch(() => ({}));
        const title = String(body.title || '').trim();
        const content = String(body.content || '').trim();
        if (!title || !content) return json({ error: '标题和正文都不能为空' }, 400);
        const category = String(body.category || '').trim() || '未分类';
        const author = String(body.author || '').trim().slice(0, 40);

        await DB.prepare(
          `UPDATE articles SET title=?, category=?, content=?, author=?, updated_at=? WHERE slug=?`
        ).bind(title, category, content, author, nowCN(), seg[1]).run();
        return json({ ok: true, slug: seg[1], message: '保存成功' });
      }

      // DELETE /api/articles/:slug
      if (seg.length === 2 && method === 'DELETE') {
        const r = await DB.prepare('DELETE FROM articles WHERE slug = ?').bind(seg[1]).run();
        const changed = (r.meta && r.meta.changes) || 0;
        if (!changed) return json({ error: '条目不存在' }, 404);
        return json({ ok: true, message: '已删除' });
      }
    }

    // ---------- /api/search?q= ----------
    if (seg[0] === 'search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json({ results: [], q });
      const like = '%' + q.replace(/[%_\\]/g, '\\$&') + "%";
      const r = await DB.prepare(
        `SELECT slug, title, category, updated_at, content FROM articles
         WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT 50`
      ).bind(like, like).all();
      const results = (r.results || []).map((a) => ({
        slug: a.slug, title: a.title, category: a.category, updated_at: a.updated_at,
        excerpt: excerpt(a.content, 160),
      }));
      return json({ results, q });
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
        `SELECT category, COUNT(*) AS count FROM articles GROUP BY category ORDER BY count DESC, category ASC`
      ).bind().all();
      return json({ categories: r.results || [] });
    }

    return json({ error: '接口不存在', path: '/' + seg.join('/') }, 404);
  } catch (e) {
    return json({ error: '服务器内部错误：' + String(e && e.message || e) }, 500);
  }
}
