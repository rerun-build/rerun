export { renderEmail } from "./render";

export { default as RunFailed } from "../emails/run-failed";
export type { RunFailedProps } from "../emails/run-failed";

export { default as BudgetExhausted } from "../emails/budget-exhausted";
export type { BudgetExhaustedProps } from "../emails/budget-exhausted";

export { default as AgentNotification } from "../emails/agent-notification";
export type { AgentNotificationProps } from "../emails/agent-notification";

export { default as IncidentResolved } from "../emails/incident-resolved";
export type { IncidentResolvedProps } from "../emails/incident-resolved";

export { default as WorkspaceInvite } from "../emails/workspace-invite";
export type { WorkspaceInviteProps } from "../emails/workspace-invite";

export { default as SignInCode } from "../emails/sign-in-code";
export type { SignInCodeProps } from "../emails/sign-in-code";

export { default as PublishedAccessCode } from "../emails/published-access-code";
export type { PublishedAccessCodeProps } from "../emails/published-access-code";

export { default as LifetimeCode } from "../emails/lifetime-code";
export type { LifetimeCodeProps } from "../emails/lifetime-code";

export { default as CreatorInvite } from "../emails/creator-invite";
export type {
  CreatorInviteProps,
  CreatorInviteContext,
} from "../emails/creator-invite";

export { default as OnboardingResume } from "../emails/onboarding-resume";
export type { OnboardingResumeProps } from "../emails/onboarding-resume";

export { default as AgentRecommendations } from "../emails/agent-recommendations";
export type {
  AgentRecommendationsProps,
  RecommendedTemplate,
} from "../emails/agent-recommendations";

export { default as AgentIdle } from "../emails/agent-idle";
export type { AgentIdleProps } from "../emails/agent-idle";

export { default as TeamInvite } from "../emails/team-invite";
export type { TeamInviteProps } from "../emails/team-invite";

export { default as AutomateAgent } from "../emails/automate-agent";
export type { AutomateAgentProps } from "../emails/automate-agent";

export { default as TrialStarted } from "../emails/trial-started";
export type { TrialStartedProps } from "../emails/trial-started";

export { default as TrialEnded } from "../emails/trial-ended";
export type { TrialEndedProps, TrialEndedReason, TrialSummary } from "../emails/trial-ended";

export { default as PaymentFailed } from "../emails/payment-failed";
export type { PaymentFailedProps } from "../emails/payment-failed";

export { default as TrialFinalNotice } from "../emails/trial-final-notice";
export type { TrialFinalNoticeProps } from "../emails/trial-final-notice";

export { default as TrialEnding } from "../emails/trial-ending";
export type { TrialEndingProps } from "../emails/trial-ending";

export { default as SubscriptionEnding } from "../emails/subscription-ending";
export type { SubscriptionEndingProps } from "../emails/subscription-ending";

export { default as ArchiveExpiring } from "../emails/archive-expiring";
export type { ArchiveExpiringProps } from "../emails/archive-expiring";
export { default as SandboxIdle } from "../emails/sandbox-idle";
export type { SandboxIdleProps } from "../emails/sandbox-idle";

export { default as RenewalReminder } from "../emails/renewal-reminder";
export type { RenewalReminderProps } from "../emails/renewal-reminder";

export { default as CreatorPitch } from "../emails/creator-pitch";
export type { CreatorPitchProps } from "../emails/creator-pitch";

export { EMAIL_PREVIEWS, findEmailPreview } from "./previews";
export type { EmailPreview } from "./previews";

export { NEWSLETTERS, findNewsletter } from "./newsletters";
export type { Newsletter } from "./newsletters";

export type {
  NewsletterAudience,
  NewsletterLayoutProps,
  NewsletterMeta,
  NewsletterProps,
} from "../components/NewsletterLayout";

export type { NewsletterSectionProps } from "../components/NewsletterSection";

export type {
  NewsletterNote,
  NewsletterNotesProps,
} from "../components/NewsletterNotes";

export { theme, text, TONES } from "../theme";
export type { Tone, ToneName } from "../theme";

export { ASSET_ORIGIN, SCENE_HEIGHT, SCENE_WIDTH } from "../assets";
export type { HeroVariant } from "../assets";

export { NOTE_ICONS } from "../assets";
export type { NoteIcon } from "../assets";

export { newsletterArtUrl, newsletterMediaUrl } from "../assets";

export { NEWSLETTER_ART } from "../newsletter-art";
export type { NewsletterArt } from "../newsletter-art";
