# Social Publisher

An open-source automation tool for distributing content across multiple social media platforms simultaneously.

## Features

- **Multi-Platform Support**: Post content to Douyin, Bilibili, Xiaohongshu, and YouTube from a single interface.
- **Unified UI**: Simple web interface built with Next.js, Tailwind CSS, and Shadcn/UI.
- **Automation Strategies**:
  - **YouTube**: Integrated via Rube MCP (`youtube-automation` skill).
  - **Douyin/Bilibili/Xiaohongshu**: Integrated via Playwright browser automation (simulating human uploading behavior).

## Prerequisites

- Node.js 18.x or later
- npm or pnpm
- Playwright browsers installed (`npx playwright install`)

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Project Structure

- `/src/app/page.tsx`: Main UI component containing the unified publishing form.
- `/src/app/api/publish/route.ts`: Backend API route that orchestrates the upload tasks.
- `/src/lib/publishers/`: Contains the specific upload implementations for each platform.
  - `douyin.ts`: Playwright logic for Douyin.
  - `bilibili.ts`: Playwright logic for Bilibili.
  - `xiaohongshu.ts`: Playwright logic for Xiaohongshu.
  - `youtube.ts`: Composio MCP integration logic for YouTube.

## Note on Chinese Platforms

Because Douyin, Xiaohongshu, and Bilibili generally restrict public API access for content creation to verified enterprise users, this tool relies on **Browser Automation (Playwright)**. 

To use this in production:
1. You will need to implement a cookie management system (e.g., logging in manually once, saving the `storage_state`, and reusing it for headless automation).
2. DOM selectors for these platforms change frequently. You must inspect and update the selectors in the `src/lib/publishers/` files accordingly.
