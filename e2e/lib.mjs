import { chromium } from 'playwright-core'

export const APP = process.env.APP_URL ?? 'http://127.0.0.1:8095'
export const OUT = new URL('./out/', import.meta.url).pathname
export const launch = () =>
  chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })

export function reporter() {
  const results = []
  const ok = (name, cond, extra = '') => { results.push([!!cond, name]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
  const finish = async (browser) => {
    await browser?.close()
    const failed = results.filter((r) => !r[0])
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    process.exit(failed.length ? 1 : 0)
  }
  return { ok, finish }
}

// The prototype screens call no API, so the sign-in mode can be stubbed to the development identity switch.
// That lets the journey run against any build (the Docker web image or `npm run dev`) whatever mode the API is in.
export async function devPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await page.route('**/api/auth/config', (r) => r.fulfill({ json: { mode: 'dev' } }))
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/404|favicon/i.test(m.text()) && errors.push(m.text()))
  return { ctx, page, errors }
}

export const as = (path, id) => `${APP}${path}${path.includes('?') ? '&' : '?'}as=${id}`
