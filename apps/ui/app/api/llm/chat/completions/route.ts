import { rerunChatCompletions } from '@rerun/cloud/llm'

export async function POST(req: Request) {
    return rerunChatCompletions(req)
}
