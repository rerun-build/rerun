import { z } from "zod";
import { providerSchema } from "./agent.js";

// The chat part that marks where a conversation moved to a backup model, and where it came back.
export const PROVIDER_SWITCH_PART = "data-provider-switch";

// Stored next to the message rather than in it, so the model never reads the marker back as part of
// the conversation. The tag tells it apart from the tool calls the same column holds.
export const PROVIDER_SWITCH_ENTRY = "provider-switch";

const switchEndSchema = z.object({
  connectionId: z.string(),
  provider: providerSchema,
  model: z.string(),
  // The connection's name when it happened: the chat still reads right once it is renamed or gone.
  name: z.string(),
});

export const providerSwitchSchema = z.object({
  kind: z.enum(["switch", "back"]),
  from: switchEndSchema,
  to: switchEndSchema,
  // When the plan that ran out resets, if its last reading said so.
  resetsAt: z.string().nullable(),
});
export type ProviderSwitch = z.infer<typeof providerSwitchSchema>;

export const providerSwitchEntrySchema = providerSwitchSchema.extend({
  type: z.literal(PROVIDER_SWITCH_ENTRY),
});
export type ProviderSwitchEntry = z.infer<typeof providerSwitchEntrySchema>;

export function providerSwitchEntry(
  change: ProviderSwitch,
): ProviderSwitchEntry {
  return { type: PROVIDER_SWITCH_ENTRY, ...change };
}

export function readProviderSwitchEntry(value: unknown): ProviderSwitch | null {
  const parsed = providerSwitchEntrySchema.safeParse(value);
  if (!parsed.success) return null;
  const { type: _type, ...change } = parsed.data;
  return change;
}
