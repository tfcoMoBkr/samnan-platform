import { test, expect } from '@playwright/test'

const TEST_USERS = {
  coordinator: {
    email: process.env.E2E_COORDINATOR_EMAIL || '',
    password: process.env.E2E_COORDINATOR_PASSWORD || '',
    redirectTo: '/dashboard',
  },
  admin: {
    email: process.env.E2E_ADMIN_EMAIL || '',
    password: process.env.E2E_ADMIN_PASSWORD || '',
    redirectTo: '/dashboard',
  },
  installation: {
    email: process.env.E2E_INSTALLATION_EMAIL || '',
    password: process.env.E2E_INSTALLATION_PASSWORD || '',
    redirectTo: '/installation',
  },
}

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('displays Arabic login form', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('أهلاً بك')
    await expect(page.locator('input[name="email"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toContainText('تسجيل الدخول')
  })

  test('shows brand panel on desktop', async ({ page, isMobile }) => {
    test.skip(isMobile, 'brand panel is hidden on small screens by design')
    await expect(page.locator('text=منصة الإدارة')).toBeVisible()
  })

  test('shows error for invalid credentials', async ({ page }) => {
    await page.fill('input[name="email"]', 'invalid@test.com')
    await page.fill('input[name="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    await expect(page.getByText('البريد الإلكتروني أو كلمة المرور غير صحيحة').first())
      .toBeVisible({ timeout: 8000 })
  })

  test('shows error for empty form submission', async ({ page }) => {
    await page.click('button[type="submit"]')
    // HTML5 validation prevents submission
    const emailInput = page.locator('input[name="email"]')
    await expect(emailInput).toHaveAttribute('required')
  })

  test('redirects to /login when accessing /dashboard unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects to /login when accessing /projects unauthenticated', async ({ page }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects to /login when accessing /users unauthenticated', async ({ page }) => {
    await page.goto('/users')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects to /login when accessing /installation unauthenticated', async ({ page }) => {
    await page.goto('/installation')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Signup page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/signup')
  })

  test('displays Arabic signup form', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('إنشاء حساب')
    await expect(page.locator('input[name="full_name"]')).toBeVisible()
    await expect(page.locator('input[name="email"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    await expect(page.locator('input[name="confirm_password"]')).toBeVisible()
  })

  test('does not offer supply role', async ({ page }) => {
    await expect(page.locator('option[value="supply"]')).toHaveCount(0)
  })

  // <option>s inside a closed <select> are never "visible" to Playwright, so
  // assert presence instead.
  test('offers all valid roles', async ({ page }) => {
    await expect(page.locator('option[value="coordinator"]')).toHaveCount(1)
    await expect(page.locator('option[value="sales_engineer"]')).toHaveCount(1)
    await expect(page.locator('option[value="installation"]')).toHaveCount(1)
    await expect(page.locator('option[value="admin"]')).toHaveCount(1)
  })

  test('shows error when passwords do not match', async ({ page }) => {
    await page.fill('input[name="full_name"]', 'Test User')
    await page.fill('input[name="email"]', 'test@test.com')
    await page.selectOption('select[name="role"]', 'coordinator')
    await page.fill('input[name="password"]', 'password123')
    await page.fill('input[name="confirm_password"]', 'different456')
    await page.click('button[type="submit"]')
    await expect(page.locator('text=كلمتا المرور غير متطابقتين')).toBeVisible()
  })

  test('has a link to login page', async ({ page }) => {
    await expect(page.locator('a[href="/login"]')).toBeVisible()
  })
})

// Authenticated tests — require E2E_* env vars
test.describe('Coordinator login flow', () => {
  test.skip(!process.env.E2E_COORDINATOR_EMAIL, 'E2E_COORDINATOR_EMAIL not set')

  test('coordinator can log in and reach dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[name="email"]', TEST_USERS.coordinator.email)
    await page.fill('input[name="password"]', TEST_USERS.coordinator.password)
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })
    await expect(page.locator('text=لوحة التحكم').first()).toBeVisible()
  })

  test('coordinator can sign out', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[name="email"]', TEST_USERS.coordinator.email)
    await page.fill('input[name="password"]', TEST_USERS.coordinator.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/dashboard/)
    await page.click('button:has-text("تسجيل الخروج"), [type="submit"]:has-text("تسجيل الخروج")')
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  })
})

test.describe('Installation role redirect', () => {
  test.skip(!process.env.E2E_INSTALLATION_EMAIL, 'E2E_INSTALLATION_EMAIL not set')

  test('installation user redirects to /installation after login', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[name="email"]', TEST_USERS.installation.email)
    await page.fill('input[name="password"]', TEST_USERS.installation.password)
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/installation/, { timeout: 10000 })
  })
})
