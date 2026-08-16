// Verify every role can open the projects they should, sees a proper notice
// (never a 404) on projects they shouldn't, and never receives foreign data.
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'd:/Work/Samnan'
const OUT = 'C:/Users/EngMo/AppData/Local/Temp/claude/d--Work-Samnan/1f49c4f1-df92-4f52-b741-4b7cffa20290/scratchpad'
const BASE = 'https://samnan-platform.vercel.app'

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const USERS = {
  install: { email: 'test-acc-inst@tfco.sa', pass: 'AccChk#2026i', role: 'installation', name: 'Acc Inst' },
  sales:   { email: 'test-acc-sales@tfco.sa', pass: 'AccChk#2026s', role: 'sales_engineer', name: 'Acc Sales' },
  pm:      { email: 'test-acc-pm@tfco.sa', pass: 'AccChk#2026c', role: 'coordinator', name: 'Acc PM' },
}
async function drop(email) {
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 })
  const u = data?.users?.find(x => x.email === email)
  if (!u) return
  await svc.from('activity_log').delete().eq('user_id', u.id)
  await svc.from('profiles').delete().eq('id', u.id)
  await svc.auth.admin.deleteUser(u.id)
}
const ids = {}
for (const [k, u] of Object.entries(USERS)) {
  await drop(u.email)
  const { data } = await svc.auth.admin.createUser({
    email: u.email, password: u.pass, email_confirm: true,
    user_metadata: { full_name: u.name, role: u.role },
  })
  ids[k] = data.user.id
  await svc.from('profiles').upsert({ id: data.user.id, full_name: u.name, role: u.role, is_active: true })
}

// One project assigned to our test installer + sales, one assigned to nobody
const { data: mine } = await svc.from('projects').insert({
  client_name: 'acc-client-mine', project_name: 'acc-project-mine', status: 'active',
  total_amount: 1000, has_installation: true,
  installation_id: ids.install, sales_engineer_id: ids.sales,
}).select('id').single()
const { data: theirs } = await svc.from('projects').insert({
  client_name: 'acc-client-secret', project_name: 'acc-project-theirs', status: 'active',
  total_amount: 777777, has_installation: true,
}).select('id').single()
await svc.from('payments').insert([
  { project_id: mine.id, type: 'upfront', amount: 1000, paid_amount: 0, status: 'pending' },
  { project_id: theirs.id, type: 'upfront', amount: 777777, paid_amount: 0, status: 'pending' },
])
const temp = [mine.id, theirs.id]

const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }

const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const [key, u] of Object.entries(USERS)) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.fill('input[type="email"]', u.email)
    await page.locator('#password').fill(u.pass)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(5000)

    // their own project (pm sees everything, so "mine" applies to them too)
    const r1 = await page.goto(`${BASE}/projects/${mine.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const t1 = await page.evaluate(() => document.body.innerText)
    check(`${key}: opens an assigned project (no 404)`,
      r1.status() === 200 && t1.includes('acc-project-mine') && !t1.includes('404'),
      `status ${r1.status()}`)

    // a project that is not theirs
    const r2 = await page.goto(`${BASE}/projects/${theirs.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const t2 = await page.evaluate(() => document.body.innerText)
    if (key === 'pm') {
      check('pm: still opens every project (manager scope intact)', t2.includes('acc-project-theirs'))
    } else {
      check(`${key}: gets the notice, NOT a 404`,
        !t2.includes('This page could not be found') && t2.includes('ما عندك صلاحية'),
        `status ${r2.status()} | body: ${t2.replace(/\s+/g, ' ').slice(0, 160)}`)
      check(`${key}: foreign financials stay hidden`, !t2.includes('777,777') && !t2.includes('777777'))
    }
    await page.screenshot({ path: `${OUT}/acc-${key}.png` })
    await ctx.close()
  }
} finally {
  await browser.close()
  await svc.from('payments').delete().in('project_id', temp)
  for (const pid of temp) {
    for (const t of ['activity_log', 'documents', 'materials', 'installations', 'project_notes', 'app_notifications'])
      await svc.from(t).delete().eq('project_id', pid).then(() => {}, () => {})
    await svc.from('projects').delete().eq('id', pid)
  }
  for (const u of Object.values(USERS)) await drop(u.email)
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
}
