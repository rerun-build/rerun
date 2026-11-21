// A conversation is named two ways: by its row in the app (a UUID, what the chat sends and the
// route looks up) and by the engine that runs it (a short random id). Tools answer with both, and a
// model that carries the engine's into a chat link leaves the user on a conversation every send
// fails on. This tells the two apart without a round trip.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isConversationId(id: string): boolean {
    return UUID.test(id)
}
