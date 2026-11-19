import { rerunChatCompletions } from '@moldwright/cloud/llm'

export async function POST(req: Request) {
    return rerunChatCompletions(req)
}
