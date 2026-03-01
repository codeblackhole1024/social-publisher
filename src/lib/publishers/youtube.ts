import { type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

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

async function checkForVerification(page: Page): Promise<boolean> {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    return text.includes('Verify it\'s you') ||
           text.includes('验证您的身份') ||
           text.includes('Complete your sign-in') ||
           text.includes('Confirm your identity') ||
           page.url().includes('v2/challenge') ||
           page.url().includes('signin/challenge');
  } catch {
    return false;
  }
}

/**
 * Try clicking an element using multiple selector strategies.
 * Returns true if any selector succeeded.
 */
async function tryClick(
  page: Page,
  selectors: string[],
  log: (msg: string) => void,
  label: string,
  timeoutMs = 8000
): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) {
        await loc.click({ force: true, timeout: timeoutMs });
        log(`Clicked "${label}" via: ${sel}`);
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
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

  try {
    const timestamp = Date.now();
    log(`Starting YouTube upload for: ${title}`);

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // ──── Step 1: Navigate to YouTube Studio ────
    log('Navigating to YouTube Studio...');
    await page.goto('https://studio.youtube.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for page to stabilize
    await page.waitForSelector('body', { timeout: 30000 });
    await page.waitForTimeout(3000);
    await safeScreenshot(page, `youtube_${timestamp}_1_initial.png`, screenshots, log);

    // Check login
    if (page.url().includes('signin') || page.url().includes('AccountChooser') || page.url().includes('accounts.google.com')) {
      return { success: false, message: 'YouTube登录态已失效，请重新登录。', logs, screenshots };
    }

    if (await checkForVerification(page)) {
      return {
        success: false,
        message: '触发了 Google 安全验证。请在"账号管理"中重新点击登录 YouTube，并在弹出的浏览器中手动完成安全验证。',
        logs,
        screenshots,
      };
    }

    // ──── Step 2: Click CREATE button ────
    log('Looking for CREATE button...');

    const createSelectors = [
      // Modern YouTube Studio selectors (2024+)
      '#create-icon',
      'ytcp-button#create-icon',
      'button[aria-label="Create"]',
      'button[aria-label="创建"]',
      'ytcp-icon-button#create-icon',
      '#upload-icon',
      'button#create-icon',
      // Fallback: any element with "Upload" or "Create" nearby
      '[id*="create"]',
      'ytcp-button:has(iron-icon)',
    ];

    let clickedCreate = await tryClick(page, createSelectors, log, 'CREATE', 10000);

    if (!clickedCreate) {
      // Strategy B: Try navigating directly to upload page
      log('CREATE button not found. Trying direct upload URL...');
      await page.goto('https://studio.youtube.com/channel/UC/videos/upload', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }).catch(() => {});
      await page.waitForTimeout(2000);

      // Check if we landed on an upload dialog
      const hasFileInput = await page.locator('input[type="file"]').count();
      if (hasFileInput > 0) {
        log('Landed on upload page via direct URL.');
        clickedCreate = true;
      }
    }

    if (!clickedCreate) {
      // Strategy C: Try keyboard shortcut (some YT Studio versions support it)
      log('Trying alternative: looking for upload-related elements on page...');
      await safeScreenshot(page, `youtube_${timestamp}_create_not_found.png`, screenshots, log);

      // Try clicking any visible upload/create button by text
      const textMatches = [
        page.getByRole('button', { name: 'Create' }),
        page.getByRole('button', { name: '创建' }),
        page.getByRole('button', { name: 'Upload' }),
        page.getByRole('button', { name: 'Upload videos' }),
        page.getByRole('button', { name: '上传视频' }),
      ];

      for (const loc of textMatches) {
        try {
          if (await loc.count() > 0) {
            await loc.first().click({ force: true, timeout: 5000 });
            log('Clicked create/upload via getByRole.');
            clickedCreate = true;
            break;
          }
        } catch {
          // next
        }
      }
    }

    if (!clickedCreate) {
      await safeScreenshot(page, `youtube_${timestamp}_no_create_btn.png`, screenshots, log);
      return { success: false, message: 'YouTube Studio页面未找到"创建"按钮。请确认登录状态正常。', logs, screenshots };
    }

    await page.waitForTimeout(1500);
    await safeScreenshot(page, `youtube_${timestamp}_2_create_menu.png`, screenshots, log);

    // ──── Step 3: Click "Upload videos" in dropdown ────
    log('Looking for "Upload videos" option...');

    const uploadOptionSelectors = [
      'tp-yt-paper-item:has-text("Upload videos")',
      'tp-yt-paper-item:has-text("Upload video")',
      'tp-yt-paper-item:has-text("上传视频")',
      '#text-item-0',
      'tp-yt-paper-item:first-child',
      'ytcp-text-menu tp-yt-paper-item:first-child',
      '[id*="menu"] tp-yt-paper-item:first-child',
    ];

    // Also try getByText approaches
    let clickedUpload = await tryClick(page, uploadOptionSelectors, log, 'Upload videos', 8000);

    if (!clickedUpload) {
      const uploadTextMatches = [
        page.getByText('Upload videos', { exact: false }),
        page.getByText('Upload video', { exact: false }),
        page.getByText('上传视频', { exact: false }),
      ];
      for (const loc of uploadTextMatches) {
        try {
          if (await loc.count() > 0) {
            await loc.first().click({ force: true, timeout: 5000 });
            log('Clicked upload option via getByText.');
            clickedUpload = true;
            break;
          }
        } catch {
          // next
        }
      }
    }

    // If still no upload dialog, check if file input already exists (direct navigation worked)
    if (!clickedUpload) {
      const fileInputExists = await page.locator('input[type="file"]').count();
      if (fileInputExists > 0) {
        log('File input already present, skipping upload option click.');
        clickedUpload = true;
      }
    }

    if (!clickedUpload) {
      await safeScreenshot(page, `youtube_${timestamp}_no_upload_option.png`, screenshots, log);
      return { success: false, message: '未找到"上传视频"选项。请检查YouTube Studio界面。', logs, screenshots };
    }

    await page.waitForTimeout(2000);

    // ──── Step 4: Upload file ────
    log('Searching for file input...');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15000 });

    const filePath = typeof file === 'string' ? file : path.join(process.cwd(), 'uploads', file.name);
    log(`Uploading file from ${filePath}...`);
    await fileInput.setInputFiles(filePath);
    await safeScreenshot(page, `youtube_${timestamp}_3_file_selected.png`, screenshots, log);

    // ──── Step 5: Wait for upload details dialog ────
    log('Waiting for upload dialog to render...');

    const titleSelectors = [
      '#textbox[aria-label*="title" i]',
      '#textbox[aria-label*="Title"]',
      '#textbox[aria-label*="标题"]',
      'ytcp-social-suggestions-textbox #textbox',
      '#title-textarea #textbox',
      'div#textbox[contenteditable="true"]',
    ];

    let titleBox = null;
    for (const sel of titleSelectors) {
      const loc = page.locator(sel).first();
      try {
        await loc.waitFor({ state: 'visible', timeout: 15000 });
        titleBox = loc;
        log(`Found title box via: ${sel}`);
        break;
      } catch {
        // try next
      }
    }

    if (!titleBox) {
      // Fallback: grab first contenteditable textbox
      titleBox = page.locator('#textbox[contenteditable="true"]').first();
      await titleBox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      log('Using fallback first #textbox for title.');
    }

    // ──── Step 6: Fill Title ────
    log('Filling title...');
    try {
      await titleBox.click();
      // Select all existing text and replace
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(title.substring(0, 100)); // YT max 100
    } catch (e) {
      log(`Title fill warning: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ──── Step 7: Fill Description ────
    log('Filling description...');
    const descSelectors = [
      '#textbox[aria-label*="Tell viewers" i]',
      '#textbox[aria-label*="viewers"]',
      '#textbox[aria-label*="描述"]',
      '#description-textarea #textbox',
    ];

    let descBox = null;
    for (const sel of descSelectors) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.count() > 0) {
          descBox = loc;
          log(`Found description box via: ${sel}`);
          break;
        }
      } catch {
        // next
      }
    }

    if (!descBox) {
      // Fallback: second contenteditable textbox
      const allTextboxes = page.locator('#textbox[contenteditable="true"]');
      const count = await allTextboxes.count();
      if (count >= 2) {
        descBox = allTextboxes.nth(1);
        log('Using fallback second #textbox for description.');
      }
    }

    if (descBox) {
      try {
        await descBox.click();
        await page.keyboard.press('Meta+A');
        await page.keyboard.press('Backspace');
        const descText = `${description}\n\n${tags.map(t => `#${t}`).join(' ')}`.substring(0, 5000);
        await page.keyboard.insertText(descText);
      } catch (e) {
        log(`Description fill warning: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      log('WARNING: Could not find description textbox.');
    }

    await safeScreenshot(page, `youtube_${timestamp}_4_text_filled.png`, screenshots, log);

    // ──── Step 8: Select "No, it's not made for kids" ────
    log('Setting audience to "Not made for kids"...');
    const notForKidsSelectors = [
      '[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
      '#radioLabel:has-text("No, it\'s not made for kids")',
      '#radioLabel:has-text("不是面向儿童")',
      'tp-yt-paper-radio-button[name="NOT_MADE_FOR_KIDS"]',
    ];

    let clickedNotForKids = false;
    for (const sel of notForKidsSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0) {
          await loc.scrollIntoViewIfNeeded();
          await loc.click({ force: true });
          log(`Selected "Not for kids" via: ${sel}`);
          clickedNotForKids = true;
          break;
        }
      } catch {
        // next
      }
    }

    if (!clickedNotForKids) {
      // Try getByText
      try {
        const nfk = page.getByText('No, it\'s not made for kids', { exact: false });
        if (await nfk.count() > 0) {
          await nfk.first().click({ force: true });
          log('Selected "Not for kids" via getByText.');
          clickedNotForKids = true;
        }
      } catch {
        // ignore
      }
    }

    if (!clickedNotForKids) {
      log('WARNING: Could not select "Not for kids". May fail at publish.');
    }

    // ──── Step 9: Click Next through tabs ────
    log('Navigating through tabs (Details → Elements → Checks → Visibility)...');

    const nextSelectors = ['#next-button', '#step-badge-1', 'ytcp-button#next-button'];

    for (let step = 0; step < 3; step++) {
      await page.waitForTimeout(1000);
      const clicked = await tryClick(page, nextSelectors, log, `Next (step ${step + 1})`);
      if (!clicked) {
        // Try getByRole
        try {
          const nextBtn = page.getByRole('button', { name: 'Next' });
          if (await nextBtn.count() > 0) {
            await nextBtn.first().click({ force: true });
            log(`Clicked Next via getByRole (step ${step + 1}).`);
          }
        } catch {
          log(`WARNING: Could not click Next at step ${step + 1}.`);
        }
      }
    }

    await page.waitForTimeout(1000);
    await safeScreenshot(page, `youtube_${timestamp}_5_visibility_tab.png`, screenshots, log);

    // ──── Step 10: Select Public visibility ────
    log('Setting visibility to Public...');
    const publicSelectors = [
      '[name="PUBLIC"]',
      'tp-yt-paper-radio-button[name="PUBLIC"]',
      '#radioLabel:has-text("Public")',
      '#radioLabel:has-text("公开")',
    ];

    let clickedPublic = false;
    for (const sel of publicSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0) {
          await loc.click({ force: true });
          log(`Selected Public via: ${sel}`);
          clickedPublic = true;
          break;
        }
      } catch {
        // next
      }
    }

    if (!clickedPublic) {
      try {
        const pubText = page.getByText('Public', { exact: true });
        if (await pubText.count() > 0) {
          await pubText.first().click({ force: true });
          log('Selected Public via getByText.');
          clickedPublic = true;
        }
      } catch {
        // ignore
      }
    }

    if (!clickedPublic) {
      log('WARNING: Could not select Public visibility. Video may publish as Draft.');
    }

    // ──── Step 11: Click Publish / Done ────
    log('Publishing video...');
    await page.waitForTimeout(1000);

    const doneSelectors = [
      '#done-button',
      'ytcp-button#done-button',
      '#publish-button',
    ];

    let clickedDone = await tryClick(page, doneSelectors, log, 'Publish/Done', 10000);

    if (!clickedDone) {
      try {
        const doneByRole = page.getByRole('button', { name: /Publish|Done|发布|完成/i });
        if (await doneByRole.count() > 0) {
          await doneByRole.first().click({ force: true });
          log('Clicked Publish via getByRole.');
          clickedDone = true;
        }
      } catch {
        // ignore
      }
    }

    if (!clickedDone) {
      await safeScreenshot(page, `youtube_${timestamp}_no_publish_btn.png`, screenshots, log);
      return { success: false, message: '未找到"发布"按钮。', logs, screenshots };
    }

    // ──── Step 12: Wait for success ────
    log('Waiting for publish confirmation...');

    try {
      // Wait for either: processing dialog close button, success text, or URL change
      await Promise.race([
        page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes('Video published') ||
                 text.includes('已发布') ||
                 text.includes('Uploading') ||
                 text.includes('Processing') ||
                 text.includes('Video upload') ||
                 text.includes('正在处理');
        }, { timeout: 30000 }),
        page.locator('#close-button').first().waitFor({ state: 'visible', timeout: 30000 }),
      ]);

      await page.waitForTimeout(2000);
      await safeScreenshot(page, `youtube_${timestamp}_6_success.png`, screenshots, log);

      // Check if there's an error message
      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.includes('Daily upload limit reached') || pageText.includes('上传限制')) {
        return { success: false, message: 'YouTube上传限制已达到每日上限。', logs, screenshots };
      }

      log('YouTube video publish flow completed!');
      return { success: true, message: 'YouTube视频发布成功！视频可能仍在处理中，请在YouTube Studio查看。', logs, screenshots };

    } catch {
      // Timeout — check current state
      await safeScreenshot(page, `youtube_${timestamp}_publish_timeout.png`, screenshots, log);

      const currentText = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (currentText.includes('Processing') || currentText.includes('正在处理') || currentText.includes('Uploading')) {
        log('Video is still processing/uploading but publish was triggered.');
        return { success: true, message: 'YouTube视频已提交发布，正在处理中。请在YouTube Studio确认。', logs, screenshots };
      }

      return { success: false, message: 'YouTube发布超时，未检测到成功确认。请在YouTube Studio手动确认。', logs, screenshots };
    }

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // Check for verification one last time
    if (await checkForVerification(page)) {
      const msg = '发布过程中被 Google 拦截并要求身份验证。请在"账号管理"中重新点击登录 YouTube，完成手动验证以刷新信任。';
      log(`[ERROR] ${msg}`);
      await safeScreenshot(page, `youtube_${Date.now()}_verification_blocked.png`, screenshots, log);
      return { success: false, message: msg, logs, screenshots };
    }

    const errorMsg = `YouTube自动化出错: ${errMsg}`;
    console.error(errorMsg);
    logs.push(`[ERROR] ${errorMsg}`);
    await safeScreenshot(page, `youtube_${Date.now()}_error.png`, screenshots, log);
    return { success: false, message: errorMsg, logs, screenshots };
  }
}
