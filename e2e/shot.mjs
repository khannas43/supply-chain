import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await p.goto('http://127.0.0.1:8095/overview')
await p.screenshot({ path: 'out/landing.png' })
await p.getByRole('button', { name: 'Sign in' }).click()
await p.waitForURL(/8180/)
await p.screenshot({ path: 'out/kc.png' })
await b.close()
