// Capture the real React renderer with isolated, fictional data. See README.md.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installDemoData } from './demo-data.mjs';

const { chromium } = await import(process.env.CHAI_PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.CHAI_SCREENSHOT_URL || 'http://127.0.0.1:4178';
const origin = new URL(baseUrl).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname)) {
  throw new Error('Screenshots must use a loopback renderer URL.');
}
const outputDir = fileURLToPath(new URL('./', import.meta.url));
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHAI_CHROMIUM_PATH ? { executablePath: process.env.CHAI_CHROMIUM_PATH } : {}),
});
const failures = [];
const externalRequests = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
  locale: 'en-GB',
  timezoneId: 'Asia/Kolkata',
  colorScheme: 'light',
  reducedMotion: 'reduce',
});
await context.route('**/*', async (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  externalRequests.push(route.request().url());
  return route.abort();
});

async function openScene(options = {}) {
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  await page.addInitScript(installDemoData, options);
  await page.goto(baseUrl);
  await page.locator('.chat-item').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function capture(page, filename, target = page, options = {}) {
  await page.mouse.move(0, 959);
  await target.screenshot({ path: `${outputDir}${filename}`, animations: 'disabled', ...options });
  console.log(`Captured ${filename}`);
}

async function enlargeOutput(page, index, height) {
  // Use the textarea's real resize handle, as a user can in the app.
  const box = await page.locator('.ai-output-box').nth(index).boundingBox();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + height - 4, { steps: 12 });
  await page.mouse.up();
}

async function runProject(page) {
  await page.locator('.ai-run-cluster-btn').first().click({ position: { x: 16, y: 16 } });
  await page.getByText('Cluster extraction complete.', { exact: true }).waitFor();
}

async function runAll(page) {
  await page.locator('[data-role="all-hours-picker"]').click();
  await page.getByRole('button', { name: 'since last opened', exact: true }).click();
  await page.locator('.ai-run-cluster-btn').nth(1).click({ position: { x: 20, y: 16 } });
  await page.getByText('Completed 3 projects • Skipped 0 (no new messages)', { exact: true }).waitFor();
  // The app dismisses its completed progress indicator after 800 ms.
  await page.locator('.ai-progress').waitFor({ state: 'hidden' });
}

try {
  const page = await openScene();
  await page.locator('.chat-item').filter({ hasText: 'Atlas Website Team' }).click();
  await page.getByPlaceholder('Type a message').fill('On it — mobile preview and form test results by 1 pm.');
  await runProject(page);
  await runAll(page);
  await enlargeOutput(page, 0, 350);
  await enlargeOutput(page, 1, 365);
  await capture(page, '01-workspace.png');

  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('.chat-item').filter({ hasText: 'Atlas' }).first().click();
  await page.locator('.attachment-pill').first().waitFor();
  await page.getByPlaceholder('Type an email reply').fill('Thanks, Sam. I’ll keep the approved service names and share the mobile preview by 1 pm. See you at the review.');
  await capture(page, '02-email.png');

  await page.getByRole('button', { name: 'Clusters', exact: true }).click();
  await page.locator('.cluster-title').filter({ hasText: 'Atlas website' }).waitFor();
  await page.locator('.cluster-group').filter({ hasText: 'Atlas website' }).locator('.chat-item').filter({ hasText: 'Atlas Website Team' }).click();
  await capture(page, '03-project-clusters.png');

  await capture(page, '05-project-insights.png', page.locator('.ai-panel'));

  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await page.locator('.chat-item').filter({ hasText: 'Noah Reed' }).click({ modifiers: ['Meta'] });
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('.chat-item').filter({ hasText: 'Noah' }).click({ modifiers: ['Meta'] });
  await page.getByText('2 selected (Shift-click range)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create Cluster', exact: true }).click();
  await page.locator('.prompt-input').fill('Harbor Studio — portfolio website');
  await capture(page, '04-create-cluster.png');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Local AI (llama.cpp)', { exact: true }).waitFor();
  const card = await page.locator('.settings-card').boundingBox();
  const connectors = await page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Connectors', exact: true }) }).boundingBox();
  await capture(page, '07-local-ai.png', page, { clip: { ...card, height: connectors.y + connectors.height - card.y + 12 } });
  await capture(page, '08-local-storage.png', page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Storage', exact: true }) }));

  const onboarding = await openScene({ tutorialCompleted: false });
  await onboarding.getByRole('dialog', { name: 'Getting started' }).waitFor();
  await capture(onboarding, '06-getting-started.png', onboarding.locator('.tutorial-card'));

  if (failures.length) throw new Error(`Renderer errors: ${failures.join('; ')}`);
  if (externalRequests.length) throw new Error(`Unexpected external requests: ${externalRequests.join('; ')}`);
  console.log('Eight screenshots captured; no renderer errors or external requests.');
} finally {
  await browser.close();
}
