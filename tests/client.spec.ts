import { test, expect } from '@playwright/test'
import { artUri, techUri, mockApi, login } from './fixtures'
test('first launch has no mandatory feeds; chosen feeds persist and can be reordered', async ({
  page,
}) => {
  const api = await mockApi(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /自分の空を/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /この空ではじめる/ })).toBeDisabled()
  await page.getByRole('button', { name: 'アートの空を追加' }).click()
  await page.getByRole('button', { name: /この空ではじめる/ }).click()
  await expect(page.getByRole('tab', { name: 'アートの空' })).toBeVisible()
  await expect(page.getByText('今日の空は、少しだけアート。')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'フォロー中' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('tab', { name: 'アートの空' })).toBeVisible()
  await page.goto('/feeds')
  await page.getByRole('button', { name: 'テクノロジーを追加' }).click()
  await page.getByRole('button', { name: 'テクノロジーを上に移動' }).click()
  const rows = page.locator('.feed-order-row')
  await expect(rows.first()).toContainText('テクノロジー')
  await page.getByRole('button', { name: 'テクノロジーを起動時のフィードに設定' }).click()
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'テクノロジー' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByText('コードから生まれる、新しい景色。')).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aozora:prefs:guest')!))
  expect(saved.feeds.map((f: { id: string }) => f.id)).toEqual([techUri, artUri])
  expect(api.writes).toEqual([])
})
test('all feeds can be removed; no recommendation is re-inserted', async ({ page }) => {
  await mockApi(page)
  await page.goto('/feeds')
  await page.getByRole('button', { name: 'アートの空を追加' }).click()
  await page.getByRole('button', { name: 'アートの空をホームから削除' }).click()
  await expect(page.getByText('ホームはまだ白紙です')).toBeVisible()
  await page.reload()
  await expect(page.locator('.feed-order-row')).toHaveCount(0)
})
test('search and guest actions work, and dialogs trap focus and close with Escape', async ({
  page,
}) => {
  await mockApi(page)
  await page.goto('/search')
  await page.getByRole('textbox', { name: 'Blueskyを検索' }).fill('空')
  await page.getByRole('button', { name: '検索', exact: true }).click()
  await expect(page.getByText('検索で見つけた青い空。')).toBeVisible()
  await page.getByRole('button', { name: 'いいねする', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'ログイン' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('ハンドル', { exact: true })).toBeFocused()
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
      true,
    )
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
test('display controls persist and both layouts avoid horizontal overflow', async ({ page }) => {
  await mockApi(page)
  await page.goto('/settings')
  await page.getByRole('switch', { name: /いいね・返信の数を隠す/ }).check()
  await page.getByRole('combobox', { name: 'テーマ', exact: true }).selectOption('dark')
  await page.reload()
  await expect(page.getByRole('switch', { name: /いいね・返信の数を隠す/ })).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /自分の空を/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
test('authentication uses a tab session and never auto-writes feed preferences; posting creates gates atomically', async ({
  page,
}) => {
  const api = await mockApi(page)
  await page.goto('/')
  await login(page)
  await expect(page.getByRole('button', { name: /フォロー中/ }).first()).toBeVisible()
  expect(api.writes.filter((w) => w.endpoint === 'app.bsky.actor.putPreferences')).toEqual([])
  const vault = await page.evaluate(() => ({
    persistent: localStorage.getItem('aozora:sessions:v1'),
    tab: sessionStorage.getItem('aozora:sessions:v1'),
  }))
  expect(vault.persistent).not.toContain('accessJwt')
  expect(vault.tab).toContain('accessJwt')
  expect(vault.tab).not.toContain('test-test-test-test')
  await page.getByRole('button', { name: 'アートの空を追加' }).click()
  await page.getByRole('button', { name: /この空ではじめる/ }).click()
  await page.getByRole('button', { name: '投稿する', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新しい投稿' })
  await dialog.getByLabel('投稿内容').fill('自分らしい空に、こんにちは。')
  await dialog.getByText('言語・返信・引用・コンテンツの設定', { exact: true }).click()
  await dialog.getByLabel('返信できる人').selectOption('following')
  await dialog.getByLabel('引用を許可する').uncheck()
  await dialog.getByRole('button', { name: '投稿する', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('自分らしい空に、こんにちは。', { exact: true })).toBeVisible()
  const body = api.writes.find((w) => w.endpoint === 'com.atproto.repo.applyWrites')!.body
  expect((body.writes as { collection: string }[]).map((w) => w.collection)).toEqual([
    'app.bsky.feed.post',
    'app.bsky.feed.threadgate',
    'app.bsky.feed.postgate',
  ])
})
test('a failed feed has a retry and recovers without losing the selected source', async ({
  page,
}) => {
  const api = await mockApi(page)
  api.setFeedFailure(true)
  await page.goto(`/feed/${encodeURIComponent(artUri)}`)
  await expect(page.getByRole('button', { name: 'もう一度試す' })).toBeVisible()
  api.setFeedFailure(false)
  await page.getByRole('button', { name: 'もう一度試す' }).click()
  await expect(page.getByText('今日の空は、少しだけアート。')).toBeVisible()
})
test('sensitive media cannot be revealed by a guest', async ({ page }) => {
  await mockApi(page)
  await page.route('**/xrpc/app.bsky.feed.getFeed?**', async (route) => {
    const { post } = await import('./fixtures')
    const sensitive = {
      ...post('ラベル付きの投稿です。'),
      labels: [
        {
          src: 'did:plc:ar7c4by46qjdydhdevvrndac',
          uri: post('x').uri,
          val: 'porn',
          cts: new Date().toISOString(),
        },
      ],
      embed: {
        $type: 'app.bsky.embed.images#view',
        images: [
          {
            thumb: 'https://example.com/private.jpg',
            fullsize: 'https://example.com/full.jpg',
            alt: '機密の画像',
          },
        ],
      },
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ feed: [{ post: sensitive }] }),
    })
  })
  await page.goto(`/feed/${encodeURIComponent(artUri)}`)
  await expect(page.locator('.timeline-meta')).toBeVisible()
  await expect(page.getByText('まだ投稿がありません', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: '機密の画像' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '表示する', exact: true })).toHaveCount(0)
})
