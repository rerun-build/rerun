// Gestures several scenes share.

import { settle } from '../verify/shared.mjs'

export const body = ({ page }) => page.locator('body')
export const dialog = ({ page }) => page.getByRole('dialog')

export async function visit(page, base, path) {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await settle(page)
}

export async function openWorkspaceMenu(page, base) {
    await visit(page, base, '/')
    await page.getByRole('button', { name: /Acme Studio/ }).first().click()
}

export async function openCoworker(page, base, coworker, tab) {
    await visit(page, base, `/?agent=${coworker.id}${tab ? `&tab=${tab}` : ''}`)
}

// The board opens on its first Box: two steps back show the three.
export async function showWholeBoard(page) {
    for (let step = 0; step < 2; step++) {
        await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
        await page.waitForTimeout(600)
    }
}

// The coworker card has no landmark of its own: from an element inside it, climb to the first
// ancestor about as tall as the window, and frame that.
export async function panelAround(page, inner) {
    await inner.first().waitFor({ timeout: 20_000 })
    await inner.first().evaluate((element) => {
        for (const marked of document.querySelectorAll('[data-docs-frame]')) marked.removeAttribute('data-docs-frame')
        let node = element
        while (node.parentElement && node.getBoundingClientRect().height < window.innerHeight * 0.9) node = node.parentElement
        node.setAttribute('data-docs-frame', '')
    })
    return page.locator('[data-docs-frame]')
}
