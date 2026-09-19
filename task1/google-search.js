// google-search.js  (TASK 1)
// Usage: node google-search.js "your search keyword"

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const keyword = process.argv.slice(2).join(' ');

  if (!keyword) {
    console.error('Please provide a search keyword. Example:');
    console.error('  node google-search.js "playwright automation"');
    process.exit(1);
  }

  const userDataDir = path.join(__dirname, 'chrome-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = await context.newPage();

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    keyword
  )}&num=10&hl=en`;

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

  const consentSelectors = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'form:has(button) button',
  ];
  for (const sel of consentSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      break;
    }
  }

  await page.waitForSelector('#search', { timeout: 15000 }).catch(() => {});

  const results = await page.evaluate(() => {
    const items = [];
    const seen = new Set();

    document.querySelectorAll('#search h3').forEach((h3) => {
      const link = h3.closest('a');
      if (!link || !link.href) return;
      if (seen.has(link.href)) return;
      seen.add(link.href);

      let container = link;
      let displayUrl = null;
      for (let i = 0; i < 6 && container; i++) {
        container = container.parentElement;
        if (!container) break;
        const text = container.innerText || '';
        const lines = text
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const urlLine = lines.find(
          (l) => l.includes('\u203a') || /^https?:\/\//i.test(l)
        );
        if (urlLine) {
          displayUrl = urlLine;
          break;
        }
      }
      if (!displayUrl) displayUrl = link.href;

      items.push({
        title: h3.innerText.trim(),
        url: link.href,
        displayUrl,
      });
    });

    return items;
  });

  const top10 = results.slice(0, 10);

  console.log(`\nTop ${top10.length} organic results for: "${keyword}"\n`);
  top10.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   ${r.displayUrl}\n`);
  });

  if (top10.length === 0) {
    console.log(
      'No results parsed — Google may have changed its markup or shown a CAPTCHA.'
    );
  } else {
    const rowsHtml = top10
      .map(
        (r, i) => `
      <tr>
        <td style="padding:10px; border-bottom:1px solid #ddd; vertical-align:top;">${i + 1}</td>
        <td style="padding:10px; border-bottom:1px solid #ddd;">
          <div style="font-weight:600; color:#1a0dab; margin-bottom:4px;">${r.title}</div>
          <a href="${r.url}" style="color:#006621; font-size:13px; text-decoration:none;">${r.displayUrl}</a>
        </td>
      </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Search Report: ${keyword}</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; color:#222;">
  <h1 style="margin-bottom:0;">Google Search Report</h1>
  <p style="color:#555; margin-top:4px;">
    Keyword: <strong>${keyword}</strong> &nbsp;|&nbsp;
    Generated: ${new Date().toLocaleString()}
  </p>
  <table style="width:100%; border-collapse: collapse; margin-top:20px;">
    <thead>
      <tr style="text-align:left; border-bottom:2px solid #333;">
        <th style="padding:10px;">#</th>
        <th style="padding:10px;">Result</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;

    const reportPath = path.join(__dirname, 'report.html');
    fs.writeFileSync(reportPath, html, 'utf-8');
    console.log(`Report saved to: ${reportPath}`);
  }

  await context.close();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});