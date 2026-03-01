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
    // Only check VISIBLE text on the main page — avoid scanning iframe JS bundles
    // which contain "geetest"/"captcha" strings in Bilibili's own code (false positive)
    const textSelectors = [
      'text="接收短信验证码"',
      'text="获取短信验证码"',
      'text="向您的手机号"',
      'text="验证码已发送"',
      'text="拖动滑块"',
      'text="完成拼图"',
      'text="请完成安全验证"',
      'text="点击按钮进行验证"',
    ];

    for (const sel of textSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
        log(`Found visible verification text: ${sel}`);
        return true;
      }
    }

    // Only match VISIBLE captcha elements (not hidden JS references)
    const classSelectors = [
      '.geetest_panel',
      '.geetest_widget',
      '#gc-box',
      '.captcha-img',
      '.bili-captcha',
      'input[placeholder*="验证码"]',
    ];

    for (const sel of classSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
        log(`Found visible verification element: ${sel}`);
        return true;
      }
    }

    // DO NOT scan iframe content() — Bilibili's JS bundles contain "geetest"/"captcha"
    // strings which cause false positives. Only visible DOM elements matter.
  } catch (e) {
    console.error('Error in checkForVerification:', e);
  }

  return false;
}

async function waitForInteractiveVerificationCode(taskId: string, log: (msg: string) => void, maxWaitMs = 120000): Promise<string | null> {
  log(`暂停自动化，等待用户输入验证码。最长等待 ${maxWaitMs / 1000} 秒...`);

  await updateTask(taskId, {
    status: 'requires_verification',
    requiresVerification: true,
    verificationPlatform: 'bilibili',
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
  await safeScreenshot(page, `bilibili_${Date.now()}_verif_modal.png`, screenshots, log);

  log('等待验证弹窗稳定...');
  await page.waitForTimeout(2500);

  // Try to trigger the SMS code
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
        } catch (e) {}
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`发送验证码第 ${attempt + 1} 次尝试出错: ${errMsg}`);
    }
  }

  if (clickedSendCode) {
    await page.waitForTimeout(3000);
    await safeScreenshot(page, `bilibili_${Date.now()}_after_sms_triggered.png`, screenshots, log);
    log('验证码发送按钮已点击。');
  } else {
    log('警告: 3次尝试后未找到"获取验证码"按钮。短信可能已自动发送。');
    await safeScreenshot(page, `bilibili_${Date.now()}_no_send_btn_found.png`, screenshots, log);
  }

  // Suspend and wait for user input
  const code = await waitForInteractiveVerificationCode(taskId, log);
  if (!code) return false;

  log('恢复自动化，填入验证码...');

  try {
    let injected = false;
    const inputSelectors = [
      'input[placeholder*="验证码"]',
      'input[placeholder*="verification"]',
      'input[type="tel"]',
      'input[type="text"]',
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allContexts: Array<{ ctx: any; label: string }> = [
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
            log(`在 ${label} 通过 '${sel}' 填入了验证码。`);
            injected = true;
            break;
          }
        }
      } catch (e) {}
    }

    if (!injected) {
      log('未找到验证码输入框。');
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
          log(`在 ${label} 点击了精确匹配的"验证"按钮。`);
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
      } catch (e) {}
    }

    if (!clickedSubmit) {
      log('警告: 未找到精确的"验证"提交按钮。尝试备选"确定"...');
      try {
        const fallback = page.getByText('确定', { exact: true });
        if (await fallback.count() > 0) {
          await fallback.first().click({ force: true });
          log('点击了备选"确定"按钮。');
          clickedSubmit = true;
        }
      } catch (e) {}
    }

    if (!clickedSubmit) {
      log('严重: 无法点击任何验证码提交按钮。');
      await safeScreenshot(page, `bilibili_${Date.now()}_no_submit_btn.png`, screenshots, log);
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
      log('警告: 15秒后验证弹窗可能仍未关闭。');
      await safeScreenshot(page, `bilibili_${Date.now()}_modal_stuck.png`, screenshots, log);
    }

    await page.waitForTimeout(2000);
    return true;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log(`填入验证码失败: ${errMsg}`);
    return false;
  }
}

export async function uploadToBilibili(
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
    console.log(`[Bilibili] ${msg}`);
    logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  };

  try {
    const timestamp = Date.now();
    log(`开始B站上传: ${title}`);

    // Anti-detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Only block fonts to speed up — do NOT block 'image' or 'media'
    // because Bilibili's upload uses these resource types internally
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (type === 'font') {
        route.abort();
      } else {
        route.continue();
      }
    });

    log('正在导航到B站创作中心...');
    await page.goto('https://member.bilibili.com/platform/upload/video/frame', {
      waitUntil: 'commit',
      timeout: 60000,
    });

    await page.waitForSelector('body', { timeout: 30000 });
    await safeScreenshot(page, `bilibili_${timestamp}_initial.png`, screenshots, log);

    // Dismiss common Bilibili popups
    log('检查并关闭弹窗...');
    try {
      const dismissSelectors = [
        'button:has-text("我知道了")',
        'button:has-text("知道了")',
        'button:has-text("关闭")',
        'div[role="button"]:has-text("我知道了")',
        '.close-btn',
        '.bili-dialog-close',
        '.modal-close',
      ];
      for (const sel of dismissSelectors) {
        const popup = page.locator(sel).first();
        if (await popup.count() > 0) {
          await popup.click({ force: true, timeout: 3000 }).catch(() => {});
          log(`关闭了弹窗: ${sel}`);
          await page.waitForTimeout(500);
        }
      }
    } catch (e) {}

    // Check login status
    const currentUrl = page.url();
    const hasLoginIndicator = currentUrl.includes('login') ||
      currentUrl.includes('passport.bilibili.com') ||
      (await page.locator('.login-tip, .login-container, .login-panel').count()) > 0;

    if (hasLoginIndicator) {
      await safeScreenshot(page, `bilibili_${timestamp}_login_required.png`, screenshots, log);
      return {
        success: false,
        message: '登录态已失效，请前往"账号管理"重新扫码登录。',
        logs,
        screenshots,
      };
    }

    // Check for early verification
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

    // --- Step 1: Upload file ---
    log('查找文件上传输入框...');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 30000 }).catch(() => log('等待文件输入框超时'));

    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);

    log(`上传文件: ${filePath}...`);
    await fileInput.setInputFiles(filePath);

    // Wait for upload to complete — must wait for actual progress to reach 100%
    // DO NOT match '重新上传' — that text exists on page BEFORE upload starts
    log('等待视频上传完成...');
    try {
      // First, wait for upload to actually start (progress > 0%)
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.includes('上传中') || text.includes('%');
      }, { timeout: 30000 }).catch(() => {});
      log('视频上传已开始...');

      // Now wait for upload to finish (100% or completion text)
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        // Check for explicit completion indicators
        if (text.includes('上传完成') || text.includes('Upload Complete')) return true;
        // Check for 100% in progress elements
        const progressEls = document.querySelectorAll('.progress-text, .upload-progress, .file-item-progress, [class*="progress"]');
        for (const el of progressEls) {
          if (el.textContent && el.textContent.trim() === '100%') return true;
        }
        // Check if progress bar width is 100%
        const bars = document.querySelectorAll('[class*="progress-bar"], [class*="upload-bar"]');
        for (const bar of bars) {
          const style = (bar as HTMLElement).style.width;
          if (style === '100%') return true;
        }
        // Fallback: if no progress indicators exist but cover image setting appeared, upload is done
        if (document.querySelector('.cover-select-box, .cover-preview, .cover-setting')) return true;
        return false;
      }, { timeout: 600000 }); // 10 minutes for large files
      log('视频上传完成。');
    } catch (e) {
      log('等待上传完成指示器超时（10分钟），继续执行...');
    }
    // Extra wait for Bilibili to process the uploaded video
    await page.waitForTimeout(3000);

    await safeScreenshot(page, `bilibili_${timestamp}_after_upload.png`, screenshots, log);

    // Dismiss popups that appeared during upload
    try {
      const uploadPopup = page.locator('button:has-text("我知道了")').first();
      if (await uploadPopup.count() > 0) {
        await uploadPopup.click({ force: true, timeout: 3000 }).catch(() => {});
        log('关闭了上传期间出现的弹窗。');
      }
    } catch (e) {}

    await page.waitForTimeout(2000);

    // --- Step 2: Fill title ---
    log('填写标题...');
    // Bilibili title input: try multiple selectors
    const titleSelectors = [
      'input[maxlength="80"]',
      'input.input-val',
      '.video-title input',
      '.title-input input',
      'input[placeholder*="标题"]',
      'input[placeholder*="请输入标题"]',
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
      } catch (e) {}
    }

    // Fallback: try contenteditable title area
    if (!titleFilled) {
      try {
        const editableTitle = page.locator('.title-container [contenteditable="true"], .video-title [contenteditable="true"]').first();
        if (await editableTitle.count() > 0) {
          await editableTitle.click({ force: true });
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.insertText(title);
          log('通过 contenteditable 填写了标题。');
          titleFilled = true;
        }
      } catch (e) {}
    }

    if (!titleFilled) {
      log('警告: 未找到标题输入框，尝试使用默认标题区域...');
      // Bilibili may auto-fill title from filename; try to clear and re-type
      try {
        const anyTitleInput = page.locator('input').first();
        if (await anyTitleInput.count() > 0) {
          const placeholder = await anyTitleInput.getAttribute('placeholder');
          if (placeholder && (placeholder.includes('标题') || placeholder.includes('title'))) {
            await anyTitleInput.fill(title);
            log('通过通用 input 填写了标题。');
            titleFilled = true;
          }
        }
      } catch (e) {}
    }

    await page.waitForTimeout(1000);

    // --- Step 3: Fill description ---
    log('填写简介...');
    const descSelectors = [
      '.ql-editor',
      'textarea[placeholder*="简介"]',
      'textarea[placeholder*="描述"]',
      '.desc-container [contenteditable="true"]',
      '.video-desc [contenteditable="true"]',
      '[contenteditable="true"].ql-editor',
      'textarea',
    ];

    let descFilled = false;
    for (const sel of descSelectors) {
      try {
        const descInput = page.locator(sel).first();
        if (await descInput.count() > 0) {
          // Check if this is the title field we already filled (skip it)
          const isTitle = await descInput.evaluate((el: Element) => {
            const parent = el.closest('.title-container, .video-title');
            return parent !== null;
          }).catch(() => false);
          if (isTitle) continue;

          await descInput.click({ force: true });
          // For contenteditable / ql-editor
          if (sel.includes('contenteditable') || sel.includes('ql-editor')) {
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            await page.keyboard.insertText(description);
          } else {
            await descInput.fill('');
            await descInput.fill(description);
          }
          log(`通过 ${sel} 填写了简介。`);
          descFilled = true;
          break;
        }
      } catch (e) {}
    }

    if (!descFilled) {
      log('警告: 未找到简介输入框，跳过简介填写。');
    }

    await page.waitForTimeout(1000);

    // --- Step 4: Add tags ---
    log('添加标签...');
    if (tags.length > 0) {
      const tagInputSelectors = [
        '.tag-container input',
        '.tag-input-wrp input',
        'input[placeholder*="标签"]',
        'input[placeholder*="tag"]',
        'input[placeholder*="按回车"]',
        '.label-item-wrp input',
        '.tag-wrp input',
      ];

      let tagInput = null;
      for (const sel of tagInputSelectors) {
        try {
          const loc = page.locator(sel).first();
          if (await loc.count() > 0) {
            tagInput = loc;
            log(`找到标签输入框: ${sel}`);
            break;
          }
        } catch (e) {}
      }

      if (tagInput) {
        for (const tag of tags) {
          try {
            await tagInput.click({ force: true });
            await tagInput.fill(tag);
            await page.keyboard.press('Enter');
            log(`添加了标签: ${tag}`);
            await page.waitForTimeout(500);
          } catch (e) {
            log(`添加标签 "${tag}" 失败，继续下一个。`);
          }
        }
      } else {
        log('警告: 未找到标签输入框，跳过标签添加。');
        // Try clicking a "添加标签" button first
        try {
          const addTagBtn = page.locator('button:has-text("添加标签"), span:has-text("添加标签"), div:has-text("添加标签")').first();
          if (await addTagBtn.count() > 0) {
            await addTagBtn.click({ force: true });
            log('点击了"添加标签"按钮。');
            await page.waitForTimeout(1000);
            // Re-try finding the input
            for (const sel of tagInputSelectors) {
              try {
                const loc = page.locator(sel).first();
                if (await loc.count() > 0) {
                  for (const tag of tags) {
                    await loc.click({ force: true });
                    await loc.fill(tag);
                    await page.keyboard.press('Enter');
                    log(`添加了标签: ${tag}`);
                    await page.waitForTimeout(500);
                  }
                  break;
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }

    await page.waitForTimeout(1000);

    // --- Step 4b: Select 分区 (category) — REQUIRED by Bilibili ---
    log('选择投稿分区...');
    try {
      // Click the 分区 dropdown/selector
      const categorySelectors = [
        '.drop-cascader .input-wrp',       // cascader input wrapper
        '.type-wrp .drop-cascader',         // type wrapper
        'div:has-text("请选择分区") >> nth=0',
        '.select-type-wrp',
        '.category-wrp .input-val',
        'span:has-text("请选择分区")',
      ];

      let clickedCategory = false;
      for (const sel of categorySelectors) {
        try {
          const loc = page.locator(sel).first();
          if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
            await loc.click({ force: true, timeout: 5000 });
            log(`点击了分区选择器: ${sel}`);
            clickedCategory = true;
            break;
          }
        } catch {}
      }

      if (clickedCategory) {
        await page.waitForTimeout(1000);
        // Select a general/common category — try 生活 (Life) or 知识 (Knowledge) or first available
        const categoryOptions = [
          'li:has-text("生活")',
          'li:has-text("知识")',
          'li:has-text("科技")',
          'li:has-text("日常")',
          'span:has-text("生活")',
          'span:has-text("知识")',
          '.list-item:first-child',
          '.drop-cascader-list li:first-child',
        ];

        let selectedMainCategory = false;
        for (const sel of categoryOptions) {
          try {
            const loc = page.locator(sel).first();
            if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
              await loc.click({ force: true, timeout: 3000 });
              log(`选择了主分区: ${sel}`);
              selectedMainCategory = true;
              break;
            }
          } catch {}
        }

        if (selectedMainCategory) {
          await page.waitForTimeout(800);
          // Bilibili uses cascading menus — need to select sub-category
          const subCategoryOptions = [
            'li:has-text("日常")',
            'li:has-text("其他")',
            'li:has-text("综合")',
            '.list-item:first-child',
            '.drop-cascader-list:last-child li:first-child',
          ];

          for (const sel of subCategoryOptions) {
            try {
              const loc = page.locator(sel).first();
              if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
                await loc.click({ force: true, timeout: 3000 });
                log(`选择了子分区: ${sel}`);
                break;
              }
            } catch {}
          }
        }
      } else {
        log('警告: 未找到分区选择器，跳过分区选择。可能导致投稿失败。');
      }
    } catch (e) {
      log('分区选择过程出错，继续执行...');
    }

    await page.waitForTimeout(1000);

    // Dismiss any popups before clicking publish
    try {
      const prePublishPopup = page.locator('button:has-text("我知道了"), button:has-text("知道了"), .close-btn').first();
      if (await prePublishPopup.count() > 0) {
        await prePublishPopup.click({ force: true, timeout: 3000 }).catch(() => {});
        log('发布前关闭了弹窗。');
        await page.waitForTimeout(500);
      }
    } catch (e) {}

    // --- Step 5: Click publish ---
    log('点击投稿按钮...');
    const publishSelectors = [
      'span:text-is("立即投稿")',
      'button:has-text("立即投稿")',
      'span:has-text("立即投稿")',
      'button:has-text("投稿")',
      'span:text-is("投稿")',
      '.submit-add:has-text("投稿")',
    ];

    let publishButton = null;
    for (const sel of publishSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0) {
          publishButton = loc;
          log(`找到投稿按钮: ${sel}`);
          break;
        }
      } catch (e) {}
    }

    if (!publishButton) {
      // Fallback: try getByRole
      try {
        const roleBtn = page.getByRole('button', { name: /投稿/ });
        if (await roleBtn.count() > 0) {
          publishButton = roleBtn.first();
          log('通过 getByRole 找到投稿按钮。');
        }
      } catch (e) {}
    }

    if (!publishButton) {
      await safeScreenshot(page, `bilibili_${timestamp}_no_publish_btn.png`, screenshots, log);
      return {
        success: false,
        message: '未找到投稿按钮，请检查页面状态。',
        logs,
        screenshots,
      };
    }

    await publishButton.scrollIntoViewIfNeeded().catch(() => {});
    await safeScreenshot(page, `bilibili_${timestamp}_before_publish.png`, screenshots, log);

    // Check if button is disabled
    const isDisabled = await publishButton.evaluate((el: Element) => {
      return el.hasAttribute('disabled') || el.classList.contains('disabled');
    }).catch(() => false);

    if (isDisabled) {
      log('投稿按钮处于禁用状态，等待5秒...');
      await page.waitForTimeout(5000);
    }

    await publishButton.click({ force: true });
    log('已点击投稿按钮。');

    // --- Step 6: Wait for success or verification ---
    log('等待投稿结果或安全验证...');

    let isSuccess = false;

    try {
      const result = await Promise.race([
        // Success: URL changes to success page
        page.waitForURL('**/platform/upload/success**', { timeout: 30000 }).then(() => 'success_url'),

        // Success: text indicators
        page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes('稿件投递成功') ||
            text.includes('投稿成功') ||
            text.includes('发布成功') ||
            text.includes('投递成功');
        }, { timeout: 30000 }).then(() => 'success_text'),

        // Verification challenge
        new Promise<string>((resolve) => {
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
        log('检测到投稿成功标志！');
      } else if (result === 'verification_blocked') {
        log('投稿后触发了安全验证弹窗。');

        const success = await handleVerificationChallenge(taskId, page, log, screenshots);
        if (success) {
          log('验证通过。等待弹窗关闭...');
          await page.waitForTimeout(3000);
          await safeScreenshot(page, `bilibili_${timestamp}_after_verif.png`, screenshots, log);

          // Check if already on success page
          const bodyText = await page.evaluate(() => document.body.innerText);
          if (
            page.url().includes('success') ||
            bodyText.includes('稿件投递成功') ||
            bodyText.includes('投稿成功')
          ) {
            isSuccess = true;
            log('验证后投稿成功（自动提交）！');
          } else {
            // May need to re-click publish
            log('验证通过但尚未投稿成功。重新点击投稿按钮...');
            try {
              let rePublishBtn = null;
              for (const sel of publishSelectors) {
                const loc = page.locator(sel).first();
                if (await loc.count() > 0) {
                  rePublishBtn = loc;
                  break;
                }
              }

              if (rePublishBtn) {
                await rePublishBtn.scrollIntoViewIfNeeded().catch(() => {});
                await safeScreenshot(page, `bilibili_${timestamp}_re_publish.png`, screenshots, log);
                await rePublishBtn.click({ force: true });
                log('重新点击了投稿按钮。');

                // Wait for final success
                try {
                  const reResult = await Promise.race([
                    page.waitForURL('**/platform/upload/success**', { timeout: 30000 }).then(() => 'success_url' as const),
                    page.waitForFunction(() => {
                      const text = document.body.innerText;
                      return text.includes('稿件投递成功') ||
                        text.includes('投稿成功') ||
                        text.includes('发布成功');
                    }, { timeout: 30000 }).then(() => 'success_text' as const),
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
                    log('重新投稿后成功！');
                  } else if (reResult === 'verification_again') {
                    log('重新投稿后再次触发验证。处理第二轮验证...');
                    const success2 = await handleVerificationChallenge(taskId, page, log, screenshots);
                    if (success2) {
                      log('第二轮验证通过。检查投稿结果...');
                      await page.waitForTimeout(3000);

                      const bodyText2 = await page.evaluate(() => document.body.innerText);
                      if (
                        page.url().includes('success') ||
                        bodyText2.includes('稿件投递成功') ||
                        bodyText2.includes('投稿成功')
                      ) {
                        isSuccess = true;
                        log('第二轮验证后投稿成功！');
                      } else {
                        // Final attempt to click publish
                        log('第二轮验证后尝试最后一次投稿...');
                        try {
                          for (const sel of publishSelectors) {
                            const finalBtn = page.locator(sel).first();
                            if (await finalBtn.count() > 0) {
                              await finalBtn.click({ force: true });
                              await page.waitForTimeout(10000);
                              const bodyText3 = await page.evaluate(() => document.body.innerText);
                              if (
                                page.url().includes('success') ||
                                bodyText3.includes('稿件投递成功') ||
                                bodyText3.includes('投稿成功')
                              ) {
                                isSuccess = true;
                                log('最终投稿成功！');
                              }
                              break;
                            }
                          }
                        } catch (e) {}

                        if (!isSuccess) {
                          await safeScreenshot(page, `bilibili_${timestamp}_final_fail.png`, screenshots, log);
                          return {
                            success: false,
                            message: '两轮验证均通过，但投稿仍未成功。请手动确认。',
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
                  if (page.url().includes('success')) {
                    isSuccess = true;
                    log('验证后投稿成功（URL检查）。');
                  } else {
                    await safeScreenshot(page, `bilibili_${timestamp}_re_publish_failed.png`, screenshots, log);
                    return {
                      success: false,
                      message: '验证通过后重新点击投稿，但未检测到成功标志。请手动确认。',
                      logs,
                      screenshots,
                    };
                  }
                }
              } else {
                log('验证后未找到投稿按钮。');
                await safeScreenshot(page, `bilibili_${timestamp}_no_republish_btn.png`, screenshots, log);
                return {
                  success: false,
                  message: '验证通过但未找到投稿按钮，请手动确认。',
                  logs,
                  screenshots,
                };
              }
            } catch (reClickErr: unknown) {
              const errMsg = reClickErr instanceof Error ? reClickErr.message : String(reClickErr);
              log(`重新投稿出错: ${errMsg}`);
              const bodyTextFallback = await page.evaluate(() => document.body.innerText);
              if (
                page.url().includes('success') ||
                bodyTextFallback.includes('稿件投递成功') ||
                bodyTextFallback.includes('投稿成功')
              ) {
                isSuccess = true;
                log('尽管重新投稿出错，但页面已跳转到成功页面。');
              } else {
                return {
                  success: false,
                  message: `验证通过但重新投稿失败: ${errMsg}`,
                  logs,
                  screenshots,
                };
              }
            }
          }
        } else {
          return {
            success: false,
            message: '验证码等待超时或提交失败。投稿终止。',
            logs,
            screenshots,
          };
        }
      }
    } catch (e) {
      log('等待投稿结果超时。');
      if (page.url().includes('success')) isSuccess = true;
    }

    if (isSuccess) {
      await safeScreenshot(page, `bilibili_${timestamp}_success.png`, screenshots, log);
      return {
        success: true,
        message: 'B站投稿成功！(已确认页面跳转或成功提示)',
        logs,
        screenshots,
      };
    }

    await safeScreenshot(page, `bilibili_${timestamp}_failed.png`, screenshots, log);
    return {
      success: false,
      message: '点击了投稿，但未检测到成功标志且未收到验证码。',
      logs,
      screenshots,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errorMessage = `B站自动化核心崩溃: ${errMsg}`;
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
