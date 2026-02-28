import { type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const DEBUG_DIR = path.join(process.cwd(), 'debug');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

export async function uploadToDouyin(
  page: Page,
  file: File | string, // Accept a local file path
  title: string,
  description: string,
  tags: string[]
) {
  try {
    const timestamp = Date.now();
    console.log(`Starting Douyin upload for: ${title} at ${timestamp}`);
    
    // Add anti-detection script
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    
    // 1. Navigate to the creator portal upload page
    await page.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: path.join(DEBUG_DIR, `douyin_${timestamp}_1_initial.png`) });
    
    // Safety check: Make sure we are not on login page
    if (page.url().includes('login') || (await page.locator('.login-container').count()) > 0) {
      return { success: false, message: '登录态已失效，页面停留在登录界面。请重新扫描二维码登录。' };
    }

    // Sometimes the upload modal or page structure takes time to render completely in SPA
    await page.waitForTimeout(4000); 
    await page.screenshot({ path: path.join(DEBUG_DIR, `douyin_${timestamp}_2_upload_ready.png`) });

    // 2. Upload the file
    // Some versions of Douyin use input[accept*="video"], others just a generic input file inside a dropzone
    const fileInput = await page.locator('input[type="file"]').first();
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    console.log('Uploading file:', filePath);
    await fileInput.setInputFiles(filePath);
    await page.screenshot({ path: path.join(DEBUG_DIR, `douyin_${timestamp}_3_file_selected.png`) });
    
    // 3. Wait for upload to complete
    console.log('Waiting for video upload to complete...');
    
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        // Looking for multiple potential states indicating the upload progress bar is done
        return text.includes('重新上传') || text.includes('上传成功') || text.includes('更换视频') || document.querySelector('.upload-success-icon');
      }, { timeout: 180000 }); // Give it up to 3 minutes
    } catch (e) {
      console.log('Timeout waiting for text indicators. Proceeding to check description form.');
    }
    
    await page.screenshot({ path: path.join(DEBUG_DIR, `douyin_${timestamp}_4_upload_complete.png`) });
    await page.waitForTimeout(3000); // UI stabilization

    // 4. Fill in title & description
    console.log('Filling description and tags...');
    
    // Try multiple possible selectors for the editor
    const editor = page.locator('.zone-container, .editor-kit-container, [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 10000 }).catch(() => console.log('Editor visibility timeout'));
    await editor.click({ force: true }).catch(() => {});
    
    const fullText = `${title}\n\n${description} ${tags.map(t => `#${t}`).join(' ')}`;
    
    // Clear and fill using keyboard for contenteditable fields (most robust method)
    await editor.fill('').catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.insertText(fullText);
    
    await page.screenshot({ path: path.join(DEBUG_DIR, `douyin_${timestamp}_5_text_filled.png`) });
    await page.waitForTimeout(1000);

    // 5. Click Publish
    console.log('Publishing...');
    // Douyin publish buttons usually contain the exact text "发布", and are distinct from "定时发布"
    const publishButton = page.locator('button', { hasText: /^发布$/ }).first();
    
    // Wait for the button to not be disabled (sometimes it's disabled while video processes)
    await publishButton.waitFor({ state: 'visible', timeout: 10000 }).catch(() => console.log('Publish button not visible'));
    
    // Check if it's disabled. If it is, wait a bit longer.
    const isDisabled = await publishButton.getAttribute('disabled');
    if (isDisabled !== null) {
        console.log('Publish button is disabled, waiting 5 more seconds...');
        await page.waitForTimeout(5000);
    }

    await publishButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1000); 
    
    await page.screenshot({ path: path.join(DEBUG_DIR, `douyin_${timestamp}_6_before_publish_click.png`) });
    
    await publishButton.click({ force: true });
    
    // 6. Wait for success indicator
    console.log('Waiting for success confirmation...');
    
    try {
      // It can redirect to /manage, show a toast, or show a modal
      await Promise.race([
        page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes('发布成功') || text.includes('投稿成功') || text.includes('进入审核') || text.includes('去查看');
        }, { timeout: 25000 }),
        page.waitForURL('**/manage/**', { timeout: 25000 })
      ]);
      
      await page.screenshot({ path: path.join(DEBUG_DIR, `douyin_${timestamp}_7_success.png`) });
      return { success: true, message: '抖音发布成功！(已确认页面跳转或成功提示)' };
    } catch (e) {
      await page.screenshot({ path: path.join(DEBUG_DIR, `douyin_${timestamp}_8_failed_detect.png`) });
      
      // Secondary check: sometimes an overlay blocks the click or there is a validation error (e.g. video too short)
      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.includes('网络异常') || pageText.includes('稍后重试')) {
         return { success: false, message: '发布被拒绝，可能是网络异常或请求频繁。' };
      }
      
      // If the URL changed anyway
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
