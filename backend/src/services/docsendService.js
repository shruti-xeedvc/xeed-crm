const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens a DocSend link with Puppeteer, fills the email gate,
 * and captures screenshots of the first N slides.
 *
 * @param {string} url          - DocSend URL (https://docsend.com/view/...)
 * @param {string} viewerEmail  - Email to enter on the gate page
 * @param {number} maxSlides    - Max slides to capture (default 12)
 * @returns {string[]}          - Array of base64 JPEG screenshots
 */
const extractFromDocsend = async (url, viewerEmail, maxSlides = 12) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`[DocSend] Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);

    // ── Email gate ──────────────────────────────────────────────
    const emailInput = await page.$('input[type="email"], input[name="email"], input[id*="email"]');
    if (emailInput) {
      console.log(`[DocSend] Email gate found — entering ${viewerEmail}`);
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(viewerEmail, { delay: 40 });
      await sleep(300);

      // Click the submit / continue button
      const clicked = await page.evaluate(() => {
        const selectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button.continue',
          'button.btn-primary',
          'button[data-testid="submit"]',
          '.document-link-auth button',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { el.click(); return true; }
        }
        return false;
      });
      if (!clicked) await page.keyboard.press('Enter');
      await sleep(3500);
    } else {
      console.log('[DocSend] No email gate detected');
    }

    // ── Slide capture ────────────────────────────────────────────
    const screenshots = [];
    let lastImgSrc = null;
    let noChangeCount = 0;

    for (let i = 0; i < maxSlides; i++) {
      const screenshot = await page.screenshot({
        encoding: 'base64',
        type: 'jpeg',
        quality: 75,
      });
      screenshots.push(screenshot);

      // Check current slide image src to detect when we stop advancing
      const currentImgSrc = await page.evaluate(() => {
        const img = document.querySelector(
          '.document-page img, .slide-container img, [class*="slide"] img, [class*="page"] img, main img'
        );
        return img ? img.src : null;
      });

      if (currentImgSrc && currentImgSrc === lastImgSrc) {
        noChangeCount++;
        if (noChangeCount >= 2) {
          console.log(`[DocSend] No new slide after ${i + 1} captures — stopping`);
          break;
        }
      } else {
        noChangeCount = 0;
      }
      lastImgSrc = currentImgSrc;

      // Advance to next slide
      const advanced = await page.evaluate(() => {
        const selectors = [
          '[data-testid="next-page"]',
          '[data-testid="next-slide"]',
          'button[aria-label*="next" i]',
          'button[aria-label*="Next" i]',
          '.next-page',
          '.next-slide',
          '[class*="nextPage"]',
          '[class*="nextSlide"]',
          '[class*="arrow-right"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && !el.disabled) { el.click(); return true; }
        }
        return false;
      });

      if (!advanced) await page.keyboard.press('ArrowRight');
      await sleep(1200);
    }

    console.log(`[DocSend] Captured ${screenshots.length} slides from ${url}`);
    return screenshots;
  } catch (err) {
    console.error(`[DocSend] Error accessing ${url}: ${err.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
};

module.exports = { extractFromDocsend };
