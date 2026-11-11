import { expect, test, type Page } from '@playwright/test'

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/shots/${test.info().project.name}-${name}.png` })
const uniq = () => String(Date.now() % 100000) + Math.floor(Math.random() * 90 + 10)

/** Собирает ошибки консоли; тест падает, если они были. */
function watch(page: Page): string[] {
  const errs: string[] = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  return errs
}
async function login(page: Page, nick: string) {
  await page.goto('/')
  await page.getByTestId('nick').fill(nick)
  await page.getByTestId('pin').fill('123456')
  await page.getByTestId('enter').click()
  await expect(page.getByTestId('case-sigma')).toBeVisible()
}
const balance = async (page: Page) => Number(await page.getByTestId('balance').getAttribute('data-value'))
async function noHScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(over, 'горизонтальный скролл').toBeLessThanOrEqual(0)
}
/** Открыть 10 дешёвых кейсов в быстром режиме — чтобы были предметы. */
async function farm(page: Page, caseId = 'meloch') {
  await page.goto('/#/case/' + caseId)
  if ((await page.getByTestId('fast').getAttribute('class'))?.includes('text-mute')) await page.getByTestId('fast').click()
  await page.getByTestId('x10').click()
  await page.getByTestId('open').click()
  await expect(page.getByTestId('sell-all-drops')).toBeVisible()
}

test('вход, открытие кейса, продажа, инвентарь', async ({ page }) => {
  const errs = watch(page)
  await page.goto('/')
  await shot(page, '01-login')
  await login(page, 'Игрок' + uniq())
  await noHScroll(page)
  await shot(page, '02-home')
  expect(await balance(page)).toBe(100000)

  await page.getByTestId('case-sigma').click()
  await page.getByTestId('open').click() // обычная (не быстрая) прокрутка
  await page.waitForTimeout(1500)
  await shot(page, '03-spin')
  await expect(page.getByTestId('result')).toBeVisible()
  expect(await balance(page)).toBe(100000 - 4000)
  await shot(page, '04-drop')
  await page.getByTestId('sell-drop').click()
  await expect.poll(() => balance(page)).toBeGreaterThan(96000)

  await page.getByTestId('fast').click()
  await page.getByTestId('x5').click()
  await page.getByTestId('open').click()
  await expect(page.getByTestId('sell-all-drops')).toBeVisible()
  await noHScroll(page)
  await shot(page, '05-x5')

  await page.goto('/#/inventory')
  await expect(page.getByTestId('inv-grid')).toBeVisible()
  await expect(page.getByTestId('inv-summary')).toContainText('5 предметов')
  await shot(page, '06-inventory')
  const before = await balance(page)
  await page.getByTestId('inv-grid').locator('.item-card').first().click()
  await page.getByTestId('sell-selected').click()
  await expect(page.getByTestId('inv-summary')).toContainText('4 предметов')
  expect(await balance(page)).toBeGreaterThan(before)
  await page.getByTestId('sell-all').click()
  await page.getByTestId('confirm-sell').click()
  await expect(page.getByTestId('inv-summary')).toContainText('0 предметов')
  await noHScroll(page)
  expect(errs).toEqual([])
})

test('апгрейдер и контракт', async ({ page }) => {
  const errs = watch(page)
  await login(page, 'Апер' + uniq())
  await farm(page)
  await farm(page)

  await page.goto('/#/upgrade')
  await page.getByTestId('picker').locator('.item-card').first().click()
  await page.getByTestId('mult-2').click()
  await expect(page.getByTestId('chance')).not.toHaveText('0.00%')
  await shot(page, '07-upgrade')
  await page.getByTestId('upgrade-go').click()
  await expect(page.getByText(/Залетело!|Мимо…/)).toBeVisible()
  await shot(page, '08-upgrade-result')
  await noHScroll(page)

  await page.goto('/#/contracts')
  await expect(page.getByTestId('picker')).toBeVisible()
  await page.getByTestId('autofill').click()
  await shot(page, '09-contract')
  await page.getByTestId('contract-go').click()
  await expect(page.getByTestId('contract-result')).toBeVisible()
  await shot(page, '10-contract-result')
  await noHScroll(page)
  expect(errs).toEqual([])
})

test('батл с ботом: синхронная анимация и выплата', async ({ page }) => {
  const errs = watch(page)
  await login(page, 'Боец' + uniq())
  await page.goto('/#/battles')
  await page.getByTestId('battle-new').click()
  await page.getByTestId('pick-sigma').click()
  await page.getByTestId('pick-dota').click()
  await page.getByTestId('with-bots').check()
  await shot(page, '11-battle-create')
  await page.getByTestId('battle-create').click()
  const room = page.getByTestId('battle-room')
  await expect(room).toHaveAttribute('data-status', 'done')
  expect(await balance(page)).toBe(100000 - 4000 - 8000)
  await page.waitForTimeout(5500)
  await shot(page, '12-battle-live')
  // перезагрузка посреди батла: комната восстанавливает фазу по серверному времени
  await page.reload()
  await expect(page.getByTestId('battle-room')).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('battle-room')).toHaveAttribute('data-over', '1', { timeout: 30000 })
  await expect(page.getByText(/забирает|без выплаты/).first()).toBeVisible()
  await shot(page, '13-battle-done')
  await noHScroll(page)
  await expect(page.getByText('сид:')).toBeVisible()
  expect(errs).toEqual([])
})

test('бонусы, батл-пасс, топ, профиль, честность, коинфлип', async ({ page }) => {
  const errs = watch(page)
  const nick = 'Бонус' + uniq()
  await login(page, nick)
  await page.goto('/#/bonus')
  await page.getByTestId('daily').click()
  await expect.poll(() => balance(page)).toBe(200000)
  await page.getByTestId('promo-input').fill('залёт')
  await page.getByTestId('promo-go').click()
  await expect.poll(() => balance(page)).toBe(300000)
  await shot(page, '14-bonus')

  await page.goto('/#/case/free')
  await page.getByTestId('open').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('open')).toContainText('Через')

  await farm(page)
  await farm(page)
  await farm(page)
  await page.goto('/#/pass')
  await page.getByTestId('claim-d_open').click()
  await expect(page.getByTestId('bp-level')).toHaveText('1')
  await page.getByTestId('claim-levels').click()
  await expect(page.getByTestId('claim-levels')).toHaveCount(0)
  await shot(page, '15-pass')
  await noHScroll(page)

  await page.goto('/#/coinflip')
  await page.getByTestId('flip-create').click()
  await page.getByTestId('flip-bot').click()
  await expect(page.getByTestId('flip-result')).toBeVisible()
  await shot(page, '16-coinflip')

  await page.goto('/#/top')
  await page.getByRole('button', { name: 'Состояние' }).click()
  await expect(page.getByTestId('top-list')).toContainText(nick)
  await shot(page, '17-top')
  await page.goto('/#/profile')
  await expect(page.getByTestId('profile-nick')).toHaveText(nick)
  await page.getByTestId('claim-ach-open10').click()
  await expect(page.getByTestId('claim-ach-open10')).toHaveCount(0)
  await shot(page, '18-profile')
  await noHScroll(page)

  await page.goto('/#/fair')
  await page.getByTestId('fair-rotate').click()
  await expect(page.getByTestId('revealed-seed')).toBeVisible()
  await expect(page.getByText('✓ совпадает с показанным хешем')).toBeVisible()
  await page.getByTestId('verify-roll').first().click()
  await expect(page.getByTestId('calc-result')).toBeVisible()
  await shot(page, '19-fair')
  await noHScroll(page)
  expect(errs).toEqual([])
})

test('краш: ставка, раунд доходит до падения, результат виден и проверяем', async ({ page }) => {
  const errs = watch(page)
  await login(page, 'Краш' + uniq())
  await page.goto('/#/crash')
  await expect(page.getByTestId('crash-stage')).toBeVisible()
  await shot(page, '23-crash-bet')
  // ставим на этапе приёма ставок (если раунд уже идёт, ждём следующий)
  await expect(page.getByTestId('crash-bet')).toBeEnabled({ timeout: 60000 })
  await page.getByTestId('crash-amount').fill('10')
  await page.getByTestId('crash-auto').fill('1.05')
  const before = await balance(page)
  await page.getByTestId('crash-bet').click()
  await expect.poll(() => balance(page)).toBe(before - 1000)
  await shot(page, '24-crash-placed')
  await expect(page.getByTestId('crash-result')).toBeVisible({ timeout: 150000 })
  await shot(page, '25-crash-done')
  await expect(page.getByTestId('crash-verify')).toBeVisible()
  await expect(page.getByTestId('crash-bets')).toContainText('Краш')
  await noHScroll(page)
  expect(errs).toEqual([])
})

test('два игрока: общий чат и батл друг с другом', async ({ browser }) => {
  const vp = test.info().project.use.viewport!
  const ca = await browser.newContext({ viewport: vp })
  const cb = await browser.newContext({ viewport: vp })
  const a = await ca.newPage()
  const b = await cb.newPage()
  const ea = watch(a)
  const eb = watch(b)
  const na = 'Аня' + uniq()
  const nb = 'Боря' + uniq()
  await login(a, na)
  await login(b, nb)

  // чат
  const mobile = vp.width < 1280
  if (mobile) {
    await a.getByTestId('chat-toggle').click()
    await b.getByTestId('chat-toggle').click()
  }
  const msg = 'привет от ' + na
  await a.getByTestId('chat-input').last().fill(msg)
  await a.getByTestId('chat-send').last().click()
  await expect(b.getByTestId('chat-list').last()).toContainText(msg)
  await b.getByTestId('chat-input').last().fill('и тебе привет')
  await b.getByTestId('chat-send').last().click()
  await expect(a.getByTestId('chat-list').last()).toContainText('и тебе привет')
  await shot(b, '20-chat')
  if (mobile) {
    await a.getByLabel('Закрыть чат').click()
    await b.getByLabel('Закрыть чат').click()
  }

  // батл: A создаёт, B видит его в лобби и садится
  await a.goto('/#/battles')
  await a.getByTestId('battle-new').click()
  await a.getByTestId('pick-sigma').click()
  await a.getByTestId('battle-create').click()
  await expect(a.getByTestId('battle-room')).toHaveAttribute('data-status', 'open')
  const battleUrl = a.url() // ссылка на комнату — как её отправили бы другу
  await b.goto('/#/battles')
  await expect(b.getByTestId('battle-row').first()).toBeVisible() // лобби видно в общем списке
  await b.goto(battleUrl)
  await expect(b.getByTestId('battle-room')).toHaveAttribute('data-status', 'open')
  await shot(b, '21-lobby')
  await b.getByTestId('join-1').click()
  await expect(b.getByTestId('battle-room')).toHaveAttribute('data-status', 'done')
  await expect(a.getByTestId('battle-room')).toHaveAttribute('data-status', 'done')
  await expect(a.getByTestId('battle-room')).toHaveAttribute('data-over', '1', { timeout: 30000 })
  await expect(b.getByTestId('battle-room')).toHaveAttribute('data-over', '1', { timeout: 30000 })
  // оба видят одни и те же выплаты
  const pa = await a.getByTestId('slot-0').innerText()
  const pb = await b.getByTestId('slot-0').innerText()
  expect(pa).toBe(pb)
  await shot(a, '22-pvp-done-a')
  await shot(b, '22-pvp-done-b')
  // банк ушёл кому-то одному
  await expect.poll(async () => (await balance(a)) + (await balance(b)), { timeout: 15000 }).toBeGreaterThan(2 * (100000 - 4000))
  expect(ea).toEqual([])
  expect(eb).toEqual([])
  await ca.close()
  await cb.close()
})
