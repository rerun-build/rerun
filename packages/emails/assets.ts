import { isWhiteLabel, type Brand } from "@rerun/contracts";

// Gmail drops data: URI images, and a localhost appUrl would break every asset in mails sent
// from a dev environment, so a sent email always resolves its assets against the production host.
// Previews are the exception and override it: the react-email server sets EMAIL_ASSET_ORIGIN in
// its dev script, and the admin gallery repoints /email/ URLs at the origin it is served from.
// Read off globalThis rather than `process`: this package has no node types, and the react-email
// preview server renders it outside a node context.
type MaybeNode = { process?: { env?: Record<string, string | undefined> } };
export const ASSET_ORIGIN =
  (globalThis as MaybeNode).process?.env?.EMAIL_ASSET_ORIGIN ??
  "https://app.rerun.build";

// An organization's email loads its artwork from where its links lead, so nothing in it names Rerun.
// A localhost app keeps the production host, which the mail client can reach.
export function assetOrigin(brand: Brand, appUrl: string | undefined): string {
  if (!isWhiteLabel(brand) || !appUrl?.startsWith("https://")) return ASSET_ORIGIN;
  return new URL(appUrl).origin;
}

/** Bumped whenever the artwork changes: both art routes are cached immutably. */
export const ART_VERSION = "7";

// The Buddy of the app icon, served by /email/logo. `public/email/logo.png` is that same image:
// mail sent before the route existed points straight at it.
export const LOGO_URL = `${ASSET_ORIGIN}/email/logo?v=${ART_VERSION}`;
export const LOGO_SIZE = 32;

// The banner is picked by variant alone: it carries its own icon and its own tint, so there is
// one image per variant and the Gmail proxy caches each of them once for everybody.
// `budget`, `invite`, `library` and `schedule` are no longer asked for by any template, but mail
// already sitting in inboxes points at them, so the route keeps serving them.
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

export function heroUrl(variant: HeroVariant, origin = ASSET_ORIGIN): string {
  return `${origin}/email/art?variant=${variant}&v=${ART_VERSION}`;
}

// Every email an account gets about itself opens on a rendered 3D glass scene instead of the icon
// stripe. The stripe is left to the agent notifications, which are relayed one per event and pick
// their band from the notification kind. One flat file per sequence, drawn by
// cloud/packages/cloud/scripts/generate-email-scenes.mts and served from the same origin as the rest of the art.
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
/** A close-up of the board, as wide as a scene. */
export const CLOSE_UP_HEIGHT = 260;

export function sceneUrl(scene: HeroScene, origin = ASSET_ORIGIN): string {
  return `${origin}/email/scene/${scene}.jpg?v=${ART_VERSION}`;
}

// The previews cannot capture a close-up or a portrait either: flat files, captured once from /og/board
// and /og/coworker.
export function alertSampleUrl(name: AlertSample): string {
  return `${ASSET_ORIGIN}/email/alert/${name}.png?v=${ART_VERSION}`;
}

export type AlertSample = "question" | "approval" | "connector" | "failed" | "claude" | "key" | "credits" | "payment" | "portrait";

// The previews cannot sign a board of their own (the secret lives with the app), so they show one
// captured once from /og/board at the frame of a scene and kept as a flat file.
export function boardSampleUrl(): string {
  return `${ASSET_ORIGIN}/email/board-sample.png?v=${ART_VERSION}`;
}

// A newsletter issue opens on its own render rather than on a shared banner: an issue is written
// once and its header is drawn for it, the way a magazine cover belongs to one number. Same band
// geometry as a scene, drawn by cloud/packages/cloud/scripts/generate-newsletter-art.mts from the brief the
// issue declares in newsletter-art.ts, and served as a flat file next to the scenes.
export function newsletterArtUrl(slug: string): string {
  return `${ASSET_ORIGIN}/email/newsletter/${slug}.jpg?v=${ART_VERSION}`;
}

// A section of an issue can carry its own picture: a screenshot of what shipped, or a screen
// recording turned into a GIF. Unlike the header, which is one file per issue, these are many, so
// they live in a folder named after the slug. Produced by cloud/packages/cloud/scripts/newsletter-media.mts.
export function newsletterMediaUrl(slug: string, file: string): string {
  return `${ASSET_ORIGIN}/email/newsletter/${slug}/${file}?v=${ART_VERSION}`;
}

// A compact note in an issue opens on a small glyph rather than a bullet: the list is skimmed, and
// a shape is read faster than a label. Closed set, one tint, so the URL space stays as small as the
// banner's and the Gmail proxy caches each glyph once for every recipient of every issue.
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
