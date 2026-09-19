// google-search.js
// Usage: node google-search.js "your search keyword"

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TARGET_DOMAIN = 'kendis.io';
const MAX_PAGES_TO_CHECK = 10; // safety limit: stop after checking this many pages

// Extracts organic results (title, real link, clean display URL) from
// whichever Google results page is currently loaded.
async function extractResults(page) {
  await page.waitForSelector('#search', { timeout: 15000 }).catch(() => {});

  return page.evaluate(() => {
    const items = [];
    const seen = new Set();

    document.querySelectorAll('#search h3').forEach((h3) => {
      const link = h3.closest('a');
      if (!link || !link.href) return;
      if (seen.has(link.href)) return;
      seen.add(link.href);

      // Climb outward from the link until we find the breadcrumb-style
      // readable address Google displays under each result.
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
}

// Dismisses a cookie/consent screen if one appears (usually only on the
// very first page load of a session).
async function dismissConsent(page) {
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
}

async function gotoSearchPage(page, keyword, startIndex) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(
    keyword
  )}&num=10&hl=en&start=${startIndex}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

function buildReportHtml(keyword, top10, rankInfo) {
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

  let rankHtml;
  if (rankInfo.found) {
    rankHtml = `<p style="background:#eaffea; border:1px solid #b6e6b6; padding:12px; border-radius:6px;">
      <strong>${TARGET_DOMAIN}</strong> found at position <strong>#${rankInfo.position}</strong>
      (page ${rankInfo.page}) &mdash; "${rankInfo.title}"
    </p>`;
  } else {
    rankHtml = `<p style="background:#fff4e5; border:1px solid #f0c987; padding:12px; border-radius:6px;">
      <strong>${TARGET_DOMAIN}</strong> was not found within the first ${rankInfo.pagesChecked} pages
      (approximately the top ${rankInfo.pagesChecked * 10} results).
    </p>`;
  }

  return `<!DOCTYPE html>
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

  <h2>Ranking check: ${TARGET_DOMAIN}</h2>
  ${rankHtml}

  <h2>Top 10 organic results (page 1)</h2>
  <table style="width:100%; border-collapse: collapse; margin-top:10px;">
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
}

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

  // ---- Page 1: used for the standard top-10 report ----
  await gotoSearchPage(page, keyword, 0);
  await dismissConsent(page);
  const page1Results = await extractResults(page);
  const top10 = page1Results.slice(0, 10);

  console.log(`\nTop ${top10.length} organic results for: "${keyword}"\n`);
  top10.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   ${r.displayUrl}\n`);
  });

  // ---- Task 2: find where kendis.io ranks, paging through results ----
  console.log(`\nSearching for "${TARGET_DOMAIN}" in the results...\n`);

  let rankInfo = { found: false, pagesChecked: 0 };
  let overallPosition = 0;
  let currentResults = page1Results;

  outerLoop: for (let pageNum = 1; pageNum <= MAX_PAGES_TO_CHECK; pageNum++) {
    if (pageNum > 1) {
      // Small pause between page loads to behave less like a bot
      await page.waitForTimeout(1500 + Math.random() * 1500);
      await gotoSearchPage(page, keyword, (pageNum - 1) * 10);
      currentResults = await extractResults(page);
    }

    rankInfo.pagesChecked = pageNum;

    for (const r of currentResults) {
      overallPosition++;
      const haystack = `${r.displayUrl} ${r.url} ${r.title}`.toLowerCase();
      if (haystack.includes(TARGET_DOMAIN)) {
        rankInfo = {
          found: true,
          position: overallPosition,
          page: pageNum,
          title: r.title,
          pagesChecked: pageNum,
        };
        break outerLoop;
      }
    }

    if (currentResults.length === 0) {
      // No more results to page through
      break;
    }
  }

  if (rankInfo.found) {
    console.log(
      `FOUND: ${TARGET_DOMAIN} is at position #${rankInfo.position} (page ${rankInfo.page})`
    );
    console.log(`  "${rankInfo.title}"`);
  } else {
    console.log(
      `NOT FOUND: ${TARGET_DOMAIN} did not appear in the first ${rankInfo.pagesChecked} pages ` +
        `(~top ${rankInfo.pagesChecked * 10} results).`
    );
  }

  // ---- Save the HTML report (top 10 + ranking result) ----
  const html = buildReportHtml(keyword, top10, rankInfo);
  const reportPath = path.join(__dirname, 'report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');
  console.log(`\nReport saved to: ${reportPath}`);

  console.log(
    '\nBrowser will stay open — close the Chrome window yourself when you\'re done looking.'
  );
  // Wait until the user closes the browser window, instead of closing it
  // automatically. This resolves once Chrome actually shuts down.
  await new Promise((resolve) => context.on('close', resolve));
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});