import { type Page } from 'playwright';
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

async function checkForVerification(page: Page, log: (msg: string) => void): Promise<boolean> {
  try {
    const textSelectors = [
      'text="接收短信验证码"',
      'text="获取短信验证码"',
      'text="安全验证"',
      'text="向您的手机号"',
      'text="验证码已发送"',
      'text="拖动滑块"',
      'text="完成拼图"'
    ];

    for (const sel of textSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        log(`Found verification text: ${sel}`);
        return true;
      }
    }

    const classSelectors = [
      '.secsdk-captcha-drag-icon',
      '#captcha_container',
      '.captcha_verify_container',
      '.verify-bar-close',
      'input[placeholder*="验证码"]'
    ];

    for (const sel of classSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        log(`Found verification element: ${sel}`);
        return true;
      }
    }

    for (const frame of page.frames()) {
      try {
        const frameContent = await frame.content();
        if (
          frameContent.includes('接收短信验证码') ||
          frameContent.includes('获取短信验证码') ||
          frameContent.includes('安全验证') ||
          frameContent.includes('验证码已发送') ||
          frameContent.includes('secsdk-captcha') ||
          frameContent.includes('captcha_verify_container')
        ) {
          log(`Found verification signature inside an iframe URL: ${frame.url().substring(0, 50)}...`);
          return true;
        }
      } catch (e) {}
    }

  } catch (e) {
    console.error("Error in checkForVerification:", e);
  }
  
  return false;
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
  
  // Wait for the verification modal to fully render before interacting
  log('Waiting for verification modal to stabilize...');
  await page.waitForTimeout(2500);
  
  // Try to trigger the SMS code with retries
  log('Attempting to click "获取验证码" (Send Code) button with retries...');
  let clickedSendCode = false;
  
  for (let attempt = 0; attempt < 3 && !clickedSendCode; attempt++) {
    if (attempt > 0) {
      log(`Retry attempt ${attempt + 1} to find send code button...`);
      await page.waitForTimeout(2000);
    }
    
    try {
      // Strategy 1: getByText — most reliable, ignores CSS visibility
      const byText = page.getByText('获取验证码', { exact: true });
      if (await byText.count() > 0) {
        await byText.first().click({ force: true, timeout: 5000 });
        log('Clicked "获取验证码" via getByText on main page.');
        clickedSendCode = true;
        break;
      }
      
      // Strategy 2: CSS selectors on main page (skip isVisible — force click)
      const sendCodeSelectors = [
        'button:has-text("获取验证码")',
        'span:has-text("获取验证码")',
        'a:has-text("获取验证码")',
        'div[role="button"]:has-text("获取验证码")',
      ];
      
      for (const sel of sendCodeSelectors) {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0) {
          await loc.click({ force: true, timeout: 5000 });
          log(`Clicked "获取验证码" on main page via: ${sel}`);
          clickedSendCode = true;
          break;
        }
      }
      if (clickedSendCode) break;
      
      // Strategy 3: Search inside all iframes
      for (const frame of page.frames()) {
        if (clickedSendCode) break;
        try {
          const frameLoc = frame.getByText('获取验证码', { exact: true });
          if (await frameLoc.count() > 0) {
            await frameLoc.first().click({ force: true, timeout: 5000 });
            log('Clicked "获取验证码" inside iframe via getByText.');
            clickedSendCode = true;
            break;
          }
          for (const sel of sendCodeSelectors) {
            const loc = frame.locator(sel).first();
            if (await loc.count() > 0) {
              await loc.click({ force: true, timeout: 5000 });
              log(`Clicked "获取验证码" inside iframe via: ${sel}`);
              clickedSendCode = true;
              break;
            }
          }
        } catch (e) {}
      }
    } catch (e: any) {
      log(`Send code attempt ${attempt + 1} error: ${e.message}`);
    }
  }
  
  if (clickedSendCode) {
    await page.waitForTimeout(3000);
    await safeScreenshot(page, `douyin_${Date.now()}_after_sms_triggered.png`, screenshots, log);
    log('SMS trigger button clicked successfully.');
  } else {
    log('WARNING: Could not find "获取验证码" button after 3 attempts. SMS may have been sent automatically.');
    await safeScreenshot(page, `douyin_${Date.now()}_no_send_btn_found.png`, screenshots, log);
  }

  // ---> Suspend and wait for user input <---
  const code = await waitForInteractiveVerificationCode(taskId, log);
  if (!code) return false;

  log('Resuming Playwright with code...');
  
  try {
    let injected = false;
    // Most-specific selectors first
    const inputSelectors = [
      'input[placeholder*="验证码"]',
      'input[placeholder*="verification"]',
      'input[type="tel"]',
      'input[type="text"]',
    ];

    // CRITICAL: Use getByText with exact match to avoid hitting '获取验证码'
    // The old selector button:has-text("验证") is a SUBSTRING match
    // that matches '获取验证码' BEFORE the actual '验证' submit button.

    // --- Step 1: Fill the code into the input field ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allContexts: Array<{ ctx: any; label: string }> = [
      { ctx: page, label: 'main page' },
      ...page.frames().map((f, i) => ({ ctx: f, label: `frame[${i}] ${f.url().substring(0, 40)}` }))
    ];

    for (const { ctx, label } of allContexts) {
      if (injected) break;
      try {
        for (const sel of inputSelectors) {
          const loc = ctx.locator(sel);
          if (await loc.count() > 0) {
            await loc.first().fill(code);
            log(`Injected code into input via '${sel}' on ${label}.`);
            injected = true;
            break;
          }
        }
      } catch (e) {}
    }

    if (!injected) {
      log('Could not find the input field to inject the code.');
      return false;
    }

    // --- Step 2: Click the EXACT '验证' submit button (NOT '获取验证码') ---
    await page.waitForTimeout(500);
    let clickedSubmit = false;

    for (const { ctx, label } of allContexts) {
      if (clickedSubmit) break;
      try {
        // Strategy A: getByText exact match — '验证' only, not '获取验证码'
        const exactBtn = ctx.getByText('验证', { exact: true });
        if (await exactBtn.count() > 0) {
          await exactBtn.first().click({ force: true, timeout: 5000 });
          log(`Clicked exact '验证' submit button on ${label}.`);
          clickedSubmit = true;
          break;
        }

        // Strategy B: getByRole button with exact name
        const roleBtn = ctx.getByRole('button', { name: '验证', exact: true });
        if (await roleBtn.count() > 0) {
          await roleBtn.first().click({ force: true, timeout: 5000 });
          log(`Clicked '验证' button via getByRole on ${label}.`);
          clickedSubmit = true;
          break;
        }

        // Strategy C: Fallback — use CSS :text-is for exact text (Playwright pseudo-selector)
        const exactCss = ctx.locator('button:text-is("验证"), div[role="button"]:text-is("验证")').first();
        if (await exactCss.count() > 0) {
          await exactCss.click({ force: true, timeout: 5000 });
          log(`Clicked '验证' via :text-is on ${label}.`);
          clickedSubmit = true;
          break;
        }
      } catch (e) {}
    }

    if (!clickedSubmit) {
      log('WARNING: Could not find exact 验证 submit button. Trying fallback "确定"...');
      try {
        const fallback = page.getByText('确定', { exact: true });
        if (await fallback.count() > 0) {
          await fallback.first().click({ force: true });
          log('Clicked fallback 确定 button.');
          clickedSubmit = true;
        }
      } catch (e) {}
    }

    if (!clickedSubmit) {
      log('CRITICAL: Could not click any submit button for verification code.');
      await safeScreenshot(page, `douyin_${Date.now()}_no_submit_btn.png`, screenshots, log);
      return false;
    }

    // --- Step 3: Wait for verification modal to actually close ---
    log('Waiting for verification modal to close...');
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return !text.includes('接收短信验证码') && !text.includes('请输入验证码');
      }, { timeout: 15000 });
      log('Verification modal closed successfully.');
    } catch (e) {
      log('WARNING: Verification modal may still be open after 15s.');
      await safeScreenshot(page, `douyin_${Date.now()}_modal_stuck.png`, screenshots, log);
    }

    await page.waitForTimeout(2000);
    return true;
  } catch (e: any) {
    log(`Failed to inject verification code: ${e.message}`);
    return false;
  }
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
      if (['image', 'media', 'font'].includes(type) && !route.request().url().includes('upload')) {
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

    // Dismiss any notification popups (共创中心, etc.) that block interaction
    log('Checking for notification popups to dismiss...');
    try {
      const dismissSelectors = [
        'button:has-text("我知道了")',
        'button:has-text("知道了")',
        'button:has-text("关闭")',
        'div[role="button"]:has-text("我知道了")',
        '.semi-modal-close',
      ];
      for (const sel of dismissSelectors) {
        const popup = page.locator(sel).first();
        if (await popup.count() > 0) {
          await popup.click({ force: true, timeout: 3000 }).catch(() => {});
          log(`Dismissed popup via: ${sel}`);
          await page.waitForTimeout(500);
        }
      }
    } catch (e) {}
    
    if (page.url().includes('login') || (await page.locator('.login-container').count()) > 0) {
      return { success: false, message: '登录态已失效，页面停留在登录界面。请前往“账号管理”重新扫码登录。', logs, screenshots };
    }

    const isEarlyVerif = await checkForVerification(page, log);
    if (isEarlyVerif) {
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

    // Wait for video detection/processing to complete (检测中 → done)
    log('Waiting for video detection to finish...');
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return !text.includes('检测中') || text.includes('检测完成') || text.includes('100%');
      }, { timeout: 120000 });
      log('Video detection completed.');
    } catch (e) {
      log('Detection did not finish in 120s, proceeding anyway.');
    }
    // Dismiss popups that appeared during upload
    try {
      const uploadPopup = page.locator('button:has-text("我知道了")').first();
      if (await uploadPopup.count() > 0) {
        await uploadPopup.click({ force: true, timeout: 3000 }).catch(() => {});
        log('Dismissed popup during upload wait.');
      }
    } catch (e) {}
    
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

    // Dismiss any popups before clicking publish
    try {
      const prePublishPopup = page.locator('button:has-text("我知道了"), button:has-text("知道了"), .semi-modal-close').first();
      if (await prePublishPopup.count() > 0) {
        await prePublishPopup.click({ force: true, timeout: 3000 }).catch(() => {});
        log('Dismissed popup before publish.');
        await page.waitForTimeout(500);
      }
    } catch (e) {}

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
            const hasVerif = await checkForVerification(page, () => {});
            if (hasVerif) {
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
        
        const success = await handleVerificationChallenge(taskId, page, log, screenshots);
        if (success) {
           log('Verification passed. Waiting for modal to close...');
           await page.waitForTimeout(3000);
           await safeScreenshot(page, `douyin_${timestamp}_after_verif.png`, screenshots, log);
           
           // Check if we already landed on success page
           if (page.url().includes('manage') || (await page.evaluate(() => document.body.innerText)).includes('发布成功')) {
              isSuccess = true;
              log('Successfully published after SMS verification (auto-submitted)!');
           } else {
              // Douyin often returns to the upload form after verification — need to re-click publish
              log('Verification passed but not yet published. Re-clicking publish button...');
              try {
                const rePublishBtn = page.locator('button', { hasText: /^发布$/ }).first();
                await rePublishBtn.waitFor({ state: 'visible', timeout: 10000 });
                
                const isStillDisabled = await rePublishBtn.getAttribute('disabled');
                if (isStillDisabled !== null) {
                  log('Publish button still disabled after verification, waiting...');
                  await page.waitForTimeout(5000);
                }
                
                await rePublishBtn.scrollIntoViewIfNeeded().catch(() => {});
                await safeScreenshot(page, `douyin_${timestamp}_re_publish.png`, screenshots, log);
                await rePublishBtn.click({ force: true });
                log('Re-clicked publish button after verification.');
                
                // Wait for final success OR another verification challenge
                try {
                  const reResult = await Promise.race([
                    page.waitForFunction(() => {
                      const text = document.body.innerText;
                      return text.includes('发布成功') || text.includes('投稿成功') || text.includes('进入审核') || text.includes('去查看');
                    }, { timeout: 30000 }).then(() => 'success_text' as const),
                    
                    page.waitForURL('**/manage/**', { timeout: 30000 }).then(() => 'success_url' as const),
                    
                    // Also check for ANOTHER verification modal
                    new Promise<'verification_again'>((resolve) => {
                      const iv = setInterval(async () => {
                        const hasVerif = await checkForVerification(page, () => {});
                        if (hasVerif) {
                          clearInterval(iv);
                          resolve('verification_again');
                        }
                      }, 1000);
                      setTimeout(() => clearInterval(iv), 30000);
                    })
                  ]);
                  
                  if (reResult === 'success_text' || reResult === 'success_url') {
                    isSuccess = true;
                    log('Successfully published after re-clicking publish!');
                  } else if (reResult === 'verification_again') {
                    log('Another verification challenge after re-publish. Handling round 2...');
                    const success2 = await handleVerificationChallenge(taskId, page, log, screenshots);
                    if (success2) {
                      log('Round 2 verification passed. Checking for success...');
                      await page.waitForTimeout(3000);
                      
                      // After second verification, check if published or need to click publish again
                      if (page.url().includes('manage') || (await page.evaluate(() => document.body.innerText)).includes('发布成功')) {
                        isSuccess = true;
                        log('Published successfully after round 2 verification!');
                      } else {
                        // Try one final re-publish
                        log('Round 2 done. Attempting final publish click...');
                        try {
                          const finalBtn = page.locator('button', { hasText: /^发布$/ }).first();
                          if (await finalBtn.count() > 0) {
                            await finalBtn.click({ force: true });
                            await page.waitForTimeout(10000);
                            if (page.url().includes('manage') || (await page.evaluate(() => document.body.innerText)).includes('发布成功')) {
                              isSuccess = true;
                              log('Published successfully after final re-click!');
                            }
                          }
                        } catch (e) {}
                        
                        if (!isSuccess) {
                          await safeScreenshot(page, `douyin_${timestamp}_final_fail.png`, screenshots, log);
                          return { success: false, message: '两轮验证均通过，但发布仍未成功。请手动确认。', logs, screenshots };
                        }
                      }
                    } else {
                      return { success: false, message: '第二轮验证码等待超时或提交失败。', logs, screenshots };
                    }
                  }
                } catch (e2) {
                  // Timeout fallback — check URL
                  if (page.url().includes('manage')) {
                    isSuccess = true;
                    log('Post-verification publish succeeded (URL check).');
                  } else {
                    await safeScreenshot(page, `douyin_${timestamp}_re_publish_failed.png`, screenshots, log);
                    return { success: false, message: '验证通过后重新点击发布，但未检测到成功标志。请手动确认。', logs, screenshots };
                  }
                }
              } catch (reClickErr: any) {
                log(`Re-publish error: ${reClickErr.message}`);
                if (page.url().includes('manage') || (await page.evaluate(() => document.body.innerText)).includes('发布成功')) {
                  isSuccess = true;
                  log('Publish succeeded despite re-click error (page already navigated).');
                } else {
                  return { success: false, message: `验证通过但重新发布失败: ${reClickErr.message}`, logs, screenshots };
                }
              }
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
