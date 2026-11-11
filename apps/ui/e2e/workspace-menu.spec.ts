import type { Page } from '@playwright/test'

import { selectMany, selectSingle } from '@/supabase/supabase-helpers'
import frenchForeman from '../../../packages/i18n/messages/fr/foreman.json'
import frenchLayout from '../../../packages/i18n/messages/fr/layout.json'

import { RERUN_CLOUD } from './support/local-stack.cjs'
import { expect, test } from './fixtures'

const openMenu = (page: Page, workspaceName = 'My workspace') => page.getByRole('main').getByRole('button', { name: workspaceName, exact: true }).click()

test('renaming the workspace shows the new name everywhere and keeps it', async ({ page, admin, account }) => {
    await page.goto('/')
    await openMenu(page)
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Workspace settings' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Acme E2E')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    await expect(page.getByRole('main').getByRole('button', { name: 'Acme E2E', exact: true })).toBeVisible()
    const { data: workspace } = await selectSingle(admin, 'workspaces', ['name'] as const, { id: account.workspaceId })
    expect(workspace).toEqual({ name: 'Acme E2E' })
    await page.reload()
    await openMenu(page, 'Acme E2E')
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Workspace settings' }).getByRole('textbox', { name: 'Name' })).toHaveValue('Acme E2E')
})

test('each theme applies at once and survives a reload', async ({ page }) => {
    const html = page.locator('html')
    for (const [theme, dark] of [['Light', false], ['Dark', true], ['Light', false]] as const) {
        await page.goto('/')
        await openMenu(page)
        await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('button', { name: theme }).click()
        await expect(html).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/)
        await page.reload()
        await expect(html).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    }
})

test('the French language pack translates the app and is remembered', async ({ page, admin, account }) => {
    await page.goto('/')
    await openMenu(page)
    await page.getByRole('menuitem', { name: /^Language/ }).click()
    await page.getByRole('menuitemradio', { name: 'Français' }).click()
    // The page renders again in French: the first time, `next dev` compiles it for the new pack.
    await expect(page.getByRole('button', { name: frenchForeman.header.newTask })).toBeVisible({ timeout: 90_000 })

    await openMenu(page)
    await expect(page.getByRole('menuitem', { name: frenchLayout.workspaceMenu.settings, exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: frenchLayout.workspaceMenu.signOut })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.reload()
    await openMenu(page)
    await expect(page.getByRole('menuitem', { name: frenchLayout.workspaceMenu.members, exact: true })).toBeVisible()
    const { data: user } = await selectSingle(admin, 'users', ['locale'] as const, { id: account.userId })
    expect(user).toEqual({ locale: 'fr' })
})

test('the notification rule is saved as it is picked', async ({ page, admin, account }) => {
    await page.goto('/')
    await openMenu(page)
    await page.getByRole('menuitem', { name: 'Notifications', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Notifications' })
    const onlyWhenNeeded = dialog.getByRole('radio', { name: /^Only when I am needed/ })
    await onlyWhenNeeded.click()
    await expect(onlyWhenNeeded).toBeChecked()
    const storedScope = async () => {
        const { data } = await selectSingle(admin, 'users', ['email_notification_prefs'] as const, { id: account.userId })
        return (data?.email_notification_prefs as { scope?: string } | null)?.scope
    }
    await expect.poll(storedScope, { message: 'the rule reaches the database', timeout: 60_000 }).toBe('needed')

    await page.reload()
    await openMenu(page)
    await page.getByRole('menuitem', { name: 'Notifications', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Notifications' }).getByRole('radio', { name: /^Only when I am needed/ })).toBeChecked()
})

test('inviting a teammate lists a pending invitation that can be revoked', async ({ page, admin, account }) => {
    const invitee = `e2e-invitee-${account.workspaceId}@rerun.local`
    await page.goto('/')
    await openMenu(page)
    await page.getByRole('menuitem', { name: 'Members', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Members' })
    const invite = dialog.getByRole('button', { name: 'Invite' })
    await expect(invite).toBeDisabled()
    await dialog.getByPlaceholder('teammate@rerun.build').fill(invitee)
    await invite.click()

    // Rerun Cloud mails the invitation; a self-hosted install has no mailer and hands over the link.
    if (RERUN_CLOUD) await expect(page.getByText(`Invitation sent to ${invitee}`)).toBeVisible()
    else await expect(dialog.getByText(`Send this link to ${invitee}. It works for them only, once.`)).toBeVisible()
    await expect(dialog.getByText(invitee, { exact: true })).toBeVisible()
    await expect(dialog.getByText('Pending')).toBeVisible()
    const { data: pending } = await selectMany(admin, 'workspace_invitations', ['email', 'status'] as const, { workspace_id: account.workspaceId })
    expect(pending).toEqual([{ email: invitee, status: 'pending' }])

    await dialog.getByRole('button', { name: 'Revoke invitation' }).click()
    const confirm = page.getByRole('alertdialog', { name: `Revoke the invitation to ${invitee}?` })
    await confirm.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(dialog.getByText(invitee, { exact: true })).toBeHidden()
    await expect
        .poll(async () => (await selectMany(admin, 'workspace_invitations', ['status'] as const, { workspace_id: account.workspaceId })).data, { message: 'the invitation is revoked in the database' })
        .not.toEqual([{ status: 'pending' }])
})

test('a second workspace is created and becomes the current one', async ({ page, admin, account }) => {
    await page.goto('/')
    await openMenu(page)
    await page.getByRole('menuitem', { name: 'New workspace', exact: true }).click()
    const naming = page.getByRole('dialog', { name: 'Name your workspace' })
    await expect(naming.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await naming.getByRole('textbox', { name: 'Name' }).fill('Second E2E')
    await naming.getByRole('button', { name: 'Continue' }).click()

    if (RERUN_CLOUD) {
        const icon = page.getByRole('dialog', { name: 'Pick an icon' })
        await icon.getByRole('button', { name: 'Twisted blue glass vortex ring' }).click()
        await icon.getByRole('button', { name: 'Continue' }).click()
    }
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Invite your team' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()

    // Rerun Cloud then puts the new workspace behind its waitlist until a machine frees up, a
    // self-hosted install asks for a server: either way its name shows in the chrome.
    await expect(page.getByRole('main')).toContainText('Second E2E', { timeout: 60_000 })
    const { data: memberships } = await selectMany(admin, 'workspace_members', ['workspace_id', 'role'] as const, { user_id: account.userId })
    expect(memberships).toHaveLength(2)
    const created = memberships!.find((membership) => membership.workspace_id !== account.workspaceId)!
    expect(created.role).toBe('admin')
    const { data: workspace } = await selectSingle(admin, 'workspaces', ['name'] as const, { id: created.workspace_id })
    expect(workspace).toEqual({ name: 'Second E2E' })
    const { data: user } = await selectSingle(admin, 'users', ['workspace_id'] as const, { id: account.userId })
    expect(user, 'the new workspace is the current one').toEqual({ workspace_id: created.workspace_id })
})
