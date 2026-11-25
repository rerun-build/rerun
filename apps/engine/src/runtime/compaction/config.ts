export const COMPACTION_TRIGGER_RATIO = 0.75
// The window alone is a poor trigger on an API model: a 922k tier would carry 690k tokens of
// history before its first summary, and every step pays that history again. A CLI keeps the ratio,
// its window is already the plan's allowance, far below the model's.
export const COMPACTION_MAX_TRIGGER_TOKENS = 150_000
export const COMPACTION_TAIL_TOKEN_BUDGET = 20_000
export const COMPACTION_SUMMARY_TOKENS_CEILING = 12_000
export const COMPACTION_CHARS_PER_TOKEN = 4
// What the summary reads nearly fills the window, so it is counted denser than the estimate: JSON,
// code or a non-Latin script runs under four characters to the token, and a summary that overflows
// leaves the history uncompacted on every turn.
export const COMPACTION_SUMMARY_INPUT_CHARS_PER_TOKEN = 3
export const COMPACTION_PRUNE_OUTPUT_CHAR_THRESHOLD = 2_000
