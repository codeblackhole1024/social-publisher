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

export async function uploadToYouTube(
  page: Page,
  file: File | string,
  title: string,
  description: string,
  tags: string[]
) {
  try {
    const timestamp = Date.now();
    console.log(`Starting YouTube upload for: ${title} at ${timestamp}`);
    
    await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded' });
    await safeScreenshot(page, `youtube_${timestamp}_1_initial.png`);
    
    if (page.url().includes('signin') || page.url().includes('AccountChooser')) {
      return { success: false, message: 'YouTube登录态已失效，请重新登录' };
    }

    await page.waitForTimeout(3000);

    // 1. Click Create -> Upload Videos
    console.log('Clicking Create and Upload Videos...');
    await page.locator('#create-icon').first().click();
    await page.waitForTimeout(1000);
    await safeScreenshot(page, `youtube_${timestamp}_2_create_menu.png`);
    
    await page.locator('#text-item-0').locator('text="Upload videos"').click().catch(async () => {
      // Fallback selector
      await page.locator('tp-yt-paper-item:has-text("Upload")').first().click();
    });

    // 2. Upload file
    const fileInput = await page.locator('input[type="file"]').first();
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    console.log('Uploading file:', filePath);
    await fileInput.setInputFiles(filePath);
    await safeScreenshot(page, `youtube_${timestamp}_3_file_selected.png`);
    
    // 3. Wait for the upload details dialog to fully appear
    console.log('Waiting for upload dialog...');
    const titleBox = page.locator('#textbox[aria-label*="Title"]').first();
    await titleBox.waitFor({ state: 'visible', timeout: 30000 });

    // 4. Fill Title
    console.log('Filling title...');
    await titleBox.click();
    await titleBox.clear();
    await page.keyboard.insertText(title.substring(0, 100)); // YT max 100

    // 5. Fill Description
    console.log('Filling description...');
    const descBox = page.locator('#textbox[aria-label*="Tell viewers"]').first();
    await descBox.click();
    await descBox.clear();
    await page.keyboard.insertText(`${description}\n\n${tags.map(t => `#${t}`).join(' ')}`.substring(0, 5000));
    await safeScreenshot(page, `youtube_${timestamp}_4_text_filled.png`);

    // 6. Select "No, it's not made for kids" (Required)
    console.log('Setting Audience rating...');
    const notForKids = page.locator('[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').first();
    await notForKids.scrollIntoViewIfNeeded();
    await notForKids.click();

    // 7. Click Next until Visibility tab
    console.log('Navigating through tabs...');
    const nextButton = page.locator('#next-button').first();
    
    // Details -> Video Elements
    await nextButton.click();
    await page.waitForTimeout(1000);
    // Video Elements -> Checks
    await nextButton.click();
    await page.waitForTimeout(1000);
    // Checks -> Visibility
    await nextButton.click();
    await page.waitForTimeout(1000);
    await safeScreenshot(page, `youtube_${timestamp}_5_visibility_tab.png`);

    // 8. Select Public
    console.log('Setting visibility to Public...');
    const publicRadio = page.locator('[name="PUBLIC"]').first();
    await publicRadio.click();

    // 9. Click Publish / Done
    console.log('Publishing...');
    const doneButton = page.locator('#done-button').first();
    await doneButton.click();

    // 10. Wait for success/uploading dialog
    console.log('Waiting for success dialog...');
    const closeButton = page.locator('#close-button').first();
    await closeButton.waitFor({ state: 'visible', timeout: 60000 });
    
    await safeScreenshot(page, `youtube_${timestamp}_6_success.png`);
    return { success: true, message: 'YouTube视频发布成功！' };

  } catch (error: any) {
    console.error('YouTube upload failed:', error);
    return { success: false, message: `YouTube自动化出错: ${error.message}` };
  }
}
