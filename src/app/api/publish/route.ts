import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { chromium, type Browser } from 'playwright';
import { uploadToDouyin } from '@/lib/publishers/douyin';
import { uploadToYouTube } from '@/lib/publishers/youtube';
import { uploadToBilibili } from '@/lib/publishers/bilibili';
import { uploadToXiaohongshu } from '@/lib/publishers/xiaohongshu';
import { saveTask, type PublishTask, type PublishResult } from '@/lib/db';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const COOKIES_DIR = path.join(process.cwd(), 'src/lib/publishers/cookies');

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
    const platformsStr = formData.get('platforms') as string;
    const platformsObj = JSON.parse(platformsStr);
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const selectedPlatformNames = Object.entries(platformsObj)
      .filter(([_, isSelected]) => isSelected)
      .map(([key]) => key);

    const taskId = `task_${Date.now()}`;
    const taskRecord: PublishTask = {
      id: taskId,
      title,
      description,
      tags,
      platforms: selectedPlatformNames,
      status: 'processing',
      createdAt: new Date().toISOString(),
      results: []
    };
    
    await saveTask(taskRecord);

    const buffer = Buffer.from(await file.arrayBuffer());
    filePath = path.join(UPLOADS_DIR, `${Date.now()}-${file.name}`);
    fs.writeFileSync(filePath, buffer);

    const tagsArray = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const results: PublishResult[] = [];

    // Respond immediately with taskId to the frontend so it can start polling!
    // DO NOT await the headless execution before responding.
    // The headless execution must run asynchronously in the background.
    
    // Create an async worker function
    const runPublishing = async () => {
      try {
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security'
            ]
        });

        if (platformsObj.douyin) {
          try {
            const cookiePath = path.join(COOKIES_DIR, 'douyin.json');
            if (!fs.existsSync(cookiePath)) throw new Error('未找到抖音登录凭证');
            
            const context = await browser.newContext({ 
                storageState: cookiePath,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();
            
            // Pass taskId to Douyin so it can suspend and poll DB if needed
            const result = await uploadToDouyin(taskId, page, filePath, title, description, tagsArray);
            results.push({ platform: 'douyin', ...result });
            await context.close();
          } catch (err: any) {
            results.push({ platform: 'douyin', success: false, message: `自动化错误: ${err.message}`, logs: [err.message], screenshots: [] });
          }
        }
        
        if (platformsObj.youtube) {
          let ytBrowser: Browser | null = null;
          try {
            const cookiePath = path.join(COOKIES_DIR, 'youtube.json');
            if (!fs.existsSync(cookiePath)) throw new Error('未找到YouTube登录凭证');
            
            // YouTube requires system Chrome — Google blocks Playwright's Chromium
            ytBrowser = await chromium.launch({
                headless: true,
                channel: 'chrome',
                args: ['--disable-blink-features=AutomationControlled', '--disable-web-security']
            });
            const context = await ytBrowser.newContext({
                storageState: cookiePath,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();
            
            const result = await uploadToYouTube(page, filePath, title, description, tagsArray);
            results.push({ platform: 'youtube', ...result });
            await context.close();
          } catch (err: any) {
            results.push({ platform: 'youtube', success: false, message: `自动化错误: ${err.message}`, logs: [err.message], screenshots: [] });
          } finally {
            if (ytBrowser) await ytBrowser.close();
          }
        }

        if (platformsObj.bilibili) {
          try {
            const cookiePath = path.join(COOKIES_DIR, 'bilibili.json');
            if (!fs.existsSync(cookiePath)) throw new Error('未找到B站登录凭证');
            
            const context = await browser.newContext({
                storageState: cookiePath,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();
            
            const result = await uploadToBilibili(taskId, page, filePath, title, description, tagsArray);
            results.push({ platform: 'bilibili', ...result });
            await context.close();
          } catch (err: any) {
            results.push({ platform: 'bilibili', success: false, message: `自动化错误: ${err.message}`, logs: [err.message], screenshots: [] });
          }
        }
        
        if (platformsObj.xiaohongshu) {
          try {
            const cookiePath = path.join(COOKIES_DIR, 'xiaohongshu.json');
            if (!fs.existsSync(cookiePath)) throw new Error('未找到小红书登录凭证');
            
            const context = await browser.newContext({
                storageState: cookiePath,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();
            
            const result = await uploadToXiaohongshu(taskId, page, filePath, title, description, tagsArray);
            results.push({ platform: 'xiaohongshu', ...result });
            await context.close();
          } catch (err: any) {
            results.push({ platform: 'xiaohongshu', success: false, message: `自动化错误: ${err.message}`, logs: [err.message], screenshots: [] });
          }
        }

      } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (browser) await browser.close();

        // Update DB Task record as completed
        const anyFailures = results.some(r => !r.success);
        taskRecord.status = anyFailures && results.some(r => r.success) ? 'completed' : (anyFailures ? 'failed' : 'completed');
        taskRecord.results = results;
        taskRecord.requiresVerification = false; // clear state
        await saveTask(taskRecord);
      }
    };

    // Fire and forget the background worker
    runPublishing();

    // Immediately return the task ID so the UI can start polling /api/tasks/[id]/verify
    return NextResponse.json({ success: true, taskId });

  } catch (error: any) {
    console.error('Publish setup error:', error);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return NextResponse.json({ error: `发布初始化发生错误: ${error.message}` }, { status: 500 });
  }
}
