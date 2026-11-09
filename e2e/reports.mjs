import { chromium } from 'playwright-core'

const PW = process.env.DEMO_USER_PASSWORD
const APP = process.env.APP_URL ?? 'http://127.0.0.1:8095'
const OUT = new URL('./out/', import.meta.url).pathname
let failed = 0
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })

async function login(user) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(APP + '/overview')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/localhost:8180/)
  await page.fill('#username', user); await page.fill('#password', PW); await page.click('#kc-login')
  await page.waitForURL(/127\.0\.0\.1:8095/)
  await page.getByRole('heading', { name: /overview/i }).waitFor()
  return [ctx, page]
}

// manager: sees three reports, not the life-cycle one
let [ctx, page] = await login('procurement.manager')
const nav = await page.locator('nav').innerText()
ok('no screen codes in the menu', !/\bS0[1-9]\b/.test(nav))
ok('Reports is a menu with submenu items', (await page.getByRole('button', { name: /Reports/ }).count()) === 1)
const names = await page.locator('#reports-menu a').allInnerTexts()
ok('manager sees three reports', names.join('|') === 'Risk exposure|Supplier concentration|Actions and decisions', names.join('|'))
await page.getByRole('button', { name: /Reports/ }).click()
ok('the submenu collapses', (await page.locator('#reports-menu').count()) === 0)
await page.getByRole('button', { name: /Reports/ }).click()

await page.getByRole('link', { name: 'Risk exposure' }).click()
await page.getByRole('heading', { name: 'Risk exposure' }).waitFor(); await page.waitForSelector('text=Most serious alerts')
ok('risk exposure lists alerts', (await page.locator('tbody tr').count()) > 5)
await page.screenshot({ path: OUT + 'r1.png', fullPage: true })
await page.getByRole('link', { name: 'Supplier concentration' }).click()
await page.waitForSelector('text=Single-source nodes')
ok('concentration shows wheat by default', (await page.getByRole('heading', { name: /concentration: wheat/ }).count()) === 1)
await page.getByRole('button', { name: 'Tungsten' }).click()
await page.getByRole('heading', { name: /concentration: tungsten/ }).waitFor()
ok('commodity switch changes the report', true)
await page.screenshot({ path: OUT + 'r2.png', fullPage: true })
await page.getByRole('link', { name: 'Actions and decisions' }).click()
await page.waitForSelector('text=Needs attention')
ok('actions report shows overdue and review items', (await page.getByText('days late').count()) > 0)
await page.screenshot({ path: OUT + 'r3.png', fullPage: true })
await page.goto(APP + '/reports/data-lifecycle')
await page.getByRole('heading', { name: 'Access denied' }).waitFor()
ok('manager is denied the life-cycle report', true)
await ctx.close()

// steward: sees the life-cycle report with every check passing
;[ctx, page] = await login('data.steward')
await page.getByRole('link', { name: 'Data life cycle' }).click()
await page.waitForSelector('text=Integrity checks')
const fails = await page.locator('.bad-text').count()
ok('every integrity check passes on the demo data', fails === 0 && (await page.locator('.ok-text').count()) >= 15, `${fails} failing`)
await page.screenshot({ path: OUT + 'r4.png', fullPage: true })
await ctx.close()

await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
