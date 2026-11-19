import { z } from 'zod'

import { agentKeysListSchema, createCoworkerSchema, createdCoworkerSchema, renameCoworkerSchema, updateAgentKeysSchema } from './agent.js'
import { accountDeletionStatusSchema, appSessionSchema, deleteAccountRequestSchema, emailCodePreparedSchema, emailCodeRequestSchema, phoneCodeRequestSchema, phoneCodeSentSchema, phoneSignInRequestSchema, signInRefusalSchema } from './app-auth.js'
import { agentViewSchema, boardAgentSchema, boxSchema, workspaceSummarySchema } from './board.js'
import { brainRevertRequestSchema } from './brain.js'
import { clientConfigSchema } from './client.js'
import {
    agentModelsSchema,
    aiConnectionCreatedSchema,
    aiConnectionsViewSchema,
    claudeSignInFinishInputSchema,
    claudeSignInStartSchema,
    codexSignInPollInputSchema,
    codexSignInPollSchema,
    codexSignInStartSchema,
    connectionUsageSchema,
    createAiConnectionInputSchema,
    replaceAiConnectionKeyInputSchema,
    setAgentModelSchema,
    updateConnectionSchema,
    workspaceDefaultInputSchema,
} from './connection.js'
import { activeRunSchema, agentConversationsOverviewSchema, conversationHitSchema, conversationMessageSchema, conversationSchema, inboxSchema, markHandledSchema, sessionKindSchema } from './conversation.js'
import { desktopSocketRequestSchema, desktopSocketSchema, takeoverRequestSchema, takeoverResultSchema } from './desktop.js'
import { coworkerFilesSchema } from './file.js'
import {
    foremanEngineConversationSchema,
    foremanEngineFilesSchema,
    foremanEngineMessagesSchema,
    foremanIndustryRequestSchema,
    foremanIndustryResultSchema,
    foremanIntakeSchema,
    foremanLeadRequestSchema,
    foremanLeadResultSchema,
    foremanStateSchema,
    foremanTrialResultSchema,
} from './foreman.js'
import { hubEndpoint, hubErrorSchema, type HubEndpoint } from './hub-endpoint.js'
import { deviceTokenSchema, meSchema, memberProfileSchema } from './me.js'
import { messageFeedbackDetailsRequestSchema, messageFeedbackEntrySchema, messageFeedbackRateRequestSchema, messageFeedbackScopeSchema } from './message-feedback.js'
import { notificationPrefsPatchSchema, notificationPrefsSchema } from './notifications.js'
import { onboardingEngineSchema, onboardingStateSchema } from './onboarding.js'
import { paidDataAlwaysAllowSchema } from './paid-data.js'
import { remoteComputerRuleSchema } from './remote-computer.js'
import { routinesViewSchema, updateRoutineSchema } from './routine.js'
import { connectTargetSchema, installedServiceSchema, installResultSchema, installServiceInputSchema, mcpServerViewSchema, resolvedServiceSchema, resolveServicesInputSchema, signInClaimSchema } from './service.js'
import { sessionSourceSchema } from './session.js'
import { skillProposalDecideRequestSchema, skillProposalSchema, skillProposalsListSchema } from './skill-proposal.js'
import { skillSummariesViewSchema } from './skill.js'

// The bodies and queries of the calls that had no schema of their own: the hub read them by hand, or
// declared them in its route file, and the app sent an object literal.

export const conversationSearchQuerySchema = z.object({ q: z.string().max(200).default(''), agentId: z.string().optional() })

export const messageFeedbackQuerySchema = z.object({ scope: messageFeedbackScopeSchema.default('agent') })

// keepOpen=1 when the person hands the browser back to the run that asked for it: the window stays on
// the coworker's screen. Without it (skipped, or a browser opened by hand), the window closes.
export const takeoverFinishQuerySchema = z.object({ keepOpen: z.literal('1').optional() })

export const computerSummarySchema = z.object({ id: z.string(), name: z.string(), handle: z.string(), status: z.enum(['online', 'busy', 'paused', 'offline']) })
export type ComputerSummary = z.infer<typeof computerSummarySchema>

export const computersListSchema = z.object({ computers: z.array(computerSummarySchema) })

export const messageFeedbackListSchema = z.object({ feedback: z.array(messageFeedbackEntrySchema) })

export const messageFeedbackRatedSchema = z.object({ id: z.string() })

export const skillProposalDecidedSchema = z.object({ proposal: skillProposalSchema })

// A send carries only the new message's text: the engine keeps the conversation. `general` opens the
// coworker's main conversation when no `sessionId` names it yet; `queued` says the text waited
// behind a run, for the hub to retry the engine rather than drop it.
export const hubChatRequestSchema = z.object({
    agentId: z.string().min(1),
    sessionId: z.string().optional(),
    text: z.string(),
    kind: sessionKindSchema.optional(),
    queued: z.boolean().optional(),
    connectionId: z.string().optional(),
    model: z.string().optional(),
    source: sessionSourceSchema.optional(),
})

export const chatResumeQuerySchema = z.object({ agentId: z.string(), runId: z.string() })

export const hubForemanChatRequestSchema = z.object({
    sessionId: z.string().min(1),
    text: z.string().min(1),
    kind: sessionKindSchema.optional(),
    queued: z.boolean().optional(),
    connectionId: z.string().optional(),
    model: z.string().optional(),
})

export const foremanConversationQuerySchema = z.object({ sessionId: z.string().optional() })

// Without a session id, General or null. With one, that conversation, or its bare transcript when it
// cannot be read.
export const foremanConversationReplySchema = z.union([foremanEngineConversationSchema, foremanEngineMessagesSchema])

export const foremanStopQuerySchema = z.object({ sessionId: z.string().optional(), runId: z.string().optional() })

// The onboarding the hub ran itself, before the welcome page: builds up to iOS 36 and Android 5 still
// open it, and send the whole transcript with every turn.
export const legacyForemanChatRequestSchema = z.looseObject({ sessionId: z.string().min(1), messages: z.array(z.unknown()), client: z.string().optional() })

export const legacyForemanConversationSchema = z.looseObject({ sessionId: z.string().optional(), backend: z.string().optional(), messages: z.array(z.unknown()).optional() }).nullable()

export const agentFileUploadQuerySchema = z.object({ agentId: z.string().optional(), scope: z.literal('shared').optional(), name: z.string(), size: z.string(), dir: z.string().optional() })

export const foremanFileUploadQuerySchema = z.object({ sessionId: z.string(), name: z.string(), size: z.string(), dir: z.string().optional() })

export const fileUploadedSchema = z.object({ path: z.string() })

export const agentFileQuerySchema = z.object({ agentId: z.string().optional(), scope: z.literal('shared').optional(), path: z.string() })

export const foremanFileQuerySchema = z.object({ sessionId: z.string(), path: z.string() })

export const transcribeQuerySchema = z.object({ format: z.string() })

export const transcriptionSchema = z.object({ text: z.string() })

const accountDeletionRefusalSchema = z.looseObject({ error: z.string(), reason: z.string().optional(), blockers: z.array(z.object({ workspaceId: z.number(), name: z.string() })).optional() })

const noPlanSchema = z.looseObject({ error: z.string(), reason: z.string().optional() })

// A 400 is a refusal with its reason, or a body the hub could not read at all: the app tells the two
// apart by the reason.
const signInFailureSchema = z.looseObject({ error: z.string(), reason: z.string().optional(), retryAfterSeconds: z.number().optional() })

const SIGN_IN_REFUSALS = { 400: signInFailureSchema, 422: signInRefusalSchema, 429: signInRefusalSchema, 503: signInRefusalSchema } as const

const NO_PLAN = { 403: noPlanSchema } as const

const CHAT_HEADERS = ['X-Session-Id', 'X-Run-Id'] as const

// Every call the mobile app makes to the hub, from every build still allowed to run. Add to it; never
// change what an entry accepts or answers in a way a shipped build cannot read: the contract in
// apps/mobile/api-contract and its check refuse it.
export const mobileApi = {
    getClientConfig: hubEndpoint({ method: 'GET', path: '/api/v1/client', response: clientConfigSchema }),

    sendPhoneCode: hubEndpoint({ method: 'POST', path: '/api/v1/auth/phone/code', body: phoneCodeRequestSchema, response: phoneCodeSentSchema, errors: SIGN_IN_REFUSALS }),
    signInWithPhone: hubEndpoint({ method: 'POST', path: '/api/v1/auth/phone/session', body: phoneSignInRequestSchema, response: appSessionSchema, errors: SIGN_IN_REFUSALS }),
    sendEmailCode: hubEndpoint({ method: 'POST', path: '/api/v1/auth/email/code', body: emailCodeRequestSchema, response: emailCodePreparedSchema, errors: SIGN_IN_REFUSALS }),
    bootstrap: hubEndpoint({ method: 'POST', path: '/api/v1/bootstrap', response: meSchema, errors: { 403: hubErrorSchema } }),

    getMe: hubEndpoint({ method: 'GET', path: '/api/v1/me', response: meSchema, errors: { 403: hubErrorSchema, 404: hubErrorSchema } }),
    listWorkspaces: hubEndpoint({ method: 'GET', path: '/api/v1/workspaces', response: z.array(workspaceSummarySchema) }),
    getAccountDeletion: hubEndpoint({ method: 'GET', path: '/api/v1/me/account', response: accountDeletionStatusSchema }),
    deleteAccount: hubEndpoint({ method: 'DELETE', path: '/api/v1/me/account', body: deleteAccountRequestSchema, response: 'none', errors: { 403: accountDeletionRefusalSchema, 409: accountDeletionRefusalSchema } }),
    getNotificationPrefs: hubEndpoint({ method: 'GET', path: '/api/v1/me/notifications', response: notificationPrefsSchema }),
    updateNotificationPrefs: hubEndpoint({ method: 'PATCH', path: '/api/v1/me/notifications', body: notificationPrefsPatchSchema, response: notificationPrefsSchema }),
    registerDevice: hubEndpoint({ method: 'POST', path: '/api/v1/me/devices', body: deviceTokenSchema, response: 'none' }),
    unregisterDevice: hubEndpoint({ method: 'DELETE', path: '/api/v1/me/devices', body: deviceTokenSchema, response: 'none' }),
    listMembers: hubEndpoint({ method: 'GET', path: '/api/v1/members', response: z.array(memberProfileSchema) }),

    listAgents: hubEndpoint({ method: 'GET', path: '/api/v1/agents', response: z.array(boardAgentSchema) }),
    createAgent: hubEndpoint({ method: 'POST', path: '/api/v1/agents', body: createCoworkerSchema, response: createdCoworkerSchema }),
    getConversationsOverview: hubEndpoint({ method: 'GET', path: '/api/v1/agents/conversations', response: agentConversationsOverviewSchema }),
    listBoxes: hubEndpoint({ method: 'GET', path: '/api/v1/boxes', response: z.array(boxSchema) }),

    getAgent: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}', response: agentViewSchema }),
    renameAgent: hubEndpoint({ method: 'PATCH', path: '/api/v1/agents/{id}', body: renameCoworkerSchema, response: 'none' }),
    deleteAgent: hubEndpoint({ method: 'DELETE', path: '/api/v1/agents/{id}', response: 'none' }),
    listAgentFiles: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/files', response: coworkerFilesSchema }),
    listAgentServices: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/services', response: z.array(installedServiceSchema) }),
    listAgentRoutines: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/routines', response: routinesViewSchema }),
    setAgentRoutineEnabled: hubEndpoint({ method: 'PATCH', path: '/api/v1/agents/{id}/routines/{kind}/{slug}', body: updateRoutineSchema, response: 'none' }),
    listAgentSkills: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/skills', response: skillSummariesViewSchema }),
    getAgentModels: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/models', response: agentModelsSchema }),
    setAgentModel: hubEndpoint({ method: 'PUT', path: '/api/v1/agents/{id}/model', body: setAgentModelSchema, response: 'none' }),
    getAgentKeys: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/keys', response: agentKeysListSchema }),
    updateAgentKeys: hubEndpoint({ method: 'PUT', path: '/api/v1/agents/{id}/keys', body: updateAgentKeysSchema, response: agentKeysListSchema }),
    setPaidDataAlwaysAllow: hubEndpoint({ method: 'PUT', path: '/api/v1/agents/{id}/paid-data', body: paidDataAlwaysAllowSchema, response: 'none' }),
    listAgentConversations: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/conversations', response: z.array(conversationSchema) }),
    cancelSubRun: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/runs/{runId}/tasks/{taskId}/cancel', response: 'none' }),
    openDesktop: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/desktop', body: desktopSocketRequestSchema, response: desktopSocketSchema }),
    startTakeover: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/desktop/takeover', body: takeoverRequestSchema, response: 'none' }),
    finishTakeover: hubEndpoint({ method: 'DELETE', path: '/api/v1/agents/{id}/desktop/takeover', query: takeoverFinishQuerySchema, response: takeoverResultSchema }),

    getMcpServer: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/mcp/{name}', response: mcpServerViewSchema }),
    connectMcpServer: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/mcp/{name}/connect', response: connectTargetSchema }),
    claimMcpSignIn: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/mcp/{name}/authorized', body: signInClaimSchema, response: 'none' }),
    resolveServices: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/services/resolve', body: resolveServicesInputSchema, response: z.array(resolvedServiceSchema) }),
    getService: hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}/services/{slug}', response: resolvedServiceSchema }),
    installService: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/services/{slug}/install', body: installServiceInputSchema, response: installResultSchema }),
    connectService: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/services/{slug}/connect', response: connectTargetSchema }),
    claimServiceSignIn: hubEndpoint({ method: 'POST', path: '/api/v1/agents/{id}/services/{slug}/authorized', body: signInClaimSchema, response: 'none' }),

    // 304: the transcript the app holds, named by the ETag it sent back, has not changed.
    getConversationMessages: hubEndpoint({ method: 'GET', path: '/api/v1/conversations/{id}/messages', response: z.array(conversationMessageSchema), emptyStatus: 304, headers: ['ETag'] }),
    getActiveRun: hubEndpoint({ method: 'GET', path: '/api/v1/conversations/{id}/active-run', response: activeRunSchema }),
    stopConversation: hubEndpoint({ method: 'POST', path: '/api/v1/conversations/{id}/stop', response: 'none' }),
    acknowledgeConversation: hubEndpoint({ method: 'POST', path: '/api/v1/conversations/{id}/acknowledge', response: 'none' }),
    listSkillProposals: hubEndpoint({ method: 'GET', path: '/api/v1/conversations/{id}/skill-proposals', response: skillProposalsListSchema }),
    decideSkillProposal: hubEndpoint({ method: 'POST', path: '/api/v1/conversations/{id}/skill-proposals', body: skillProposalDecideRequestSchema, response: skillProposalDecidedSchema }),
    listMessageFeedback: hubEndpoint({ method: 'GET', path: '/api/v1/conversations/{id}/feedback', query: messageFeedbackQuerySchema, response: messageFeedbackListSchema }),
    rateMessage: hubEndpoint({ method: 'POST', path: '/api/v1/conversations/{id}/feedback', body: messageFeedbackRateRequestSchema, response: messageFeedbackRatedSchema }),
    updateMessageFeedback: hubEndpoint({ method: 'PATCH', path: '/api/v1/feedback/{id}', body: messageFeedbackDetailsRequestSchema, response: 'none' }),
    clearMessageFeedback: hubEndpoint({ method: 'DELETE', path: '/api/v1/feedback/{id}', response: 'none' }),
    searchConversations: hubEndpoint({ method: 'GET', path: '/api/v1/conversations/search', query: conversationSearchQuerySchema, response: z.array(conversationHitSchema) }),
    revertBrainPage: hubEndpoint({ method: 'POST', path: '/api/v1/brain/pages/{slug}/revert', body: brainRevertRequestSchema, response: 'none', errors: { 409: hubErrorSchema } }),

    getInbox: hubEndpoint({ method: 'GET', path: '/api/v1/inbox', response: inboxSchema }),
    markInboxRead: hubEndpoint({ method: 'POST', path: '/api/v1/inbox/read', body: markHandledSchema, response: 'none' }),

    listComputers: hubEndpoint({ method: 'GET', path: '/api/v1/computers', response: computersListSchema }),
    allowOnComputer: hubEndpoint({ method: 'POST', path: '/api/v1/computers/{id}/rules', body: remoteComputerRuleSchema, response: 'none' }),

    listAiConnections: hubEndpoint({ method: 'GET', path: '/api/v1/ai-connections', response: aiConnectionsViewSchema }),
    createAiConnection: hubEndpoint({ method: 'POST', path: '/api/v1/ai-connections', body: createAiConnectionInputSchema, response: aiConnectionCreatedSchema, errors: NO_PLAN }),
    updateAiConnection: hubEndpoint({ method: 'PATCH', path: '/api/v1/ai-connections/{id}', body: updateConnectionSchema, response: 'none', errors: NO_PLAN }),
    deleteAiConnection: hubEndpoint({ method: 'DELETE', path: '/api/v1/ai-connections/{id}', response: 'none', status: 200, errors: NO_PLAN }),
    replaceAiConnectionKey: hubEndpoint({ method: 'PUT', path: '/api/v1/ai-connections/{id}/keys', body: replaceAiConnectionKeyInputSchema, response: 'none', errors: NO_PLAN }),
    getAiConnectionUsage: hubEndpoint({ method: 'GET', path: '/api/v1/ai-connections/{id}/usage', response: connectionUsageSchema, errors: NO_PLAN }),
    setWorkspaceDefaultModel: hubEndpoint({ method: 'PUT', path: '/api/v1/ai-connections/default', body: workspaceDefaultInputSchema, response: 'none', errors: NO_PLAN }),
    startClaudeSignIn: hubEndpoint({ method: 'POST', path: '/api/v1/ai-connections/claude/start', response: claudeSignInStartSchema, errors: NO_PLAN }),
    finishClaudeSignIn: hubEndpoint({ method: 'POST', path: '/api/v1/ai-connections/claude/finish', body: claudeSignInFinishInputSchema, response: aiConnectionCreatedSchema, errors: NO_PLAN }),
    startCodexSignIn: hubEndpoint({ method: 'POST', path: '/api/v1/ai-connections/codex/start', response: codexSignInStartSchema }),
    pollCodexSignIn: hubEndpoint({ method: 'POST', path: '/api/v1/ai-connections/codex/poll', body: codexSignInPollInputSchema, response: codexSignInPollSchema, errors: { 400: hubErrorSchema, ...NO_PLAN } }),

    getOnboarding: hubEndpoint({ method: 'GET', path: '/api/v1/onboarding', response: onboardingStateSchema }),
    saveOnboardingIntake: hubEndpoint({ method: 'POST', path: '/api/v1/onboarding/intake', body: foremanIntakeSchema, response: 'none', status: 200 }),
    decideOnboardingIndustry: hubEndpoint({ method: 'POST', path: '/api/v1/onboarding/industry', body: foremanIndustryRequestSchema, response: foremanIndustryResultSchema }),
    startOnboardingTrial: hubEndpoint({ method: 'POST', path: '/api/v1/onboarding/trial', response: foremanTrialResultSchema, errors: { 409: hubErrorSchema } }),
    claimOnboardingEngine: hubEndpoint({ method: 'POST', path: '/api/v1/onboarding/engine', response: 'none' }),
    getOnboardingEngine: hubEndpoint({ method: 'GET', path: '/api/v1/onboarding/engine', response: onboardingEngineSchema }),
    finishOnboarding: hubEndpoint({ method: 'POST', path: '/api/v1/onboarding/finish', response: 'none' }),

    saveForemanIntake: hubEndpoint({ method: 'POST', path: '/api/v1/foreman/intake', body: foremanIntakeSchema, response: 'none', status: 200 }),
    decideForemanIndustry: hubEndpoint({ method: 'POST', path: '/api/v1/foreman/industry', body: foremanIndustryRequestSchema, response: foremanIndustryResultSchema }),
    startForemanTrial: hubEndpoint({ method: 'POST', path: '/api/v1/foreman/trial', response: foremanTrialResultSchema, errors: { 409: hubErrorSchema } }),
    startForemanLead: hubEndpoint({ method: 'POST', path: '/api/v1/foreman/lead', body: foremanLeadRequestSchema, response: foremanLeadResultSchema }),
    getForemanEngineFiles: hubEndpoint({ method: 'GET', path: '/api/v1/foreman/files', response: foremanEngineFilesSchema }),
    listForemanConversations: hubEndpoint({ method: 'GET', path: '/api/v1/foreman/conversations', response: z.array(conversationSchema) }),
    getForemanState: hubEndpoint({ method: 'GET', path: '/api/chat/foreman/state', response: foremanStateSchema }),
    getForemanConversation: hubEndpoint({ method: 'GET', path: '/api/chat/foreman/engine', query: foremanConversationQuerySchema, response: foremanConversationReplySchema }),
    sendForemanMessage: hubEndpoint({ method: 'POST', path: '/api/chat/foreman/engine', body: hubForemanChatRequestSchema, response: 'ui-message-stream', headers: CHAT_HEADERS, errors: { 409: hubErrorSchema } }),
    stopForeman: hubEndpoint({ method: 'DELETE', path: '/api/chat/foreman/engine', query: foremanStopQuerySchema, response: 'none', status: 200 }),
    getLegacyForemanConversation: hubEndpoint({ method: 'GET', path: '/api/chat/foreman', response: legacyForemanConversationSchema }),
    sendLegacyForemanMessage: hubEndpoint({ method: 'POST', path: '/api/chat/foreman', body: legacyForemanChatRequestSchema, response: 'ui-message-stream', errors: { 409: hubErrorSchema, 423: hubErrorSchema } }),

    sendChatMessage: hubEndpoint({ method: 'POST', path: '/api/chat', body: hubChatRequestSchema, response: 'ui-message-stream', headers: CHAT_HEADERS, errors: { 404: hubErrorSchema, 409: hubErrorSchema } }),
    resumeChat: hubEndpoint({ method: 'GET', path: '/api/chat/resume', query: chatResumeQuerySchema, response: 'ui-message-stream', emptyStatus: 204 }),

    uploadAgentFile: hubEndpoint({ method: 'POST', path: '/api/files/stream', query: agentFileUploadQuerySchema, body: 'bytes', response: fileUploadedSchema, status: 201 }),
    uploadForemanFile: hubEndpoint({ method: 'POST', path: '/api/foreman/files/stream', query: foremanFileUploadQuerySchema, body: 'bytes', response: fileUploadedSchema, status: 201 }),
    readAgentFile: hubEndpoint({ method: 'GET', path: '/api/files/raw', query: agentFileQuerySchema, response: 'bytes' }),
    readForemanFile: hubEndpoint({ method: 'GET', path: '/api/foreman/files/raw', query: foremanFileQuerySchema, response: 'bytes' }),
    transcribeVoice: hubEndpoint({ method: 'POST', path: '/api/voice/transcribe', query: transcribeQuerySchema, body: 'bytes', response: transcriptionSchema }),
} satisfies Record<string, HubEndpoint>

export type MobileApi = typeof mobileApi
export type MobileEndpointName = keyof MobileApi
