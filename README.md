# 我的百科档案馆

一个免注册、开箱即用的简易百科网站（仿维基风格），支持创建 / 编辑 / 删除 / 全文搜索 / 随机阅读，正文支持 Markdown。

- 前端：原生 HTML/CSS/JS 单页应用（无构建步骤）
- 后端：Cloudflare Pages Functions
- 数据库：Cloudflare D1（免费，首次访问自动建表并写入 2 篇入门条目）

## 部署步骤（全程网页点选，无需命令行）

### 1. 上传到 GitHub

1. 登录 [github.com](https://github.com) → 右上角 **+** → **New repository**
2. 仓库名填 `my-wiki`，选 Public（或 Private 也可以），点 **Create repository**
3. 在新页面点 **uploading an existing file** 链接
4. 把本项目文件夹 **里面的内容**（`functions/`、`public/`、`README.md`）一起拖进上传区，
   ⚠️ 注意：拖进去后仓库根目录应该直接能看到 `functions` 和 `public` 两个文件夹
5. 点 **Commit changes** 完成上传

### 2. 创建 Cloudflare Pages 并连接仓库

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → 左侧 **Workers 和 Pages** → **创建** → 选 **Pages** 标签
2. **连接到 Git** → 授权 GitHub → 选中刚才的 `my-wiki` 仓库 → **开始设置**
3. 构建设置：
   - 框架预设：无（None）
   - 构建命令：留空
   - 构建输出目录：`public`
4. 点 **保存并部署**，等待部署完成，先记下分配的 `xxx.pages.dev` 域名

### 3. 创建 D1 数据库并绑定

1. 左侧菜单 **存储和数据库** → **D1 SQL 数据库** → **创建数据库**，名字填 `wiki-db`
2. 回到你的 Pages 项目 → **设置** → **绑定** → **添加** → 选 **D1 数据库**
   - 变量名称：`DB`（必须大写，必须是 DB）
   - 选择数据库：`wiki-db`
   - 保存
3. 回到 **部署** 页面，在最新一次部署右侧点 **⋯** → **重试部署**（让绑定生效）
4. 访问你的 `xxx.pages.dev`，首次打开会自动建表并出现两篇入门条目，即部署成功

### 4. 绑定自定义域名（wiki 子域名）

1. Pages 项目 → **自定义域** → **设置自定义域**
2. 输入 `wiki.sokach.dpdns.org`（建议用子域名，根域名留给现有服务）
3. 按提示确认，Cloudflare 会自动添加 DNS 记录 → 点 **激活域**
4. 等待证书签发（几分钟），然后访问 `https://wiki.sokach.dpdns.org`

## 可选：开启编辑口令

本站默认任何访客都能编辑。若想防止陌生人乱改：
Pages 项目 → **设置** → **变量和机密** → 添加变量 `EDIT_PASSWORD`，值设为你的口令，
之后编辑/删除时网站会提示输入口令。删除该变量即可恢复完全开放。

## 站长自定义

- 站点名称 / 口号 / 公告：编辑 `public/app.js` 最顶部三个常量
- 入门条目内容：编辑 `functions/api/[[path]].js` 中的 `SEED_ARTICLES`
- 配色：编辑 `public/style.css` 顶部的 CSS 变量

## 本地开发（可选，需要 Node.js 18+ 和 npm）

```bash
npm install -g wrangler
npx wrangler pages dev public --d1 DB=xxx   # xxx 换成你的 D1 数据库 ID
```
