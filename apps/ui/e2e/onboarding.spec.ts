import { selectSingle } from '@/supabase/supabase-helpers'

import { RERUN_CLOUD } from './support/local-stack.cjs'
import { expect, test } from './fixtures'

test.use({ onboarded: false })

test('a Rerun Cloud account that has not been onboarded starts with the onboarding', async ({ page, admin, account }) => {
    test.skip(!RERUN_CLOUD, 'the onboarding interview is Rerun Cloud’s')
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'What is your company website?' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)

    const { data: workspace } = await selectSingle(admin, 'workspaces', ['onboarded_at'] as const, { id: account.workspaceId })
    expect(workspace).toEqual({ onboarded_at: null })
})

test('a self-hosted account that has not been onboarded opens on its board', async ({ page }) => {
    test.skip(RERUN_CLOUD, 'Rerun Cloud starts with its onboarding interview')
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'My workspace' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What is your company website?' })).toHaveCount(0)
})
