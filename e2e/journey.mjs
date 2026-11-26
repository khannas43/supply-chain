// Browser journey through the tungsten prototype screens. It checks the worked example from the
// Scope of Work, the rules that gate a recommendation, and the screens that maintain the data.
// Usage:  node journey.mjs            (APP_URL defaults to the Docker web app on 8095)
import { APP, OUT, as, devPage, launch, reporter } from './lib.mjs'

const { ok, finish } = reporter()
const browser = await launch()
const A = 'u-demo'

// ---- 1. dashboard, map, profile, requirement and the comparison limit ----
{
  const { ctx, page: p, errors } = await devPage(browser)
  await p.goto(`${APP}/?as=${A}`); await p.waitForSelector('canvas')
  ok('the app opens on the market overview', new URL(p.url()).pathname === '/market')
  ok('market overview draws its charts', (await p.locator('canvas').count()) >= 3)
  ok('retired screens are not in the menu', !(await p.locator('nav').innerText()).match(/Risk inbox|Supplier network|Impact assessment|Response comparison|Risk exposure/))
  for (const hidden of ['/risk', '/network', '/impact', '/response', '/reports/risk-exposure', '/overview']) {
    await p.goto(as(hidden, A)); await p.waitForTimeout(300)
    ok(`${hidden} is hidden and redirects to the market overview`, new URL(p.url()).pathname === '/market')
  }

  await p.goto(as('/suppliers', A)); await p.waitForSelector('table')
  ok('the dashboard lists all 14 suppliers', (await p.locator('tbody tr').count()) === 14)
  await p.getByRole('tab', { name: 'Map' }).click(); await p.waitForSelector('canvas'); await p.waitForTimeout(700)
  ok('the map renders', (await p.locator('canvas').count()) > 0)
  await p.selectOption('.filters select >> nth=2', 'yes'); await p.waitForTimeout(300)
  ok('the map follows the filters (3 emerging suppliers)', /3 of 14 suppliers/.test(await p.locator('text=/of 14 suppliers/').innerText()))
  await p.getByRole('tab', { name: 'List' }).click(); await p.selectOption('.filters select >> nth=2', 'any')

  await p.getByRole('link', { name: 'Eyre Basin Tungsten' }).click(); await p.waitForURL(/suppliers\/E/)
  ok('a supplier opens as a full screen', await p.getByRole('heading', { name: 'Eyre Basin Tungsten' }).isVisible())
  ok('the profile shows a source and date for each item', (await p.locator('section:has(h2:text("Status, origin")) tbody tr').count()) >= 8)
  await p.getByRole('button', { name: 'Remove from comparison' }).click()
  ok('the profile adds and removes the supplier', await p.getByRole('button', { name: 'Add to comparison' }).isVisible())
  await p.goto(as('/suppliers/ZZ', A))
  ok('an unknown supplier is handled', await p.getByText('Supplier not found').first().isVisible())

  await p.goto(as('/requirement', A)); await p.waitForSelector('#r-vol')
  await p.fill('#r-vol', '')
  ok('an empty volume is rejected', await p.getByText('Enter a volume above zero.').isVisible())
  await p.fill('#r-vol', '50')

  await p.goto(as('/configuration', A)); await p.waitForSelector('#cfg-limit')
  await p.fill('#cfg-limit', '1')
  ok('a limit of 1 is rejected', await p.getByRole('button', { name: 'Save', exact: true }).isDisabled())
  await p.fill('#cfg-limit', '4'); await p.getByRole('button', { name: 'Save', exact: true }).click()
  ok('the limit is saved and logged', (await p.locator('section:has(h2:text("Change log")) tbody tr').count()) === 1)
  await p.goto(as('/comparison', A))
  ok('over the limit, the comparison pauses', (await p.getByText('configured limit is 4').isVisible()) && (await p.locator('table.rank').count()) === 0)
  await p.goto(as('/suppliers', A)); await p.waitForSelector('table')
  ok('selection stops at the limit', await p.locator('tbody input[type=checkbox]:not(:checked)').first().isDisabled())

  await p.goto(as('/configuration', A)); await p.fill('#cfg-limit', '10'); await p.getByRole('button', { name: 'Save', exact: true }).click()
  await p.goto(as('/suppliers', A)); await p.waitForSelector('table')
  for (const id of ['E', 'G', 'H', 'I', 'J']) {
    const cb = p.locator('tbody tr', { has: p.locator(`a[href="/suppliers/${id}"]`) }).locator('input')
    if (!(await cb.isChecked())) await cb.check()
  }
  await p.getByRole('link', { name: 'Continue' }).click(); await p.waitForURL(/requirement/)
  await p.getByRole('link', { name: /Continue to data/ }).click(); await p.waitForURL(/data/)
  await p.goto(as('/comparison', A))
  const t0 = Date.now(); await p.waitForSelector('table.rank'); const ms = Date.now() - t0
  ok('a comparison at the limit of ten loads within three seconds', ms < 3000, `${ms} ms`)
  ok('no script errors in the journey', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---- 2. quotes, comparison, stress test, decision and pack ----
{
  const { ctx, page: p, errors } = await devPage(browser)
  const txt = async (sel) => (await p.locator(sel).first().innerText()).replace(/\s+/g, ' ')

  await p.goto(as('/comparison', A)); await p.waitForSelector('table.rank')
  const body = await p.locator('table.rank').innerText()
  ok('worked example: landed costs match (A 2,060,000; B 2,115,000; C 2,095,000)', ['2,060,000', '2,115,000', '2,095,000'].every((v) => body.includes(v)))
  const order = await p.locator('table.rank tbody tr td:nth-child(2) a').allInnerTexts()
  ok('worked example: ranking is A, C, E, B', order.join('|') === 'Ardenne Tungsten Refining|Costa Alta Mining|Eyre Basin Tungsten|Bao Viet Tungsten', order.join('|'))
  const notRanked = await txt('section:has(h2:text("Not ranked"))')
  ok('worked example: D is excluded by the sanctions knock-out, F lacks data', notRanked.includes('Sanctions match') && notRanked.includes('Insufficient data'))
  ok('E is marked indicative', (await p.locator('.badge.b-warn:text("Indicative")').count()) >= 1)
  await p.locator('#w-price').fill('10'); await p.locator('#w-security').fill('70')
  ok('weights that do not total 100% are refused', await p.getByText(/must equal 100%/).isVisible())
  await p.getByRole('button', { name: 'Security-led' }).click()
  ok('a named profile sets the weights', (await p.locator('#w-security').inputValue()) === '45')
  await p.getByRole('button', { name: 'Reset to defaults' }).click()
  ok('trade-offs and robustness are shown', (await p.getByRole('heading', { name: 'Trade-offs in plain language' }).isVisible()) && (await p.getByRole('heading', { name: 'Robustness check' }).isVisible()))

  await p.goto(as('/data', A))
  await p.getByRole('button', { name: 'Use the sample file' }).click(); await p.waitForSelector('text=Row check')
  ok('three sample rows are rejected', (await p.locator('.badge.b-bad:text("Rejected")').count()) === 3)
  ok('a price per kg is converted to per tonne', await p.getByText('converted from per kg to per tonne').isVisible())
  await p.getByRole('button', { name: /Approve and load 6/ }).click()
  ok('rejected rows go to Data review', await p.getByText('3 rejected rows sent to Data review').isVisible())
  await p.getByRole('button', { name: 'Use the sample file' }).click(); await p.getByRole('button', { name: /Approve and load 6/ }).click()
  await p.goto(as('/review', A)); await p.waitForSelector('h1')
  ok('loading the same file again queues no duplicates', (await p.locator('section[aria-label^="Review item"]').count()) === 5)

  await p.goto(as('/stress', A)); await p.waitForSelector('text=Baseline and scenario ranking')
  await p.locator('#sc-sev').fill('100'); await p.waitForTimeout(200)
  const stressRows = await p.locator('section:has(h2:text("Baseline and scenario ranking")) tbody tr').allInnerTexts()
  ok('the stress test re-ranks: the China-dependent supplier falls hardest', stressRows[stressRows.length - 1].includes('Bao Viet') && stressRows[0].includes('Costa Alta'), stressRows.map((r) => r.slice(0, 12)).join(' / '))

  await p.goto(as('/decision', A)); await p.waitForSelector('#rec')
  await p.selectOption('#rec', { index: 1 })
  ok('submitting needs a rationale', await p.getByRole('button', { name: 'Submit for review' }).isDisabled())
  await p.fill('#why', 'Lowest landed cost with green ratings on every dimension.')
  await p.getByRole('button', { name: 'Submit for review' }).click()
  ok('the person who recorded cannot review', await p.getByText('you cannot review it').isVisible())
  ok('a pack cannot be issued before the review', await p.getByRole('button', { name: /Issue pack version 1/ }).isDisabled())
  await p.goto(as('/decision', 'u-analyst-a')); await p.waitForSelector('#rec')
  await p.getByRole('button', { name: 'Confirm the comparison and pack' }).click()
  await p.getByRole('button', { name: /Issue pack version 1/ }).click()
  await p.getByRole('button', { name: 'Open', exact: true }).click(); await p.waitForSelector('[aria-label="Issued pack version 1"]')
  ok('the issued pack has its eight sections', (await p.locator('.pack h3').count()) === 8)
  const before = await p.locator('.pack').innerText()
  await p.goto(as('/comparison', 'u-analyst-a')); await p.getByRole('button', { name: 'Cost-led' }).click()
  await p.goto(as('/decision', 'u-analyst-a')); await p.getByRole('button', { name: 'Open', exact: true }).click()
  ok('an issued pack does not change when weightings change', (await p.locator('.pack').innerText()) === before)
  await p.screenshot({ path: OUT + 'pack.png', fullPage: true }).catch(() => undefined)
  ok('no script errors in the journey', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---- 3. data review and supplier master ----
{
  const { ctx, page: p, errors } = await devPage(browser)
  await p.goto(as('/data', A))
  await p.getByRole('button', { name: 'Use the sample file' }).click(); await p.getByRole('button', { name: /Approve and load 6/ }).click()
  await p.goto(as('/review', A)); await p.waitForSelector('h1')
  const item = (heading) => p.locator('section[aria-label^="Review item"]', { hasText: heading })

  const amb = item('Ambiguous supplier: Jackson Ridge')
  await amb.locator('select').selectOption('J'); await amb.getByRole('button', { name: 'Link and replay' }).click(); await p.waitForTimeout(300)
  await p.getByRole('tab', { name: 'Closed' }).click()
  ok('an ambiguous name is resolved by linking it to a master record', await item('Jackson Ridge').getByText('Resolved').first().isVisible())
  await p.getByRole('tab', { name: 'Open' }).click()

  const eur = item('Unrecognised currency')
  await eur.getByLabel('currency').fill('USD'); await eur.getByLabel('price_usd_per_t').fill('36500')
  await eur.getByRole('button', { name: /Save correction and replay/ }).click(); await p.waitForTimeout(300)
  await p.getByRole('tab', { name: 'Closed' }).click()
  ok('a corrected row is replayed and its quote loads', (await item('Illimani').getByText('Resolved').first().isVisible()) && (await item('Illimani').getByText(/Corrected price/).isVisible()))
  await p.getByRole('tab', { name: 'Open' }).click()

  await item('Registry match to confirm: Fergana').getByRole('button', { name: 'Confirm this match' }).first().click(); await p.waitForTimeout(300)
  await p.goto(as('/master?s=F', A)); await p.waitForSelector('#m-reg-id')
  ok('a confirmed registry match is stored on the supplier', (await p.locator('#m-reg-id').inputValue()).startsWith('C05-W-90'))

  await p.goto(as('/review', A)); await item('Unknown supplier: Unknown Metals').getByRole('link', { name: /add to the master/ }).click()
  await p.waitForURL(/master\?new=1/)
  ok('the new-supplier form is prefilled from the review item', (await p.locator('#n-name').inputValue()) === 'Unknown Metals Ltd')
  await p.fill('#n-country', 'Chile'); await p.getByRole('button', { name: 'Create supplier' }).click()
  await p.waitForSelector('h2:has-text("Unknown Metals Ltd")')
  await p.goto(as('/review', A))
  ok('the new supplier can be linked from the review item', (await item('Unknown supplier: Unknown Metals').locator('select option').allInnerTexts()).some((o) => o.includes('Unknown Metals Ltd')))

  await p.goto(as('/master?s=A', A)); await p.waitForSelector('#m-lei')
  await p.fill('#m-lei', 'SHORT'); await p.getByRole('button', { name: 'Save changes' }).click()
  ok('a malformed LEI is rejected', await p.getByText('A LEI has 20 letters and digits.').isVisible())
  await p.fill('#m-lei', 'REPRESENTATIVE00000A')
  await p.fill('#m-alias', 'Bao Viet Tungsten'); await p.getByRole('button', { name: 'Add', exact: true }).click()
  ok('an alias that belongs to another supplier is blocked', await p.getByText(/already identifies Bao Viet Tungsten/).isVisible())
  await p.fill('#m-alias', 'Ardenne Refining AT'); await p.getByRole('button', { name: 'Add', exact: true }).click()
  await p.getByRole('button', { name: 'Save changes' }).click()
  ok('a change is saved as a new version', await p.getByText(/Saved as version 2/).isVisible())
  await p.selectOption('#q-form', 'WO3'); await p.getByRole('button', { name: 'Record', exact: true }).click()
  ok('a qualified status needs evidence and a confirming person', await p.getByText('needs evidence and the confirming person').isVisible())
  await p.fill('#q-ev', 'Cert WQ-77'); await p.fill('#q-by', 'Engineering Lead'); await p.getByRole('button', { name: 'Record', exact: true }).click()
  await p.waitForTimeout(200)
  ok('the qualification is recorded with evidence and both people', (await p.getByRole('cell', { name: 'Cert WQ-77', exact: true }).isVisible()) && (await p.getByRole('cell', { name: 'Engineering Lead', exact: true }).first().isVisible()))
  ok('no script errors in the journey', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await finish(browser)
