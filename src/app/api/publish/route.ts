import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { chromium, type Browser } from 'playwright';
import { uploadToDouyin } from '@/lib/publishers/douyin';
// import { uploadToBilibili } from '@/lib/publishers/bilibili';
// import { uploadToXiaohongshu } from '@/lib/publishers/xiaohongshu';
// import { uploadToYouTube } from '@/lib/publishers/youtube';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const COOKIES_DIR = path.join(process.cwd(), 'src/lib/publishers/cookies');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function POST(req: Request) {
  let browser: Browser | null = null;
  let filePath = '';

  try {
    const formData = await req.formData();
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const tags = formData.get('tags') as string;
    const platforms = JSON.parse(formData.get('platforms') as string);
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Save the physical file locally
    const buffer = Buffer.from(await file.arrayBuffer());
    filePath = path.join(UPLOADS_DIR, `${Date.now()}-${file.name}`);
    fs.writeFileSync(filePath, buffer);

    const results = [];
    const tagsArray = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    // Launch a headless browser session to be shared (different contexts)
    browser = await chromium.launch({ headless: true });

    // Execute platforms sequentially to avoid blocking or memory overload
    if (platforms.douyin) {
      try {
        const cookiePath = path.join(COOKIES_DIR, 'douyin.json');
        if (!fs.existsSync(cookiePath)) throw new Error('未找到抖音登录凭证');
        
        const context = await browser.newContext({ storageState: cookiePath });
        const page = await context.newPage();
        
        const result = await uploadToDouyin(page, filePath, title, description, tagsArray);
        results.push({ platform: 'douyin', ...result });
        await context.close();
      } catch (err: any) {
        results.push({ platform: 'douyin', success: false, message: `自动化错误: ${err.message}` });
      }
    }
    
    // Add other platforms similarly (Bilibili, Xiaohongshu)...
    if (platforms.bilibili) {
      results.push({ platform: 'bilibili', success: false, message: 'Playwright逻辑待实现' });
    }
    
    if (platforms.xiaohongshu) {
      results.push({ platform: 'xiaohongshu', success: false, message: 'Playwright逻辑待实现' });
    }
    
    if (platforms.youtube) {
      results.push({ platform: 'youtube', success: false, message: 'Composio逻辑待接通' });
    }

    // Clean up temporary file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    if (browser) await browser.close();
    return NextResponse.json({ success: true, results });

  } catch (error: any) {
    console.error('Publish error:', error);
    if (browser) await browser.close().catch(() => {});
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return NextResponse.json({ error: `发布过程发生错误: ${error.message}` }, { status: 500 });
  }
}
