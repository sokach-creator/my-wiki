// ============================================================
// 百科档案馆 - 前端（无框架单页应用）
// 站长改这里：站点名称 / 口号 / 公告
// ============================================================
const SITE_NAME = '我的百科档案馆';
const SITE_TAGLINE = '记录一切 · 分享所学';
const SITE_NOTICE = '本站为简易百科，任何人都可以直接创建和编辑条目，无需注册登录。';

document.title = SITE_NAME;
document.getElementById('siteName').textContent = SITE_NAME;
document.getElementById('siteTagline').textContent = SITE_TAGLINE;

// ---------------- 工具 ----------------
const $app = document.getElementById('app');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const pwd = localStorage.getItem('wiki_edit_pwd');
  if (pwd) headers['X-Edit-Password'] = pwd;
  const resp = await fetch('/api' + path, Object.assign({}, opts, { headers }));
  let data = {};
  try { data = await resp.json(); } catch { /* 忽略 */ }
  if (!resp.ok) {
    const err = new Error(data.error || ('请求失败（HTTP ' + resp.status + '）'));
    err.status = resp.status;
    err.needPassword = !!data.needPassword;
    throw err;
  }
  return data;
}

function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' toast-error' : '');
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------- 图片：客户端压缩 + 上传 ----------------
// 上传前先在浏览器里压缩（最长边 1600px、优先 WebP），体积通常降 70~90%
const IMG_MAX_EDGE = 1600;
const IMG_UPLOAD_LIMIT = 15 * 1024 * 1024; // 原图 15MB 以上直接拒收

async function compressImage(file) {
  if (file.type === 'image/gif') return file; // 动图不压缩，保留原样
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch { return file; } // 解码失败就原样上传，由服务端校验
  const scale = Math.min(1, IMG_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  let blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.8));
  let mime = 'image/webp';
  if (!blob || blob.type !== 'image/webp') { // 旧浏览器不支持 WebP 编码则退 JPEG
    blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.78));
    mime = 'image/jpeg';
  }
  if (!blob) return file;
  const base = (file.name || 'image').replace(/\.[^.]+$/, '');
  const out = new File([blob], base + (mime === 'image/webp' ? '.webp' : '.jpg'), { type: mime });
  return out.size < file.size ? out : file; // 压缩反而变大（小图）就保留原图
}

function uploadImage(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file, file.name || 'image');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/images');
    const pwd = localStorage.getItem('wiki_edit_pwd');
    if (pwd) xhr.setRequestHeader('X-Edit-Password', pwd);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* 忽略 */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = new Error(data.error || ('上传失败（HTTP ' + xhr.status + '）'));
      err.status = xhr.status;
      err.needPassword = !!data.needPassword;
      reject(err);
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.send(fd);
  });
}

// 上传（自动处理首次输入编辑口令）
async function tryUpload(file, onProgress) {
  try {
    return await uploadImage(file, onProgress);
  } catch (err) {
    if (err.needPassword) {
      const pwd = prompt('本站已开启编辑口令，请输入：');
      if (!pwd) throw err;
      localStorage.setItem('wiki_edit_pwd', pwd);
      return uploadImage(file, onProgress);
    }
    throw err;
  }
}

// ---------------- Markdown 渲染（安全：先转义再解析） ----------------
function mdInline(s) {
  s = s.replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
    // 支持网络图片和本站上传的图片（/api/images/xx）
    if (/^(https?:)?\/\//.test(src) || /^\/api\/images\//.test(src)) {
      return '<img src="' + src + '" alt="' + alt + '" loading="lazy">';
    }
    return m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, href) => {
    if (/^https?:\/\//.test(href)) return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>';
    if (href.startsWith('#/')) return '<a href="' + href + '">' + txt + '</a>';
    return m;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let para = [];
  let i = 0;
  const flush = () => {
    if (para.length) { html += '<p>' + para.map(mdInline).join('<br>') + '</p>'; para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const lv = h[1].length;
      html += '<h' + lv + '>' + mdInline(esc(h[2].trim())) + '</h' + lv + '>';
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); html += '<hr>'; i++; continue; }
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(esc(lines[i].replace(/^>\s?/, ''))); i++; }
      html += '<blockquote>' + buf.map(mdInline).join('<br>') + '</blockquote>';
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(esc(lines[i].replace(/^\s*[-*]\s+/, ''))); i++; }
      html += '<ul>' + items.map((x) => '<li>' + mdInline(x) + '</li>').join('') + '</ul>';
      continue;
    }
    if (/^\s*\d+[.、)]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i])) { items.push(esc(lines[i].replace(/^\s*\d+[.、)]\s+/, ''))); i++; }
      html += '<ol>' + items.map((x) => '<li>' + mdInline(x) + '</li>').join('') + '</ol>';
      continue;
    }
    if (line.trim() === '') { flush(); i++; continue; }
    para.push(esc(line));
    i++;
  }
  flush();
  return html;
}

// 从渲染后的正文生成目录框
function buildToc(container) {
  const heads = container.querySelectorAll('h2, h3');
  if (heads.length < 2) return '';
  let html = '<div class="article-toc"><div class="toc-title">目录</div>';
  heads.forEach((el, idx) => {
    el.id = 'sec-' + idx;
    html += '<a class="' + (el.tagName === 'H3' ? 'lv3' : 'lv2') + '" href="#sec-' + idx + '">' + esc(el.textContent) + '</a>';
  });
  return html + '</div>';
}

// 高亮搜索命中（输入已是转义后的文本）
function highlight(text, q) {
  const t = esc(text);
  if (!q) return t;
  const eq = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return t.replace(new RegExp(eq, 'gi'), (m) => '<mark>' + m + '</mark>');
}

// ---------------- 视图 ----------------
function noticeBar() {
  if (localStorage.getItem('wiki_notice_closed')) return '';
  return '<div class="notice"><span>' + esc(SITE_NOTICE) + '</span>' +
    '<button class="notice-close" onclick="closeNotice()" title="关闭">✕</button></div>';
}
window.closeNotice = function () {
  localStorage.setItem('wiki_notice_closed', '1');
  const n = document.querySelector('.notice');
  if (n) n.remove();
};

async function viewHome() {
  const [stats, articles, cats] = await Promise.all([
    api('/stats'), api('/articles'), api('/categories'),
  ]);
  const latest = articles.articles.slice(0, 10);
  $app.innerHTML =
    noticeBar() +
    '<div class="card">' +
      '<h1 class="page-title" style="border-bottom:none;margin-bottom:0">欢迎来到' + esc(SITE_NAME) + '</h1>' +
      '<p class="page-sub" style="margin:6px 0 4px">' + esc(SITE_TAGLINE) + '</p>' +
      '<div class="hero-stats">' +
        '<div class="stat-box"><b>' + stats.articles + '</b><span>条目</span></div>' +
        '<div class="stat-box"><b>' + stats.categories + '</b><span>分类</span></div>' +
        '<div class="stat-box"><b style="font-size:15px;line-height:52px">' + esc(stats.lastUpdate || '—') + '</b><span>最近更新</span></div>' +
      '</div>' +
      '<div class="quick-links">' +
        '<a class="btn btn-primary" href="#/new">✎ 创建条目</a>' +
        '<a class="btn btn-outline" href="#/list">☰ 内容列表</a>' +
        '<a class="btn btn-outline" href="#/random">🎲 随机阅读</a>' +
        '<a class="btn btn-outline" href="#/article/guide">📖 编辑指南</a>' +
      '</div>' +
    '</div>' +
    '<div class="home-grid">' +
      '<div class="card"><h2 style="margin:4px 0 10px;font-size:20px">最近更新</h2>' +
        (latest.length
          ? '<ul style="margin:0;padding-left:24px">' + latest.map((a) =>
              '<li style="margin:8px 0"><a class="wiki-link" href="#/article/' + encodeURIComponent(a.slug) + '">' + esc(a.title) + '</a>' +
              '<span class="item-date">' + esc(a.category) + ' · ' + esc(a.updated_at) + '</span></li>').join('') + '</ul>'
          : '<div class="empty-tip">还没有条目，点上方「创建条目」写第一篇吧</div>') +
      '</div>' +
      '<div class="card"><h2 style="margin:4px 0 10px;font-size:20px">分类</h2>' +
        (cats.categories.length
          ? cats.categories.map((c) =>
              '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed #e5e0da">' +
              '<a class="wiki-link" href="#/list#cat-' + encodeURIComponent(c.category) + '">' + esc(c.category) + '</a>' +
              '<span style="color:var(--muted);font-size:13px">' + c.count + ' 条</span></div>').join('')
          : '<div class="empty-tip">暂无分类</div>') +
      '</div>' +
    '</div>';
}

async function viewList() {
  const data = await api('/articles');
  const groups = {};
  for (const a of data.articles) {
    (groups[a.category] = groups[a.category] || []).push(a);
  }
  const catNames = Object.keys(groups);
  $app.innerHTML =
    '<h1 class="page-title">内容列表</h1>' +
    '<div class="intro-box">' +
      '<p>这里汇总了本站全部条目，按分类分组排列。</p>' +
      '<p>点击红色链接即可进入阅读；发现缺少的内容，可以点顶部「创建条目」自行添加。' +
      '如需备份，可 <a class="wiki-link" href="javascript:void(0)" onclick="exportBackup()">导出全部条目（JSON）</a>。</p>' +
    '</div>' +
    '<div class="home-grid">' +
      '<div class="card">' +
        (catNames.length
          ? catNames.map((c) =>
              '<div class="cat-section" id="cat-' + esc(c) + '">' +
              '<h2>' + esc(c) + '<span class="cat-count">（' + groups[c].length + ' 条）</span></h2>' +
              '<ul>' + groups[c].map((a) =>
                '<li><a class="wiki-link" href="#/article/' + encodeURIComponent(a.slug) + '">' + esc(a.title) + '</a>' +
                '<span class="item-date">' + esc(a.updated_at) + ' 更新</span></li>').join('') + '</ul></div>').join('')
          : '<div class="empty-tip">站内还没有任何条目</div>') +
      '</div>' +
      '<div class="list-toc"><h3>分类导航</h3>' +
        catNames.map((c) => '<a href="#cat-' + encodeURIComponent(c) + '" onclick="jumpInPage(event,this)">' + esc(c) + '</a>').join('') +
      '</div>' +
    '</div>';
}
window.jumpInPage = function (e, el) {
  e.preventDefault();
  const target = document.getElementById(decodeURIComponent(el.getAttribute('href').slice(1)));
  if (target) target.scrollIntoView({ behavior: 'smooth' });
};

// 一键备份：下载全部条目的 JSON 文件
window.exportBackup = async function () {
  try {
    toast('正在打包备份…');
    const list = (await api('/articles')).articles;
    const full = [];
    for (const a of list) {
      try { full.push((await api('/articles/' + encodeURIComponent(a.slug))).article); } catch {}
    }
    const blob = new Blob([JSON.stringify({ site: SITE_NAME, exported_at: new Date().toISOString(), articles: full }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wiki-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('备份已下载（' + full.length + ' 条）');
  } catch (e) { toast('备份失败：' + (e.message || e), 4000); }
};

async function viewArticle(slug) {
  let data;
  try {
    data = await api('/articles/' + encodeURIComponent(slug));
  } catch (e) {
    $app.innerHTML = '<div class="card"><h1 class="page-title">条目不存在</h1>' +
      '<p style="margin:14px 0">' + esc(e.message) + '</p>' +
      '<a class="btn btn-primary" href="#/new">创建这个条目</a> ' +
      '<a class="btn btn-outline" href="#/list">返回内容列表</a></div>';
    return;
  }
  const a = data.article;
  const bodyHtml = renderMarkdown(a.content);
  $app.innerHTML =
    '<div class="card">' +
      '<div class="article-head">' +
        '<h1 class="page-title">' + esc(a.title) + '</h1>' +
        '<div class="article-actions">' +
          '<a class="btn btn-outline btn-small" href="#/edit/' + encodeURIComponent(a.slug) + '">✎ 编辑</a>' +
          '<button class="btn btn-danger btn-small" onclick="deleteArticle(\'' + encodeURIComponent(a.slug) + '\')">删除</button>' +
        '</div>' +
      '</div>' +
      '<div class="article-meta">所属分类：<a class="meta-cat" href="#/list#cat-' + encodeURIComponent(a.category) + '">' + esc(a.category) + '</a>' +
        (a.author ? ' · 编辑：' + esc(a.author) : '') +
        ' · 创建于 ' + esc(a.created_at) + ' · 最后更新 ' + esc(a.updated_at) + '</div>' +
      '<div id="tocHolder"></div>' +
      '<div class="article-body" id="articleBody">' + bodyHtml + '</div>' +
      '<a class="back-link" href="#/list">← 返回内容列表</a>' +
    '</div>';
  const toc = buildToc(document.getElementById('articleBody'));
  if (toc) document.getElementById('tocHolder').innerHTML = toc;
  document.title = a.title + ' - ' + SITE_NAME;
}

window.deleteArticle = async function (slugEnc) {
  if (!confirm('确定要删除这个条目吗？此操作不可恢复！')) return;
  try {
    const r = await api('/articles/' + slugEnc, { method: 'DELETE' });
    toast(r.message || '已删除');
    location.hash = '#/list';
  } catch (e) {
    if (e.needPassword) {
      const pwd = prompt('本站已开启编辑口令，请输入：');
      if (!pwd) return;
      localStorage.setItem('wiki_edit_pwd', pwd);
      return deleteArticle(slugEnc);
    }
    toast(e.message, true);
  }
};

async function viewSearch(q) {
  let data = { results: [] };
  if (q) { try { data = await api('/search?q=' + encodeURIComponent(q)); } catch { /* 保持空 */ } }
  $app.innerHTML =
    '<h1 class="page-title">搜索：' + esc(q) + '</h1>' +
    '<p class="page-sub">共找到 ' + data.results.length + ' 条相关内容</p>' +
    '<div class="card">' +
      (data.results.length
        ? data.results.map((r) =>
            '<div class="search-result">' +
            '<div class="sr-title"><a class="wiki-link" href="#/article/' + encodeURIComponent(r.slug) + '">' + highlight(r.title, q) + '</a></div>' +
            '<div class="sr-excerpt">' + highlight(r.excerpt, q) + '</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:3px">' + esc(r.category) + ' · ' + esc(r.updated_at) + '</div>' +
            '</div>').join('')
        : '<div class="empty-tip">没有找到相关内容。换个关键词试试，或者' +
          '<a class="wiki-link" href="#/new?q=' + encodeURIComponent(q || '') + '">创建这个条目</a></div>') +
    '</div>';
}

async function viewRandom() {
  try {
    const r = await api('/articles/random');
    location.hash = '#/article/' + encodeURIComponent(r.slug);
  } catch (e) {
    toast(e.message, true);
    location.hash = '#/';
  }
}

async function viewEditor(slug, presetQuery) {
  let a = { title: '', category: '', content: '', author: '' };
  let isEdit = false;
  if (slug) {
    try {
      const data = await api('/articles/' + encodeURIComponent(slug));
      a = data.article;
      isEdit = true;
    } catch (e) {
      toast(e.message, true);
      location.hash = '#/list';
      return;
    }
  }
  const cats = await api('/categories');
  let cfg = {};
  try { cfg = await api('/config'); } catch { /* 忽略 */ }
  const needPwd = !!cfg.editPasswordRequired && !localStorage.getItem('wiki_edit_pwd');

  // 恢复本地草稿
  const draftKey = 'wiki_draft_' + (slug || 'new');
  let draftTipHtml = '';
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (draft && (draft.content !== a.content || draft.title !== a.title)) {
      draftTipHtml = '<div class="draft-tip">检测到未保存的本地草稿（' + esc(draft.saved_at || '') + '）：' +
        '<button class="btn btn-outline btn-small" id="restoreDraft">恢复草稿</button> ' +
        '<button class="btn btn-outline btn-small" id="discardDraft">丢弃草稿</button></div>';
    }
  } catch { /* 忽略 */ }

  $app.innerHTML =
    '<h1 class="page-title">' + (isEdit ? '编辑条目' : '创建新条目') + '</h1>' +
    '<div class="card"><form class="editor-form" id="editorForm">' +
      '<label for="titleInput">标题 *</label>' +
      '<input type="text" id="titleInput" required maxlength="80" value="' + esc(a.title) + '" placeholder="例如：规则怪谈入门">' +
      '<label for="catInput">分类</label>' +
      '<input type="text" id="catInput" maxlength="20" list="catList" value="' + esc(a.category) + '" placeholder="例如：故事 / 资料 / 随笔（可新建）">' +
      '<datalist id="catList">' + cats.categories.map((c) => '<option value="' + esc(c.category) + '">').join('') + '</datalist>' +
      '<label for="authorInput">署名（可选，仅作展示）</label>' +
      '<input type="text" id="authorInput" maxlength="40" value="' + esc(a.author || localStorage.getItem('wiki_author') || '') + '" placeholder="你的昵称">' +
      (needPwd ? '<label for="pwdInput">编辑口令 *</label><input type="password" id="pwdInput" placeholder="站长已开启编辑口令，请输入">' : '') +
      '<label for="contentInput">正文（支持 Markdown）*</label>' +
      '<div class="editor-toolbar">' +
        '<button type="button" data-md="bold">加粗</button>' +
        '<button type="button" data-md="h2">标题</button>' +
        '<button type="button" data-md="link">链接</button>' +
        '<button type="button" id="imgBtn" title="上传图片：也可直接把截图粘贴或拖拽进编辑框">图片</button>' +
        '<button type="button" data-md="ul">列表</button>' +
        '<button type="button" data-md="quote">引用</button>' +
        '<button type="button" data-md="code">代码块</button>' +
        '<button type="button" data-md="hr">分隔线</button>' +
        '<span class="img-status" id="imgStatus" hidden></span>' +
        '<input type="file" id="imgInput" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>' +
      '</div>' +
      '<div class="editor-cols">' +
        '<textarea id="contentInput" required placeholder="在这里写正文…&#10;&#10;支持 Markdown：# 标题、**加粗**、- 列表、[链接](网址)">' + esc(a.content) + '</textarea>' +
        '<div class="preview-pane empty" id="previewPane"></div>' +
      '</div>' +
      draftTipHtml +
      '<div style="margin-top:16px;display:flex;gap:10px">' +
        '<button type="submit" class="btn btn-primary">💾 保存</button>' +
        '<a class="btn btn-outline" href="' + (isEdit ? '#/article/' + encodeURIComponent(slug) : '#/') + '">取消</a>' +
      '</div>' +
      '<div class="editor-tip">提示：本站不设注册登录，保存后立即对所有人可见。</div>' +
    '</form></div>';

  const contentInput = document.getElementById('contentInput');
  const preview = document.getElementById('previewPane');
  const updatePreview = () => {
    const v = contentInput.value;
    if (!v.trim()) { preview.classList.add('empty'); preview.innerHTML = ''; return; }
    preview.classList.remove('empty');
    preview.innerHTML = renderMarkdown(v);
  };
  contentInput.addEventListener('input', updatePreview);
  updatePreview();

  // 工具栏
  document.querySelectorAll('.editor-toolbar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!btn.dataset.md) return; // 图片按钮等无 data-md 的按钮单独处理
      const ins = {
        bold: ['**', '**'], h2: ['\n## ', '\n'], ul: ['- ', ''], quote: ['> ', ''],
        code: ['\n```\n', '\n```\n'], hr: ['\n---\n', ''],
        link: ['[', '](https://)'],
      }[btn.dataset.md] || ['', ''];
      const s = contentInput.selectionStart, e = contentInput.selectionEnd;
      const sel = contentInput.value.slice(s, e);
      contentInput.setRangeText(ins[0] + sel + ins[1], s, e, 'end');
      contentInput.focus();
      updatePreview();
    });
  });

  // 图片上传：按钮选择 / 截图粘贴 / 拖拽，三种方式统一走这里
  const imgStatus = document.getElementById('imgStatus');
  const showImgStatus = (text) => {
    if (!text) { imgStatus.hidden = true; return; }
    imgStatus.textContent = text;
    imgStatus.hidden = false;
  };
  const insertAtCursor = (text) => {
    const s = contentInput.selectionStart, e = contentInput.selectionEnd;
    contentInput.setRangeText(text, s, e, 'end');
    contentInput.dispatchEvent(new Event('input')); // 触发预览刷新和草稿保存
    contentInput.focus();
  };
  async function handleImageFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const f of files) {
      if (!/^image\//.test(f.type)) { toast('「' + f.name + '」不是图片文件', true); continue; }
      if (f.size > IMG_UPLOAD_LIMIT) { toast('「' + f.name + '」超过 15MB，请先缩小后再上传', true); continue; }
      try {
        showImgStatus('⏳ 压缩中…');
        const up = await compressImage(f);
        const r = await tryUpload(up, (p) => showImgStatus('⏳ 上传中 ' + p + '%'));
        const alt = (up.name || '图片').replace(/\.[^.]+$/, '');
        insertAtCursor((contentInput.value && !contentInput.value.endsWith('\n') ? '\n' : '') + '![' + esc(alt) + '](' + r.url + ')\n');
        showImgStatus('');
        toast('图片已插入（' + Math.round(r.size / 1024) + 'KB）');
      } catch (err) {
        showImgStatus('');
        toast(err.message || '图片上传失败', true);
      }
    }
  }
  document.getElementById('imgBtn').addEventListener('click', () => document.getElementById('imgInput').click());
  document.getElementById('imgInput').addEventListener('change', (e) => {
    handleImageFiles(e.target.files);
    e.target.value = ''; // 允许重复选择同一文件
  });
  contentInput.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) { e.preventDefault(); handleImageFiles(files); }
  });
  ['dragover', 'drop'].forEach((ev) => {
    contentInput.addEventListener(ev, (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      if (ev === 'drop') handleImageFiles(files);
    });
  });

  // 草稿：自动保存 / 恢复 / 丢弃
  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        title: document.getElementById('titleInput').value,
        content: contentInput.value,
        saved_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }),
      }));
    } catch { /* 忽略 */ }
  };
  let draftTimer;
  contentInput.addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 800); });
  const restoreBtn = document.getElementById('restoreDraft');
  if (restoreBtn) restoreBtn.addEventListener('click', () => {
    const d = JSON.parse(localStorage.getItem(draftKey) || '{}');
    document.getElementById('titleInput').value = d.title || '';
    contentInput.value = d.content || '';
    updatePreview();
  });
  const discardBtn = document.getElementById('discardDraft');
  if (discardBtn) discardBtn.addEventListener('click', () => {
    localStorage.removeItem(draftKey);
    location.reload();
  });

  // 保存（带防重复提交保护）
  let saving = false;
  async function doSave() {
    if (saving) return;
    saving = true;
    const btn = document.querySelector('#editorForm button[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.orig = btn.textContent; btn.textContent = '⏳ 保存中…'; }
    const unlock = () => { saving = false; if (btn) { btn.disabled = false; btn.textContent = btn.dataset.orig || '💾 保存'; } };
    try {
      const pwdEl = document.getElementById('pwdInput');
      if (pwdEl && pwdEl.value) localStorage.setItem('wiki_edit_pwd', pwdEl.value);
      const payload = {
        title: document.getElementById('titleInput').value.trim(),
        category: document.getElementById('catInput').value.trim(),
        content: contentInput.value.trim(),
        author: document.getElementById('authorInput').value.trim(),
      };
      if (!payload.title || !payload.content) { toast('标题和正文都不能为空', true); unlock(); return; }
      if (payload.author) localStorage.setItem('wiki_author', payload.author);

      const r = isEdit
        ? await api('/articles/' + encodeURIComponent(slug), { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/articles', { method: 'POST', body: JSON.stringify(payload) });
      unlock();
      localStorage.removeItem(draftKey);
      toast(r.message || '已保存');
      location.hash = '#/article/' + encodeURIComponent(r.slug || slug);
    } catch (err) {
      if (err.needPassword) {
        unlock();
        const pwd = prompt('本站已开启编辑口令，请输入：');
        if (!pwd) return;
        localStorage.setItem('wiki_edit_pwd', pwd);
        return doSave();
      }
      toast(err.message || '保存失败', true);
      unlock();
    }
  }
  document.getElementById('editorForm').addEventListener('submit', (e) => {
    e.preventDefault();
    doSave();
  });

  if (presetQuery && !isEdit) {
    document.getElementById('titleInput').value = presetQuery;
    document.getElementById('titleInput').focus();
  }
}

// ---------------- 路由 ----------------
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = h.split('?');
  const params = new URLSearchParams(queryPart || '');
  return { path: pathPart, params };
}

async function render() {
  const { path, params } = parseHash();
  const seg = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  document.getElementById('mainNav').classList.remove('open');
  $app.innerHTML = '<div class="loading">正在加载…</div>';
  try {
    if (seg.length === 0) return await viewHome();
    if (seg[0] === 'list') return await viewList();
    if (seg[0] === 'new') return await viewEditor(null, params.get('q') || '');
    if (seg[0] === 'edit' && seg[1]) return await viewEditor(decodeURIComponent(seg[1]));
    if (seg[0] === 'article' && seg[1]) return await viewArticle(decodeURIComponent(seg[1]));
    if (seg[0] === 'search') return await viewSearch(params.get('q') || '');
    if (seg[0] === 'random') return await viewRandom();
    $app.innerHTML = '<div class="card"><h1 class="page-title">页面不存在</h1><p style="margin:14px 0">你要找的页面不存在。</p><a class="btn btn-primary" href="#/">返回首页</a></div>';
  } catch (e) {
    $app.innerHTML = '<div class="card"><h1 class="page-title">出错了</h1><p style="margin:14px 0">' +
      esc(e.message || String(e)) + '</p>' +
      '<p style="color:var(--muted);font-size:13px">请先刷新页面重试。若反复出现数据库相关错误，请检查 wrangler.jsonc 中的 D1 绑定（变量名必须为 DB）。</p>' +
      '<a class="btn btn-primary" href="#/">返回首页</a></div>';
  }
}

window.addEventListener('hashchange', render);

// 图片灯箱：点击正文/预览里的图片放大查看（Esc 或点击任意处关闭）
document.addEventListener('click', (e) => {
  const img = e.target.closest('.article-body img, .preview-pane img');
  if (!img) return;
  const lb = document.createElement('div');
  lb.className = 'img-lightbox';
  const big = document.createElement('img');
  big.src = img.src;
  big.alt = img.alt || '';
  lb.appendChild(big);
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.img-lightbox').forEach((x) => x.remove());
});

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('searchInput').value.trim();
  if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
  else location.hash = '#/search';
});
document.getElementById('navToggle').addEventListener('click', () => {
  document.getElementById('mainNav').classList.toggle('open');
});

render();
