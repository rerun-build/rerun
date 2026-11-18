// Gestures several scenes share.

import { settle } from '../verify/shared.mjs'

export async function openWorkspaceMenu(page, base) {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await settle(page)
    await page.getByRole('button', { name: /Acme Studio/ }).first().click()
}

export async function openCoworker(page, base, coworker, tab) {
    await page.goto(`${base}/?agent=${coworker.id}${tab ? `&tab=${tab}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await settle(page)
}
