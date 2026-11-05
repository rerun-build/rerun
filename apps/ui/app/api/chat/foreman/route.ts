import { convertToModelMessages, createIdGenerator, createUIMessageStream, createUIMessageStreamResponse, pruneMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { foremanClientSchema } from '@rerun/contracts'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { isPhoneStepPending } from '@/cloud/phone.server'
import { logRerunUsage, meteredFetch, type OpenRouterUsage } from '@/cloud/billing.server'
import { MICROS_PER_USD } from '@/cloud/billing'
import { engineSessionOf, loadForemanConversation, saveForemanConversation } from '@/lib/foreman/conversation'
import { dedupeMessagesById } from '@/lib/foreman/dedupe-messages'
import { foremanErrorText } from '@/lib/foreman/error-text'
import { foremanHubApiKey } from '@/lib/foreman/hub-api-key'
import { withInlineAttachments } from '@/lib/foreman/inline-attachments'
import { arrivingIntent } from '@/lib/foreman/opening'
import { forcesFirstPlan, isOnboardingPhase, pinnedPlanBoxes } from '@/lib/foreman/phases'
import { pinPlanBoxesTransform } from '@/lib/foreman/pin-plan-boxes'
import { sealPendingWidgets } from '@/lib/foreman/seal-pending'
import { loadForemanState } from '@/lib/foreman/state'
import { withoutVoiceMarkers } from '@/lib/foreman/strip-voice'
import { foremanSystemPrompt } from '@/lib/foreman/prompt'
import { PHONE_REQUIRED_MESSAGE } from '@/cloud/phone'
import { prepareScript, runScript } from '@/lib/foreman/scripted'
import { foremanActiveTools, foremanTools } from '@/lib/foreman/tools'
import { createForemanTurn } from '@/lib/foreman/turn'

// The onboarding foreman. Unlike /api/chat, which only proxies a box engine's stream, the loop runs
// here: there is no machine yet to run it on, since the build is what claims one. It walks the
// onboarding and nothing past it: once the team is built, the foreman is the one on the workspace's
// engine (./engine/route.ts), and this route turns every request away.
//
// It runs on the Rerun key and is on the house: what it costs is logged, never taken off the
// workspace's credit, and an empty credit does not stop it.

// Enough steps to read, ask and show a card in one turn, few enough that a model stuck in a loop
// stops costing Rerun.
const STEP_LIMIT = 24

// How far back a tool result is still worth its tokens. Everything older keeps its call and its
// text, and loses its payload, which is where nearly all the weight of this transcript sits. Slicing
// the list instead would eventually cut between a tool call and its result and break the turn.
const TOOL_OUTPUT_HORIZON = 'before-last-10-messages' as const

// Named here rather than read off a Rerun tier: the tiers move with what a box costs to run, and
// the onboarding, where a trial decides whether to pay, needs a model that draws its cards instead
// of writing them out as text.
const FOREMAN_MODEL_ID = process.env.RERUN_FOREMAN_MODEL ?? 'openai/gpt-6-sol'

// The onboarding is watched live by someone who has not paid yet. Left to decide its own effort, the
// model spends a minute and a half weighing every name and every Box of a card they will edit anyway;
// on low the plan card comes back in about 25 s.
const ONBOARDING_REASONING = { openrouter: { reasoning: { effort: 'low' } } }

const MESSAGE_ID = createIdGenerator({ prefix: 'fm', size: 16 })

type ForemanRequestBody = { sessionId?: unknown; messages?: unknown; client?: unknown }

export async function POST(req: Request): Promise<Response> {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Un anonyme n'a que la carte d'accueil, qui ne passe pas par ici : le Foreman ne parle qu'à un
    // compte.
    if (ctx.authUser.is_anonymous) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (await isPhoneStepPending(ctx.supabase, ctx.userId)) return Response.json({ error: PHONE_REQUIRED_MESSAGE }, { status: 403 })

    const apiKey = foremanHubApiKey()
    if (!apiKey) return Response.json({ error: 'The foreman is unavailable' }, { status: 503 })

    let body: ForemanRequestBody
    try {
        body = (await req.json()) as ForemanRequestBody
    } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) return Response.json({ error: 'Missing session id' }, { status: 400 })
    if (!Array.isArray(body.messages)) return Response.json({ error: 'Missing messages' }, { status: 400 })

    // Its transcript lives on the engine: saving this turn over it would erase the row that finds it.
    if ((await engineSessionOf(ctx, sessionId))?.backend === 'engine') return Response.json({ error: 'engine_conversation' }, { status: 409 })

    // A question the user walked away from rather than answered would come back as a tool call with
    // no result, which the provider refuses. The browser closes the ones it sees; this covers a
    // reload, a second tab and anything it missed.
    // A transcript where two answers streamed over each other comes back with each of them once,
    // so the model does not read the conversation twice and the save below writes it clean.
    const messages = sealPendingWidgets(dedupeMessagesById(body.messages as UIMessage[]))

    // Where the workspace stands decides both what the foreman is told to do and what it is given
    // to do it with, so it is resolved once and handed to the two of them.
    // Read off the opening message of the transcript rather than off this request: it is the one
    // place it cannot be re-asserted at turn 40, and pruneMessages never touches a user text part,
    // so it survives however long the conversation runs.
    const client = foremanClientSchema.catch('web').parse(body.client)
    const state = await loadForemanState(ctx, req.headers.get('accept-language'), arrivingIntent(messages), client)

    // No machine to build on and none in the pool: the browser shows the waitlist wall and sends
    // nothing, and whatever reaches here anyway is turned away before a single token is spent.
    if (state.phase === 'waitlist') return Response.json({ error: 'engine_waitlist' }, { status: 423 })
    // The team is built: the browser moves to the foreman on the engine, and a message sent from a
    // tab that has not caught up yet is turned away rather than answered by a foreman with no belt.
    if (state.phase === 'companion') return Response.json({ error: 'onboarding_over' }, { status: 409 })

    // The confirmed plan, the trial card and the build are the app's to run, not the model's: no
    // model is called for them, so they cost nothing and wait on nothing but the work itself.
    const prepared = await prepareScript(ctx, state, messages)
    if (prepared && 'script' in prepared) {
        const { script } = prepared
        const scripted = createUIMessageStream<UIMessage>({
            originalMessages: messages,
            generateId: MESSAGE_ID,
            onError: foremanErrorText,
            onFinish: ({ messages: transcript }) => {
                void saveForemanConversation(ctx, sessionId, transcript).catch(err => console.error('[foreman] failed to persist:', err))
            },
            execute: ({ writer }) => runScript(script, { ctx, writer, signal: req.signal }),
        })
        return createUIMessageStreamResponse({ stream: scripted })
    }
    const planError = prepared && 'planError' in prepared ? prepared.planError : null

    const settle = (usage: OpenRouterUsage) => {
        if (typeof usage.cost !== 'number') return
        void logRerunUsage({
            workspaceId: ctx.workspace.id,
            model: FOREMAN_MODEL_ID,
            tier: 'smart',
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            costMicros: Math.round(usage.cost * MICROS_PER_USD),
        }).catch(() => {})
    }

    const openrouter = createOpenAICompatible({
        name: 'openrouter',
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        fetch: meteredFetch(settle),
    })

    // The phase moves inside a turn: save_profile opens the plan between two steps. The turn follows
    // what the tools returned so the next step is given the instructions and the belt of where the
    // workspace now stands.
    const turn = createForemanTurn(state)

    const model = openrouter(FOREMAN_MODEL_ID)

    // Read once, like the plan schema it matches (tools.ts): a schema cannot move between two steps.
    const pinned = pinnedPlanBoxes(state)

    // A confirmed card the app could not write down comes back to the model, which is the one able to
    // fix the plan and show it again.
    const systemFor = (now: typeof state) => (planError ? `${foremanSystemPrompt(now)}\n\nThe card they just confirmed could not be written down: ${planError} Fix the plan and show the card again with show_plan.` : foremanSystemPrompt(now))

    // Resolved before the stream is composed, so nothing is awaited between the writer being handed
    // over and the merge: `execute` resolving with no stream merged closes the response on the spot.
    // `messages` reste intact : c'est lui qui est persisté plus bas et qui redessine la bulle lecteur
    // au rechargement. Seule la copie remise au modèle perd son marqueur vocal et reçoit les fichiers joints.
    const modelMessages = pruneMessages({ messages: await convertToModelMessages(await withInlineAttachments(withoutVoiceMarkers(messages), ctx, sessionId)), toolCalls: TOOL_OUTPUT_HORIZON, reasoning: 'before-last-message' })

    const stream = createUIMessageStream<UIMessage>({
        originalMessages: messages,
        // Sans ça la réponse part sans id, le navigateur s'en fabrique un dans son coin et le hub
        // persiste une chaîne vide : deux tours dans la même conversation, et au rechargement la
        // pile rend deux bulles sous la même clé.
        generateId: MESSAGE_ID,
        onError: foremanErrorText,
        // The hub is a long-lived server, so the write outlives the response without `after`. A
        // conversation that fails to save still answered the user: it is logged, never raised.
        // `isAborted` compris : un tour coupé par le Stop a quand même été payé et lu, il doit
        // survivre au rechargement.
        onFinish: ({ messages: transcript }) => {
            void saveForemanConversation(ctx, sessionId, transcript).catch(err => console.error('[foreman] failed to persist:', err))
        },
        execute: ({ writer }) => {
            const result = streamText({
                model,
                system: systemFor(state),
                providerOptions: ONBOARDING_REASONING,
                messages: modelMessages,
                tools: foremanTools({ ctx, turn }),
                // The whole belt is declared and the step decides what is reachable. Stated twice on
                // purpose: prepareStep is what moves it, this is the floor it moves from, so a belt that was
                // never narrowed cannot hand show_plan to a workspace that is still being asked its name.
                activeTools: foremanActiveTools(state),
                // Instructions and belt are rebuilt from the same state, so a phase can never read
                // instructions naming a tool it does not hold.
                prepareStep: ({ stepNumber }) => {
                    const now = turn.state()
                    const step = { system: systemFor(now), activeTools: foremanActiveTools(now) }
                    return stepNumber === 0 && forcesFirstPlan(now, messages) ? { ...step, toolChoice: { type: 'tool' as const, toolName: 'show_plan' } } : step
                },
                experimental_transform: pinPlanBoxesTransform(pinned),
                // A profile saved by a workspace that installed first ends the onboarding in the middle of
                // the turn: there is no step after it to hand a belt to.
                stopWhen: [stepCountIs(STEP_LIMIT), () => !isOnboardingPhase(turn.state().phase)],
                // Le bouton Stop du composer ferme le flux : sans ce signal la boucle continuerait à tourner
                // sur le hub, et à consommer le crédit du workspace, pour une réponse que personne ne lit.
                abortSignal: req.signal,
                onError: ({ error }) => console.error('[foreman] run failed:', error),
            })

            // Merged with nothing but its error text: the id of the response message and the persistence
            // both belong to the stream above, and passing them here would hand the message two ids.
            writer.merge(result.toUIMessageStream({ onError: foremanErrorText }))
        },
    })

    return createUIMessageStreamResponse({ stream })
}

export async function GET(): Promise<Response> {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // A conversation that cannot be read is not an error the column can act on: it opens empty.
    const conversation = await loadForemanConversation(ctx, 'hub').catch(err => {
        console.error('[foreman] failed to read the conversation:', err)
        return null
    })
    return Response.json(conversation)
}
