const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// @sparticuz/chromium already includes all necessary sandbox/GPU args
// We only add extras that aren't covered by chromium.args
const EXTRA_ARGS = ['--single-process', '--no-zygote'];

/**
 * Opens a DocSend link with Puppeteer, fills the email gate,
 * and captures screenshots of the first N slides.
 */
const extractFromDocsend = async (url, viewerEmail, maxSlides = 12) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, ...EXTRA_ARGS],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
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
      const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 75 });
      screenshots.push(screenshot);

      const currentImgSrc = await page.evaluate(() => {
        const img = document.querySelector(
          '.document-page img, .slide-container img, [class*="slide"] img, [class*="page"] img, main img'
        );
        return img ? img.src : null;
      });

      if (currentImgSrc && currentImgSrc === lastImgSrc) {
        noChangeCount++;
        if (noChangeCount >= 2) { console.log(`[DocSend] No new slide after ${i + 1} — stopping`); break; }
      } else {
        noChangeCount = 0;
      }
      lastImgSrc = currentImgSrc;

      const advanced = await page.evaluate(() => {
        const selectors = [
          '[data-testid="next-page"]', '[data-testid="next-slide"]',
          'button[aria-label*="next" i]', 'button[aria-label*="Next" i]',
          '.next-page', '.next-slide', '[class*="nextPage"]', '[class*="nextSlide"]', '[class*="arrow-right"]',
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

/**
 * Opens a Papermark link with Puppeteer, fills the email gate,
 * and captures screenshots of the first N pages.
 * Papermark URL pattern: https://www.papermark.com/view/[id]
 */
const extractFromPapermark = async (url, viewerEmail, maxSlides = 12) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, ...EXTRA_ARGS],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`[Papermark] Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2500);

    // ── Email gate ──────────────────────────────────────────────
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    if (emailInput) {
      console.log(`[Papermark] Email gate found — entering ${viewerEmail}`);
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(viewerEmail, { delay: 40 });
      await sleep(500);

      // Log all buttons visible on the gate page for debugging
      const buttonTexts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
      );
      console.log(`[Papermark] Buttons on gate page: ${JSON.stringify(buttonTexts)}`);

      // Try every possible submit approach in order
      const clicked = await page.evaluate(() => {
        const cssCandidates = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button[data-testid="submit-email"]',
          'button[data-testid="continue"]',
          'button[data-testid="submit"]',
          'form button',
        ];
        for (const sel of cssCandidates) {
          const el = document.querySelector(sel);
          if (el) { el.click(); return `css:${sel}`; }
        }
        // Text fallback
        const allButtons = Array.from(document.querySelectorAll('button'));
        const match = allButtons.find(
          (b) => /continue|submit|view|access|proceed|enter|confirm/i.test(b.textContent?.trim())
        );
        if (match) { match.click(); return `text:${match.textContent?.trim()}`; }
        // Last resort: click the first button on the page
        if (allButtons[0]) { allButtons[0].click(); return `first-button:${allButtons[0].textContent?.trim()}`; }
        return null;
      });
      console.log(`[Papermark] Gate submit result: ${clicked}`);

      // Also try Enter key as backup
      await page.keyboard.press('Enter');

      // Wait for deck to load — poll for scrollHeight to grow beyond viewport
      console.log('[Papermark] Waiting for deck to load after email gate...');
      let waited = 0;
      while (waited < 25000) {
        await sleep(1000);
        waited += 1000;
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        const inputGone = await page.$('input[type="email"], input[name="email"]') === null;
        if (h > 1100 || inputGone) {
          console.log(`[Papermark] Deck loaded — height ${h}px, inputGone=${inputGone}, after ${waited}ms`);
          await sleep(2000); // let images render
          break;
        }
        if (waited % 5000 === 0) console.log(`[Papermark] Still waiting... height=${h}px`);
      }
    } else {
      console.log('[Papermark] No email gate detected');
      await sleep(4000); // wait for deck render
    }

    // ── Page capture ─────────────────────────────────────────────
    // Papermark renders all document pages stacked vertically in a single
    // scrollable view. We take a full-page screenshot, then scroll viewport-
    // by-viewport to capture every slide without relying on next-page buttons.
    const screenshots = [];

    // Get full scrollable height
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const viewportHeight = page.viewport()?.height || 900;
    console.log(`[Papermark] Document height: ${pageHeight}px, viewport: ${viewportHeight}px`);

    let scrollY = 0;
    let prevHash = '';
    let noChangeCount = 0;

    while (screenshots.length < maxSlides) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await sleep(800);

      const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 75 });
      const hash = screenshot.slice(0, 300);

      if (hash === prevHash) {
        noChangeCount++;
        if (noChangeCount >= 2) {
          console.log(`[Papermark] No change after scrolling — stopping at ${screenshots.length} screenshots`);
          break;
        }
      } else {
        noChangeCount = 0;
        screenshots.push(screenshot);
      }
      prevHash = hash;

      scrollY += viewportHeight;
      if (scrollY >= pageHeight) break;
    }

    console.log(`[Papermark] Captured ${screenshots.length} pages from ${url}`);
    return screenshots;
  } catch (err) {
    console.error(`[Papermark] Error accessing ${url}: ${err.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
};

module.exports = { extractFromDocsend, extractFromPapermark };
