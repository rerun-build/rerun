import { messageText, stripBridgePrefix } from '@rerun/contracts'
import { isTextUIPart, isToolUIPart, type UIMessage } from 'ai'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import { Directory, File, Paths } from 'expo-file-system'
import * as Speech from 'expo-speech'
import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionErrorEvent, type ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition'

import * as Haptics from '@/lib/haptics'

import { spokenText, takeSentences } from './speech-chunks'

// `ringing` lasts from the tap on the call button to the first word of the coworker picking up.
export type CallPhase = 'ringing' | 'listening' | 'thinking' | 'speaking' | 'blocked'

// One turn of the call, in milliseconds. `endpointMs` runs from the last word heard to the send,
// `acceptedMs` (the hub answers: it and the engine have taken the run) and the four `first*` from the
// send, and `totalMs` from the last word heard to the first sound of the answer.
export type TurnTiming = { turn: number; heard: string; endpointMs: number; acceptedMs: number | null; firstChunkMs: number | null; firstTextMs: number | null; firstSentenceMs: number | null; firstAudioMs: number | null; totalMs: number | null }

// The voices a call can speak with. The hub knows all but the last by the same names; the last one
// is the phone's own synthesizer, which is also what says a sentence the hub could not.
export const CALL_VOICE_IDS = ['sarah', 'george', 'lily', 'will', 'charlotte', 'leo', 'eve', 'marie', 'iphone'] as const
export type CallVoiceId = (typeof CALL_VOICE_IDS)[number]
const PHONE_VOICE: CallVoiceId = 'iphone'

// What hums while the call waits for the coworker. `off` leaves the line silent.
export const WAIT_SOUND_IDS = ['mellow', 'off'] as const
export type WaitSoundId = (typeof WAIT_SOUND_IDS)[number]
const WAIT_SOUNDS: Record<Exclude<WaitSoundId, 'off'>, number> = {
    mellow: require('@/assets/sounds/call-wait-mellow.wav'),
}

export type CallState = { phase: CallPhase; heard: string; saying: string; tool: string | null; turns: TurnTiming[]; error: string | null; lang: string; silenceMs: number; voice: string | null; onDevice: boolean; pickedUpAt: number | null; voiceId: CallVoiceId; waitSoundId: WaitSoundId }

// `runId` names the run the hub last answered with: it changes when the answer to a send comes back.
// `speech` is where the hub reads a sentence out loud, null while nobody is signed in.
export type CallDeps = { send: (text: string) => void; stop: () => void; model: () => string; runId: () => string | null; speech: (text: string, voice: CallVoiceId, lang: string) => { url: string; headers: Record<string, string> } | null }

// A sentence being fetched as audio while the one before it plays.
type Clip = { sentence: string; file: Promise<File | null> }

type Turn = { n: number; heard: string; sent: string; speechEndAt: number; sentAt: number; acceptedAt: number | null; firstChunkAt: number | null; firstTextAt: number | null; firstSentenceAt: number | null; firstAudioAt: number | null; offset: number; pending: number; clips: Clip[]; playing: boolean; sawBusy: boolean; streamDone: boolean; settled: boolean }

const SILENCE_STEPS_MS = [700, 1000, 1300]
// A question is over when it is asked: its mark ends the turn sooner than a trailing thought would.
const QUESTION_SILENCE_MS = 450
const REOPEN_MIC_MS = 250
const ACCEPTED_POLL_MS = 40
const MIC_LEVEL_MS = 80
const MIC_LEVEL_MAX = 10
const PICK_UP_TURN = 0
const CALL_BRIEF = "[Phone call rules, for the whole call: you are speaking out loud. Answer right away, in one to three short spoken sentences, no markdown, no lists, no links, no emoji. Before using a tool, say in one short sentence what you are about to do. Reply in the caller's language.]"
const CALL_TAG = '[Phone call: answer right away, out loud, in one to three short sentences.]'
const WAIT_SOUND_VOLUME = 1
// A player that ends lets go of the phone's audio session by default, which closes the microphone
// the call has just reopened: the caller's first word came back as a whole turn.
const KEEP_SESSION = { keepAudioSessionActive: true }
const CLIP_LEVEL_MS = 110
// A clip that never starts (a file the player cannot read) must not hold the call.
const CLIP_STALL_MS = 8000
const FATAL_MIC_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported'])
const VOICE_TIERS = ['premium', 'enhanced', 'compact']

// The coworker picks up before the caller says anything: the ringing covers the cold start of a new
// conversation, and the first real question lands on a warm one.
function pickUpMessage(lang: string): string {
    return `[Phone call] You are being called, on a phone set to ${lang}. Pick up with one very short spoken greeting in that language, then wait for the caller.\n\n${CALL_BRIEF}`
}

function turnMessage(heard: string): string {
    return `${heard}\n\n${CALL_TAG}`
}

function endsOnQuestion(transcript: string): boolean {
    return /[?!]["')\]»]*\s*$/.test(transcript)
}

// iOS refines a transcript after the person stopped talking (a capital, a comma): only new letters
// count as speech, or the silence would never be long enough.
function lettersOf(transcript: string): string {
    return transcript.toLowerCase().replace(/[\s.,;:!?…'"«»()-]+/g, '')
}

// A text part the model has closed ends its sentence even without a terminator: what comes next is
// a tool call, and the announcement before it has to be said now.
function replyText(message: UIMessage): string {
    return message.parts.map(part => (isTextUIPart(part) ? part.text + (part.state === 'done' ? '\n' : '') : '')).join('')
}

function liveToolOf(message: UIMessage): string | null {
    const part = message.parts.findLast(candidate => !candidate.type.startsWith('data-'))
    if (!part || !isToolUIPart(part) || (part.state !== 'input-streaming' && part.state !== 'input-available')) return null
    return stripBridgePrefix('toolName' in part ? part.toolName : part.type.slice('tool-'.length))
}

const clipFolder = () => new Directory(Paths.cache, 'call-clips')

async function bestVoice(lang: string): Promise<Speech.Voice | null> {
    const voices = await Speech.getAvailableVoicesAsync().catch(() => [])
    const base = lang.slice(0, 2).toLowerCase()
    const rank = (voice: Speech.Voice) => {
        const tier = VOICE_TIERS.findIndex(name => voice.identifier.includes(`.${name}.`))
        return (tier === -1 ? 0 : (VOICE_TIERS.length - tier) * 2) + (voice.language.toLowerCase() === lang.toLowerCase() ? 1 : 0)
    }
    return voices.filter(voice => voice.language.toLowerCase().startsWith(base)).sort((a, b) => rank(b) - rank(a))[0] ?? null
}

// A phone call with a coworker, turn by turn: the phone's recognizer hears, the conversation's own
// chat answers, the phone's synthesizer says the answer sentence by sentence as it streams.
export class CallSession {
    private state: CallState
    private readonly listeners = new Set<() => void>()
    private deps: CallDeps | null = null
    private subscriptions: { remove: () => void }[] = []
    private generation = 0
    private live = false
    private micOpen = false
    private heardLetters = ''
    private lastSpeechAt = 0
    private silenceTimer: ReturnType<typeof setTimeout> | null = null
    private reopenTimer: ReturnType<typeof setTimeout> | null = null
    private acceptedPoll: ReturnType<typeof setInterval> | null = null
    private phoneVoiceId: string | undefined
    private waitSound: AudioPlayer | null = null
    private clipPlayer: AudioPlayer | null = null
    private clipCount = 0
    private turn: Turn | null = null
    private turnCount = PICK_UP_TURN
    private levelListener: ((level: number) => void) | null = null

    constructor(lang: string) {
        this.state = { phase: 'ringing', heard: '', saying: '', tool: null, turns: [], error: null, lang, silenceMs: 1000, voice: null, onDevice: false, pickedUpAt: null, voiceId: 'sarah', waitSoundId: 'mellow' }
    }

    // How loud the call is right now, from 0 to 1: the caller's voice while they talk, a beat on each
    // word the coworker says. Handed straight to an animation, never through the state.
    onLevel(listener: ((level: number) => void) | null) {
        this.levelListener = listener
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    getSnapshot = () => this.state

    private set(patch: Partial<CallState>) {
        this.state = { ...this.state, ...patch }
        this.listeners.forEach(listener => listener())
    }

    async start(deps: CallDeps) {
        const generation = ++this.generation
        this.deps = deps
        this.live = true
        this.subscriptions = [
            ExpoSpeechRecognitionModule.addListener('result', this.onResult),
            ExpoSpeechRecognitionModule.addListener('end', this.onMicClosed),
            ExpoSpeechRecognitionModule.addListener('error', this.onMicError),
            ExpoSpeechRecognitionModule.addListener('volumechange', event => {
                if (this.state.phase === 'listening') this.levelListener?.(Math.min(1, Math.max(0, event.value / MIC_LEVEL_MAX)))
            }),
        ]
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync().catch(() => null)
        if (generation !== this.generation) return
        if (!permission?.granted) return this.set({ phase: 'blocked', error: 'Microphone and speech recognition are not allowed for Rerun.' })
        this.set({ onDevice: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition() })
        await Promise.all([this.pickVoice(), setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {})])
        if (generation !== this.generation) return
        this.loadWaitSound()
        this.beginTurn('', pickUpMessage(this.state.lang), Date.now())
    }

    dispose() {
        if (!this.live) return
        this.generation++
        this.live = false
        this.clearTimers()
        this.subscriptions.forEach(subscription => subscription.remove())
        this.subscriptions = []
        if (this.micOpen) ExpoSpeechRecognitionModule.abort()
        this.micOpen = false
        const turn = this.turn
        if (turn && !turn.settled) {
            this.settle(turn)
            if (!turn.streamDone) this.deps?.stop()
        }
        this.turn = null
        this.hush()
        this.waitSound?.remove()
        this.waitSound = null
        setAudioModeAsync({ allowsRecording: false }).catch(() => {})
        try {
            const clips = clipFolder()
            if (clips.exists) clips.delete()
        } catch {}
    }

    // A tap while the coworker thinks or talks: it stops there and the caller has the floor again.
    interrupt() {
        const turn = this.turn
        if (!turn || turn.settled) return
        this.settle(turn)
        this.hush()
        if (!turn.streamDone) this.deps?.stop()
        this.listen()
    }

    cycleWaitSound() {
        this.set({ waitSoundId: WAIT_SOUND_IDS[(WAIT_SOUND_IDS.indexOf(this.state.waitSoundId) + 1) % WAIT_SOUND_IDS.length] })
        this.loadWaitSound()
    }

    // A faint sound on a loop while the call waits for the coworker: the line is alive, nobody talks.
    private loadWaitSound() {
        this.waitSound?.remove()
        this.waitSound = null
        if (this.state.waitSoundId === 'off') return
        this.waitSound = createAudioPlayer(WAIT_SOUNDS[this.state.waitSoundId], KEEP_SESSION)
        this.waitSound.loop = true
        this.waitSound.volume = WAIT_SOUND_VOLUME
    }

    cycleVoice() {
        this.set({ voiceId: CALL_VOICE_IDS[(CALL_VOICE_IDS.indexOf(this.state.voiceId) + 1) % CALL_VOICE_IDS.length] })
    }

    cycleSilence() {
        const next = SILENCE_STEPS_MS[(SILENCE_STEPS_MS.indexOf(this.state.silenceMs) + 1) % SILENCE_STEPS_MS.length]
        this.set({ silenceMs: next })
    }

    async setLang(lang: string) {
        this.set({ lang })
        await this.pickVoice()
        if (this.state.phase !== 'listening' || !this.micOpen) return
        this.forgetHeard()
        ExpoSpeechRecognitionModule.abort()
    }

    // The conversation turned the message down because the run just stopped still holds it.
    refused() {
        const turn = this.turn
        if (!turn || turn.settled) return
        this.settle(turn)
        this.set({ error: 'The previous answer was still running. Say it again.' })
        this.listen()
    }

    onStream(messages: UIMessage[], busy: boolean, error: Error | undefined) {
        const turn = this.turn
        if (!turn || turn.settled || turn.streamDone) return
        if (busy) turn.sawBusy = true
        if (error && turn.sawBusy) {
            this.settle(turn)
            this.set({ error: error.message })
            return this.listen()
        }
        const asked = messages.findLastIndex(message => message.role === 'user')
        const reply = asked >= 0 && messageText(messages[asked]) === turn.sent ? messages.slice(asked + 1).findLast(message => message.role === 'assistant') : undefined
        const text = reply ? replyText(reply) : ''
        if (reply && text.length >= turn.offset) {
            const now = Date.now()
            if (turn.firstChunkAt === null && reply.parts.length > 0) turn.firstChunkAt = now
            if (turn.firstTextAt === null && text.trim()) turn.firstTextAt = now
            const { sentences, next } = takeSentences(text, turn.offset, turn.firstSentenceAt === null)
            turn.offset = next
            sentences.forEach(sentence => this.say(turn, sentence))
            const tool = liveToolOf(reply)
            if (tool !== this.state.tool) this.set({ tool })
        }
        if (!turn.sawBusy || busy) return
        turn.streamDone = true
        const rest = spokenText(text.slice(turn.offset))
        turn.offset = text.length
        if (rest) this.say(turn, rest)
        this.listenOnceSaid(turn)
    }

    private async pickVoice() {
        const voice = await bestVoice(this.state.lang)
        this.phoneVoiceId = voice?.identifier
        this.set({ voice: voice?.name ?? null })
    }

    private say(turn: Turn, sentence: string) {
        turn.pending += 1
        if (turn.firstSentenceAt === null) turn.firstSentenceAt = Date.now()
        if (this.state.voiceId === PHONE_VOICE) return this.sayOnPhone(turn, sentence)
        turn.clips.push({ sentence, file: this.fetchClip(sentence) })
        this.playNextClip(turn)
    }

    private heardSaying(turn: Turn, sentence: string) {
        if (turn.settled) return
        this.waitSound?.pause()
        if (turn.firstAudioAt === null) {
            turn.firstAudioAt = Date.now()
            this.showTiming(turn)
            if (turn.n === PICK_UP_TURN) this.pickedUp()
        }
        this.set({ phase: 'speaking', saying: sentence })
    }

    private saidOne(turn: Turn) {
        if (turn.settled) return
        turn.pending -= 1
        this.listenOnceSaid(turn)
    }

    private sayOnPhone(turn: Turn, sentence: string, then?: () => void) {
        const said = () => {
            this.saidOne(turn)
            then?.()
        }
        Speech.speak(sentence, {
            language: this.state.lang,
            voice: this.phoneVoiceId,
            onStart: () => this.heardSaying(turn, sentence),
            onBoundary: () => {
                if (!turn.settled) this.levelListener?.(1)
            },
            onDone: said,
            onError: said,
        })
    }

    private async fetchClip(sentence: string): Promise<File | null> {
        const request = this.deps?.speech(sentence, this.state.voiceId, this.state.lang)
        if (!request) return null
        try {
            const folder = clipFolder()
            folder.create({ intermediates: true, idempotent: true })
            this.clipCount += 1
            return await File.downloadFileAsync(request.url, new File(folder, `${Date.now()}-${this.clipCount}.mp3`), { headers: request.headers })
        } catch (error) {
            console.log('[CALL] speech failed', String(error))
            return null
        }
    }

    // One clip at a time, in the order the sentences came. A sentence the hub could not read is said
    // by the phone instead, so an answer is never cut short.
    private async playNextClip(turn: Turn) {
        if (turn.playing || turn.settled) return
        const clip = turn.clips.shift()
        if (!clip) return
        turn.playing = true
        const file = await clip.file
        if (turn.settled) return
        const next = () => {
            turn.playing = false
            this.playNextClip(turn)
        }
        if (!file) return this.sayOnPhone(turn, clip.sentence, next)

        const player = createAudioPlayer({ uri: file.uri }, { ...KEEP_SESSION, updateInterval: CLIP_LEVEL_MS })
        this.clipPlayer = player
        let over = false
        let started = false
        const finish = () => {
            if (over) return
            over = true
            clearTimeout(stall)
            status.remove()
            player.remove()
            if (this.clipPlayer === player) this.clipPlayer = null
            this.saidOne(turn)
            next()
        }
        const stall = setTimeout(finish, CLIP_STALL_MS)
        const status = player.addListener('playbackStatusUpdate', update => {
            if (turn.settled) return
            if (update.playing && !started) {
                started = true
                clearTimeout(stall)
                this.heardSaying(turn, clip.sentence)
            }
            if (update.playing) this.levelListener?.(0.4 + Math.random() * 0.6)
            if (update.didJustFinish) finish()
        })
        player.play()
    }

    // Everything the call is saying or humming stops at once.
    private hush() {
        Speech.stop().catch(() => {})
        this.waitSound?.pause()
        this.clipPlayer?.pause()
        this.clipPlayer?.remove()
        this.clipPlayer = null
    }

    private listenOnceSaid(turn: Turn) {
        if (!turn.streamDone || turn.pending > 0) return
        this.settle(turn)
        this.listen()
    }

    private pickedUp() {
        if (this.state.pickedUpAt !== null) return
        this.set({ pickedUpAt: Date.now() })
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    }

    private settle(turn: Turn) {
        turn.settled = true
        this.stopAcceptedPoll()
        this.waitSound?.pause()
        if (turn.n === PICK_UP_TURN) this.pickedUp()
        const timing = this.showTiming(turn)
        console.log('[CALL]', JSON.stringify({ model: this.deps?.model(), voice: this.state.voiceId, lang: this.state.lang, onDevice: this.state.onDevice, silenceMs: this.state.silenceMs, ...timing }))
    }

    private showTiming(turn: Turn): TurnTiming {
        const since = (at: number | null) => (at === null ? null : at - turn.sentAt)
        const timing: TurnTiming = { turn: turn.n, heard: turn.heard, endpointMs: turn.sentAt - turn.speechEndAt, acceptedMs: since(turn.acceptedAt), firstChunkMs: since(turn.firstChunkAt), firstTextMs: since(turn.firstTextAt), firstSentenceMs: since(turn.firstSentenceAt), firstAudioMs: since(turn.firstAudioAt), totalMs: turn.firstAudioAt === null ? null : turn.firstAudioAt - turn.speechEndAt }
        this.set({ turns: [...this.state.turns.filter(shown => shown.turn !== turn.n), timing] })
        return timing
    }

    private listen() {
        if (!this.live) return
        this.forgetHeard()
        this.set({ phase: 'listening', saying: '', tool: null })
        this.openMic()
    }

    private forgetHeard() {
        this.clearTimers()
        this.heardLetters = ''
        this.set({ heard: '' })
    }

    // A recognizer still closing reopens from its `end` event, which always comes last.
    private openMic() {
        if (!this.live || this.micOpen || this.state.phase !== 'listening') return
        this.micOpen = true
        ExpoSpeechRecognitionModule.start({
            lang: this.state.lang,
            interimResults: true,
            continuous: true,
            maxAlternatives: 1,
            addsPunctuation: true,
            requiresOnDeviceRecognition: this.state.onDevice,
            volumeChangeEventOptions: { enabled: true, intervalMillis: MIC_LEVEL_MS },
            // The recognizer's own default is the `measurement` mode, which plays the answer faintly.
            iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'default' },
        })
    }

    // The response headers are not handed to the chat's caller: the run id they carry is, in a ref.
    private watchAccepted(turn: Turn, runBefore: string | null) {
        this.stopAcceptedPoll()
        this.acceptedPoll = setInterval(() => {
            if (this.deps?.runId() === runBefore) return
            turn.acceptedAt = Date.now()
            this.stopAcceptedPoll()
        }, ACCEPTED_POLL_MS)
    }

    private stopAcceptedPoll() {
        if (this.acceptedPoll) clearInterval(this.acceptedPoll)
        this.acceptedPoll = null
    }

    private clearTimers() {
        if (this.silenceTimer) clearTimeout(this.silenceTimer)
        if (this.reopenTimer) clearTimeout(this.reopenTimer)
        this.silenceTimer = null
        this.reopenTimer = null
    }

    private onResult = (event: ExpoSpeechRecognitionResultEvent) => {
        if (this.state.phase !== 'listening') return
        const transcript = event.results[0]?.transcript ?? ''
        const letters = lettersOf(transcript)
        if (!letters) return
        this.set({ heard: transcript, error: null })
        if (letters !== this.heardLetters) {
            this.heardLetters = letters
            this.lastSpeechAt = Date.now()
        }
        if (event.isFinal) return this.endTurn()
        const silence = endsOnQuestion(transcript) ? Math.min(QUESTION_SILENCE_MS, this.state.silenceMs) : this.state.silenceMs
        if (this.silenceTimer) clearTimeout(this.silenceTimer)
        this.silenceTimer = setTimeout(this.endTurn, Math.max(0, this.lastSpeechAt + silence - Date.now()))
    }

    private onMicClosed = () => {
        this.micOpen = false
        if (!this.live || this.state.phase !== 'listening') return
        if (this.heardLetters) return this.endTurn()
        this.reopenTimer = setTimeout(() => this.openMic(), REOPEN_MIC_MS)
    }

    private onMicError = (event: ExpoSpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted' || event.error === 'no-speech') return
        console.log('[CALL] recognizer error', event.error, event.message)
        if (!FATAL_MIC_ERRORS.has(event.error)) return
        // The phone may lack the on-device model of this language: Apple's servers have it.
        if (this.state.onDevice) return this.set({ onDevice: false })
        this.set({ phase: 'blocked', error: `Speech recognition failed: ${event.message || event.error}` })
    }

    private endTurn = () => {
        this.clearTimers()
        const heard = this.state.heard.trim()
        if (this.state.phase !== 'listening' || !heard || !this.deps) return
        if (this.micOpen) ExpoSpeechRecognitionModule.abort()
        this.heardLetters = ''
        this.levelListener?.(0)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        this.turnCount += 1
        this.set({ phase: 'thinking', saying: '', tool: null })
        this.beginTurn(heard, turnMessage(heard), this.lastSpeechAt || Date.now())
    }

    private beginTurn(heard: string, sent: string, speechEndAt: number) {
        if (!this.deps) return
        const turn: Turn = { n: this.turnCount, heard, sent, speechEndAt, sentAt: Date.now(), acceptedAt: null, firstChunkAt: null, firstTextAt: null, firstSentenceAt: null, firstAudioAt: null, offset: 0, pending: 0, clips: [], playing: false, sawBusy: false, streamDone: false, settled: false }
        this.turn = turn
        console.log('[CALL] sent', JSON.stringify({ turn: turn.n, heard, at: turn.sentAt }))
        this.waitSound?.seekTo(0).catch(() => {})
        this.waitSound?.play()
        this.watchAccepted(turn, this.deps.runId())
        this.deps.send(sent)
    }
}
