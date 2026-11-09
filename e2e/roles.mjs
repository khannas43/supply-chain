import { chromium } from 'playwright-core'
const APP = process.env.APP_URL ?? 'http://127.0.0.1:8095'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const cases = [
  ['u-analyst-a', '/sources', 'Source and pipeline health'], ['u-analyst-a', '/rules', 'Rules and reference data'],
  ['u-steward', '/sources', 'Source and pipeline health'], ['u-steward', '/rules', 'Rules and reference data'],
  ['u-admin', '/sources', 'Source and pipeline health'], ['u-admin', '/rules', 'Rules and reference data'], ['u-admin', '/simulator', 'Simulator control'],
  ['u-demo', '/sources', 'Source and pipeline health'], ['u-demo', '/simulator', 'Simulator control'],
  ['u-manager', '/actions', 'Action register'], ['u-manager', '/response', 'Response comparison'], ['u-viewer', '/overview', 'overview'],
  ['u-manager', '/rules', 'Access denied'], ['u-viewer', '/sources', 'Access denied'], ['u-analyst-a', '/simulator', 'Access denied'],
]
let bad = 0
for (const [as, path, heading] of cases) {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage()
  const failures = []
  page.on('response', (r) => r.status() >= 400 && failures.push(`${r.status()} ${new URL(r.url()).pathname}`))
  await page.goto(`${APP}${path}?as=${as}`)
  await page.getByRole('heading', { name: new RegExp(heading, 'i') }).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const alerts = await page.locator('[role=alert]').allInnerTexts()
  const ok = failures.length === 0 && alerts.length === 0
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${as.padEnd(12)} ${path.padEnd(11)} ${heading}${ok ? '' : '  ' + [...failures, ...alerts].join(' | ')}`)
  await page.context().close()
}
await browser.close()
console.log(bad ? `${bad} problems` : 'all screens load cleanly for every role')
process.exit(bad ? 1 : 0)
