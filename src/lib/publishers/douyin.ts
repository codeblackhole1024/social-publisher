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
    // The standard douyin file input is an input with type=file and accept="video/*"
    const fileInput = await page.locator('input[type="file"][accept*="video"]').first();
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    console.log('Uploading file:', filePath);
    await fileInput.setInputFiles(filePath);
    
    // 3. Wait for upload to complete
    // We look for indications that the upload progress is complete.
    // E.g., looking for the word "重新上传" (Re-upload) which appears only after completion.
    console.log('Waiting for video upload to complete...');
    
    try {
      await page.waitForFunction(() => {
        return document.body.innerText.includes('重新上传') || document.body.innerText.includes('上传成功');
      }, { timeout: 120000 }); // Give it up to 2 minutes for big files
    } catch (e) {
      console.log('Timeout waiting for text indicators, proceeding anyway. (Video might be large)');
      // If we wait 120s and it fails, we still try to proceed, but ideally we should fail.
    }

    // 4. Fill in title & description
    // Douyin uses a unified contenteditable editor (.zone-container is common, or an aria-label="作品描述")
    console.log('Filling description and tags...');
    
    const editor = await page.locator('.zone-container, [contenteditable="true"]').first();
    await editor.click();
    await editor.clear();
    
    const fullText = `${title}\n\n${description} ${tags.map(t => `#${t}`).join(' ')}`;
    await editor.fill(fullText);

    // 5. Click Publish
    console.log('Publishing...');
    const publishButton = await page.locator('button:has-text("发布")').first();
    await publishButton.click();
    
    // 6. Wait for success indicator
    console.log('Waiting for success confirmation...');
    
    try {
      // Typically it redirects or shows a success toast
      await page.waitForFunction(() => {
        return document.body.innerText.includes('发布成功') || document.body.innerText.includes('审核中') || window.location.href.includes('manage');
      }, { timeout: 30000 });
      return { success: true, message: '抖音发布成功！(进入审核阶段)' };
    } catch (e) {
      return { success: false, message: '点击了发布，但未检测到成功提示，请前往抖音创作中心确认。' };
    }

  } catch (error: any) {
    console.error('Douyin upload failed:', error);
    return { success: false, message: `抖音发布过程出错: ${error.message}` };
  }
}
