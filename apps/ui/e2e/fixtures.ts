import { randomUUID } from 'node:crypto'

import { test as base, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'

import { deleteAccount, deleteUser, linkEngine, markOnboarded, mintSignInLink, readLocalStack, signIn, workspaceOf } from './support/local-stack.cjs'

type LocalStack = ReturnType<typeof readLocalStack>
type Account = { email: string; userId: string; workspaceId: number }

type Fixtures = {
    // Every test is signed in unless it sets `test.use({ signedIn: false })`.
    signedIn: boolean
    // Past the onboarding by default: a spec about the onboarding sets `test.use({ onboarded: false })`.
    onboarded: boolean
    // The throwaway account of the test, signed in on the page's browser context and deleted after with
    // every workspace it was alone in. Absent from a signed-out test.
    account: Account
    // An address no account has yet, for a spec that signs up through the app; whatever account the
    // app opened for it is deleted after.
    freshEmail: string
    // Uncaught exceptions a spec knows about and lets through, each with the reason next to it.
    toleratedPageErrors: RegExp[]
}

type WorkerFixtures = { stack: LocalStack; admin: SupabaseClient<Database> }

const throwawayEmail = () => `e2e-${randomUUID().slice(0, 13)}@rerun.local`

// Playwright's fixtures hand their value over through a callback; it is named `provide` here because
// the React hooks lint rules read any function called `use` as a hook.
export const test = base.extend<Fixtures, WorkerFixtures>({
    stack: [async ({}, provide) => provide(readLocalStack()), { scope: 'worker' }],
    admin: [async ({ stack }, provide) => provide(createClient<Database>(stack.url!, stack.secretKey!, { auth: { persistSession: false, autoRefreshToken: false } })), { scope: 'worker' }],
    signedIn: [true, { option: true }],
    onboarded: [true, { option: true }],
    toleratedPageErrors: [[], { option: true }],
    // The cookie banner would sit over the bottom of every screen.
    context: async ({ context, baseURL }, provide) => {
        await context.addCookies([{ name: 'rerun-consent', value: `v1:denied:${Date.now()}`, url: baseURL! }])
        await provide(context)
    },
    account: [
        async ({ context, baseURL, admin, signedIn, onboarded }, provide) => {
            if (!signedIn) return provide(undefined as never)
            const email = throwawayEmail()
            const link = await mintSignInLink(admin, email)
            try {
                await signIn(context, baseURL!, admin, link)
                const workspaceId = await workspaceOf(admin, link.userId)
                // An engine that never answers: enough for Rerun Cloud to lift its waitlist wall.
                await linkEngine(admin, workspaceId, { engineHost: '127.0.0.1:9', apiKey: `e2e-${randomUUID()}` })
                if (onboarded) await markOnboarded(admin, workspaceId)
                await provide({ email, userId: link.userId, workspaceId })
            } finally {
                await deleteUser(admin, link.userId, { withWorkspaces: true })
            }
        },
        { auto: true },
    ],
    freshEmail: async ({ admin }, provide) => {
        const email = throwawayEmail()
        try {
            await provide(email)
        } finally {
            await deleteAccount(admin, email, { withWorkspaces: true })
        }
    },
    // Every spec fails on an uncaught exception in the page, whatever it asserts.
    page: async ({ page, toleratedPageErrors }, provide) => {
        const uncaught: string[] = []
        page.on('pageerror', (error) => {
            if (!toleratedPageErrors.some((tolerated) => tolerated.test(String(error)))) uncaught.push(String(error))
        })
        await provide(page)
        expect(uncaught, 'uncaught exceptions in the page').toEqual([])
    },
})

export { expect }

export async function expectNoHorizontalOverflow(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0)
}

export function isMobile(page: Page) {
    return (page.viewportSize()?.width ?? 1440) < 768
}
