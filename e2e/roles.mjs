// Every screen against every role: it loads cleanly for the roles allowed to see it and says so for the others.
// Needs the API in dev mode (identity override):  AUTH_MODE=dev docker compose up -d api
// Restore the normal mode afterwards:             docker compose up -d api
import { APP, launch, reporter } from './lib.mjs'

const { ok, finish } = reporter()
const browser = await launch()

const ALL = ['u-viewer', 'u-analyst-a', 'u-manager', 'u-steward', 'u-admin', 'u-demo']
const TEAM = ['u-analyst-a', 'u-steward', 'u-admin', 'u-demo']
const NOT_TEAM = ['u-viewer', 'u-manager']
const screens = [
  // the tungsten purchasing screens
  ['/market', 'Market overview', ALL], ['/suppliers', 'Supplier dashboard', ALL], ['/suppliers/A', 'Ardenne Tungsten Refining', ALL],
  ['/requirement', 'Requirement', ALL], ['/comparison', 'Comparison', ALL], ['/stress', 'Stress test', ALL],
  ['/decision', 'Decision & pack', ['u-analyst-a', 'u-manager', 'u-steward', 'u-admin', 'u-demo']],
  ['/data', 'Data & quotes', TEAM], ['/review', 'Data review', TEAM], ['/master', 'Supplier master', TEAM], ['/configuration', 'Configuration', TEAM],
  // screens kept from the first build
  ['/actions', 'Action register', ALL], ['/sources', 'Source and pipeline health', ['u-analyst-a', 'u-steward', 'u-admin', 'u-demo']],
  ['/rules', 'Rules and reference data', ['u-analyst-a', 'u-steward', 'u-admin']], ['/simulator', 'Simulator control', ['u-admin', 'u-demo']],
]
const denied = { '/decision': ['u-viewer'], '/data': NOT_TEAM, '/review': NOT_TEAM, '/master': NOT_TEAM, '/configuration': NOT_TEAM, '/sources': ['u-viewer', 'u-manager'], '/rules': ['u-viewer', 'u-manager', 'u-demo'], '/simulator': ['u-viewer', 'u-manager', 'u-analyst-a', 'u-steward'] }
// screens moved to Phase 2: the address still works, but lands on the market overview
const hidden = ['/risk', '/network', '/impact', '/response', '/overview', '/reports/risk-exposure', '/reports/supplier-concentration', '/reports/actions', '/reports/data-lifecycle']

async function open(as, path, heading) {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage()
  const failures = []
  page.on('response', (r) => r.status() >= 400 && !r.url().includes('favicon') && failures.push(`${r.status()} ${new URL(r.url()).pathname}`))
  await page.goto(`${APP}${path}?as=${as}`)
  const found = await page.getByRole('heading', { name: new RegExp(heading, 'i') }).first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  await page.waitForTimeout(800)
  const alerts = await page.locator('[role=alert]').allInnerTexts()
  const url = new URL(page.url()).pathname
  await page.context().close()
  return { found, failures, alerts, url }
}

for (const [path, heading, allowed] of screens) {
  for (const as of ALL) {
    if (allowed.includes(as)) {
      const r = await open(as, path, heading)
      ok(`${as.padEnd(12)} ${path.padEnd(15)} loads cleanly`, r.found && r.failures.length === 0 && r.alerts.length === 0, [...r.failures, ...r.alerts, r.found ? '' : 'heading not found'].filter(Boolean).join(' | '))
    } else if (denied[path]?.includes(as)) {
      const r = await open(as, path, 'Access denied')
      ok(`${as.padEnd(12)} ${path.padEnd(15)} is told access is denied`, r.found)
    }
  }
}
for (const path of hidden) {
  const r = await open('u-admin', path, 'Market overview')
  ok(`${path.padEnd(32)} is hidden and lands on the market overview`, r.found && r.url === '/market', r.url)
}
await finish(browser)
