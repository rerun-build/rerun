import type { Page } from '@playwright/test'

import { selectMaybeSingle } from '@/supabase/supabase-helpers'

import { findAccount, lastMailedCode, RERUN_CLOUD } from './support/local-stack.cjs'
import { expect, expectNoHorizontalOverflow, test } from './fixtures'

// The chrome has one, and on a phone Rerun Cloud's onboarding sheet adds "Already have an account? Sign in".
const signInButtons = (page: Page) => page.getByRole('button', { name: 'Sign in', exact: true })
// "Welcome" when a visitor opens it, "Welcome to Rerun" when a self-hosted install opens it on its own.
const welcomeDialog = (page: Page) => page.getByRole('dialog', { name: /^Welcome/ })

// Signed out, a person meets one of: the visitor's "Sign in" button (Rerun Cloud), the dialog a
// self-hosted install opens on its own, or the /auth page, each titled "Welcome…".
async function expectSignedOut(page: Page) {
    await expect(page.getByRole('heading', { name: /^Welcome/ }).or(signInButtons(page)).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'My workspace' })).toHaveCount(0)
}

// Rerun Cloud lets a visitor look around first, a self-hosted install asks for an account at once.
async function openEmailSignIn(page: Page) {
    await page.goto('/')
    const dialog = welcomeDialog(page)
    if (RERUN_CLOUD) {
        await signInButtons(page).first().click()
        await dialog.getByRole('button', { name: 'Continue with email' }).click()
    }
    await expect(dialog.getByRole('textbox', { name: 'Email' })).toBeVisible()
    return dialog
}

async function askForEmailCode(page: Page, email: string) {
    const dialog = await openEmailSignIn(page)
    await dialog.getByRole('textbox', { name: 'Email' }).fill(email)
    const askedAt = new Date(Date.now() - 1000)
    await dialog.getByRole('textbox', { name: 'Email' }).press('Enter')
    // The auth server retries a failing email hook for a while before it answers with an error toast.
    const codeAsked = dialog.getByText(email)
    const failure = page.getByRole('region', { name: /Notifications/ }).getByRole('listitem')
    await expect(codeAsked.or(failure).first()).toBeVisible({ timeout: 90_000 })
    if (await failure.isVisible()) throw new Error(`The code could not be sent: ${await failure.innerText()}`)
    return { dialog, askedAt, codeInput: dialog.locator('input[autocomplete="one-time-code"]') }
}

test.describe('signed out', () => {
    test.use({ signedIn: false })

    test('a visitor of Rerun Cloud lands on the guest onboarding and can open the sign-in dialog', async ({ page }) => {
        test.skip(!RERUN_CLOUD, 'the guest onboarding is Rerun Cloud’s')
        await page.goto('/')
        await expect(page.getByRole('heading', { name: 'What is your company website?' })).toBeVisible()
        await expectNoHorizontalOverflow(page)

        await signInButtons(page).first().click()
        const dialog = welcomeDialog(page)
        await expect(dialog.getByRole('button', { name: 'Continue with email' })).toBeVisible()
        await expect(dialog.getByRole('link', { name: 'Terms of Service' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
    })

    test('a visitor of a self-hosted install is asked for an account at once', async ({ page }) => {
        test.skip(RERUN_CLOUD, 'a self-hosted install has no guest mode')
        await page.goto('/')
        const dialog = welcomeDialog(page)
        await expect(dialog.getByRole('heading', { name: 'Welcome to Rerun' })).toBeVisible()
        await expect(dialog.getByRole('textbox', { name: 'Email' })).toBeEditable()
        await expectNoHorizontalOverflow(page)
    })

    test('a new address signs up with the code it receives by email', async ({ page, admin, stack, freshEmail }) => {
        const { dialog, askedAt, codeInput } = await askForEmailCode(page, freshEmail)
        await codeInput.fill(await lastMailedCode(stack.mailpitUrl, freshEmail, { after: askedAt }))

        await expect(dialog).toBeHidden({ timeout: 60_000 })
        await expect(signInButtons(page)).toHaveCount(0)
        const account = await findAccount(admin, freshEmail)
        expect(account, 'the app opened an account for the address').not.toBeNull()
        const { data: user } = await selectMaybeSingle(admin, 'users', ['workspace_id'] as const, { id: account!.id })
        expect(user?.workspace_id, 'the new account has a workspace').toBeTruthy()

        await page.reload()
        await expect(page.getByRole('tablist', { name: 'Chief of Staff' }).or(page.getByRole('heading', { name: 'What is your company website?' })).first()).toBeVisible()
        await expect(signInButtons(page)).toHaveCount(0)
    })

    test('a wrong code is refused and keeps the visitor signed out', async ({ page, stack, freshEmail }) => {
        const { dialog, askedAt, codeInput } = await askForEmailCode(page, freshEmail)
        const code = await lastMailedCode(stack.mailpitUrl, freshEmail, { after: askedAt })
        await codeInput.fill(String((Number(code) + 1) % 1_000_000).padStart(6, '0'))

        await expect(dialog.getByText('This code is wrong or has expired.')).toBeVisible({ timeout: 60_000 })
        await expect(dialog).toBeVisible()
        await page.reload()
        await expectSignedOut(page)
    })
})

test.describe('signed in', () => {
    // The board's polls still in flight when the session ends reach /auth, where Next answers a server
    // action of another page with `{}`: the client throws it, unseen.
    test.use({ toleratedPageErrors: [/An unexpected response was received from the server/] })

    test('signing out ends the session, even after a reload', async ({ page, account }) => {
        await page.goto('/')
        await page.getByRole('button', { name: 'My workspace' }).click()
        await expect(page.getByRole('menu')).toContainText(account.email)
        await page.getByRole('menuitem', { name: 'Sign out' }).click()

        await expectSignedOut(page)
        await page.goto('/')
        await expectSignedOut(page)
        await page.reload()
        await expectSignedOut(page)
    })
})
