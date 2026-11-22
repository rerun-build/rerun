// The coworker dock: the rail of coworkers on the edge of the screen, end to end on the local hub:
//   pnpm verify:desktop --onboarded --engine --scenario apps/desktop-app/e2e/coworker-dock.mjs
// (`--engine`: the demo coworkers are created on the local engine, or they would show offline.)
//
// The demo workspace of the docs is seeded, then a coworker starts working, finishes a run, and the
// dock is clicked. Whether it floats over another app in full screen, and lets the clicks around the
// rail through, is checked by hand on a real desktop.

import { readFileSync } from 'node:fs'
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

// The buddies of the rail from top to bottom, by the name each one reads out.
const RAIL_CONTROLS = ['Move', 'New coworker', 'Show coworkers']
const railNames = (dock) =>
    dock.evaluate((controls) => [...document.querySelectorAll('[data-coworker-dock] button[aria-label]')].map((button) => button.getAttribute('aria-label')).filter((name) => !controls.includes(name)), RAIL_CONTROLS)

const readDockSettings = async (app) => {
    const folder = await app.evaluate(({ app: electron }) => electron.getPath('userData'))
    return JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8')).coworkerDock ?? {}
}

const sidebarOrders = async (admin, workspaceId) => {
    const { data } = await admin.from('agents').select('id, sidebar_order').eq('workspace_id', workspaceId).order('id')
    return data
}

// Playwright cannot click a native menu: the templates the shell builds are kept, and an item's own
// click is called, as the menu would.
const recordDockMenus = (app) =>
    app.evaluate(({ Menu }) => {
        if (globalThis.__dockMenus) return
        globalThis.__dockMenus = []
        const build = Menu.buildFromTemplate.bind(Menu)
        Menu.buildFromTemplate = (template) => {
            const menu = build(template)
            globalThis.__dockMenus.push({ template, menu })
            return menu
        }
    })

// `labels`: the item, after the submenus that lead to it.
async function clickDockMenuItem(app, labels) {
    await waitUntil(() => app.evaluate(() => globalThis.__dockMenus.length), (count) => count > 0, 'the shell opens its menu')
    const found = await app.evaluate((_electron, path) => {
        const { template, menu } = globalThis.__dockMenus.pop()
        globalThis.__dockMenus.length = 0
        menu.closePopup()
        let items = template
        let item = null
        for (const label of path) {
            item = items.find((entry) => entry.label === label) ?? null
            items = item?.submenu ?? []
        }
        if (!item?.click) return template.map((entry) => entry.label ?? entry.type)
        item.click()
        return true
    }, labels)
    if (found !== true) throw new Error(`Check failed: the menu has no such item (${JSON.stringify(found)})`)
}

const LEAD_SCOUT = COWORKERS.leadScout
const LEAD_SCOUT_SESSION = 'demo-session-lead-scout'

export default async function coworkerDockScenario({ app, page, step, base, admin, workspaceId, account, shell }) {
    const { data: pool } = await admin.from('engine_pool').select('engine_api_key').eq('claimed_by_workspace_id', workspaceId).single()
    await seedDemoWorkspace({ admin, workspaceId, userId: account.userId, email: account.email, apiKey: pool.engine_api_key, dataDir: join(REPO_ROOT, '.context/verify/engine-data') })
    // A cold `next dev` compiles the home on this first visit, past the default 30 seconds.
    await page.goto(base, { timeout: 180_000 })
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })

    const initial = await page.evaluate(() => window.rerunShell.settings.get())
    check(initial.coworkerDock === true, 'the dock is on by default')
    check((await page.evaluate(() => window.rerunShell.capabilities)).includes('coworkerDock'), 'the shell says it has a dock')
    check((await page.evaluate(() => window.rerunShell.capabilities)).includes('coworkerDockArrange'), 'and that it keeps the order and the hidden coworkers')

    const dock = await waitUntil(() => app.windows().find((candidate) => isDock(candidate.url())), Boolean, 'the dock window opens', 60_000)
    await dock.getByRole('button', { name: LEAD_SCOUT.name, exact: true }).waitFor({ timeout: 30_000 })
    const box = await waitUntil(() => dockWindow(app), (value) => value?.visible, 'the dock window shows')
    check(box.onTop && box.allWorkspaces && !box.focusable, `it floats on top, on every desktop, without taking the focus (${JSON.stringify(box)})`)
    check(box.bounds.x + box.bounds.width === box.workArea.x + box.workArea.width && box.bounds.height === box.workArea.height, 'it is glued to the right edge, as tall as the screen')
    const strip = await dock.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--shell-titlebar-h').trim())
    check(strip === '0px', 'the dock has no title strip')
    for (const coworker of Object.values(COWORKERS)) await dock.getByRole('button', { name: coworker.name, exact: true }).waitFor()
    check(true, 'one buddy per coworker')
    await step('dock', { target: dock })

    // A coworker starts working: its buddy moves.
    await admin.from('sessions').update({ status: 'working' }).eq('agent_id', LEAD_SCOUT.id).eq('engine_session_id', LEAD_SCOUT_SESSION)
    const leadScoutBuddy = dock.getByRole('button', { name: LEAD_SCOUT.name, exact: true }).locator('[data-buddy-motion]')
    await waitUntil(() => leadScoutBuddy.getAttribute('data-buddy-motion').catch(() => null), (motion) => motion === 'bob', 'the buddy of a working coworker moves')
    await step('a coworker at work', { target: dock })

    // It finishes: a pip counts the run waiting for the person.
    await admin.from('sessions').update({ status: 'idle' }).eq('agent_id', LEAD_SCOUT.id).eq('engine_session_id', LEAD_SCOUT_SESSION)
    await admin.from('notifications').insert({ workspace_id: workspaceId, agent_id: LEAD_SCOUT.id, engine_session_id: LEAD_SCOUT_SESSION, kind: 'done', message: 'Found 14 new agencies', recipients: [account.userId] })
    const leadScoutButton = dock.getByRole('button', { name: LEAD_SCOUT.name, exact: true })
    await waitUntil(() => leadScoutButton.innerText(), (text) => text.trim() === '1', 'a pip appears on the coworker that finished')
    await step('a run waits', { target: dock })

    // A click on it opens its notes on the dock; "Open in Rerun" brings the main window up on its
    // conversation, and the pip goes.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].hide())
    await leadScoutButton.click()
    const openInRerun = dock.getByRole('button', { name: 'Open in Rerun' })
    await openInRerun.waitFor()
    check(!(await mainVisible(app)), 'the main window stays away while the notes show on the dock')
    await step('notes of a coworker on the dock', { target: dock })
    await openInRerun.click()
    await waitUntil(() => mainVisible(app), Boolean, 'the main window comes back')
    await page.getByText(LEAD_SCOUT.name).first().waitFor()
    await waitUntil(() => leadScoutButton.innerText(), (text) => text.trim() === '', 'opening the conversation clears the pip')
    await step('conversation opened from the dock')

    // The Chief of Staff leads the rail, drawn as its orb, and opens its conversation.
    const foremanButton = dock.locator('button:has([data-dock-foreman])')
    check((await railNames(dock))[0] === (await foremanButton.getAttribute('aria-label')), 'the Chief of Staff leads the rail')
    const foremanLine = page.getByText('All three, start with Lead Scout.').first()
    const leadScoutComposer = page.getByPlaceholder(`Message ${LEAD_SCOUT.name}...`)
    check(await leadScoutComposer.isVisible(), 'the conversation of Lead Scout is open before the click')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].hide())
    await foremanButton.click()
    await waitUntil(() => mainVisible(app), Boolean, 'the main window comes back for the Chief of Staff')
    await foremanLine.waitFor({ timeout: 30_000 })
    await waitUntil(() => leadScoutComposer.isVisible(), (visible) => !visible, 'the conversation of Lead Scout makes way for the Chief of Staff')
    check(true, 'a click on the Chief of Staff opens its conversation')
    await step('Chief of Staff opened from the dock')

    // A buddy dragged to the top of the rail stays there: the shell keeps the order in its settings.
    const sidebarBefore = await sidebarOrders(admin, workspaceId)
    const railBefore = await railNames(dock)
    const last = railBefore.at(-1)
    const from = await dock.getByRole('button', { name: last, exact: true }).boundingBox()
    const to = await foremanButton.boundingBox()
    await dock.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await dock.mouse.down()
    await dock.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 12 })
    await dock.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 2 })
    await dock.mouse.up()
    const reordered = await waitUntil(() => railNames(dock), (names) => names[0] === last, `${last} moves to the top of the rail`)
    const shownIds = (view) => view.state.coworkers.map((coworker) => coworker.id)
    const savedView = await waitUntil(() => dock.evaluate(() => window.rerunShell.coworkerDock.get()), (view) => view.state.coworkers[0].name === last, 'the shell keeps the order the rail was dragged to')
    const stored = await readDockSettings(app)
    check(Object.values(stored.arrangements ?? {}).some((arrangement) => arrangement.order[0] === shownIds(savedView)[0]), `the order is written in the settings of the app (${JSON.stringify(stored.arrangements)})`)
    check(JSON.stringify(await sidebarOrders(admin, workspaceId)) === JSON.stringify(sidebarBefore), 'the order of the sidebar is untouched')
    await step('dock reordered', { target: dock })

    // Right-click on a buddy: its menu hides it from the dock, the app still has it.
    await recordDockMenus(app)
    await dock.getByRole('button', { name: LEAD_SCOUT.name }).click({ button: 'right' })
    await clickDockMenuItem(app, [`Hide ${LEAD_SCOUT.name} from Dock`])
    await waitUntil(() => railNames(dock), (names) => !names.includes(LEAD_SCOUT.name), 'the hidden coworker leaves the rail')
    check(await page.getByText(LEAD_SCOUT.name).first().isVisible(), 'the hidden coworker stays in the app')
    await step('coworker hidden from the dock', { target: dock })

    // The two windows reloaded: the dock keeps its order and the hidden coworker.
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })
    await dock.reload()
    const afterReload = await waitUntil(() => railNames(dock), (names) => names.length > 0, 'the dock draws again after the reload')
    check(afterReload[0] === last && !afterReload.includes(LEAD_SCOUT.name), `the order and the hidden coworker survive a reload (${afterReload.join(', ')})`)

    // "Show in Dock" brings it back, where it was.
    await dock.getByRole('button', { name: last, exact: true }).click({ button: 'right' })
    await clickDockMenuItem(app, ['Show in Dock', LEAD_SCOUT.name])
    const restored = await waitUntil(() => railNames(dock), (names) => names.includes(LEAD_SCOUT.name), 'Show in Dock brings the coworker back')
    check(restored.join() === reordered.join(), `back at its place in the order (${restored.join(', ')})`)
    await shell.setSystemTheme('dark')
    await step('dock reordered, dark', { target: dock })
    await shell.setSystemTheme('light')

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

    // The bottom edge of the rail dragged up: the rail stops growing there and its coworkers scroll,
    // its top stays put. A double click on the edge lets it grow with them again.
    const bottomEdge = dock.getByRole('separator', { name: 'Resize' }).last()
    const railBox = () => bottomEdge.evaluate((edge) => edge.parentElement.getBoundingClientRect().toJSON())
    const tall = await railBox()
    const grip = await bottomEdge.boundingBox()
    await dock.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await dock.mouse.down()
    await dock.mouse.move(grip.x + grip.width / 2, tall.top - 500, { steps: 5 })
    await dock.mouse.up()
    const shortView = await waitUntil(() => dock.evaluate(() => window.rerunShell.coworkerDock.get()), (view) => view.maxHeight !== null, 'the shell keeps the height the rail was dragged to')
    check(shortView.maxHeight === 120, `never shorter than the grip, a coworker and the "+" (${shortView.maxHeight})`)
    const short = await railBox()
    check(Math.round(short.height) <= 120 && Math.abs(short.top - tall.top) <= 1, `the rail shrinks from its bottom edge (${JSON.stringify({ tall, short })})`)
    await step('dock resized', { target: dock })
    await bottomEdge.dblclick()
    await waitUntil(() => dock.evaluate(() => window.rerunShell.coworkerDock.get()), (view) => view.maxHeight === null, 'a double click on the edge lets it grow again')
    await waitUntil(railBox, (box) => Math.round(box.height) === Math.round(tall.height), 'back to the height of its coworkers')

    // The top edge follows the pointer from where it was grabbed, and the bottom stays on its pixel,
    // while it is dragged and once the shell has the new height.
    const topEdge = dock.getByRole('separator', { name: 'Resize' }).first()
    const before = await railBox()
    const topGrip = await topEdge.boundingBox()
    await dock.mouse.move(topGrip.x + topGrip.width / 2, topGrip.y + topGrip.height / 2)
    await dock.mouse.down()
    await dock.mouse.move(topGrip.x + topGrip.width / 2, topGrip.y + topGrip.height / 2 + 30, { steps: 5 })
    const dragged = await railBox()
    check(Math.abs(dragged.top - (before.top + 30)) <= 1 && Math.abs(dragged.bottom - before.bottom) <= 1, `the top edge follows the pointer, the bottom stays (${JSON.stringify({ before, dragged })})`)
    await dock.mouse.up()
    await waitUntil(() => dock.evaluate(() => window.rerunShell.coworkerDock.get()), (view) => view.maxHeight !== null, 'the shell keeps the height the top edge was dragged to')
    const settled = await railBox()
    check(Math.abs(settled.top - dragged.top) <= 1 && Math.abs(settled.bottom - before.bottom) <= 1, `the rail stays where it was let go (${JSON.stringify({ dragged, settled })})`)
    await topEdge.dblclick()
    await waitUntil(() => dock.evaluate(() => window.rerunShell.coworkerDock.get()), (view) => view.maxHeight === null, 'a double click on the top edge lets it grow again')

    // The grip stays under the pointer while the rail moves along the edge.
    const moveGrip = dock.locator('button.cursor-grab').first()
    const gripStart = await moveGrip.boundingBox()
    await dock.mouse.move(gripStart.x + gripStart.width / 2, gripStart.y + gripStart.height / 2)
    await dock.mouse.down()
    await dock.mouse.move(gripStart.x + gripStart.width / 2, gripStart.y + gripStart.height / 2 + 60, { steps: 5 })
    const gripMoved = await moveGrip.boundingBox()
    check(Math.abs(gripMoved.y - gripStart.y - 60) <= 1, `the grip follows the pointer (${JSON.stringify({ gripStart, gripMoved })})`)
    await dock.mouse.move(gripStart.x + gripStart.width / 2, gripStart.y + gripStart.height / 2, { steps: 5 })
    await dock.mouse.up()

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
    await dock.getByRole('button', { name: LEAD_SCOUT.name, exact: true }).waitFor()

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
