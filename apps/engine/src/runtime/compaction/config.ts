export const COMPACTION_TRIGGER_RATIO = 0.75
export const COMPACTION_MAX_TRIGGER_TOKENS = 150_000
export const COMPACTION_TAIL_TOKEN_BUDGET = 20_000
export const COMPACTION_SUMMARY_TOKENS_CEILING = 12_000
export const COMPACTION_CHARS_PER_TOKEN = 4
export const COMPACTION_PRUNE_OUTPUT_CHAR_THRESHOLD = 2_000

function resultHandleChars(): number {
    const parsed = Number.parseInt(process.env.RERUN_RESULT_HANDLE_CHARS ?? '', 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20_000
}

export const RESULT_HANDLE_CHARS = resultHandleChars()
