# 我的百科档案馆

一个免注册、开箱即用的简易百科网站（仿维基风格），支持创建 / 编辑 / 删除 / 全文搜索 / 随机阅读 / 一键备份，正文支持 Markdown。

- 前端：原生 HTML/CSS/JS 单页应用（无构建步骤）
- 后端：`worker/index.js`（Cloudflare Workers）
- 数据库：Cloudflare D1（免费；首次访问自动建表并写入 2 篇入门条目）
- 部署：GitHub 连接 Cloudflare Workers，推送即自动部署

## 项目结构

```
my-wiki/（仓库根目录）
├── wrangler.jsonc    ← 部署配置（★ 需要填入你的数据库 ID）
├── worker/
│   └── index.js      ← 后端 API + 数据库逻辑（不需要动）
└── public/           ← 网站静态文件
    ├── index.html    ← 页面外壳
    ├── app.js        ← 前端逻辑（顶部 3 个常量可改站名/口号/公告）
    └── style.css     ← 样式（顶部 CSS 变量可改配色）
```

## 部署步骤

### 第 1 步：创建 D1 数据库并拿到 ID

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → 左侧 **存储和数据库** → **D1 SQL 数据库** → **创建数据库**
2. 名字填 **`wiki-db`**（必须一致）→ 创建
3. 打开 `wiki-db` 详情页 → 复制页面上的 **数据库 ID**（一串 32 位的字符）

### 第 2 步：上传项目到 GitHub

1. 登录 [github.com](https://github.com) → 右上角 **+** → **New repository** → 名字 `my-wiki` → **Create repository**
2. 点 **uploading an existing file**，把本项目里的 **3 样东西** 一起拖进上传区：
   - `wrangler.jsonc`（拖之前先用记事本打开，把 `"database_id"` 的值换成第 1 步复制的 ID ⚠️ 忘了换部署会失败）
   - `worker` 文件夹
   - `public` 文件夹
3. 确认仓库首页能看到 `wrangler.jsonc`、`worker`、`public` 三项 → **Commit changes**

### 第 3 步：连接 Cloudflare（如果已经建过项目就跳过）

1. Cloudflare 后台 → **Workers 和 Pages** → **创建** → **Workers** → **连接到 Git** → 选 `my-wiki`
2. 其它设置保持默认 → 部署（会得到一个 `my-wiki.xxx.workers.dev` 网址）

### 第 4 步：验证

打开 `my-wiki.xxx.workers.dev`，看到《欢迎来到本百科》《编辑指南》两篇条目即成功。
之后每次在 GitHub 改动文件都会自动重新部署。

> 部署日志报 `database_id` 相关错误 = 第 2 步忘了替换数据库 ID；
> 报 `DB` 未绑定 = wrangler.jsonc 没上传成功，检查仓库根目录是否有它。

## 绑定自定义域名

1. Cloudflare 后台 → **Workers 和 Pages** → 打开 `my-wiki` → **设置** → **域和路由**（Domains & Routes）→ **添加** → **自定义域**
2. 输入 `wiki.sokach.dpdns.org`（建议用子域名，根域名留给其他服务）→ 确认
3. Cloudflare 自动添加 DNS 记录，等几分钟证书签发，访问 `https://wiki.sokach.dpdns.org`

## 可选：开启编辑口令

默认任何访客都能编辑。想防止陌生人乱改：在 `wrangler.jsonc` 中加入：

```jsonc
"vars": { "EDIT_PASSWORD": "你的口令" }
```

推送后编辑/删除时网站会提示输入口令。删掉这段即恢复完全开放。

## 站长自定义

- 站点名称 / 口号 / 公告：`public/app.js` 最顶部三个常量
- 内置入门条目：`worker/index.js` 中的 `SEED_ARTICLES`
- 配色：`public/style.css` 顶部 CSS 变量

## 数据备份

「内容列表」页 → **导出全部条目（JSON）**，会下载包含所有条目的 JSON 文件，建议定期备份。
