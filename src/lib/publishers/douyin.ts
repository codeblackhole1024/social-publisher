import { type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const DEBUG_DIR = path.join(process.cwd(), 'public', 'debug');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
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

  const safeScreenshot = async (filename: string) => {
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
    await safeScreenshot(`douyin_${timestamp}_1_initial.png`);
    
    if (page.url().includes('login') || (await page.locator('.login-container').count()) > 0) {
      return { success: false, message: '登录态已失效，页面停留在登录界面。请重新扫描二维码登录。', logs, screenshots };
    }

    await page.waitForTimeout(4000); 
    await safeScreenshot(`douyin_${timestamp}_2_upload_ready.png`);

    // 3. Upload the file
    log('Searching for file input...');
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 30000 }).catch(() => log('Timeout waiting for file input'));
    
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    log(`Uploading file from ${filePath}...`);
    await fileInput.setInputFiles(filePath);
    await safeScreenshot(`douyin_${timestamp}_3_file_selected.png`);
    
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
    
    await safeScreenshot(`douyin_${timestamp}_4_upload_complete.png`);
    await page.waitForTimeout(3000); 

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
    
    await safeScreenshot(`douyin_${timestamp}_5_text_filled.png`);
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
    
    await safeScreenshot(`douyin_${timestamp}_6_before_publish_click.png`);
    
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
      
      await safeScreenshot(`douyin_${timestamp}_7_success.png`);
      log('Published successfully!');
      return { success: true, message: '抖音发布成功！(已确认页面跳转或成功提示)', logs, screenshots };
    } catch (e) {
      await safeScreenshot(`douyin_${timestamp}_8_failed_detect.png`);
      
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
