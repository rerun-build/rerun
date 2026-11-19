import { convertToModelMessages, createIdGenerator, createUIMessageStream, createUIMessageStreamResponse, pruneMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { foremanClientSchema } from '@moldwright/contracts'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { isPhoneStepPending } from '@moldwright/cloud/phone.server'
import { logRerunUsage, meteredFetch, type OpenRouterUsage } from '@moldwright/cloud/billing.server'
import { MICROS_PER_USD } from '@moldwright/cloud/billing'
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
import { PHONE_REQUIRED_MESSAGE } from '@moldwright/cloud/phone'
import { prepareScript, runScript } from '@/lib/foreman/scripted'
import { foremanActiveTools, foremanTools } from '@/lib/foreman/tools'
import { createForemanTurn } from '@/lib/foreman/turn'

const STEP_LIMIT = 24

const TOOL_OUTPUT_HORIZON = 'before-last-10-messages' as const

const FOREMAN_MODEL_ID = process.env.RERUN_FOREMAN_MODEL ?? 'openai/gpt-6-sol'

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

    if ((await engineSessionOf(ctx, sessionId))?.backend === 'engine') return Response.json({ error: 'engine_conversation' }, { status: 409 })

    const messages = sealPendingWidgets(dedupeMessagesById(body.messages as UIMessage[]))

    const client = foremanClientSchema.catch('web').parse(body.client)
    const loadState = () => loadForemanState(ctx, req.headers.get('accept-language'), arrivingIntent(messages), client)
    const state = await loadState()

    if (state.phase === 'waitlist') return Response.json({ error: 'engine_waitlist' }, { status: 423 })
    if (state.phase === 'companion') return Response.json({ error: 'onboarding_over' }, { status: 409 })

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
            execute: ({ writer }) => runScript(script, { ctx, writer, signal: req.signal, reload: loadState }),
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

    const turn = createForemanTurn(state)

    const model = openrouter(FOREMAN_MODEL_ID)

    const pinned = pinnedPlanBoxes(state)

    const systemFor = (now: typeof state) => (planError ? `${foremanSystemPrompt(now)}\n\nThe card they just confirmed could not be written down: ${planError} Fix the plan and show the card again with show_plan.` : foremanSystemPrompt(now))

    const modelMessages = pruneMessages({ messages: await convertToModelMessages(await withInlineAttachments(withoutVoiceMarkers(messages), ctx, sessionId)), toolCalls: TOOL_OUTPUT_HORIZON, reasoning: 'before-last-message' })

    const stream = createUIMessageStream<UIMessage>({
        originalMessages: messages,
        generateId: MESSAGE_ID,
        onError: foremanErrorText,
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
                activeTools: foremanActiveTools(state),
                prepareStep: ({ stepNumber }) => {
                    const now = turn.state()
                    const step = { system: systemFor(now), activeTools: foremanActiveTools(now) }
                    return stepNumber === 0 && forcesFirstPlan(now, messages) ? { ...step, toolChoice: { type: 'tool' as const, toolName: 'show_plan' } } : step
                },
                experimental_transform: pinPlanBoxesTransform(pinned),
                stopWhen: [stepCountIs(STEP_LIMIT), () => !isOnboardingPhase(turn.state().phase)],
                abortSignal: req.signal,
                onError: ({ error }) => console.error('[foreman] run failed:', error),
            })

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

    const conversation = await loadForemanConversation(ctx, 'hub').catch(err => {
        console.error('[foreman] failed to read the conversation:', err)
        return null
    })
    return Response.json(conversation)
}
