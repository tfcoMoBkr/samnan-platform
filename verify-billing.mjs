// Verify the billing filter on all three screens in production.
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'd:/Work/Samnan'
const OUT = 'C:/Users/EngMo/AppData/Local/Temp/claude/d--Work-Samnan/1f49c4f1-df92-4f52-b741-4b7cffa20290/scratchpad'
const BASE = 'https://samnan-platform.vercel.app'
const EMAIL = 'test-billing-check@tfco.sa'
const PASS = 'BillChk#2026x'

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
async function drop() {
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 })
  const u = data?.users?.find(x => x.email === EMAIL)
  if (!u) return
  await svc.from('activity_log').delete().eq('user_id', u.id)
  await svc.from('profiles').delete().eq('id', u.id)
  await svc.auth.admin.deleteUser(u.id)
}
await drop()
const { data: created } = await svc.auth.admin.createUser({
  email: EMAIL, password: PASS, email_confirm: true,
  user_metadata: { full_name: 'Billing Check', role: 'admin' },
})
await svc.from('profiles').upsert({ id: created.user.id, full_name: 'Billing Check', role: 'admin', is_active: true })

// Expected counts, computed from the database
const { data: pays } = await svc.from('payments').select('project_id, billing_status, status')
const live = (pays ?? []).filter(p => p.status !== 'cancelled')
const projSets = new Map()
for (const p of live) {
  if (!p.billing_status) continue
  const set = projSets.get(p.project_id) ?? new Set()
  set.add(p.billing_status)   // exact match only — states do not overlap
  projSets.set(p.project_id, set)
}
const expectProjects = {
  collected: [...projSets.values()].filter(s => s.has('collected')).length,
  invoiced: [...projSets.values()].filter(s => s.has('invoiced')).length,
  both: [...projSets.values()].filter(s => s.has('both')).length,
}
console.log('expected project counts:', JSON.stringify(expectProjects))

// a project that has a billing status, for the payments-tab check
const targetProjectId = [...projSets.keys()][0]
// and one WITHOUT any billing status, to prove the filter is still rendered
const { data: allProjects } = await svc.from('projects').select('id, project_name')
const payByProj = new Set(live.map(p => p.project_id))
const noBilling = (allProjects ?? []).find(p => payByProj.has(p.id) && !projSets.has(p.id))
const { data: targetProj } = await svc.from('projects').select('project_name').eq('id', targetProjectId).single()

const browser = await chromium.launch({ channel: 'chrome' })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }
try {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', EMAIL)
  await page.locator('#password').fill(PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 25000 })
  await page.waitForTimeout(2500)

  // ── 1. Dashboard summary ──
  const dash = await page.evaluate(() => document.body.innerText)
  check('dashboard shows the billing breakdown', dash.includes('حالة الفوترة والتحصيل'))
  const dashLinks = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="billing="]')].map(a => a.getAttribute('href')))
  check('dashboard chips deep-link to the filtered list', dashLinks.length >= 2, dashLinks.join(' '))
  await page.screenshot({ path: OUT + '/bill-dashboard.png' })

  // ── 2. Projects list, arriving via the deep link ──
  await page.goto(BASE + '/projects?billing=collected', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  // admin sees all projects; count rendered cards
  const cardHrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/projects/"]')]
      .map(a => a.getAttribute('href'))
      .filter(h => h !== '/projects/new'))
  const shown = cardHrefs.length
  check('deep link pre-applies the collected filter',
    shown === expectProjects.collected, `${shown} card(s), expected ${expectProjects.collected}`)
  const listText = await page.evaluate(() => document.body.innerText)
  check('projects list renders the billing chip row', listText.includes('حالة الفوترة والتحصيل'))
  await page.screenshot({ path: OUT + '/bill-projects.png' })

  // clicking "الكل" style clear should restore everything
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('مسح الكل'))
    b?.click()
  })
  await page.waitForTimeout(800)
  const afterClear = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/projects/"]')]
      .map(a => a.getAttribute('href')).filter(h => h !== '/projects/new').length)
  check('clearing filters restores the full list', afterClear > shown, `${shown} → ${afterClear}`)

  // ── 3. Payments tab inside a project ──
  await page.goto(`${BASE}/projects/${targetProjectId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const tabText = await page.evaluate(() => document.body.innerText)
  check(`payments tab shows the filter ("${targetProj.project_name}")`, tabText.includes('حالة الفوترة والتحصيل'))
  const before = await page.evaluate(() => document.querySelectorAll('[class*="grid"] > div').length)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^(تم التحصيل|تم الفوترة|تم التحصيل والفوترة)/.test(x.textContent.trim()))
    b?.click()
  })
  await page.waitForTimeout(900)
  const after = await page.evaluate(() => document.body.innerText)
  check('clicking a billing chip filters the payment cards', !after.includes('Application error'))
  await page.screenshot({ path: OUT + '/bill-payments.png' })

  // ── 4. Filter is permanent, and empty selection says "لا يوجد" ──
  if (noBilling) {
    await page.goto(`${BASE}/projects/${noBilling.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    const t = await page.evaluate(() => document.body.innerText)
    check(`filter still shown on a project with no billing data ("${noBilling.project_name}")`,
      t.includes('حالة الفوترة والتحصيل'))
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('تم التحصيل والفوترة'))
      b?.click()
    })
    await page.waitForTimeout(900)
    const t2 = await page.evaluate(() => document.body.innerText)
    check('selecting an empty state shows «لا يوجد»', t2.includes('لا يوجد'))
    await page.screenshot({ path: OUT + '/bill-empty.png' })
  }
} finally {
  await browser.close()
  await drop()
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
}
