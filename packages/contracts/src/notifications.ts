import { z } from "zod";

// The one question of the settings: which runs are worth hearing about at all.
export const NOTIFICATION_SCOPES = [
  "everything",
  "mine",
  "needed",
  "nothing",
] as const;

export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];

export const COWORKER_MODES = ["default", "everything", "muted"] as const;

export type CoworkerMode = (typeof COWORKER_MODES)[number];

// `follow` is left out until someone decides: an absent key is what lets the author of a scheduled
// task, or the owner as a last resort, follow the coworker for them. An explicit `false` is a
// « Stop following » and is never overridden.
export type CoworkerRule = { mode: CoworkerMode; follow?: boolean };

export const EMAIL_CATEGORIES = ["billing", "product"] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

// Stored as jsonb in `users.email_notification_prefs`. A row without `version: 2` is the old
// channel × run type × kind matrix, which is not converted: it starts over on the recommended setting.
export type NotificationPrefs = {
  version: 2;
  scope: NotificationScope;
  toast: boolean;
  sound: boolean;
  email: boolean;
  coworkers: Record<string, CoworkerRule>;
  // « Notify me » on one scheduled task or trigger, keyed by `taskKey`. An absent key leaves the
  // task to its coworker's follow.
  tasks: Record<string, boolean>;
  categories: Record<EmailCategory, boolean>;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  version: 2,
  scope: "mine",
  toast: true,
  sound: true,
  email: true,
  coworkers: {},
  tasks: {},
  categories: { billing: true, product: true },
};

export const DEFAULT_COWORKER_RULE: CoworkerRule = { mode: "default" };

export function coworkerRuleOf(
  prefs: NotificationPrefs,
  agentId: string | null | undefined,
): CoworkerRule {
  return (agentId && prefs.coworkers[agentId]) || DEFAULT_COWORKER_RULE;
}

export const hasOwnRule = (rule: CoworkerRule) =>
  rule.mode !== "default" || rule.follow === true;

// Back to the shared setting. A coworker that was followed keeps an explicit « stop following »,
// otherwise the author of one of its scheduled tasks would be made to follow it again.
export const resetRule = (rule: CoworkerRule): CoworkerRule =>
  rule.follow !== undefined
    ? { mode: "default", follow: false }
    : { mode: "default" };

export function isScheduledSource(source: string | null | undefined): boolean {
  return source === "schedule" || source === "trigger";
}

export const taskKey = (agentId: string, source: string, slug: string) =>
  `${agentId}:${source}:${slug}`;

export function taskRuleOf(
  prefs: NotificationPrefs,
  agentId: string | null | undefined,
  source: string | null | undefined,
  slug: string | null | undefined,
): boolean | undefined {
  if (!agentId || !slug || !isScheduledSource(source)) return undefined;
  return prefs.tasks[taskKey(agentId, source!, slug)];
}

// What the « Notify me » switch of one task shows: its own rule when it has one, otherwise whatever
// already makes its runs reach you. A muted coworker reaches no one, whatever its tasks say.
export function taskNotifies(
  prefs: NotificationPrefs,
  agentId: string,
  source: string,
  slug: string,
): boolean {
  const rule = coworkerRuleOf(prefs, agentId);
  if (rule.mode === "muted") return false;
  return (
    taskRuleOf(prefs, agentId, source, slug) ??
    (rule.follow === true ||
      rule.mode === "everything" ||
      prefs.scope === "everything")
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function normalizeCategories(
  raw: Record<string, unknown>,
): Record<EmailCategory, boolean> {
  const categories = isRecord(raw.categories) ? raw.categories : raw;
  return {
    billing:
      typeof categories.billing === "boolean" ? categories.billing : true,
    product:
      typeof categories.product === "boolean" ? categories.product : true,
  };
}

function normalizeCoworkerRule(value: unknown): CoworkerRule | null {
  if (!isRecord(value)) return null;
  const mode = COWORKER_MODES.includes(value.mode as CoworkerMode)
    ? (value.mode as CoworkerMode)
    : "default";
  const rule: CoworkerRule = { mode };
  if (typeof value.follow === "boolean") rule.follow = value.follow;
  return rule.mode === "default" && rule.follow === undefined ? null : rule;
}

function anyKindOn(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.values(value).some(
    (entry) => entry === true || anyKindOn(entry),
  );
}

// A v1 email matrix with every kind off is someone who unsubscribed from run emails: that choice
// survives the reset, the rest of the matrix does not.
function unsubscribedFromRunEmails(raw: Record<string, unknown>): boolean {
  const channels = isRecord(raw.channels) ? raw.channels : null;
  return !!channels && isRecord(channels.email) && !anyKindOn(channels.email);
}

function legacyPrefs(raw: Record<string, unknown>): NotificationPrefs {
  const coworkers: Record<string, CoworkerRule> = {};
  if (isRecord(raw.agents)) {
    for (const [id, rule] of Object.entries(raw.agents))
      if (isRecord(rule) && rule.mode === "muted")
        coworkers[id] = { mode: "muted" };
  }
  if (Array.isArray(raw.mutedAgents)) {
    for (const id of raw.mutedAgents)
      if (typeof id === "string") coworkers[id] = { mode: "muted" };
  }
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    email: !unsubscribedFromRunEmails(raw),
    coworkers,
    tasks: {},
    categories: normalizeCategories(raw),
  };
}

export function normalizeNotificationPrefs(value: unknown): NotificationPrefs {
  const raw = isRecord(value) ? value : {};
  if (raw.version !== 2) return legacyPrefs(raw);

  const coworkers: Record<string, CoworkerRule> = {};
  if (isRecord(raw.coworkers)) {
    for (const [id, rule] of Object.entries(raw.coworkers)) {
      const normalized = normalizeCoworkerRule(rule);
      if (normalized) coworkers[id] = normalized;
    }
  }
  const tasks: Record<string, boolean> = {};
  if (isRecord(raw.tasks)) {
    for (const [key, on] of Object.entries(raw.tasks))
      if (typeof on === "boolean") tasks[key] = on;
  }
  const flag = (key: "toast" | "sound" | "email") =>
    typeof raw[key] === "boolean"
      ? (raw[key] as boolean)
      : DEFAULT_NOTIFICATION_PREFS[key];

  return {
    version: 2,
    scope: NOTIFICATION_SCOPES.includes(raw.scope as NotificationScope)
      ? (raw.scope as NotificationScope)
      : DEFAULT_NOTIFICATION_PREFS.scope,
    toast: flag("toast"),
    sound: flag("sound"),
    email: flag("email"),
    coworkers,
    tasks,
    categories: normalizeCategories(raw),
  };
}

// A coworker rule is always sent whole: the merge replaces it by agent id.
const coworkerRuleSchema = z.object({
  mode: z.enum(COWORKER_MODES),
  follow: z.boolean().optional(),
});

export const notificationPrefsSchema = z.object({
  version: z.literal(2),
  scope: z.enum(NOTIFICATION_SCOPES),
  toast: z.boolean(),
  sound: z.boolean(),
  email: z.boolean(),
  coworkers: z.record(z.string(), coworkerRuleSchema),
  tasks: z.record(z.string(), z.boolean()),
  categories: z.object({ billing: z.boolean(), product: z.boolean() }),
});

// Every write reads the current jsonb, merges the patch on top, and writes the full object back, so a
// surface that only touches one field never clobbers the rest.
export const notificationPrefsPatchSchema = z
  .object({
    scope: z.enum(NOTIFICATION_SCOPES),
    toast: z.boolean(),
    sound: z.boolean(),
    email: z.boolean(),
    coworkers: z.record(z.string(), coworkerRuleSchema),
    // Null drops the key, back to the coworker's follow.
    tasks: z.record(z.string(), z.boolean().nullable()),
    categories: z
      .object({ billing: z.boolean(), product: z.boolean() })
      .partial(),
  })
  .partial();

export type NotificationPrefsPatch = z.infer<
  typeof notificationPrefsPatchSchema
>;

function mergeCoworkerRules(
  base: NotificationPrefs["coworkers"],
  patch: NotificationPrefsPatch["coworkers"],
): NotificationPrefs["coworkers"] {
  if (!patch) return base;
  const out = { ...base };
  for (const [id, rule] of Object.entries(patch)) {
    const normalized = normalizeCoworkerRule(rule);
    if (normalized) out[id] = normalized;
    else delete out[id];
  }
  return out;
}

function mergeTasks(
  base: NotificationPrefs["tasks"],
  patch: NotificationPrefsPatch["tasks"],
): NotificationPrefs["tasks"] {
  if (!patch) return base;
  const out = { ...base };
  for (const [key, on] of Object.entries(patch)) {
    if (on === null) delete out[key];
    else out[key] = on;
  }
  return out;
}

export function mergeNotificationPrefs(
  base: NotificationPrefs,
  patch: NotificationPrefsPatch,
): NotificationPrefs {
  return {
    version: 2,
    scope: patch.scope ?? base.scope,
    toast: patch.toast ?? base.toast,
    sound: patch.sound ?? base.sound,
    email: patch.email ?? base.email,
    coworkers: mergeCoworkerRules(base.coworkers, patch.coworkers),
    tasks: mergeTasks(base.tasks, patch.tasks),
    categories: { ...base.categories, ...patch.categories },
  };
}
