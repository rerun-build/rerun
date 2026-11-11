import { expect, expectNoHorizontalOverflow, isMobile, test } from './fixtures'

test('an onboarded workspace opens on its board and its Chief of Staff', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'My workspace' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Coworker board' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Click to recruit your first coworker' })).toBeVisible()

    // On a phone the Chief of Staff is a sheet its orb opens, on a wider screen a side panel.
    if (isMobile(page)) await page.getByRole('button', { name: 'Ask your Chief of Staff' }).click()
    await expect(page.getByRole('tab', { name: 'Ask', selected: true })).toBeVisible()
    await expect(page.getByText("Hi, I'm your Chief of Staff")).toBeVisible()
    for (const starter of ['Build my first coworker', 'Start from a template', 'How does this work?']) {
        await expect(page.getByRole('button', { name: new RegExp(starter) })).toBeVisible()
    }
    await expect(page.getByRole('textbox', { name: 'Send a message...' })).toBeEditable()
    await expectNoHorizontalOverflow(page)
})

test('the Routines tab of the Chief of Staff opens and comes back to Ask', async ({ page }) => {
    await page.goto('/')
    if (isMobile(page)) await page.getByRole('button', { name: 'Ask your Chief of Staff' }).click()
    await page.getByRole('tab', { name: 'Routines' }).click()
    await expect(page.getByRole('tab', { name: 'Routines', selected: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Ask' }).click()
    await expect(page.getByText("Hi, I'm your Chief of Staff")).toBeVisible()
})
