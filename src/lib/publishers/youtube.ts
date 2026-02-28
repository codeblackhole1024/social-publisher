import { type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const DEBUG_DIR = path.join(process.cwd(), 'public', 'debug');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

export async function uploadToYouTube(
  page: Page,
  file: File | string,
  title: string,
  description: string,
  tags: string[]
) {
  const logs: string[] = [];
  const screenshots: string[] = [];

  const log = (msg: string) => {
    console.log(`[YouTube] ${msg}`);
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
    log(`Starting YouTube upload for: ${title}`);
    
    log('Navigating to YouTube Studio...');
    await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded' });
    await safeScreenshot(`youtube_${timestamp}_1_initial.png`);
    
    if (page.url().includes('signin') || page.url().includes('AccountChooser')) {
      return { success: false, message: 'YouTube登录态已失效，请重新登录', logs, screenshots };
    }

    await page.waitForTimeout(3000);

    // 1. Click Create -> Upload Videos
    log('Clicking Create and Upload Videos...');
    await page.locator('#create-icon').first().click();
    await page.waitForTimeout(1000);
    await safeScreenshot(`youtube_${timestamp}_2_create_menu.png`);
    
    await page.locator('#text-item-0').locator('text="Upload videos"').click().catch(async () => {
      // Fallback selector
      await page.locator('tp-yt-paper-item:has-text("Upload")').first().click();
    });

    // 2. Upload file
    const fileInput = await page.locator('input[type="file"]').first();
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    log(`Uploading file from ${filePath}...`);
    await fileInput.setInputFiles(filePath);
    await safeScreenshot(`youtube_${timestamp}_3_file_selected.png`);
    
    // 3. Wait for the upload details dialog to fully appear
    log('Waiting for upload dialog to render...');
    const titleBox = page.locator('#textbox[aria-label*="Title"]').first();
    await titleBox.waitFor({ state: 'visible', timeout: 30000 });

    // 4. Fill Title
    log('Filling title...');
    await titleBox.click();
    await titleBox.clear();
    await page.keyboard.insertText(title.substring(0, 100)); // YT max 100

    // 5. Fill Description
    log('Filling description...');
    const descBox = page.locator('#textbox[aria-label*="Tell viewers"]').first();
    await descBox.click();
    await descBox.clear();
    await page.keyboard.insertText(`${description}\n\n${tags.map(t => `#${t}`).join(' ')}`.substring(0, 5000));
    await safeScreenshot(`youtube_${timestamp}_4_text_filled.png`);

    // 6. Select "No, it's not made for kids" (Required)
    log('Setting Audience rating to "Not made for kids"...');
    const notForKids = page.locator('[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').first();
    await notForKids.scrollIntoViewIfNeeded();
    await notForKids.click();

    // 7. Click Next until Visibility tab
    log('Navigating through tabs (Details -> Elements -> Checks -> Visibility)...');
    const nextButton = page.locator('#next-button').first();
    
    await nextButton.click();
    await page.waitForTimeout(1000);
    await nextButton.click();
    await page.waitForTimeout(1000);
    await nextButton.click();
    await page.waitForTimeout(1000);
    await safeScreenshot(`youtube_${timestamp}_5_visibility_tab.png`);

    // 8. Select Public
    log('Setting visibility to Public...');
    const publicRadio = page.locator('[name="PUBLIC"]').first();
    await publicRadio.click();

    // 9. Click Publish / Done
    log('Publishing video...');
    const doneButton = page.locator('#done-button').first();
    await doneButton.click();

    // 10. Wait for success/uploading dialog
    log('Waiting for success confirmation dialog...');
    const closeButton = page.locator('#close-button').first();
    await closeButton.waitFor({ state: 'visible', timeout: 60000 });
    
    await safeScreenshot(`youtube_${timestamp}_6_success.png`);
    log('YouTube video published successfully!');
    return { success: true, message: 'YouTube视频发布成功！', logs, screenshots };

  } catch (error: any) {
    const errorMsg = `YouTube自动化出错: ${error.message}`;
    console.error(errorMsg);
    logs.push(`[ERROR] ${errorMsg}`);
    return { success: false, message: errorMsg, logs, screenshots };
  }
}
