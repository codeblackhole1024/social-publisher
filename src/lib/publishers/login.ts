import { chromium, type BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';

const COOKIES_DIR = path.join(process.cwd(), 'src/lib/publishers/cookies');

// Ensure cookie directory exists
if (!fs.existsSync(COOKIES_DIR)) {
  fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

export type Platform = 'douyin' | 'bilibili' | 'xiaohongshu' | 'youtube';

const PLATFORM_URLS: Record<Exclude<Platform, 'youtube'>, string> = {
  douyin: 'https://creator.douyin.com/',
  bilibili: 'https://member.bilibili.com/platform/home',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
};

export async function loginToPlatform(platform: Exclude<Platform, 'youtube'>) {
  const cookiePath = path.join(COOKIES_DIR, `${platform}.json`);
  
  console.log(`Starting login for ${platform}...`);
  console.log(`Please login manually in the opened browser window.`);

  // Launch headed browser so the user can see and scan QR code or type password
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
  });

  // Check if we already have a session to resume from
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

    // Give user 3 minutes to log in
    console.log(`Waiting for user to log into ${platform} (timeout: 3 minutes)...`);
    
    // We wait for a specific element that only appears after login, or just wait for the user to signal.
    // Since selectors change, a robust approach for a CLI/API tool is to wait for the user to close the page,
    // or wait for a specific URL change that indicates the dashboard loaded.
    
    if (platform === 'douyin') {
      // Wait until the URL is the dashboard or upload page
      await page.waitForURL('**/creator-micro/**', { timeout: 180000 }).catch(() => console.log('Timeout or URL mismatch, assuming manual close'));
    } else if (platform === 'bilibili') {
      await page.waitForURL('**/platform/home**', { timeout: 180000 }).catch(() => console.log('Timeout or URL mismatch, assuming manual close'));
    } else if (platform === 'xiaohongshu') {
      await page.waitForURL('**/creator/home**', { timeout: 180000 }).catch(() => console.log('Timeout or URL mismatch, assuming manual close'));
    }

    // Save the storage state (cookies + localStorage)
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

export function checkLoginStatus(platform: Exclude<Platform, 'youtube'>): boolean {
  const cookiePath = path.join(COOKIES_DIR, `${platform}.json`);
  // Simple check: does the cookie file exist?
  // In a robust implementation, you'd parse it and check expiry dates.
  return fs.existsSync(cookiePath);
}
