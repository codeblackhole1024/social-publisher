# 自媒体一键发布平台 / Social Publisher

<p align="center">
  <strong>一键发布视频到多个自媒体平台 | One-click publish videos to multiple social media platforms</strong>
</p>

<p align="center">
  <a href="./README_zh.md">中文文档</a> | <a href="./README.md">English</a>
</p>

---

## 📢 关注我

| 平台 | 链接 |
|:---:|:---:|
| YouTube | [@CodeBlackHole](https://www.youtube.com/@CodeBlackHole) |
| GitHub | [codeblackhole1024](https://github.com/codeblackhole1024) |
| 抖音 | <img src="./public/images/douyin.png" width="200" /> |
| 微信公众号 | <img src="./public/images/wechat.jpg" width="200" /> |

> 如果这个项目对你有帮助，欢迎 ⭐ Star 并关注我的频道获取更多内容！

---

## 项目介绍

**自媒体一键发布平台** 是一个基于 Next.js 构建的自动化工具，支持将视频内容一键发布到多个主流自媒体平台。通过 Playwright 浏览器自动化技术，实现登录态管理、视频上传、信息填写和一键发布的完整流程。

## 支持平台

| 平台 | 状态 | 说明 |
|:---:|:---:|:---|
| 抖音 | ✅ 已验证 | 支持扫码登录、短信验证码交互、自动发布 |
| YouTube | ✅ 已验证 | 使用系统 Chrome 登录（绕过 Google 安全检测） |
| Bilibili | ✅ 已实现 | 支持视频上传、分区选择、自动发布 |
| 小红书 | ✅ 已实现 | 支持视频上传、标签填写、自动发布 |

## 核心功能

- **一键多平台发布** — 填写标题、描述、标签，选择平台，一键发布到所有选中平台
- **扫码登录** — 首次使用打开浏览器扫码登录，后续自动复用登录态（Cookie 持久化）
- **验证码交互** — 发布过程中触发短信验证时，页面弹窗引导用户输入验证码
- **发布结果追踪** — 每个平台独立展示发布状态、日志和调试截图
- **数据持久化** — 基于 Supabase 存储发布任务和平台登录状态
- **全中文界面** — 页面完全支持中文显示

## 技术栈

| 技术 | 用途 |
|:---|:---|
| [Next.js 16](https://nextjs.org/) | 全栈框架（前端 + API Routes） |
| [React 19](https://react.dev/) | UI 渲染 |
| [Tailwind CSS 4](https://tailwindcss.com/) | 样式 |
| [Shadcn/UI](https://ui.shadcn.com/) | UI 组件库 |
| [Playwright](https://playwright.dev/) | 浏览器自动化（登录 & 发布） |
| [Supabase](https://supabase.com/) | 数据库（任务记录 & 平台状态） |
| TypeScript | 类型安全 |

## 快速开始

### 前置条件

- Node.js >= 18
- npm 或 pnpm
- Supabase 账号（免费即可）
- 各平台已注册的创作者账号

### 1. 克隆项目

```bash
git clone https://github.com/codeblackhole1024/social-publisher.git
cd social-publisher
```

### 2. 安装依赖

```bash
npm install
```

### 3. 安装 Playwright 浏览器

```bash
npx playwright install chromium
```

### 4. 配置环境变量

创建 `.env.local` 文件：

```env
NEXT_PUBLIC_SUPABASE_URL=你的Supabase项目URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的Supabase匿名Key
```

### 5. 初始化数据库

在 Supabase 控制台执行以下 SQL：

```sql
-- 平台表
CREATE TABLE IF NOT EXISTS platforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_connected BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ
);

-- 初始化平台数据
INSERT INTO platforms (id, name, is_connected) VALUES
  ('douyin', '抖音', false),
  ('bilibili', 'B站', false),
  ('youtube', 'YouTube', false),
  ('xiaohongshu', '小红书', false)
ON CONFLICT (id) DO NOTHING;

-- 任务表
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  tags TEXT,
  platforms JSONB,
  status TEXT DEFAULT 'pending',
  results JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  requires_verification BOOLEAN DEFAULT FALSE,
  verification_platform TEXT,
  verification_code TEXT
);
```

### 6. 启动开发服务器

```bash
npm run dev
```

打开浏览器访问 [http://localhost:3000](http://localhost:3000)

## 使用流程

1. **登录平台** — 点击各平台的「登录」按钮，在弹出的浏览器中完成扫码/账号登录
2. **填写内容** — 输入视频标题、描述、标签
3. **选择文件** — 上传要发布的视频文件
4. **选择平台** — 勾选要发布的目标平台
5. **一键发布** — 点击发布按钮，等待各平台自动完成上传和发布
6. **查看结果** — 实时查看每个平台的发布进度、日志和截图

## 项目结构

```
social-publisher/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # 主页面（发布表单 + 结果展示）
│   │   ├── layout.tsx                # 布局（中文标题、元信息）
│   │   └── api/
│   │       ├── publish/route.ts      # 发布 API（后台任务处理）
│   │       ├── auth/[platform]/      # 平台登录 API
│   │       ├── auth/status/          # 登录状态查询
│   │       └── tasks/[id]/verify/    # 验证码交互 API
│   ├── lib/
│   │   ├── db.ts                     # Supabase 数据操作
│   │   ├── supabase.ts               # Supabase 客户端
│   │   └── publishers/
│   │       ├── douyin.ts             # 抖音自动化
│   │       ├── youtube.ts            # YouTube 自动化
│   │       ├── bilibili.ts           # Bilibili 自动化
│   │       ├── xiaohongshu.ts        # 小红书自动化
│   │       ├── login.ts              # 统一登录管理
│   │       └── cookies/              # 登录态持久化
│   └── components/ui/                # Shadcn UI 组件
├── public/debug/                     # 调试截图输出
├── uploads/                          # 临时上传文件
└── package.json
```

## 注意事项

- 首次登录各平台需要手动扫码，登录态会自动保存供后续使用
- 抖音发布可能触发短信验证码，请留意页面弹窗提示
- YouTube 登录使用系统安装的 Chrome 浏览器（非 Playwright 内置 Chromium）
- 小红书发布前请确保账号已绑定手机号
- 调试截图保存在 `public/debug/` 目录，可通过发布结果查看

## License

MIT
