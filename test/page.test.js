// Drives the stocks page in the installed Chrome (playwright-core, no browser download) against the real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ROOT } from './helpers/server.js';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {}

let server;
let browser;
let skip = !chromium && 'playwright-core not installed';
before(async () => {
  if (skip) return;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
  } catch {
    skip = 'Google Chrome not installed';
    return;
  }
  server = await startServer(ROOT, { STOCK_COUNT: '3000', TICKS_PER_SECOND: '3000' });
});
after(async () => {
  await browser?.close();
  server?.proc.kill();
});

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`http://localhost:${server.port}/`);
  await page.waitForFunction(() => document.getElementById('statusText').textContent === 'Live');
  return page;
}

// Reads what the virtual table shows and what it is subscribed to.
const tableState = (page) => page.evaluate(() => ({
  rendered: [...document.querySelectorAll('#rows tr.row')].map((tr) => tr.children[1].textContent),
  topSpacer: parseInt(document.querySelector('#rows tr.spacer td')?.style.height || '0', 10),
  liveRows: Number(document.getElementById('liveRows').textContent),
  filteredCodes: filtered.map((k) => stocks.get(k).code),
}));

test('virtual table: only visible rows are mounted, and the right ones after a deep scroll', async (t) => {
  if (skip) return t.skip(skip);
  const page = await openPage();
  let s = await tableState(page);
  assert.ok(s.rendered.length > 0 && s.rendered.length < 60, `mounted ${s.rendered.length} of 3000`);

  await page.evaluate(() => window.scrollTo(0, 48 * 1500));
  await page.waitForTimeout(400);
  s = await tableState(page);
  const first = s.topSpacer / 48;
  assert.ok(first > 1000, 'window moved deep into the list');
  assert.deepEqual(s.rendered, s.filteredCodes.slice(first, first + s.rendered.length), 'rows match their position');
  await page.waitForTimeout(300);
  assert.equal((await tableState(page)).liveRows, s.rendered.length, 'subscribed to exactly the mounted rows');
  await page.close();
});

test('search boxes share one query, and no matches shows a message', async (t) => {
  if (skip) return t.skip(skip);
  const page = await openPage();
  await page.fill('#topSearch', 'riyad');
  assert.equal(await page.inputValue('#search'), 'riyad');
  await page.fill('#search', 'zzzz-no-such-stock');
  assert.equal(await page.inputValue('#topSearch'), 'zzzz-no-such-stock');
  assert.match(await page.textContent('#rows'), /No stocks match/);
  await page.close();
});

test('selected sector survives a reconnect; status shows Reconnecting then Live', async (t) => {
  if (skip) return t.skip(skip);
  const page = await openPage();
  const sector = await page.evaluate(() => document.querySelectorAll('#sector option')[1].value);
  await page.selectOption('#sector', sector);
  await page.evaluate(() => ws.close());
  await page.waitForFunction(() => document.getElementById('statusText').textContent.startsWith('Reconnecting'));
  await page.waitForFunction(() => document.getElementById('statusText').textContent === 'Live', null, { timeout: 15000 });
  assert.equal(await page.inputValue('#sector'), sector);
  const sectors = await page.$$eval('#rows tr.row td:nth-child(4)', (tds) => [...new Set(tds.map((td) => td.textContent))]);
  assert.equal(sectors.length, 1);
  await page.close();
});

test('controls are labelled and the ticker can be paused', async (t) => {
  if (skip) return t.skip(skip);
  const page = await openPage();
  assert.ok(await page.getByLabel('Sector').isVisible());
  await page.click('#tickerToggle');
  assert.equal(await page.getAttribute('#tickerToggle', 'aria-pressed'), 'true');
  assert.ok(await page.$eval('#ticker', (el) => el.classList.contains('paused')));
  await page.close();
});
