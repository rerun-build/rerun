// Quick ask: the floating field for the Chief of Staff, end to end on the local hub:
//   pnpm verify:desktop --onboarded --engine --scenario apps/desktop-app/e2e/quick-ask.mjs
// (`--engine`: without an engine behind the workspace the question is refused and never shows.)
//
// Playwright cannot press a global shortcut: the window is opened by the File menu's item, which
// runs the same toggle, and the shortcut's registration is checked on its own. The second half
// changes the shortcut, from the page and from the recorder of the Desktop tab.

function check(condition, message) {
    if (!condition) throw new Error(`Check failed: ${message}`)
    console.log(`[e2e] ok: ${message}`)
}

const isRegistered = (app, accelerator) => app.evaluate(({ globalShortcut }, keys) => globalShortcut.isRegistered(keys), accelerator)
const menuAccelerator = (app) => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').accelerator ?? null)
const setShortcut = (page, accelerator) => page.evaluate((keys) => window.rerunShell.quickAsk.setShortcut('text', keys), accelerator)

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

const QUESTION = 'What did my coworkers finish today?'

export default async function quickAskScenario({ app, page, step, base }) {
    await page.goto(base)
    await page.waitForSelector('[data-foreman-split]', { timeout: 60_000 })
    const initial = await page.evaluate(() => window.rerunShell.settings.get())
    check(initial.quickAskShortcut === (process.platform === 'darwin' ? 'Shift+Command+Space' : 'Control+Shift+Space'), `the default shortcut is set (${initial.quickAskShortcut})`)
    check(await isRegistered(app, initial.quickAskShortcut), 'the global shortcut is registered')
    check((await menuAccelerator(app)) === initial.quickAskShortcut, 'the File menu shows the shortcut from the launch')
    check((await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').accelerator ?? null)) === initial.quickAskVoiceShortcut, 'and the voice one')

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].hide())
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').click())
    const quick = await waitUntil(() => app.windows().find((candidate) => candidate.url().endsWith('/quick-ask')), Boolean, 'the Quick ask window opens')
    await quick.waitForSelector('[data-quick-ask] textarea')
    // The shell shows the window once the page has finished loading, which can come after the field.
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))?.isVisible() ?? false), Boolean, 'the Quick ask window shows')
    const box = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))
        return { visible: window.isVisible(), onTop: window.isAlwaysOnTop(), bounds: window.getBounds() }
    })
    check(box.visible && box.onTop && box.bounds.width === 640, `a small window floats on top (${JSON.stringify(box)})`)
    const strip = await quick.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--shell-titlebar-h').trim())
    check(strip === '0px', 'the Quick ask window has no title strip')
    await step('quick ask window', { target: quick })

    await quick.fill('[data-quick-ask] textarea', QUESTION)
    await step('quick ask typed', { target: quick })
    await quick.keyboard.press('Enter')
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))?.isVisible() ?? false), (visible) => !visible, 'Enter puts the window away')
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].isVisible()), Boolean, 'the main window comes back')
    await page.getByText(QUESTION).first().waitFor({ timeout: 30_000 })
    check(true, 'the question reaches the Chief of Staff in the main window')
    check((await page.evaluate(() => localStorage.getItem('rerun:quick-ask'))) === null, 'the handed-over text is taken once')
    await step('question asked in the main window')

    // Escape puts it away without sending anything.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').click())
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))?.isVisible() ?? false), Boolean, 'the window opens again')
    await quick.fill('[data-quick-ask] textarea', 'never sent')
    await quick.keyboard.press('Escape')
    await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))?.isVisible() ?? false), (visible) => !visible, 'Escape puts it away')
    check((await page.getByText('never sent').count()) === 0, 'nothing is sent on Escape')

    // The shortcut changes: the new keys are registered, the old ones let go, the menu follows.
    const moved = await setShortcut(page, 'Control+Alt+K')
    check(moved.status === 'ok' && moved.settings.quickAskShortcut === 'Control+Alt+K' && moved.settings.quickAsk, 'a new shortcut is saved')
    check((await isRegistered(app, 'Control+Alt+K')) && !(await isRegistered(app, initial.quickAskShortcut)), 'the new keys are registered, the old ones let go')
    await waitUntil(() => menuAccelerator(app), (accelerator) => accelerator === 'Control+Alt+K', 'the File menu shows the new shortcut')

    // Recording a new one holds the current one back, and gives it back.
    await page.evaluate(() => window.rerunShell.quickAsk.pauseShortcuts(true))
    await waitUntil(() => isRegistered(app, 'Control+Alt+K'), (registered) => !registered, 'the shortcut is held back while recording')
    await page.evaluate(() => window.rerunShell.quickAsk.pauseShortcuts(false))
    await waitUntil(() => isRegistered(app, 'Control+Alt+K'), Boolean, 'and comes back when recording ends')

    // Keys the shell refuses, and keys someone else holds, leave the shortcut as it was.
    const invalid = await setShortcut(page, 'Shift+K')
    check(invalid.status === 'invalid' && invalid.settings.quickAskShortcut === 'Control+Alt+K', 'a shortcut without a modifier is refused')
    await app.evaluate(({ globalShortcut }) => globalShortcut.register('Control+Alt+J', () => {}))
    const taken = await setShortcut(page, 'Control+Alt+J')
    check(taken.status === 'taken' && taken.settings.quickAskShortcut === 'Control+Alt+K' && (await isRegistered(app, 'Control+Alt+K')), `keys already held are refused, the previous shortcut stays (${taken.status})`)
    await app.evaluate(({ globalShortcut }) => globalShortcut.unregister('Control+Alt+J'))

    // No shortcut is Quick ask off; the switch of an older web app still turns it back on.
    const off = await setShortcut(page, null)
    check(off.status === 'ok' && off.settings.quickAskShortcut === null && !off.settings.quickAsk && !(await isRegistered(app, 'Control+Alt+K')), 'no shortcut turns Quick ask off')
    const legacy = await page.evaluate(() => window.rerunShell.settings.set({ quickAsk: true }))
    check(legacy.quickAskShortcut === initial.quickAskShortcut && (await isRegistered(app, initial.quickAskShortcut)), 'the old switch puts the default back')

    // The recorder of the Desktop tab.
    await page.getByRole('button', { name: /workspace/i }).first().click()
    await page.getByRole('menuitem', { name: /account/i }).first().click()
    await page.getByRole('tab', { name: 'Desktop app' }).click()
    const recorder = page.locator('#desktop-quick-ask')
    await recorder.waitFor()
    await step('desktop tab with the shortcut')
    await recorder.click()
    await waitUntil(() => isRegistered(app, initial.quickAskShortcut), (registered) => !registered, 'clicking the recorder holds the shortcut back')
    await page.keyboard.press('Meta+Space')
    await page.getByText(/is used by Spotlight|is used by the system|is used by/).first().waitFor()
    await step('a shortcut of the system is refused')
    await page.keyboard.press('Control+Alt+L')
    await waitUntil(() => page.evaluate(() => window.rerunShell.settings.get()), (settings) => settings.quickAskShortcut === 'Control+Alt+L', 'a shortcut typed in the recorder is saved')
    check(await isRegistered(app, 'Control+Alt+L'), 'and registered')
    await step('shortcut recorded')
    await recorder.click()
    await page.keyboard.press('Backspace')
    await page.getByText('Off. Record a shortcut to turn it on.').waitFor()
    check(!(await isRegistered(app, 'Control+Alt+L')), '⌫ in the recorder turns Quick ask off')
    await step('quick ask off')
    await setShortcut(page, null)
    await page.evaluate(() => window.rerunShell.settings.set({ quickAsk: true }))

    // Voice: Space held in the empty field records, letting go sends the transcript. The microphone
    // is an oscillator and the transcription is answered in the page: neither exists on a test box.
    const SPOKEN = 'What is on my calendar tomorrow?'
    const quickWindowVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/quick-ask'))?.isVisible() ?? false)
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').click())
    await waitUntil(quickWindowVisible, Boolean, 'the window opens for a spoken question')
    await quick.evaluate((spoken) => {
        navigator.mediaDevices.getUserMedia = async () => {
            const context = new AudioContext()
            const tone = context.createOscillator()
            const destination = context.createMediaStreamDestination()
            tone.connect(destination)
            tone.start()
            return destination.stream
        }
        const realFetch = window.fetch.bind(window)
        window.fetch = (input, init) => (String(input).includes('/api/voice/transcribe') ? Promise.resolve(new Response(JSON.stringify({ text: spoken }), { headers: { 'Content-Type': 'application/json' } })) : realFetch(input, init))
    }, SPOKEN)
    await quick.waitForSelector('[data-quick-ask][data-step="text"] textarea')
    // Escape kept the draft typed above: Space only talks in an empty field.
    await quick.fill('[data-quick-ask] textarea', '')
    await step('quick ask with the voice hint', { target: quick })
    await quick.keyboard.down('Space')
    await quick.waitForSelector('[data-quick-ask][data-step="listening"]')
    await new Promise((done) => setTimeout(done, 1200))
    await step('quick ask listening', { target: quick })
    await quick.keyboard.up('Space')
    await quick.waitForSelector('[data-quick-ask][data-step="sent"]', { timeout: 15_000 })
    await step('quick ask sent', { target: quick })
    await waitUntil(quickWindowVisible, (visible) => !visible, 'the window goes once the question is sent')
    await page.getByText(SPOKEN).first().waitFor({ timeout: 30_000 })
    check(true, 'the spoken question reaches the Chief of Staff')

    // While it listens, the window stays up when it loses the focus (the system's microphone prompt).
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').click())
    await waitUntil(quickWindowVisible, Boolean, 'the window opens again')
    await quick.evaluate(() => window.rerunShell.quickAsk.hold(true))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].focus())
    await new Promise((done) => setTimeout(done, 800))
    check(await quickWindowVisible(), 'a held window stays up when it loses the focus')
    await quick.evaluate(() => window.rerunShell.quickAsk.close())
    await waitUntil(quickWindowVisible, (visible) => !visible, 'closing it lets go of the hold')

    // The voice shortcut: Quick ask opens listening, a second press sends.
    const settingsNow = await page.evaluate(() => window.rerunShell.settings.get())
    check(settingsNow.quickAskVoiceShortcut === 'Alt+Shift+Space' && (await isRegistered(app, 'Alt+Shift+Space')), 'the voice shortcut is ⌥⇧Space and registered')
    check((await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').accelerator)) === 'Alt+Shift+Space', 'the File menu shows it')
    const VOICED = 'Draft the weekly update for the team'
    await quick.evaluate((spoken) => {
        const realFetch = window.fetch.bind(window)
        window.fetch = (input, init) => (String(input).includes('/api/voice/transcribe') ? Promise.resolve(new Response(JSON.stringify({ text: spoken }), { headers: { 'Content-Type': 'application/json' } })) : realFetch(input, init))
    }, VOICED)
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await waitUntil(quickWindowVisible, Boolean, 'the voice shortcut brings the window up')
    await quick.waitForSelector('[data-quick-ask][data-step="listening"]')
    await new Promise((done) => setTimeout(done, 1200))
    await step('voice shortcut listening', { target: quick })
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="sent"]', { timeout: 15_000 })
    await waitUntil(quickWindowVisible, (visible) => !visible, 'a second press sends, and the window goes')
    await page.getByText(VOICED).first().waitFor({ timeout: 30_000 })
    check(true, 'the question asked by the voice shortcut reaches the Chief of Staff')

    // Escape throws it away.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="listening"]')
    await quick.keyboard.press('Escape')
    await quick.waitForSelector('[data-quick-ask][data-step="text"]')
    check(true, 'Escape cancels a voice question')
    await quick.evaluate(() => window.rerunShell.quickAsk.close())

    // Put away while it listens (the text shortcut toggles it), it stops listening and sends nothing.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="listening"]')
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').click())
    await waitUntil(quickWindowVisible, (visible) => !visible, 'the text shortcut puts a listening window away')
    await quick.waitForSelector('[data-quick-ask][data-step="text"]', { state: 'attached' })
    check((await quick.evaluate(() => localStorage.getItem('rerun:quick-ask'))) === null, 'a window put away stops listening and sends nothing')

    // A draft typed before a spoken question is still in the field after it.
    const DRAFT = 'half a thought'
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask').click())
    await waitUntil(quickWindowVisible, Boolean, 'the window opens on its field')
    await quick.fill('[data-quick-ask] textarea', DRAFT)
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="listening"]')
    await new Promise((done) => setTimeout(done, 1200))
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="sent"]', { timeout: 15_000 })
    await waitUntil(quickWindowVisible, (visible) => !visible, 'the spoken question leaves')
    await quick.waitForSelector('[data-quick-ask][data-step="text"]', { state: 'attached' })
    check((await quick.inputValue('[data-quick-ask] textarea')) === DRAFT, 'the draft outlives the spoken question')
    await quick.fill('[data-quick-ask] textarea', '')

    // Escape while the recording is written out drops it: the transcription here never answers.
    await quick.evaluate(() => {
        const realFetch = window.fetch.bind(window)
        window.fetch = (input, init) => (String(input).includes('/api/voice/transcribe') ? new Promise(() => {}) : realFetch(input, init))
    })
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="listening"]')
    await new Promise((done) => setTimeout(done, 1200))
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="transcribing"]')
    await quick.keyboard.press('Escape')
    await quick.waitForSelector('[data-quick-ask][data-step="text"]')
    check((await quickWindowVisible()) && (await quick.evaluate(() => localStorage.getItem('rerun:quick-ask'))) === null, 'Escape drops a question being written out, the window stays on its field')
    await quick.evaluate(() => window.rerunShell.quickAsk.close())
    await waitUntil(quickWindowVisible, (visible) => !visible, 'the window closes')

    // The microphone refused: Escape puts the window away, it comes back on its field, and it no
    // longer stays up when it loses the focus.
    await quick.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => {
            throw new DOMException('Permission denied', 'NotAllowedError')
        }
    })
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="micDenied"]')
    await step('quick ask without the microphone', { target: quick })
    await quick.keyboard.press('Escape')
    await waitUntil(quickWindowVisible, (visible) => !visible, 'Escape puts the refused microphone screen away')
    await quick.waitForSelector('[data-quick-ask][data-step="text"]', { state: 'attached' })
    check(true, 'and the window comes back on its field')
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('quick-ask-voice').click())
    await quick.waitForSelector('[data-quick-ask][data-step="micDenied"]')
    await new Promise((done) => setTimeout(done, 800))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].focus())
    await waitUntil(quickWindowVisible, (visible) => !visible, 'a refused microphone no longer holds the window up')

    // The two shortcuts cannot share keys.
    const clash = await page.evaluate((keys) => window.rerunShell.quickAsk.setShortcut('voice', keys), initial.quickAskShortcut)
    check(clash.status === 'taken' && clash.settings.quickAskVoiceShortcut === 'Alt+Shift+Space', 'the voice shortcut cannot take the text one’s keys')
    const voiceOff = await page.evaluate(() => window.rerunShell.quickAsk.setShortcut('voice', null))
    check(voiceOff.settings.quickAskVoiceShortcut === null && !(await isRegistered(app, 'Alt+Shift+Space')), 'the voice shortcut turns off on its own')
    await page.evaluate(() => window.rerunShell.quickAsk.setShortcut('voice', 'Alt+Shift+Space'))
}

