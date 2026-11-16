import { z } from 'zod'

const isoTime = z.string().max(40).datetime({ offset: true })
const count = z.number().int().min(0)

export const ROOM_MAX_MEMBERS = 5
export const ROOM_MIN_MEMBERS = 2
export const ROOM_MAX_ROUNDS = 2
export const ROOM_DEFAULT_MINUTES = 30
export const ROOM_MAX_MINUTES = 60

export const roomStatusSchema = z.enum(['open', 'decided', 'presented', 'expired'])
export const roomAuthorKindSchema = z.enum(['coworker', 'orchestrator', 'user'])
export const roomPostKindSchema = z.enum(['post', 'decision'])
export const roomOutcomeSchema = z.enum(['decided', 'presented'])

export const roomMemberSchema = z.object({
    agentId: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    tokensIn: count,
    tokensOut: count,
}).strict()

export const roomPostSchema = z.object({
    id: z.string().max(64),
    seq: z.number().int().min(1),
    round: z.number().int().min(0).max(2),
    kind: roomPostKindSchema,
    authorKind: roomAuthorKindSchema,
    authorId: z.string().min(1).max(64),
    authorName: z.string().min(1).max(80),
    text: z.string().min(1).max(8000),
    createdAt: isoTime,
}).strict()

export const roomSummarySchema = z.object({
    id: z.string().max(64),
    title: z.string().min(1).max(120),
    job: z.string().max(80).nullable(),
    openedBy: z.string().max(64),
    status: roomStatusSchema,
    round: z.number().int().min(0).max(2),
    members: z.array(roomMemberSchema).min(2).max(5),
    lastPost: z.object({ authorName: z.string().max(80), text: z.string().max(200) }).strict().nullable(),
    createdAt: isoTime,
    closesAt: isoTime,
    closedAt: isoTime.nullable(),
}).strict()

export const roomDetailSchema = roomSummarySchema.extend({
    question: z.string().min(1).max(8000),
    decision: z.string().max(8000).nullable(),
    posts: z.array(roomPostSchema).max(200),
}).strict()

export const roomOpenInputSchema = z.object({
    title: z.string().min(1).max(120),
    question: z.string().min(1).max(8000),
    members: z.array(z.string().min(1).max(64)).min(2).max(5),
    job: z.string().max(80).optional(),
    minutes: z.number().int().min(1).max(60).optional(),
}).strict()

export const roomPostInputSchema = z.object({
    text: z.string().min(1).max(8000),
    author: z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(80) }).strict(),
}).strict()

export const roomCloseInputSchema = z.object({
    decision: z.string().min(1).max(8000),
    outcome: roomOutcomeSchema,
}).strict()

export type RoomStatus = z.infer<typeof roomStatusSchema>
export type RoomOutcome = z.infer<typeof roomOutcomeSchema>
export type RoomMember = z.infer<typeof roomMemberSchema>
export type RoomPost = z.infer<typeof roomPostSchema>
export type RoomSummary = z.infer<typeof roomSummarySchema>
export type RoomDetail = z.infer<typeof roomDetailSchema>
export type RoomOpenInput = z.infer<typeof roomOpenInputSchema>
export type RoomPostInput = z.infer<typeof roomPostInputSchema>
export type RoomCloseInput = z.infer<typeof roomCloseInputSchema>
