import { z } from "zod";
import { isRecord } from "./record.js";

export const NOTIFICATION_SCOPES = [
  "everything",
  "mine",
  "needed",
  "nothing",
] as const;

export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];

export const COWORKER_MODES = ["default", "everything", "muted"] as const;

export type CoworkerMode = (typeof COWORKER_MODES)[number];

export type CoworkerRule = { mode: CoworkerMode; follow?: boolean };

export const EMAIL_CATEGORIES = ["billing", "product"] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export type NotificationPrefs = {
  version: 2;
  scope: NotificationScope;
  toast: boolean;
  sound: boolean;
  email: boolean;
  coworkers: Record<string, CoworkerRule>;
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

export const notificationPrefsPatchSchema = z
  .object({
    scope: z.enum(NOTIFICATION_SCOPES),
    toast: z.boolean(),
    sound: z.boolean(),
    email: z.boolean(),
    coworkers: z.record(z.string(), coworkerRuleSchema),
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
