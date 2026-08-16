// Confirm the two newly-deployed fixes are actually live in production:
//  1. materials % on the projects list is stage-based (was always 0%)
//  2. Excel is offered in the attachments file picker
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'd:/Work/Samnan'
const OUT = 'C:/Users/EngMo/AppData/Local/Temp/claude/d--Work-Samnan/1f49c4f1-df92-4f52-b741-4b7cffa20290/scratchpad'
const BASE = 'https://samnan-platform.vercel.app'
const EMAIL = 'test-live-check@tfco.sa'
const PASS = 'LiveChk#2026x'

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
  user_metadata: { full_name: 'Live Check', role: 'admin' },
})
await svc.from('profiles').upsert({ id: created.user.id, full_name: 'Live Check', role: 'admin', is_active: true })

// A project whose materials are delivered — it must no longer read 0%
const { data: mats } = await svc.from('materials').select('project_id').eq('status', 'delivered').limit(1)
const { data: proj } = await svc.from('projects').select('id, project_name').eq('id', mats[0].project_id).single()

const browser = await chromium.launch({ channel: 'chrome' })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
try {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', EMAIL)
  await page.locator('#password').fill(PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 25000 })

  // ── 1. materials % on the projects list ──
  await page.goto(BASE + '/projects', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll('input')].find(i => i.placeholder?.includes('ابحث'))
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, name)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, proj.project_name)
  await page.waitForTimeout(1200)
  const cardText = await page.evaluate(() => document.body.innerText)
  const matMatch = cardText.match(/المواد[\s\S]{0,40}?(\d+)%/)
  const materialsPct = matMatch ? Number(matMatch[1]) : null
  console.log(`materials % for a DELIVERED project ("${proj.project_name}"):`, materialsPct, materialsPct === 100 ? 'PASS' : 'CHECK')
  await page.screenshot({ path: OUT + '/live-progress.png' })

  // ── 2. Excel accepted by the attachments picker ──
  await page.goto(`${BASE}/projects/${proj.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('المرفقات') && x.offsetParent)
    b?.click()
  })
  await page.waitForTimeout(900)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('رفع ملفات') && x.offsetParent)
    b?.click()
  })
  await page.waitForTimeout(700)
  const accepts = await page.evaluate(() =>
    [...document.querySelectorAll('input[type=file]')].map(i => i.getAttribute('accept')).filter(Boolean))
  const excelOk = accepts.some(a => a.includes('.xlsx'))
  console.log('file picker accepts Excel:', excelOk ? 'PASS' : 'FAIL', '|', accepts[accepts.length - 1]?.slice(0, 90))
  const hint = await page.evaluate(() => document.body.innerText.includes('Excel'))
  console.log('hint text mentions Excel:', hint ? 'PASS' : 'FAIL')
  await page.screenshot({ path: OUT + '/live-excel.png' })
} finally {
  await browser.close()
  await drop()
  console.log('cleaned up')
}
