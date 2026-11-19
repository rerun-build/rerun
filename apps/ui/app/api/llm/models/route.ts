import { moldwrightModels } from '@moldwright/cloud/llm'

export async function GET(req: Request) {
    return moldwrightModels(req)
}
