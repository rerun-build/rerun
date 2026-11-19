import { moldwrightChatCompletions } from '@moldwright/cloud/llm'

export async function POST(req: Request) {
    return moldwrightChatCompletions(req)
}
