// The coworker dock: the rail of coworkers on the edge of the screen, end to end on the local hub:
//   pnpm verify:desktop --onboarded --engine --scenario apps/desktop-app/e2e/coworker-dock.mjs
// (`--engine`: the demo coworkers are created on the local engine, or they would show offline.)
//
// The demo workspace of the docs is seeded, then a coworker starts working, finishes a run, and the
// dock is clicked. Whether it floats over another app in full screen, and lets the clicks around the
// rail through, is checked by hand on a real desktop.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COWORKERS, seedDemoWorkspace } from '../../../scripts/docs-media/demo-workspace.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

function check(condition, message) {
    if (!condition) throw new Error(`Check failed: ${message}`)
    console.log(`[e2e] ok: ${message}`)
}

async function waitUntil(read, predicate, message, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs
    let value
    while (Date.now() < deadline) {
        value = await read()
        if (predicate(value)) return value
        await new Promise((done) => setTimeout(done, 250))
    }
    throw new Error(`Timed out: ${message} (last value: ${JSON.stringify(value)})`)
}

const isDock = (url) => url.endsWith('/coworker-dock')
const dockWindow = (app) =>
    app.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/coworker-dock'))
        if (!window) return null
        const display = screen.getDisplayMatching(window.getBounds())
        return { visible: window.isVisible(), onTop: window.isAlwaysOnTop(), allWorkspaces: window.isVisibleOnAllWorkspaces(), focusable: window.isFocusable(), bounds: window.getBounds(), workArea: display.workArea }
    })
const mainVisible = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].isVisible())

const LEAD_SCOUT = COWORKERS.leadScout
const LEAD_SCOUT_SESSION = 'demo-session-lead-scout'

export default async function coworkerDockScenario({ app, page, step, base, admin, workspaceId, account }) {
    const { data: pool } = await admin.from('engine_pool').select('engine_api_key').eq('claimed_by_workspace_id', workspaceId).single()
    await seedDemoWorkspace({ admin, workspaceId, userId: account.userId, email: account.email, apiKey: pool.engine_api_key, dataDir: join(REPO_ROOT, '.context/verify/engine-data') })
    await page.goto(base)
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })

    const initial = await page.evaluate(() => window.rerunShell.settings.get())
    check(initial.coworkerDock === true, 'the dock is on by default')
    check((await page.evaluate(() => window.rerunShell.capabilities)).includes('coworkerDock'), 'the shell says it has a dock')

    const dock = await waitUntil(() => app.windows().find((candidate) => isDock(candidate.url())), Boolean, 'the dock window opens', 60_000)
    await dock.getByRole('button', { name: LEAD_SCOUT.name }).waitFor({ timeout: 30_000 })
    const box = await waitUntil(() => dockWindow(app), (value) => value?.visible, 'the dock window shows')
    check(box.onTop && box.allWorkspaces && !box.focusable, `it floats on top, on every desktop, without taking the focus (${JSON.stringify(box)})`)
    check(box.bounds.x + box.bounds.width === box.workArea.x + box.workArea.width && box.bounds.height === box.workArea.height, 'it is glued to the right edge, as tall as the screen')
    const strip = await dock.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--shell-titlebar-h').trim())
    check(strip === '0px', 'the dock has no title strip')
    for (const coworker of Object.values(COWORKERS)) await dock.getByRole('button', { name: coworker.name }).waitFor()
    check(true, 'one buddy per coworker')
    await step('dock', { target: dock })

    // A coworker starts working: its buddy moves.
    await admin.from('sessions').update({ status: 'working' }).eq('agent_id', LEAD_SCOUT.id).eq('engine_session_id', LEAD_SCOUT_SESSION)
    const leadScoutBuddy = dock.getByRole('button', { name: LEAD_SCOUT.name }).locator('[data-buddy-motion]')
    await waitUntil(() => leadScoutBuddy.getAttribute('data-buddy-motion').catch(() => null), (motion) => motion === 'bob', 'the buddy of a working coworker moves')
    await step('a coworker at work', { target: dock })

    // It finishes: a pip counts the run waiting for the person.
    await admin.from('sessions').update({ status: 'idle' }).eq('agent_id', LEAD_SCOUT.id).eq('engine_session_id', LEAD_SCOUT_SESSION)
    await admin.from('notifications').insert({ workspace_id: workspaceId, agent_id: LEAD_SCOUT.id, engine_session_id: LEAD_SCOUT_SESSION, kind: 'done', message: 'Found 14 new agencies', recipients: [account.userId] })
    const leadScoutButton = dock.getByRole('button', { name: LEAD_SCOUT.name })
    await waitUntil(() => leadScoutButton.innerText(), (text) => text.trim() === '1', 'a pip appears on the coworker that finished')
    await step('a run waits', { target: dock })

    // A click on it brings the main window up on its conversation, and the pip goes.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].hide())
    await leadScoutButton.click()
    await waitUntil(() => mainVisible(app), Boolean, 'the main window comes back')
    await page.getByText(LEAD_SCOUT.name).first().waitFor()
    await waitUntil(() => leadScoutButton.innerText(), (text) => text.trim() === '', 'opening the conversation clears the pip')
    await step('conversation opened from the dock')

    // The "+" opens New coworker in the main window.
    await dock.getByRole('button', { name: 'New coworker' }).click()
    await page.getByRole('dialog').first().waitFor()
    check(true, 'the "+" opens the new coworker dialog')
    await step('new coworker from the dock')
    await page.keyboard.press('Escape')

    // A paused workspace: the "+" is off, as in the sidebar. The reload of the main window keeps the dock.
    const newCoworker = dock.getByRole('button', { name: 'New coworker' })
    await admin.from('workspaces').update({ boxes_archived_at: new Date().toISOString() }).eq('id', workspaceId)
    await page.reload()
    await waitUntil(() => newCoworker.isDisabled(), Boolean, 'the "+" is disabled on a paused workspace')
    check((await dockWindow(app))?.visible, 'the dock stayed up through the reload')
    await step('paused workspace', { target: dock })
    await admin.from('workspaces').update({ boxes_archived_at: null }).eq('id', workspaceId)
    await page.reload()
    await waitUntil(() => newCoworker.isDisabled(), (disabled) => !disabled, 'the "+" comes back once the workspace runs again')

    // Let go on the left half of the screen, it moves to the left edge, and stays there.
    await dock.evaluate(() => window.rerunShell.coworkerDock.drop({ x: screen.availLeft + 10, y: screen.availTop + 200 }))
    const left = await waitUntil(() => dockWindow(app), (value) => value?.bounds.x === value?.workArea.x, 'the dock moves to the left edge')
    check(left.bounds.height === left.workArea.height, 'still as tall as the screen')
    await step('dock on the left edge', { target: dock })

    // A double click on the grip folds it into a tab; a click unfolds it.
    await dock.getByRole('button', { name: 'Move' }).dblclick()
    await dock.getByRole('button', { name: 'Show coworkers' }).waitFor()
    await step('dock collapsed', { target: dock })
    await dock.getByRole('button', { name: 'Show coworkers' }).click()
    await dock.getByRole('button', { name: LEAD_SCOUT.name }).waitFor()

    // Off in the settings, the window goes; on again, it comes back where it was.
    const off = await page.evaluate(() => window.rerunShell.settings.set({ coworkerDock: false }))
    check(off.coworkerDock === false, 'the dock can be turned off')
    await waitUntil(() => dockWindow(app), (value) => value === null, 'the dock window goes')
    await page.evaluate(() => window.rerunShell.settings.set({ coworkerDock: true }))
    const back = await waitUntil(() => dockWindow(app), (value) => value?.visible, 'the dock comes back once turned on')
    check(back.bounds.x === back.workArea.x, 'on the edge it was left on')
    const fresh = await waitUntil(() => app.windows().find((candidate) => isDock(candidate.url())), Boolean, 'the new dock window loads')
    await fresh.evaluate(() => window.rerunShell.coworkerDock.drop({ x: screen.availLeft + screen.availWidth - 10, y: screen.availTop + screen.availHeight / 2 }))
    await waitUntil(() => dockWindow(app), (value) => value && value.bounds.x + value.bounds.width === value.workArea.x + value.workArea.width, 'and goes back to the right edge')

    // The Desktop tab of the settings has the switch.
    await page.getByRole('button', { name: /workspace/i }).first().click()
    await page.getByRole('menuitem', { name: /account/i }).first().click()
    await page.getByRole('tab', { name: 'Desktop app' }).click()
    await page.locator('#desktop-coworker-dock').waitFor()
    check((await page.locator('#desktop-coworker-dock').getAttribute('aria-checked')) === 'true', 'the Desktop tab shows the dock switch, on')
    await step('desktop tab with the dock switch')
}
