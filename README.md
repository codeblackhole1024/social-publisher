# Social Publisher / 自媒体一键发布平台

<p align="center">
  <strong>一键发布视频到多个自媒体平台 | One-click publish videos to multiple social media platforms</strong>
</p>

<p align="center">
  <a href="./README_zh.md">中文文档</a> | <a href="./README.md">English</a>
</p>

---

## 📢 Follow Me

| Platform | Link |
|:---:|:---:|
| YouTube | [@CodeBlackHole](https://www.youtube.com/@CodeBlackHole) |
| GitHub | [codeblackhole1024](https://github.com/codeblackhole1024) |
| Douyin (抖音) | <img src="./public/images/douyin.png" width="200" /> |
| WeChat (微信公众号) | <img src="./public/images/wechat.jpg" width="200" /> |

> If you find this project helpful, please ⭐ Star and follow my channels for more content!

---

## Introduction

**Social Publisher** is an automation tool built with Next.js that enables one-click video publishing to multiple social media platforms. Powered by Playwright browser automation, it handles login session management, video uploading, form filling, and publishing — all in one click.

## Supported Platforms

| Platform | Status | Notes |
|:---:|:---:|:---|
| Douyin (抖音) | ✅ Verified | QR code login, SMS verification handling, auto-publish |
| YouTube | ✅ Verified | Uses system Chrome (bypasses Google's bot detection) |
| Bilibili | ✅ Implemented | Video upload, category selection, auto-publish |
| Xiaohongshu (小红书) | ✅ Implemented | Video upload, tag filling, auto-publish |

## Key Features

- **One-Click Multi-Platform Publish** — Fill in title, description, tags, select platforms, publish to all at once
- **QR Code Login** — First-time login opens a browser for QR scanning; sessions are persisted via cookies
- **Verification Code Handling** — Interactive modal prompts for SMS verification codes during publishing
- **Publish Result Tracking** — Independent status, logs, and debug screenshots per platform
- **Data Persistence** — Supabase-backed storage for tasks and platform login states
- **Chinese UI** — Full Chinese language interface

## Tech Stack

| Technology | Purpose |
|:---|:---|
| [Next.js 16](https://nextjs.org/) | Full-stack framework (Frontend + API Routes) |
| [React 19](https://react.dev/) | UI rendering |
| [Tailwind CSS 4](https://tailwindcss.com/) | Styling |
| [Shadcn/UI](https://ui.shadcn.com/) | UI component library |
| [Playwright](https://playwright.dev/) | Browser automation (login & publish) |
| [Supabase](https://supabase.com/) | Database (task records & platform status) |
| TypeScript | Type safety |

## Getting Started

### Prerequisites

- Node.js >= 18
- npm or pnpm
- Supabase account (free tier works)
- Creator accounts on target platforms

### 1. Clone the Repository

```bash
git clone https://github.com/codeblackhole1024/social-publisher.git
cd social-publisher
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Install Playwright Browsers

```bash
npx playwright install chromium
```

### 4. Configure Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 5. Initialize Database

Run the following SQL in your Supabase dashboard:

```sql
-- Platforms table
CREATE TABLE IF NOT EXISTS platforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_connected BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ
);

-- Seed platform data
INSERT INTO platforms (id, name, is_connected) VALUES
  ('douyin', '抖音', false),
  ('bilibili', 'B站', false),
  ('youtube', 'YouTube', false),
  ('xiaohongshu', '小红书', false)
ON CONFLICT (id) DO NOTHING;

-- Tasks table
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

### 6. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. **Login to Platforms** — Click the "Login" button for each platform and complete QR code / account login in the opened browser
2. **Fill Content** — Enter video title, description, and tags
3. **Select File** — Upload the video file to publish
4. **Select Platforms** — Check the target platforms
5. **Publish** — Click the publish button and wait for automated upload and publishing
6. **View Results** — Monitor real-time publishing progress, logs, and screenshots for each platform

## Project Structure

```
social-publisher/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Main page (publish form + results)
│   │   ├── layout.tsx                # Layout (title, metadata)
│   │   └── api/
│   │       ├── publish/route.ts      # Publish API (background task handler)
│   │       ├── auth/[platform]/      # Platform login API
│   │       ├── auth/status/          # Login status query
│   │       └── tasks/[id]/verify/    # Verification code API
│   ├── lib/
│   │   ├── db.ts                     # Supabase data operations
│   │   ├── supabase.ts               # Supabase client
│   │   └── publishers/
│   │       ├── douyin.ts             # Douyin automation
│   │       ├── youtube.ts            # YouTube automation
│   │       ├── bilibili.ts           # Bilibili automation
│   │       ├── xiaohongshu.ts        # Xiaohongshu automation
│   │       ├── login.ts              # Unified login manager
│   │       └── cookies/              # Persisted login sessions
│   └── components/ui/                # Shadcn UI components
├── public/debug/                     # Debug screenshot output
├── uploads/                          # Temporary upload files
└── package.json
```

## Notes

- First-time login on each platform requires manual QR code scanning; sessions are saved for subsequent use
- Douyin publishing may trigger SMS verification — watch for the modal prompt on the page
- YouTube login uses the system-installed Chrome browser (not Playwright's bundled Chromium)
- Ensure your Xiaohongshu account has a bound phone number before publishing
- Debug screenshots are saved to `public/debug/` and viewable from publish results

## License

MIT
