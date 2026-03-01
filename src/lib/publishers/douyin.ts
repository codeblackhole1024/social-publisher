import { type Page, type Frame } from 'playwright';
import path from 'path';
import fs from 'fs';
import { updateTask, getTask } from '../db';

const DEBUG_DIR = path.join(process.cwd(), 'public', 'debug');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

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

async function checkForVerification(page: Page, log: (msg: string) => void): Promise<Frame | Page | null> {
  const checkFrame = async (frame: Frame | Page) => {
    try {
      const text = await frame.evaluate(() => document.body.innerText || '');
      if (text.includes('获取短信验证码') || 
          text.includes('安全验证') || 
          text.includes('向您的手机号') || 
          text.includes('验证码已发送')) {
        return true;
      }
      const hasModal = await frame.evaluate(() => {
        return !!(
          document.querySelector('.secsdk-captcha-drag-icon') || 
          document.querySelector('#captcha_container') || 
          document.querySelector('.captcha_verify_container') ||
          document.querySelector('.verify-bar-close')
        );
      });
      if (hasModal) return true;
    } catch (e) {}
    return false;
  };

  if (await checkFrame(page)) return page;
  for (const frame of page.frames()) {
    if (await checkFrame(frame)) return frame;
  }
  return null;
}

async function waitForInteractiveVerificationCode(taskId: string, log: (msg: string) => void, maxWaitMs = 120000): Promise<string | null> {
  log(`Suspending automation and requesting UI verification code. Will wait for ${maxWaitMs / 1000} seconds...`);
  
  await updateTask(taskId, { 
    status: 'requires_verification',
    requiresVerification: true,
    verificationPlatform: 'douyin',
    verificationCode: null 
  });

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const task = await getTask(taskId);
    if (task && task.verificationCode) {
      log(`Received verification code from UI: ${task.verificationCode}`);
      await updateTask(taskId, { 
        status: 'processing',
        requiresVerification: false 
      });
      return task.verificationCode;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  log(`Timeout waiting for user verification code.`);
  return null;
}

// Reusable handler to solve the challenge whenever it appears
async function handleVerificationChallenge(taskId: string, page: Page, log: (msg: string) => void, screenshots: string[]): Promise<boolean> {
  log('Interactive verification flow triggered.');
  await safeScreenshot(page, `douyin_${Date.now()}_verif_modal.png`, screenshots, log);
  
  const code = await waitForInteractiveVerificationCode(taskId, log);
  if (!code) return false;

  log('Resuming Playwright with code...');
  
  // Refind the frame right before filling, just in case
  const verifFrame = await checkForVerification(page, log);
  if (verifFrame) {
    const inputLoc = verifFrame.locator('input[type="text"], input[type="tel"], input[placeholder*="验证码"]').first();
    await inputLoc.fill(code);
    await page.waitForTimeout(1000);
    
    // Multiple variations of Douyin's confirm buttons
    const confirmBtn = verifFrame.locator('button:has-text("确定"), button:has-text("验证"), div[role="button"]:has-text("确定")').first();
    await confirmBtn.click();
    
    log('Waiting 5s for verification modal to clear...');
    await page.waitForTimeout(5000);
    return true;
  }
  return false; // Could not find frame to inject
}


export async function uploadToDouyin(
  taskId: string,
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
    
    log('Navigating to Douyin creator portal...');
    await page.goto('https://creator.douyin.com/creator-micro/content/upload', { 
        waitUntil: 'commit', 
        timeout: 60000 
    });
    
    await page.waitForSelector('body', { timeout: 30000 });
    
    if (page.url().includes('login') || (await page.locator('.login-container').count()) > 0) {
      return { success: false, message: '登录态已失效，页面停留在登录界面。请前往“账号管理”重新扫码登录。', logs, screenshots };
    }

    // --- EARLY VERIFICATION CHECK ---
    const earlyVerifFrame = await checkForVerification(page, log);
    if (earlyVerifFrame) {
      log('Detected early verification modal');
      const success = await handleVerificationChallenge(taskId, page, log, screenshots);
      if (!success) {
        return { success: false, message: '页面初始化时触发安全验证，且验证失败或超时。', logs, screenshots };
      }
    }

    await page.waitForTimeout(4000); 

    log('Searching for file input...');
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 30000 }).catch(() => log('Timeout waiting for file input'));
    
    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    
    log(`Uploading file from ${filePath}...`);
    await fileInput.setInputFiles(filePath);
    
    log('Waiting for video upload to complete...');
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.includes('重新上传') || text.includes('上传成功') || text.includes('更换视频') || document.querySelector('.upload-success-icon');
      }, { timeout: 180000 });
      log('Video upload finished.');
    } catch (e) {
      log('Timeout waiting for upload text indicators.');
    }
    
    await page.waitForTimeout(3000); 

    log('Filling description and tags...');
    const editor = page.locator('.zone-container, .editor-kit-container, [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 15000 }).catch(() => log('Editor visibility timeout'));
    await editor.click({ force: true }).catch(() => {});
    
    const fullText = `${title}\n\n${description} ${tags.map(t => `#${t}`).join(' ')}`;
    await editor.fill('').catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.insertText(fullText);
    await page.waitForTimeout(1000);

    log('Publishing...');
    const publishButton = page.locator('button', { hasText: /^发布$/ }).first();
    await publishButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => log('Publish button not visible'));
    
    const isDisabled = await publishButton.getAttribute('disabled');
    if (isDisabled !== null) {
        log('Publish button is disabled, waiting...');
        await page.waitForTimeout(5000);
    }

    await publishButton.scrollIntoViewIfNeeded().catch(() => {});
    await safeScreenshot(page, `douyin_${timestamp}_before_publish.png`, screenshots, log);
    await publishButton.click({ force: true });
    
    log('Waiting for success confirmation or security challenge...');
    
    let isSuccess = false;
    
    try {
      const result = await Promise.race([
        page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes('发布成功') || text.includes('投稿成功') || text.includes('进入审核') || text.includes('去查看');
        }, { timeout: 30000 }).then(() => 'success_text'),
        
        page.waitForURL('**/manage/**', { timeout: 30000 }).then(() => 'success_url'),
        
        new Promise<string>((resolve) => {
          const interval = setInterval(async () => {
            const frame = await checkForVerification(page, () => {});
            if (frame) {
              clearInterval(interval);
              resolve('verification_blocked');
            }
          }, 1000);
          setTimeout(() => clearInterval(interval), 30000);
        })
      ]);

      if (result === 'success_text' || result === 'success_url') {
        isSuccess = true;
      } else if (result === 'verification_blocked') {
        log('Verification modal popped up immediately after clicking publish.');
        
        // --- POST-PUBLISH VERIFICATION CHECK ---
        const success = await handleVerificationChallenge(taskId, page, log, screenshots);
        if (success) {
           log('Waiting for publish success after submitting verification code...');
           await page.waitForTimeout(5000);
           
           if (page.url().includes('manage') || (await page.evaluate(() => document.body.innerText)).includes('发布成功')) {
              isSuccess = true;
              log('Successfully published after SMS verification!');
           } else {
              return { success: false, message: '验证码已提交，但发布依然失败，可能验证码错误或过期。', logs, screenshots };
           }
        } else {
          return { success: false, message: '验证码等待超时或提交失败。发布终止。', logs, screenshots };
        }
      }

    } catch (e) {
      log('Race timed out.');
      if (page.url().includes('manage')) isSuccess = true;
    }

    if (isSuccess) {
      await safeScreenshot(page, `douyin_${timestamp}_success.png`, screenshots, log);
      return { success: true, message: '抖音发布成功！(已确认页面跳转或成功提示)', logs, screenshots };
    }

    await safeScreenshot(page, `douyin_${timestamp}_failed.png`, screenshots, log);
    return { success: false, message: '点击了发布，但未检测到成功标志且未收到验证码。', logs, screenshots };

  } catch (error: any) {
    const errorMsg = `抖音自动化核心崩溃: ${error.message}`;
    console.error(errorMsg);
    logs.push(`[ERROR] ${errorMsg}`);
    return { success: false, message: errorMsg, logs, screenshots };
  }
}
