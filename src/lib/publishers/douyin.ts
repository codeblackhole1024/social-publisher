import { type Page } from 'playwright';
import path from 'path';

export async function uploadToDouyin(
  page: Page,
  file: File | string, // Accept a local file path
  title: string,
  description: string,
  tags: string[]
) {
  try {
    console.log(`Starting Douyin upload for: ${title}`);
    
    // 1. Navigate to the creator portal upload page directly
    await page.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'networkidle' });
    
    // Safety check: Make sure we are not on login page
    if (page.url().includes('login')) {
      return { success: false, message: '登录态已失效，请重新扫描二维码登录' };
    }

    await page.waitForTimeout(3000); // Allow DOM to settle

    // 2. Upload the file
    const fileInput = await page.locator('input[type="file"][accept*="video"], input[type="file"]').first();
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    console.log('Uploading file:', filePath);
    await fileInput.setInputFiles(filePath);
    
    // 3. Wait for upload to complete
    console.log('Waiting for video upload to complete...');
    
    // We give it a generous timeout for the video to process and upload.
    // The presence of the "重新上传" text indicates the upload & processing is done.
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.includes('重新上传') || text.includes('上传成功') || text.includes('更换视频');
      }, { timeout: 180000 }); // Give it up to 3 minutes for large files
    } catch (e) {
      console.log('Timeout waiting for specific text indicators. Checking if publish button is ready anyway.');
    }

    await page.waitForTimeout(3000); // Let UI catch up

    // 4. Fill in title & description
    console.log('Filling description and tags...');
    
    const editor = await page.locator('.zone-container, [contenteditable="true"]').first();
    // Sometimes the editor is not interactable immediately
    await editor.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await editor.click({ force: true });
    
    const fullText = `${title}\n\n${description} ${tags.map(t => `#${t}`).join(' ')}`;
    await editor.fill('');
    await page.keyboard.insertText(fullText); // keyboard.insertText is safer for contenteditable

    // 5. Click Publish
    console.log('Publishing...');
    // Douyin has varying classes for the publish button, often it has the text "发布"
    const publishButton = page.locator('button:has-text("发布"), .btn-publish').first();
    await publishButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500); // Small delay to let any hover/scroll animations finish
    
    // Force click to ensure it fires even if technically intercepted by a toast overlay
    await publishButton.click({ force: true });
    
    // 6. Wait for success indicator
    console.log('Waiting for success confirmation...');
    
    try {
      // It can redirect to /manage or show a toast message
      await Promise.race([
        page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes('发布成功') || text.includes('投稿成功') || text.includes('进入审核');
        }, { timeout: 20000 }),
        page.waitForURL('**/manage/**', { timeout: 20000 })
      ]);
      
      return { success: true, message: '抖音发布成功！(已跳转到作品管理或显示成功提示)' };
    } catch (e) {
      // Final manual check of the URL in case the navigation was quiet
      if (page.url().includes('manage')) {
        return { success: true, message: '抖音发布成功！(URL已变更)' };
      }
      return { success: false, message: '已点击发布按钮，但未检测到明确的成功标志（URL未跳/无成功字样），请前往抖音创作者中心确认。' };
    }

  } catch (error: any) {
    console.error('Douyin upload failed:', error);
    return { success: false, message: `抖音自动化过程出错: ${error.message}` };
  }
}
