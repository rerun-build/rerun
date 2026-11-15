export const CONTEXT_PART_OPTIONS = { rerun: { context: true } } as const;

export type ContextTextPart = {
  type: "text";
  text: string;
  providerOptions: typeof CONTEXT_PART_OPTIONS;
};

export function contextTextPart(text: string): ContextTextPart {
  return { type: "text", text, providerOptions: CONTEXT_PART_OPTIONS };
}

export function isContextPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const options = (
    part as { providerOptions?: { rerun?: { context?: unknown } } }
  ).providerOptions;
  return options?.rerun?.context === true;
}

export function visibleText(content: unknown, separator: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part) =>
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        !isContextPart(part),
    )
    .map((part) => String((part as { text?: unknown }).text ?? ""))
    .filter(Boolean)
    .join(separator);
}

export function contextTexts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(isContextPart)
    .map((part) => String((part as { text?: unknown }).text ?? ""));
}
