import { type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const DEBUG_DIR = path.join(process.cwd(), 'public', 'debug');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

// Helper to take screenshots safely without crashing the main flow
async function safeScreenshot(page: Page, filename: string, screenshots: string[], log: (msg: string) => void) {
  try {
    await page.screenshot({ 
      path: path.join(DEBUG_DIR, filename),
      timeout: 5000, 
      animations: 'disabled', 
    });
    screenshots.push(`/debug/${filename}`);
  } catch (err) {
    log(`Debug screenshot failed for ${filename}`);
  }
}

// Helper to check for security/SMS verification popups
async function checkForVerification(page: Page): Promise<boolean> {
  const text = await page.evaluate(() => document.body.innerText);
  return text.includes('获取短信验证码') || 
         text.includes('安全验证') || 
         text.includes('向您的手机号') || 
         text.includes('验证码已发送');
}

export async function uploadToDouyin(
  page: Page,
  file: File | string, 
  title: string,
  description: string,
  tags: string[]
) {
  const logs: string[] = [];
  const screenshots: string[] = [];

  const log = (msg: string) => {
    console.log(`[Douyin] ${msg}`);
    logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  };

  try {
    const timestamp = Date.now();
    log(`Starting Douyin upload for: ${title}`);
    
    // 1. Anti-detection & Network optimization
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type) && !route.request().url().includes('upload')) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // 2. Navigate
    log('Navigating to Douyin creator portal...');
    await page.goto('https://creator.douyin.com/creator-micro/content/upload', { 
        waitUntil: 'commit', 
        timeout: 60000 
    });
    
    await page.waitForSelector('body', { timeout: 30000 });
    await safeScreenshot(page, `douyin_${timestamp}_1_initial.png`, screenshots, log);
    
    if (page.url().includes('login') || (await page.locator('.login-container').count()) > 0) {
      return { success: false, message: '登录态已失效，页面停留在登录界面。请前往“账号管理”重新扫码登录。', logs, screenshots };
    }

    if (await checkForVerification(page)) {
      return { 
        success: false, 
        message: '触发了抖音的安全验证机制（需要手机验证码）。自动化服务无法完成此操作。请前往“账号管理”重新点击登录，在弹出的可见浏览器中手动完成验证码输入以刷新信任状态。', 
        logs, 
        screenshots 
      };
    }

    await page.waitForTimeout(4000); 
    await safeScreenshot(page, `douyin_${timestamp}_2_upload_ready.png`, screenshots, log);

    // 3. Upload the file
    log('Searching for file input...');
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 30000 }).catch(() => log('Timeout waiting for file input'));
    
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    log(`Uploading file from ${filePath}...`);
    await fileInput.setInputFiles(filePath);
    await safeScreenshot(page, `douyin_${timestamp}_3_file_selected.png`, screenshots, log);
    
    // 4. Wait for upload to complete
    log('Waiting for video upload to complete (this might take a few minutes)...');
    
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.includes('重新上传') || text.includes('上传成功') || text.includes('更换视频') || document.querySelector('.upload-success-icon');
      }, { timeout: 180000 });
      log('Video upload finished.');
    } catch (e) {
      log('Timeout waiting for text indicators. Proceeding to check description form.');
    }
    
    await safeScreenshot(page, `douyin_${timestamp}_4_upload_complete.png`, screenshots, log);
    await page.waitForTimeout(3000); 

    if (await checkForVerification(page)) {
      return { 
        success: false, 
        message: '上传完成后触发了安全验证（需要验证码）。请前往“账号管理”重新登录并在真实浏览器环境中完成操作以刷新信任状态。', 
        logs, 
        screenshots 
      };
    }

    // 5. Fill in title & description
    log('Filling description and tags...');
    
    const editor = page.locator('.zone-container, .editor-kit-container, [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 15000 }).catch(() => log('Editor visibility timeout'));
    await editor.click({ force: true }).catch(() => {});
    
    const fullText = `${title}\n\n${description} ${tags.map(t => `#${t}`).join(' ')}`;
    
    await editor.fill('').catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.insertText(fullText);
    
    await safeScreenshot(page, `douyin_${timestamp}_5_text_filled.png`, screenshots, log);
    await page.waitForTimeout(1000);

    // 6. Click Publish
    log('Publishing...');
    const publishButton = page.locator('button', { hasText: /^发布$/ }).first();
    
    await publishButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => log('Publish button not visible'));
    
    const isDisabled = await publishButton.getAttribute('disabled');
    if (isDisabled !== null) {
        log('Publish button is disabled, waiting 5 more seconds...');
        await page.waitForTimeout(5000);
    }

    await publishButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1000); 
    
    await safeScreenshot(page, `douyin_${timestamp}_6_before_publish_click.png`, screenshots, log);
    
    await publishButton.click({ force: true });
    
    // 7. Wait for success indicator
    log('Waiting for success confirmation (URL change or Success Toast)...');
    
    try {
      await Promise.race([
        page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes('发布成功') || text.includes('投稿成功') || text.includes('进入审核') || text.includes('去查看');
        }, { timeout: 30000 }),
        page.waitForURL('**/manage/**', { timeout: 30000 })
      ]);
      
      await safeScreenshot(page, `douyin_${timestamp}_7_success.png`, screenshots, log);
      log('Published successfully!');
      return { success: true, message: '抖音发布成功！(已确认页面跳转或成功提示)', logs, screenshots };
    } catch (e) {
      await safeScreenshot(page, `douyin_${timestamp}_8_failed_detect.png`, screenshots, log);
      
      // Final verification check
      if (await checkForVerification(page)) {
        return { 
          success: false, 
          message: '点击发布时触发了安全验证（手机验证码）。这是平台风控机制。请前往“账号管理”重新点击登录，并在真实可见的浏览器内完成一次手动操作来解除风控。', 
          logs, 
          screenshots 
        };
      }

      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.includes('网络异常') || pageText.includes('稍后重试')) {
         log('Network error or rate limit detected.');
         return { success: false, message: '发布被拒绝，可能是网络异常或请求频繁。', logs, screenshots };
      }
      
      if (page.url().includes('manage')) {
        log('Published successfully! (Silent URL change)');
        return { success: true, message: '抖音发布成功！(URL已静默变更)', logs, screenshots };
      }
      
      log('Failed to detect success state.');
      return { success: false, message: '点击了发布，但未检测到成功标志。请查看调试截图。', logs, screenshots };
    }

  } catch (error: any) {
    const errorMsg = `抖音自动化核心崩溃: ${error.message}`;
    console.error(errorMsg);
    logs.push(`[ERROR] ${errorMsg}`);
    return { success: false, message: errorMsg, logs, screenshots };
  }
}
