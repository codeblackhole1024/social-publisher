import { type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const DEBUG_DIR = path.join(process.cwd(), 'debug');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

// Helper to take screenshots safely without crashing the main flow
async function safeScreenshot(page: Page, filename: string) {
  try {
    await page.screenshot({ 
      path: path.join(DEBUG_DIR, filename),
      timeout: 5000, 
      animations: 'disabled', 
    });
  } catch (err) {
    console.log(`Debug screenshot failed for ${filename}, continuing anyway...`);
  }
}

export async function uploadToDouyin(
  page: Page,
  file: File | string, 
  title: string,
  description: string,
  tags: string[]
) {
  try {
    const timestamp = Date.now();
    console.log(`Starting Douyin upload for: ${title} at ${timestamp}`);
    
    // 1. Anti-detection & Network optimization
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    
    // Block unnecessary resources to speed up page load
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      // Block images, media (other than our upload), fonts, and styles
      if (['image', 'media', 'font', 'stylesheet'].includes(type) && !route.request().url().includes('upload')) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // 2. Navigate to the creator portal upload page
    // Change waitUntil to 'commit' (receiving the first byte) instead of waiting for the full DOM tree
    // Increase timeout to 60 seconds (60000ms) to account for slow connections
    console.log('Navigating to Douyin creator portal...');
    await page.goto('https://creator.douyin.com/creator-micro/content/upload', { 
        waitUntil: 'commit', 
        timeout: 60000 
    });
    
    // Wait for the body element explicitly instead of relying on page load events
    await page.waitForSelector('body', { timeout: 30000 });
    await safeScreenshot(page, `douyin_${timestamp}_1_initial.png`);
    
    // Safety check: Make sure we are not on login page
    if (page.url().includes('login') || (await page.locator('.login-container').count()) > 0) {
      return { success: false, message: '登录态已失效，页面停留在登录界面。请重新扫描二维码登录。' };
    }

    // Sometimes the upload modal or page structure takes time to render completely in SPA
    await page.waitForTimeout(4000); 
    await safeScreenshot(page, `douyin_${timestamp}_2_upload_ready.png`);

    // 3. Upload the file
    console.log('Searching for file input...');
    // We wait up to 30s for the file input to actually exist in the DOM
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 30000 }).catch(() => console.log('Timeout waiting for input[type="file"]'));
    
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    console.log('Uploading file:', filePath);
    await fileInput.setInputFiles(filePath);
    await safeScreenshot(page, `douyin_${timestamp}_3_file_selected.png`);
    
    // 4. Wait for upload to complete
    console.log('Waiting for video upload to complete...');
    
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.includes('重新上传') || text.includes('上传成功') || text.includes('更换视频') || document.querySelector('.upload-success-icon');
      }, { timeout: 180000 }); // Give it up to 3 minutes
    } catch (e) {
      console.log('Timeout waiting for text indicators. Proceeding to check description form.');
    }
    
    await safeScreenshot(page, `douyin_${timestamp}_4_upload_complete.png`);
    await page.waitForTimeout(3000); // UI stabilization

    // 5. Fill in title & description
    console.log('Filling description and tags...');
    
    const editor = page.locator('.zone-container, .editor-kit-container, [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 15000 }).catch(() => console.log('Editor visibility timeout'));
    await editor.click({ force: true }).catch(() => {});
    
    const fullText = `${title}\n\n${description} ${tags.map(t => `#${t}`).join(' ')}`;
    
    await editor.fill('').catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.insertText(fullText);
    
    await safeScreenshot(page, `douyin_${timestamp}_5_text_filled.png`);
    await page.waitForTimeout(1000);

    // 6. Click Publish
    console.log('Publishing...');
    const publishButton = page.locator('button', { hasText: /^发布$/ }).first();
    
    await publishButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => console.log('Publish button not visible'));
    
    const isDisabled = await publishButton.getAttribute('disabled');
    if (isDisabled !== null) {
        console.log('Publish button is disabled, waiting 5 more seconds...');
        await page.waitForTimeout(5000);
    }

    await publishButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1000); 
    
    await safeScreenshot(page, `douyin_${timestamp}_6_before_publish_click.png`);
    
    await publishButton.click({ force: true });
    
    // 7. Wait for success indicator
    console.log('Waiting for success confirmation...');
    
    try {
      await Promise.race([
        page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes('发布成功') || text.includes('投稿成功') || text.includes('进入审核') || text.includes('去查看');
        }, { timeout: 30000 }),
        page.waitForURL('**/manage/**', { timeout: 30000 })
      ]);
      
      await safeScreenshot(page, `douyin_${timestamp}_7_success.png`);
      return { success: true, message: '抖音发布成功！(已确认页面跳转或成功提示)' };
    } catch (e) {
      await safeScreenshot(page, `douyin_${timestamp}_8_failed_detect.png`);
      
      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.includes('网络异常') || pageText.includes('稍后重试')) {
         return { success: false, message: '发布被拒绝，可能是网络异常或请求频繁。' };
      }
      
      if (page.url().includes('manage')) {
        return { success: true, message: '抖音发布成功！(URL已静默变更)' };
      }
      
      return { success: false, message: '点击了发布，但未检测到成功标志。请查看 /debug 目录下的截图以诊断问题。' };
    }

  } catch (error: any) {
    console.error('Douyin upload failed:', error);
    return { success: false, message: `抖音自动化核心崩溃: ${error.message}` };
  }
}
