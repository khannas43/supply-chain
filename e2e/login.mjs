import { chromium } from 'playwright-core'

const PW = process.env.DEMO_USER_PASSWORD
const APP = process.env.APP_URL ?? 'http://127.0.0.1:8095'
const results = []
const ok = (name, cond, extra = '') => { results.push([cond, name, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })

async function login(page, user, path = '/overview') {
  await page.goto(APP + path)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/localhost:8180/)
  await page.fill('#username', user)
  await page.fill('#password', PW)
  await page.click('#kc-login')
  await page.waitForURL(/127\.0\.0\.1:8095/)
}

// 1. an analyst signs in through Keycloak
let ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
let page = await ctx.newPage()
await page.goto(APP + '/overview')
await page.getByRole('button', { name: 'Sign in' }).waitFor()
ok('signed-out visitor sees the sign-in page', true)
await page.screenshot({ path: new URL('./out/' + Date.now() + '.png', import.meta.url).pathname }).catch(() => undefined)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL(/localhost:8180/)
await page.screenshot({ path: new URL('./out/' + Date.now() + '.png', import.meta.url).pathname }).catch(() => undefined)
await page.fill('#username', 'risk.analyst.a'); await page.fill('#password', 'wrong-password'); await page.click('#kc-login')
await page.getByText(/Invalid username or password/i).waitFor()
ok('a wrong password is refused by Keycloak', true)
await page.fill('#password', PW); await page.click('#kc-login')
await page.waitForURL(/127\.0\.0\.1:8095/)
await page.getByRole('heading', { name: /overview/i }).waitFor()
ok('after login the app opens on the page asked for', page.url() === APP + '/overview', page.url())
ok('the header shows the real user and role', (await page.locator('.devrole').innerText()).includes('Risk Analyst A') && (await page.locator('.devrole').innerText()).includes('Risk Analyst'))
ok('the dev identity switch is gone', (await page.locator('select', { hasText: 'dev switch' }).count()) === 0)
await page.waitForSelector('text=Active alerts')
ok('data loads with the token', (await page.locator('.tile .big').first().innerText()).trim() !== '')
await page.screenshot({ path: new URL('./out/' + Date.now() + '.png', import.meta.url).pathname }).catch(() => undefined)

// a disposition is saved under the name from the token
await page.goto(APP + '/risk?alert=AL-W-001')
await page.getByRole('button', { name: 'Confirmed' }).click()
await page.fill('#rationale', 'Policy text verified against the source')
await page.getByRole('button', { name: /Record confirmed/ }).click()
await page.waitForSelector('text=recorded and added to the audit trail')
ok('an analyst can record a disposition', true)

await page.reload(); await page.getByRole('heading', { name: 'Risk inbox' }).waitFor()
ok('the session survives a reload', await page.locator('.devrole').innerText().then((t) => t.includes('Risk Analyst A')))
ok('an analyst has no Simulator screen', (await page.getByRole('link', { name: /Simulator/ }).count()) === 0)

await page.getByRole('button', { name: 'Sign out' }).click()
await page.waitForURL(/localhost:8180|127\.0\.0\.1:8095/)
await page.goto(APP + '/overview')
await page.getByRole('button', { name: 'Sign in' }).waitFor()
ok('after signing out the sign-in page returns', true)
await ctx.close()

// 2. a user limited to wheat
ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); page = await ctx.newPage()
await login(page, 'wheat.analyst')
await page.getByRole('heading', { name: /overview/i }).waitFor()
ok('a wheat-only user sees only the wheat switch', (await page.locator('.seg button').allInnerTexts()).join('|') === 'Wheat')
ok('and is told so', (await page.locator('.devrole').innerText()).includes('wheat only'))
await page.goto(APP + '/risk'); await page.waitForSelector('text=Port congestion')
const rows = await page.locator('tbody tr').count()
ok('their inbox has only wheat alerts', rows === 2, `${rows} rows`)
const status = await page.evaluate(async () => {
  const k = Object.keys(sessionStorage).find((x) => x.startsWith('oidc.user:'))
  const t = JSON.parse(sessionStorage.getItem(k)).access_token
  const get = async (p) => (await fetch('/api' + p, { headers: { Authorization: 'Bearer ' + t } })).status
  return { tungstenAlert: await get('/alerts/AL-T-001'), tungstenOverview: await get('/overview?commodity=tungsten'), wheatAlert: await get('/alerts/AL-W-001') }
})
ok('the API hides the other commodity from them', status.tungstenAlert === 404 && status.tungstenOverview === 404 && status.wheatAlert === 200, JSON.stringify(status))
await ctx.close()

// 3. a viewer
ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); page = await ctx.newPage()
await login(page, 'executive.viewer')
await page.getByRole('heading', { name: /overview/i }).waitFor()
const nav = await page.locator('nav a').allInnerTexts()
ok('a viewer has no source, rules or simulator screens', !nav.some((t) => /Source health|Rules and data|Simulator/.test(t)), nav.join(', '))
await page.goto(APP + '/sources')
await page.getByRole('heading', { name: 'Access denied' }).waitFor()
ok('and is told so when opening one by address', true)
await ctx.close()

// 4. an admin
ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); page = await ctx.newPage()
await login(page, 'platform.admin', '/sources')
await page.getByRole('heading', { name: /Source and pipeline health/ }).waitFor()
ok('a deep link survives the login', new URL(page.url()).pathname === '/sources', page.url())
await page.waitForSelector('text=Pause')
ok('an admin can pause sources', (await page.getByRole('button', { name: 'Pause' }).count()) > 0)
await page.goto(APP + '/simulator'); await page.getByRole('heading', { name: 'Simulator control' }).waitFor()
ok('and reaches the simulator', true)
await ctx.close()

await browser.close()
const failed = results.filter((r) => !r[0])
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
