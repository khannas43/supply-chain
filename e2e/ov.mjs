import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
await p.goto('http://127.0.0.1:8095/overview'); await p.getByRole('button', { name: 'Sign in' }).click()
await p.waitForURL(/8180/); await p.fill('#username', 'procurement.manager'); await p.fill('#password', process.env.DEMO_USER_PASSWORD); await p.click('#kc-login')
await p.waitForSelector('text=Alerts by severity'); await p.waitForTimeout(1500); await p.screenshot({ path: 'out/ov-wheat.png', fullPage: true })
await p.getByRole('button', { name: 'Tungsten' }).click(); await p.waitForTimeout(2000); await p.screenshot({ path: 'out/ov-tungsten.png', fullPage: true })
await b.close()
