// Sign-in through Keycloak, and what each kind of user sees afterwards.
// Needs the stack running with Keycloak (the default) and DEMO_USER_PASSWORD set.
import { APP, launch, reporter } from './lib.mjs'

const PW = process.env.DEMO_USER_PASSWORD
if (!PW) { console.error('Set DEMO_USER_PASSWORD (see .env).'); process.exit(2) }
const { ok, finish } = reporter()
const browser = await launch()
const origin = new URL(APP).origin.replace(/[.]/g, '\\.')

async function login(page, user, path = '/market') {
  await page.goto(APP + path)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/localhost:8180/)
  await page.fill('#username', user); await page.fill('#password', PW); await page.click('#kc-login')
  await page.waitForURL(new RegExp(origin))
}
const apiStatus = (page, paths) => page.evaluate(async (ps) => {
  const k = Object.keys(sessionStorage).find((x) => x.startsWith('oidc.user:'))
  const t = JSON.parse(sessionStorage.getItem(k)).access_token
  const out = {}
  for (const [name, p] of Object.entries(ps)) out[name] = (await fetch('/api' + p, { headers: { Authorization: 'Bearer ' + t } })).status
  return out
}, paths)

// 1. an analyst signs in
let ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
let page = await ctx.newPage()
await page.goto(APP + '/market')
await page.getByRole('button', { name: 'Sign in' }).waitFor()
ok('a signed-out visitor sees the sign-in page', true)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL(/localhost:8180/)
await page.fill('#username', 'risk.analyst.a'); await page.fill('#password', 'wrong-password'); await page.click('#kc-login')
await page.getByText(/Invalid username or password/i).waitFor()
ok('a wrong password is refused by Keycloak', true)
await page.fill('#password', PW); await page.click('#kc-login')
await page.waitForURL(new RegExp(origin))
await page.getByRole('heading', { name: /market overview/i }).waitFor()
ok('after login the app opens on the page asked for', page.url() === APP + '/market', page.url())
const who = await page.locator('.devrole').innerText()
ok('the header shows the real user and role', who.includes('Risk Analyst A') && who.includes('Risk Analyst'))
ok('the development identity switch is gone', (await page.locator('select', { hasText: 'dev switch' }).count()) === 0)
const s1 = await apiStatus(page, { overview: '/overview?commodity=tungsten' })
ok('a protected API call works with the token', s1.overview === 200, JSON.stringify(s1))

// a settings change is logged under the name in the token
await page.goto(APP + '/configuration'); await page.waitForSelector('#cfg-limit')
await page.fill('#cfg-limit', '9'); await page.getByRole('button', { name: 'Save', exact: true }).click()
ok('a settings change is logged under the signed-in name', (await page.locator('section:has(h2:text("Change log")) tbody').innerText()).includes('Risk Analyst A'))
await page.reload(); await page.getByRole('heading', { name: 'Configuration' }).waitFor()
ok('the session survives a reload', (await page.locator('.devrole').innerText()).includes('Risk Analyst A'))
ok('an analyst has no Simulator screen', (await page.getByRole('link', { name: /Simulator/ }).count()) === 0)

await page.getByRole('button', { name: 'Sign out' }).click()
await page.waitForURL(/localhost:8180|127\.0\.0\.1/)
await page.goto(APP + '/market')
await page.getByRole('button', { name: 'Sign in' }).waitFor()
ok('after signing out the sign-in page returns', true)
await ctx.close()

// 2. a user limited to tungsten
ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); page = await ctx.newPage()
await login(page, 'tungsten.analyst')
await page.getByRole('heading', { name: /market overview/i }).waitFor()
ok('a tungsten-only user sees the tungsten switch', (await page.locator('.seg button').allInnerTexts()).join('|') === 'Tungsten')
ok('and is told so', (await page.locator('.devrole').innerText()).includes('tungsten only'))
const s2 = await apiStatus(page, { alert: '/alerts/AL-T-001', overview: '/overview?commodity=tungsten', retired: '/overview?commodity=wheat' })
ok('the API serves tungsten and rejects the retired commodity', s2.alert === 200 && s2.overview === 200 && s2.retired === 422, JSON.stringify(s2))
await ctx.close()

// 3. a viewer
ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); page = await ctx.newPage()
await login(page, 'executive.viewer')
await page.getByRole('heading', { name: /market overview/i }).waitFor()
const nav = await page.locator('nav a').allInnerTexts()
ok('a viewer sees the market, dashboard, requirement, comparison and stress test', ['Market overview', 'Supplier dashboard', 'Requirement', 'Comparison', 'Stress test'].every((n) => nav.includes(n)), nav.join(', '))
ok('and no data, decision, master, review, configuration or admin screens', !nav.some((t) => /Data & quotes|Decision & pack|Supplier master|Data review|Configuration|Source health|Rules and data|Simulator/.test(t)), nav.join(', '))
await page.goto(APP + '/configuration')
await page.getByRole('heading', { name: 'Access denied' }).waitFor()
ok('and is told so when opening one by address', true)
await ctx.close()

// 4. an admin
ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); page = await ctx.newPage()
await login(page, 'platform.admin', '/configuration')
await page.getByRole('heading', { name: 'Configuration' }).waitFor()
ok('a deep link survives the login', new URL(page.url()).pathname === '/configuration', page.url())
ok('an admin can change the comparison limit', await page.locator('#cfg-limit').isEnabled())
await page.goto(APP + '/sources'); await page.getByRole('heading', { name: /Source and pipeline health/ }).waitFor(); await page.waitForSelector('text=Pause')
ok('an admin can pause sources', (await page.getByRole('button', { name: 'Pause' }).count()) > 0)
await page.goto(APP + '/simulator'); await page.getByRole('heading', { name: 'Simulator control' }).waitFor()
ok('and reaches the simulator', true)
await ctx.close()

await finish(browser)
