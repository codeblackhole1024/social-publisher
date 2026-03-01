import { chromium, type BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';

const COOKIES_DIR = path.join(process.cwd(), 'src/lib/publishers/cookies');

if (!fs.existsSync(COOKIES_DIR)) {
  fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

export type Platform = 'douyin' | 'bilibili' | 'xiaohongshu' | 'youtube';

const PLATFORM_URLS: Record<Platform, string> = {
  douyin: 'https://creator.douyin.com/',
  bilibili: 'https://member.bilibili.com/platform/home',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  youtube: 'https://studio.youtube.com/',
};

export async function loginToPlatform(platform: Platform) {
  const cookiePath = path.join(COOKIES_DIR, `${platform}.json`);
  
  console.log(`Starting login for ${platform}...`);
  console.log(`Please login manually in the opened browser window.`);

  // Use system Chrome for YouTube (Google blocks Playwright's Chromium as 'unsafe browser')
  const useSystemChrome = platform === 'youtube';
  const browser = await chromium.launch({
    headless: false,
    ...(useSystemChrome ? { channel: 'chrome' } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized', '--disable-blink-features=AutomationControlled'],
  });

  let context: BrowserContext;
  if (fs.existsSync(cookiePath)) {
    console.log(`Loading existing session for ${platform}...`);
    context = await browser.newContext({ storageState: cookiePath });
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();
  
  try {
    await page.goto(PLATFORM_URLS[platform]);

    console.log(`Waiting for user to log into ${platform} (timeout: 3 minutes)...`);
    
    // Check URL or content to confirm login
    if (platform === 'douyin') {
      await page.waitForURL('**/creator-micro/**', { timeout: 180000 }).catch(() => console.log('Timeout assuming manual close'));
    } else if (platform === 'bilibili') {
      await page.waitForURL('**/platform/home**', { timeout: 180000 }).catch(() => console.log('Timeout assuming manual close'));
    } else if (platform === 'xiaohongshu') {
      await page.waitForURL('**/creator/home**', { timeout: 180000 }).catch(() => console.log('Timeout assuming manual close'));
    } else if (platform === 'youtube') {
      // YouTube Studio — wait for channel dashboard or studio home
      await page.waitForURL('**/studio.youtube.com/**', { timeout: 180000 }).catch(() => console.log('Timeout assuming manual close'));
    }

    await context.storageState({ path: cookiePath });
    console.log(`Successfully saved session for ${platform} to ${cookiePath}`);
    
    await browser.close();
    return { success: true, message: `Login successful for ${platform}` };

  } catch (error) {
    console.error(`Login process failed for ${platform}:`, error);
    await browser.close();
    return { success: false, error: `Login failed for ${platform}` };
  }
}

export function checkLoginStatus(platform: Platform): boolean {
  const cookiePath = path.join(COOKIES_DIR, `${platform}.json`);
  return fs.existsSync(cookiePath);
}
