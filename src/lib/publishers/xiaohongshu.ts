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
      'text="完成拼图"',
      'text="请完成验证"',
      'text="滑动验证"',
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
      'input[placeholder*="验证码"]',
      '.captcha-slider',
      '.slide-verify',
    ];

    for (const sel of classSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        log(`Found verification element: ${sel}`);
        return true;
      }
    }

    // Visibility-only iframe check (no content scanning to avoid false positives from JS bundles)
    for (const frame of page.frames()) {
      try {
        const visibleCaptcha = frame.locator('.secsdk-captcha-drag-icon, .captcha_verify_container, .verify-bar-close, input[placeholder*="验证码"]');
        if (await visibleCaptcha.first().isVisible({ timeout: 500 }).catch(() => false)) {
          log(`Found visible verification element inside iframe: ${frame.url().substring(0, 50)}...`);
          return true;
        }
      } catch (e) { /* iframe may be cross-origin */ }
    }

  } catch (e) {
    console.error("Error in checkForVerification:", e);
  }

  return false;
}

async function waitForInteractiveVerificationCode(taskId: string, log: (msg: string) => void, maxWaitMs = 120000): Promise<string | null> {
  log(`暂停自动化，等待用户输入验证码。最长等待 ${maxWaitMs / 1000} 秒...`);

  await updateTask(taskId, {
    status: 'requires_verification',
    requiresVerification: true,
    verificationPlatform: 'xiaohongshu',
    verificationCode: null,
  });

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const task = await getTask(taskId);
    if (task && task.verificationCode) {
      log(`从 UI 收到验证码: ${task.verificationCode}`);
      await updateTask(taskId, {
        status: 'processing',
        requiresVerification: false,
      });
      return task.verificationCode;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  log('等待用户验证码超时。');
  return null;
}

async function handleVerificationChallenge(taskId: string, page: Page, log: (msg: string) => void, screenshots: string[]): Promise<boolean> {
  log('触发交互式验证流程。');
  await safeScreenshot(page, `xhs_${Date.now()}_verif_modal.png`, screenshots, log);

  // Wait for the verification modal to fully render
  log('等待验证弹窗稳定...');
  await page.waitForTimeout(2500);

  // Try to trigger the SMS code with retries
  log('尝试点击"获取验证码"按钮...');
  let clickedSendCode = false;

  for (let attempt = 0; attempt < 3 && !clickedSendCode; attempt++) {
    if (attempt > 0) {
      log(`第 ${attempt + 1} 次重试查找发送验证码按钮...`);
      await page.waitForTimeout(2000);
    }

    try {
      // Strategy 1: getByText
      const byText = page.getByText('获取验证码', { exact: true });
      if (await byText.count() > 0) {
        await byText.first().click({ force: true, timeout: 5000 });
        log('通过 getByText 点击了"获取验证码"。');
        clickedSendCode = true;
        break;
      }

      // Strategy 2: CSS selectors
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
          log(`通过 ${sel} 点击了"获取验证码"。`);
          clickedSendCode = true;
          break;
        }
      }
      if (clickedSendCode) break;

      // Strategy 3: Search inside iframes
      for (const frame of page.frames()) {
        if (clickedSendCode) break;
        try {
          const frameLoc = frame.getByText('获取验证码', { exact: true });
          if (await frameLoc.count() > 0) {
            await frameLoc.first().click({ force: true, timeout: 5000 });
            log('在 iframe 中通过 getByText 点击了"获取验证码"。');
            clickedSendCode = true;
            break;
          }
          for (const sel of sendCodeSelectors) {
            const loc = frame.locator(sel).first();
            if (await loc.count() > 0) {
              await loc.click({ force: true, timeout: 5000 });
              log(`在 iframe 中通过 ${sel} 点击了"获取验证码"。`);
              clickedSendCode = true;
              break;
            }
          }
        } catch (e) { /* cross-origin iframe */ }
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`发送验证码第 ${attempt + 1} 次尝试出错: ${errMsg}`);
    }
  }

  if (clickedSendCode) {
    await page.waitForTimeout(3000);
    await safeScreenshot(page, `xhs_${Date.now()}_after_sms_triggered.png`, screenshots, log);
    log('短信触发按钮点击成功。');
  } else {
    log('警告: 3次尝试后未找到"获取验证码"按钮。短信可能已自动发送。');
    await safeScreenshot(page, `xhs_${Date.now()}_no_send_btn_found.png`, screenshots, log);
  }

  // Suspend and wait for user input
  const code = await waitForInteractiveVerificationCode(taskId, log);
  if (!code) return false;

  log('恢复 Playwright，注入验证码...');

  try {
    let injected = false;
    const inputSelectors = [
      'input[placeholder*="验证码"]',
      'input[placeholder*="verification"]',
      'input[type="tel"]',
      'input[type="text"]',
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allContexts: Array<{ ctx: Page | ReturnType<Page['frames']>[number]; label: string }> = [
      { ctx: page, label: 'main page' },
      ...page.frames().map((f, i) => ({ ctx: f, label: `frame[${i}] ${f.url().substring(0, 40)}` })),
    ];

    for (const { ctx, label } of allContexts) {
      if (injected) break;
      try {
        for (const sel of inputSelectors) {
          const loc = ctx.locator(sel);
          if (await loc.count() > 0) {
            await loc.first().fill(code);
            log(`在 ${label} 通过 '${sel}' 注入了验证码。`);
            injected = true;
            break;
          }
        }
      } catch (e) { /* skip */ }
    }

    if (!injected) {
      log('无法找到验证码输入框。');
      return false;
    }

    // Click the submit button
    await page.waitForTimeout(500);
    let clickedSubmit = false;

    for (const { ctx, label } of allContexts) {
      if (clickedSubmit) break;
      try {
        // Strategy A: getByText exact match
        const exactBtn = ctx.getByText('验证', { exact: true });
        if (await exactBtn.count() > 0) {
          await exactBtn.first().click({ force: true, timeout: 5000 });
          log(`在 ${label} 点击了精确匹配的"验证"提交按钮。`);
          clickedSubmit = true;
          break;
        }

        // Strategy B: getByRole
        const roleBtn = ctx.getByRole('button', { name: '验证', exact: true });
        if (await roleBtn.count() > 0) {
          await roleBtn.first().click({ force: true, timeout: 5000 });
          log(`在 ${label} 通过 getByRole 点击了"验证"按钮。`);
          clickedSubmit = true;
          break;
        }

        // Strategy C: CSS :text-is
        const exactCss = ctx.locator('button:text-is("验证"), div[role="button"]:text-is("验证")').first();
        if (await exactCss.count() > 0) {
          await exactCss.click({ force: true, timeout: 5000 });
          log(`在 ${label} 通过 :text-is 点击了"验证"按钮。`);
          clickedSubmit = true;
          break;
        }
      } catch (e) { /* skip */ }
    }

    if (!clickedSubmit) {
      log('警告: 未找到精确的"验证"提交按钮，尝试"确定"...');
      try {
        const fallback = page.getByText('确定', { exact: true });
        if (await fallback.count() > 0) {
          await fallback.first().click({ force: true });
          log('点击了备选"确定"按钮。');
          clickedSubmit = true;
        }
      } catch (e) { /* skip */ }
    }

    if (!clickedSubmit) {
      log('严重: 无法点击任何验证码提交按钮。');
      await safeScreenshot(page, `xhs_${Date.now()}_no_submit_btn.png`, screenshots, log);
      return false;
    }

    // Wait for verification modal to close
    log('等待验证弹窗关闭...');
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return !text.includes('接收短信验证码') && !text.includes('请输入验证码');
      }, { timeout: 15000 });
      log('验证弹窗已关闭。');
    } catch (e) {
      log('警告: 15秒后验证弹窗可能仍然打开。');
      await safeScreenshot(page, `xhs_${Date.now()}_modal_stuck.png`, screenshots, log);
    }

    await page.waitForTimeout(2000);
    return true;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log(`注入验证码失败: ${errMsg}`);
    return false;
  }
}

async function dismissPopups(page: Page, log: (msg: string) => void) {
  try {
    const dismissSelectors = [
      'button:has-text("我知道了")',
      'button:has-text("知道了")',
      'button:has-text("关闭")',
      'button:has-text("下次再说")',
      'button:has-text("暂不")',
      'button:has-text("我了解了")',
      'a:has-text("我了解了")',
      'span:has-text("我了解了")',
      'div[role="button"]:has-text("我知道了")',
      '.close-button',
      '.modal-close',
      '[class*="close-icon"]',
      '[class*="dialog"] [class*="close"]',
      // Xiaohongshu specific tutorial/guide overlays
      '[class*="guide"] button',
      '[class*="toast"] [class*="close"]',
    ];
    for (const sel of dismissSelectors) {
      const popup = page.locator(sel).first();
      if (await popup.count() > 0) {
        await popup.click({ force: true, timeout: 3000 }).catch(() => {});
        log(`关闭了弹窗: ${sel}`);
        await page.waitForTimeout(500);
      }
    }
  } catch (e) { /* ignore popup dismiss errors */ }
}


export async function uploadToXiaohongshu(
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
    console.log(`[小红书] ${msg}`);
    logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  };

  try {
    const timestamp = Date.now();
    log(`开始小红书上传: ${title}`);

    // Anti-detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Block unnecessary resources to speed up
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (type === 'font') {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Navigate to Xiaohongshu creator upload page
    log('正在导航到小红书创作者发布页面...');
    await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official', {
      waitUntil: 'commit',
      timeout: 60000,
    });

    await page.waitForSelector('body', { timeout: 30000 });
    await safeScreenshot(page, `xhs_${timestamp}_initial.png`, screenshots, log);

    // Dismiss any notification popups
    log('检查并关闭弹窗...');
    await dismissPopups(page, log);

    // Check login status
    const currentUrl = page.url();
    const loginIndicators = [
      '.login-container',
      '[class*="login"]',
      'text="扫码登录"',
      'text="手机号登录"',
      'text="密码登录"',
    ];

    let isLoginPage = currentUrl.includes('login') || currentUrl.includes('sign');
    if (!isLoginPage) {
      for (const sel of loginIndicators) {
        try {
          const count = await page.locator(sel).count();
          if (count > 0) {
            // Verify it's actually a login page, not just a small element
            const bodyText = await page.evaluate(() => document.body.innerText);
            if (bodyText.includes('扫码登录') || bodyText.includes('手机号登录')) {
              isLoginPage = true;
              break;
            }
          }
        } catch (e) { /* skip */ }
      }
    }

    if (isLoginPage) {
      await safeScreenshot(page, `xhs_${timestamp}_login_required.png`, screenshots, log);
      return {
        success: false,
        message: '登录态已失效，请前往"账号管理"重新扫码登录。',
        logs,
        screenshots,
      };
    }

    // Check for early verification challenge
    const isEarlyVerif = await checkForVerification(page, log);
    if (isEarlyVerif) {
      log('检测到页面初始化时的安全验证弹窗');
      const success = await handleVerificationChallenge(taskId, page, log, screenshots);
      if (!success) {
        return {
          success: false,
          message: '页面初始化时触发安全验证，且验证失败或超时。',
          logs,
          screenshots,
        };
      }
    }

    await page.waitForTimeout(3000);

    // Xiaohongshu may require selecting "视频" content type tab
    log('检查是否需要选择"视频"内容类型...');
    try {
      const videoTabSelectors = [
        'span:has-text("上传视频")',
        'div:has-text("上传视频")',
        'button:has-text("上传视频")',
        '[class*="tab"]:has-text("视频")',
        'span:text-is("视频")',
        'div[role="tab"]:has-text("视频")',
      ];
      for (const sel of videoTabSelectors) {
        const tab = page.locator(sel).first();
        if (await tab.count() > 0) {
          await tab.click({ force: true, timeout: 5000 });
          log(`点击了视频选项卡: ${sel}`);
          await page.waitForTimeout(1500);
          break;
        }
      }
    } catch (e) {
      log('未找到视频选项卡或已默认选中，继续...');
    }

    // Dismiss popups again after tab selection
    await dismissPopups(page, log);

    // Wait for file input and upload
    log('查找文件上传输入框...');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 30000 }).catch(() => log('等待文件输入框超时'));

    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);

    if (!fs.existsSync(filePath)) {
      log(`文件不存在: ${filePath}`);
      return {
        success: false,
        message: `上传文件不存在: ${filePath}`,
        logs,
        screenshots,
      };
    }

    log(`正在上传文件: ${filePath}...`);
    await fileInput.setInputFiles(filePath);

    await safeScreenshot(page, `xhs_${timestamp}_after_upload_start.png`, screenshots, log);

    // Wait for upload completion (two-phase: wait for start, then wait for finish)
    log('等待视频上传开始...');
    try {
      // Phase 1: Wait for upload to actually start (progress indicator appears)
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return (
          text.includes('上传中') ||
          text.includes('%') ||
          text.includes('处理中') ||
          text.includes('转码中') ||
          document.querySelector('video') !== null ||
          document.querySelector('[class*="video-preview"]') !== null ||
          document.querySelector('[class*="progress"]') !== null
        );
      }, { timeout: 60000 });
      log('检测到上传开始。');
    } catch (e) {
      log('未检测到上传进度指示器，继续等待完成...');
    }

    // Phase 2: Wait for upload to finish
    log('等待视频上传完成...');
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return (
          text.includes('上传成功') ||
          text.includes('更换视频') ||
          text.includes('替换视频') ||
          text.includes('100%') ||
          // Cover image selector appeared = upload done
          document.querySelector('[class*="cover"]') !== null ||
          document.querySelector('[class*="upload-success"]') !== null ||
          document.querySelector('video') !== null
        );
      }, { timeout: 600000 });
      log('视频上传完成。');
    } catch (e) {
      log('等待上传完成指示器超时，继续尝试...');
    }

    // Wait for any video processing
    log('等待视频处理完成...');
    try {
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return !text.includes('上传中') && !text.includes('处理中') && !text.includes('转码中');
      }, { timeout: 120000 });
      log('视频处理完成。');
    } catch (e) {
      log('视频处理120秒内未完成，继续尝试...');
    }

    // Dismiss popups that may have appeared during upload
    await dismissPopups(page, log);

    await page.waitForTimeout(2000);
    await safeScreenshot(page, `xhs_${timestamp}_upload_done.png`, screenshots, log);

    // Fill title
    log('填写标题...');
    const titleSelectors = [
      'input[placeholder*="标题"]',
      'input[placeholder*="填写标题"]',
      '#post-title',
      'input.c-input_inner',
      '[class*="title"] input',
      '[class*="title-input"]',
      'input[name="title"]',
      'input[maxlength="20"]',
    ];

    let titleFilled = false;
    for (const sel of titleSelectors) {
      try {
        const titleInput = page.locator(sel).first();
        if (await titleInput.count() > 0) {
          await titleInput.click({ force: true });
          await titleInput.fill('');
          await titleInput.fill(title);
          log(`通过 ${sel} 填写了标题。`);
          titleFilled = true;
          break;
        }
      } catch (e) { /* try next selector */ }
    }

    if (!titleFilled) {
      // Fallback: try contenteditable title areas
      log('标准输入框未找到，尝试 contenteditable 标题区域...');
      try {
        const editableTitle = page.locator('[class*="title"] [contenteditable="true"]').first();
        if (await editableTitle.count() > 0) {
          await editableTitle.click({ force: true });
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.insertText(title);
          log('通过 contenteditable 标题区域填写了标题。');
          titleFilled = true;
        }
      } catch (e) { /* skip */ }
    }

    if (!titleFilled) {
      log('警告: 未能找到标题输入框，标题可能未填写。');
    }

    await page.waitForTimeout(1000);

    // Fill description with tags appended
    log('填写描述和标签...');
    const tagString = tags.map(t => {
      // Xiaohongshu uses #tag format — add space before each tag
      const cleanTag = t.startsWith('#') ? t : `#${t}`;
      return cleanTag;
    }).join(' ');

    const fullDescription = `${description}\n${tagString}`;

    const descSelectors = [
      '.ql-editor',
      '[contenteditable="true"]',
      '#post-textarea',
      'textarea',
      '[class*="desc"] [contenteditable="true"]',
      '[class*="content"] [contenteditable="true"]',
      '[class*="editor"] [contenteditable="true"]',
      'div[data-placeholder]',
    ];

    let descFilled = false;
    for (const sel of descSelectors) {
      try {
        const descArea = page.locator(sel).first();
        if (await descArea.count() > 0) {
          // Skip if this is the title field we already filled
          const placeholder = await descArea.getAttribute('placeholder');
          if (placeholder && placeholder.includes('标题')) continue;

          // Check if it's a class that looks like title
          const className = await descArea.getAttribute('class');
          if (className && className.includes('title') && !className.includes('desc') && !className.includes('content')) continue;

          await descArea.click({ force: true });
          await page.waitForTimeout(300);

          // Clear existing content
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(200);

          // Type description with tags
          // For Xiaohongshu, typing tags with # triggers tag suggestions
          // We insert the description first, then add tags
          await page.keyboard.insertText(description);
          await page.waitForTimeout(500);

          // Add tags one by one — Xiaohongshu may show tag suggestions when typing #
          for (const tag of tags) {
            await page.keyboard.insertText(' ');
            const cleanTag = tag.startsWith('#') ? tag : `#${tag}`;
            await page.keyboard.insertText(cleanTag);
            await page.waitForTimeout(300);

            // Try to select the first tag suggestion if it appears
            try {
              const tagSuggestion = page.locator('[class*="tag-suggest"] li, [class*="mention-list"] li, [class*="hashtag"] li').first();
              if (await tagSuggestion.count() > 0) {
                await tagSuggestion.click({ force: true, timeout: 1000 });
                log(`选择了标签建议: ${cleanTag}`);
              }
            } catch (e) { /* no suggestion appeared, tag text is fine */ }
          }

          log(`通过 ${sel} 填写了描述和标签。`);
          descFilled = true;
          break;
        }
      } catch (e) { /* try next selector */ }
    }

    if (!descFilled) {
      log('警告: 未能找到描述输入区域，描述可能未填写。');
    }

    await page.waitForTimeout(1500);

    // Dismiss any popups before publishing
    await dismissPopups(page, log);

    // Click publish button
    log('准备发布...');
    const publishSelectors = [
      'button:has-text("发布")',
      'button:has-text("立即发布")',
      'button:text-is("发布")',
      '[class*="publish"] button',
      'button[class*="submit"]',
      'button[class*="publish"]',
    ];

    let publishButton = null;
    for (const sel of publishSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0) {
          publishButton = btn;
          log(`找到发布按钮: ${sel}`);
          break;
        }
      } catch (e) { /* try next */ }
    }

    if (!publishButton) {
      // Fallback: find by role
      try {
        const roleBtn = page.getByRole('button', { name: '发布' });
        if (await roleBtn.count() > 0) {
          publishButton = roleBtn.first();
          log('通过 getByRole 找到发布按钮。');
        }
      } catch (e) { /* skip */ }
    }

    if (!publishButton) {
      await safeScreenshot(page, `xhs_${timestamp}_no_publish_btn.png`, screenshots, log);
      return {
        success: false,
        message: '未找到发布按钮。请检查页面状态。',
        logs,
        screenshots,
      };
    }

    await publishButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => log('发布按钮不可见'));

    // Check if button is disabled
    const isDisabled = await publishButton.getAttribute('disabled');
    if (isDisabled !== null) {
      log('发布按钮当前为禁用状态，等待...');
      await page.waitForTimeout(5000);
    }

    // Also check for aria-disabled or class-based disabled
    try {
      const ariaDisabled = await publishButton.getAttribute('aria-disabled');
      const btnClass = await publishButton.getAttribute('class');
      if (ariaDisabled === 'true' || (btnClass && btnClass.includes('disabled'))) {
        log('发布按钮通过 aria/class 禁用，等待5秒...');
        await page.waitForTimeout(5000);
      }
    } catch (e) { /* skip */ }

    await publishButton.scrollIntoViewIfNeeded().catch(() => {});
    await safeScreenshot(page, `xhs_${timestamp}_before_publish.png`, screenshots, log);
    await publishButton.click({ force: true });

    log('已点击发布，等待成功确认或安全验证...');

    // Wait for success or verification
    let isSuccess = false;

    try {
      const result = await Promise.race([
        // Success indicator: text on page
        page.waitForFunction(() => {
          const text = document.body.innerText;
          return (
            text.includes('发布成功') ||
            text.includes('已发布') ||
            text.includes('发布完成') ||
            text.includes('笔记已发布') ||
            text.includes('作品已发布')
          );
        }, { timeout: 30000 }).then(() => 'success_text' as const),

        // Success indicator: URL change to success/manage page
        page.waitForURL(url => {
          const href = url.toString();
          return (
            href.includes('/publish/success') ||
            href.includes('/manage') ||
            href.includes('/creator/home') ||
            href.includes('published')
          );
        }, { timeout: 30000 }).then(() => 'success_url' as const),

        // Verification challenge
        new Promise<'verification_blocked'>((resolve) => {
          const interval = setInterval(async () => {
            const hasVerif = await checkForVerification(page, () => {});
            if (hasVerif) {
              clearInterval(interval);
              resolve('verification_blocked');
            }
          }, 1000);
          setTimeout(() => clearInterval(interval), 30000);
        }),
      ]);

      if (result === 'success_text' || result === 'success_url') {
        isSuccess = true;
        log('检测到发布成功标志！');
      } else if (result === 'verification_blocked') {
        log('发布后触发了安全验证弹窗。');

        const success = await handleVerificationChallenge(taskId, page, log, screenshots);
        if (success) {
          log('验证通过。等待弹窗关闭...');
          await page.waitForTimeout(3000);
          await safeScreenshot(page, `xhs_${timestamp}_after_verif.png`, screenshots, log);

          // Check if already on success page
          const bodyText = await page.evaluate(() => document.body.innerText);
          const postVerifUrl = page.url();
          if (
            postVerifUrl.includes('manage') ||
            postVerifUrl.includes('success') ||
            bodyText.includes('发布成功') ||
            bodyText.includes('已发布')
          ) {
            isSuccess = true;
            log('验证后发布成功！');
          } else {
            // May need to re-click publish after verification
            log('验证通过但尚未发布。尝试重新点击发布按钮...');
            try {
              let rePublishBtn = null;
              for (const sel of publishSelectors) {
                const btn = page.locator(sel).first();
                if (await btn.count() > 0) {
                  rePublishBtn = btn;
                  break;
                }
              }

              if (rePublishBtn) {
                const isStillDisabled = await rePublishBtn.getAttribute('disabled');
                if (isStillDisabled !== null) {
                  log('发布按钮仍为禁用状态，等待...');
                  await page.waitForTimeout(5000);
                }

                await rePublishBtn.scrollIntoViewIfNeeded().catch(() => {});
                await safeScreenshot(page, `xhs_${timestamp}_re_publish.png`, screenshots, log);
                await rePublishBtn.click({ force: true });
                log('重新点击了发布按钮。');

                // Wait for final success or another verification
                try {
                  const reResult = await Promise.race([
                    page.waitForFunction(() => {
                      const text = document.body.innerText;
                      return (
                        text.includes('发布成功') ||
                        text.includes('已发布') ||
                        text.includes('发布完成') ||
                        text.includes('笔记已发布')
                      );
                    }, { timeout: 30000 }).then(() => 'success_text' as const),

                    page.waitForURL(url => {
                      const href = url.toString();
                      return href.includes('/publish/success') || href.includes('/manage');
                    }, { timeout: 30000 }).then(() => 'success_url' as const),

                    new Promise<'verification_again'>((resolve) => {
                      const iv = setInterval(async () => {
                        const hasVerif = await checkForVerification(page, () => {});
                        if (hasVerif) {
                          clearInterval(iv);
                          resolve('verification_again');
                        }
                      }, 1000);
                      setTimeout(() => clearInterval(iv), 30000);
                    }),
                  ]);

                  if (reResult === 'success_text' || reResult === 'success_url') {
                    isSuccess = true;
                    log('重新发布后成功！');
                  } else if (reResult === 'verification_again') {
                    log('重新发布后再次触发验证。处理第二轮...');
                    const success2 = await handleVerificationChallenge(taskId, page, log, screenshots);
                    if (success2) {
                      log('第二轮验证通过。检查发布状态...');
                      await page.waitForTimeout(3000);

                      const bodyText2 = await page.evaluate(() => document.body.innerText);
                      const url2 = page.url();
                      if (
                        url2.includes('manage') ||
                        url2.includes('success') ||
                        bodyText2.includes('发布成功') ||
                        bodyText2.includes('已发布')
                      ) {
                        isSuccess = true;
                        log('第二轮验证后发布成功！');
                      } else {
                        // Final attempt
                        log('第二轮验证完成。尝试最后一次点击发布...');
                        try {
                          let finalBtn = null;
                          for (const sel of publishSelectors) {
                            const btn = page.locator(sel).first();
                            if (await btn.count() > 0) {
                              finalBtn = btn;
                              break;
                            }
                          }
                          if (finalBtn) {
                            await finalBtn.click({ force: true });
                            await page.waitForTimeout(10000);
                            const bodyText3 = await page.evaluate(() => document.body.innerText);
                            const url3 = page.url();
                            if (
                              url3.includes('manage') ||
                              url3.includes('success') ||
                              bodyText3.includes('发布成功') ||
                              bodyText3.includes('已发布')
                            ) {
                              isSuccess = true;
                              log('最终重试发布成功！');
                            }
                          }
                        } catch (e) { /* skip */ }

                        if (!isSuccess) {
                          await safeScreenshot(page, `xhs_${timestamp}_final_fail.png`, screenshots, log);
                          return {
                            success: false,
                            message: '两轮验证均通过，但发布仍未成功。请手动确认。',
                            logs,
                            screenshots,
                          };
                        }
                      }
                    } else {
                      return {
                        success: false,
                        message: '第二轮验证码等待超时或提交失败。',
                        logs,
                        screenshots,
                      };
                    }
                  }
                } catch (e2) {
                  // Timeout fallback — check URL
                  const fallbackUrl = page.url();
                  if (fallbackUrl.includes('manage') || fallbackUrl.includes('success')) {
                    isSuccess = true;
                    log('验证后重新发布成功（URL检查）。');
                  } else {
                    await safeScreenshot(page, `xhs_${timestamp}_re_publish_failed.png`, screenshots, log);
                    return {
                      success: false,
                      message: '验证通过后重新点击发布，但未检测到成功标志。请手动确认。',
                      logs,
                      screenshots,
                    };
                  }
                }
              } else {
                log('验证后未找到发布按钮。');
                await safeScreenshot(page, `xhs_${timestamp}_no_btn_after_verif.png`, screenshots, log);
                return {
                  success: false,
                  message: '验证通过但未找到发布按钮。请手动确认。',
                  logs,
                  screenshots,
                };
              }
            } catch (reClickErr: unknown) {
              const errMsg = reClickErr instanceof Error ? reClickErr.message : String(reClickErr);
              log(`重新发布出错: ${errMsg}`);
              const bodyTextFallback = await page.evaluate(() => document.body.innerText);
              const urlFallback = page.url();
              if (
                urlFallback.includes('manage') ||
                urlFallback.includes('success') ||
                bodyTextFallback.includes('发布成功')
              ) {
                isSuccess = true;
                log('尽管重新点击出错，但页面已跳转到成功页面。');
              } else {
                return {
                  success: false,
                  message: `验证通过但重新发布失败: ${errMsg}`,
                  logs,
                  screenshots,
                };
              }
            }
          }
        } else {
          return {
            success: false,
            message: '验证码等待超时或提交失败。发布终止。',
            logs,
            screenshots,
          };
        }
      }
    } catch (e) {
      log('等待发布结果超时。');
      const fallbackUrl = page.url();
      if (fallbackUrl.includes('manage') || fallbackUrl.includes('success')) {
        isSuccess = true;
      }
    }

    if (isSuccess) {
      await safeScreenshot(page, `xhs_${timestamp}_success.png`, screenshots, log);
      return {
        success: true,
        message: '小红书发布成功！(已确认页面跳转或成功提示)',
        logs,
        screenshots,
      };
    }

    await safeScreenshot(page, `xhs_${timestamp}_failed.png`, screenshots, log);
    return {
      success: false,
      message: '点击了发布，但未检测到成功标志且未收到验证码。',
      logs,
      screenshots,
    };

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errorMessage = `小红书自动化核心崩溃: ${errMsg}`;
    console.error(errorMessage);
    logs.push(`[ERROR] ${errorMessage}`);
    return {
      success: false,
      message: errorMessage,
      logs,
      screenshots,
    };
  }
}
