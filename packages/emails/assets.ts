type MaybeNode = { process?: { env?: Record<string, string | undefined> } };
export const ASSET_ORIGIN =
  (globalThis as MaybeNode).process?.env?.EMAIL_ASSET_ORIGIN ??
  "https://app.rerun.build";

export const ART_VERSION = "6";

export const LOGO_URL = `${ASSET_ORIGIN}/email/logo?v=${ART_VERSION}`;
export const LOGO_SIZE = 32;

export type HeroVariant =
  | "done"
  | "info"
  | "question"
  | "approval"
  | "connector"
  | "failed"
  | "digest"
  | "budget"
  | "invite"
  | "library"
  | "schedule";

export function heroUrl(variant: HeroVariant): string {
  return `${ASSET_ORIGIN}/email/art?variant=${variant}&v=${ART_VERSION}`;
}

export type HeroScene =
  | "automate-agent"
  | "agent-idle"
  | "onboarding-resume"
  | "agent-recommendations"
  | "creator-pitch"
  | "team-invite"
  | "workspace-invite"
  | "trial-started"
  | "trial-ended"
  | "trial-ending"
  | "subscription-ending"
  | "budget-exhausted";

export const SCENE_WIDTH = 520;
export const SCENE_HEIGHT = 240;

export function sceneUrl(scene: HeroScene): string {
  return `${ASSET_ORIGIN}/email/scene/${scene}.jpg?v=${ART_VERSION}`;
}

export function boardSampleUrl(): string {
  return `${ASSET_ORIGIN}/email/board-sample.png?v=${ART_VERSION}`;
}

export function newsletterArtUrl(slug: string): string {
  return `${ASSET_ORIGIN}/email/newsletter/${slug}.jpg?v=${ART_VERSION}`;
}

export function newsletterMediaUrl(slug: string, file: string): string {
  return `${ASSET_ORIGIN}/email/newsletter/${slug}/${file}?v=${ART_VERSION}`;
}

export const NOTE_ICONS = [
  "fix",
  "speed",
  "chat",
  "board",
  "connector",
  "mobile",
  "setting",
  "email",
  "schedule",
  "file",
  "access",
  "display",
] as const;

export type NoteIcon = (typeof NOTE_ICONS)[number];

export const NOTE_ICON_SIZE = 18;

export function noteIconUrl(name: NoteIcon): string {
  return `${ASSET_ORIGIN}/email/icon?name=${name}&v=${ART_VERSION}`;
}
