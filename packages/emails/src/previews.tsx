import * as React from "react";
import AgentNotification, {
  type AgentNotificationKind,
} from "../emails/agent-notification";
import AgentIdle from "../emails/agent-idle";
import ArchiveExpiring from "../emails/archive-expiring";
import AgentRecommendations from "../emails/agent-recommendations";
import AutomateAgent from "../emails/automate-agent";
import BudgetExhausted from "../emails/budget-exhausted";
import CreatorInvite from "../emails/creator-invite";
import CreatorPitch from "../emails/creator-pitch";
import IncidentResolved from "../emails/incident-resolved";
import LifetimeCode from "../emails/lifetime-code";
import OnboardingResume from "../emails/onboarding-resume";
import PaymentFailed from "../emails/payment-failed";
import RenewalReminder from "../emails/renewal-reminder";
import RunFailed from "../emails/run-failed";
import SandboxIdle from "../emails/sandbox-idle";
import SignInCode from "../emails/sign-in-code";
import PublishedAccessCode from "../emails/published-access-code";
import TeamInvite from "../emails/team-invite";
import SubscriptionEnding from "../emails/subscription-ending";
import TrialEnded from "../emails/trial-ended";
import TrialEnding from "../emails/trial-ending";
import TrialFinalNotice from "../emails/trial-final-notice";
import TrialStarted from "../emails/trial-started";
import WorkspaceInvite from "../emails/workspace-invite";
import { boardSampleUrl } from "../assets";

export interface EmailPreview {
  id: string;
  group: string;
  label: string;
  element: React.ReactElement;
}

const APP_URL = "https://app.rerun.build";
// The end-of-access notices are mandatory, so they carry no unsubscribe link at all.
const BILLING_URL = `${APP_URL}/?billing=1`;

const KIND_LABELS: Record<AgentNotificationKind, string> = {
  done: "Done",
  info: "Heads up",
  question: "Question",
  approval: "Approval",
  connector: "App",
};

const KIND_MESSAGES: Record<AgentNotificationKind, string> = {
  done: "Published the weekly report to Notion and emailed the summary to the team.",
  info: "The Stripe webhook signature changed. I kept going, but you may want to look.",
  question:
    "I found two candidate database schemas. Which one should I use for the migration?",
  approval:
    "Ready to send the outreach sequence to 240 contacts. Approve before I start?",
  connector:
    "I need access to Google Drive to read the spreadsheet you mentioned.",
};

// Real published slugs, so the gallery shows the cards the endpoint actually captures rather
// than the generic fallback a slug nobody published resolves to.
const RECOMMENDED = [
  {
    title: "Turn slow Shopify stock into bundles and campaigns",
    line: "Finds what has stopped selling and drafts the bundle and the campaign to move it",
    setupMinutes: 5,
    url: `${APP_URL}/?template=shopify-dead-stock-bundles`,
    imageUrl: `${APP_URL}/og/templates/shopify-dead-stock-bundles/email-card`,
  },
  {
    title: "Log Fireflies call notes to HubSpot weekly",
    line: "Files every call of the week on the right deal, once you have approved the batch",
    setupMinutes: 5,
    url: `${APP_URL}/?template=log-call-notes-to-hubspot`,
    imageUrl: `${APP_URL}/og/templates/log-call-notes-to-hubspot/email-card`,
  },
  {
    title: "Compile a daily news digest and send it via Gmail",
    line: "Ranks and summarises your sources every morning and drops the digest in your inbox",
    setupMinutes: 5,
    url: `${APP_URL}/?template=daily-news-digest-gmail`,
    imageUrl: `${APP_URL}/og/templates/daily-news-digest-gmail/email-card`,
  },
];

// The row the email falls back to when a capture is not there: no board on the template, or a
// screenshot that failed on the way out. Worth relooking at, it is also what a reader with images
// turned off comes closest to seeing.
const RECOMMENDED_NO_IMAGE = RECOMMENDED.map(({ imageUrl, ...rest }) => rest);

const notificationPreviews: EmailPreview[] = (
  Object.keys(KIND_LABELS) as AgentNotificationKind[]
).map((kind) => ({
  id: `agent-notification/${kind}`,
  group: "Coworker notification",
  label: KIND_LABELS[kind],
  element: (
    <AgentNotification
      agentName="Atlas"
      kind={kind}
      message={KIND_MESSAGES[kind]}
      appUrl={APP_URL}
      unsubscribeUrl={`${APP_URL}/unsubscribe`}
    />
  ),
}));

/**
 * Every template and every variant of it, in one list. The admin gallery renders this, so a
 * new variant is visible the moment it is added here.
 */
export const EMAIL_PREVIEWS: EmailPreview[] = [
  ...notificationPreviews,
  {
    id: "agent-notification/question-board",
    group: "Coworker notification",
    label: "Question, on the workspace board",
    element: (
      <AgentNotification
        agentName="Atlas"
        kind="question"
        message={KIND_MESSAGES.question}
        reason="You started this conversation."
        boardUrl={boardSampleUrl()}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "run-failed/with-run",
    group: "Run failed",
    label: "With run id",
    element: (
      <RunFailed
        agentName="Atlas"
        runId="run_4f2a9c"
        errorMessage="Tool call timed out after 900s while waiting for the engine."
        reason="You started this run."
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "run-failed/no-run",
    group: "Run failed",
    label: "Without run id",
    element: (
      <RunFailed
        agentName="Scout"
        runId=""
        errorMessage={
          "Error: connect ECONNREFUSED 127.0.0.1:3000\n    at TCPConnectWrap.afterConnect"
        }
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "run-failed/board",
    group: "Run failed",
    label: "On the workspace board",
    element: (
      <RunFailed
        agentName="Atlas"
        runId="run_4f2a9c"
        errorMessage="Tool call timed out after 900s while waiting for the engine."
        boardUrl={boardSampleUrl()}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "incident-resolved/schedule",
    group: "Back to normal",
    label: "Schedule recovered",
    element: (
      <IncidentResolved
        agentName="Atlas"
        sourceLabel='Schedule "weekly-export"'
        reason="You follow Atlas's scheduled tasks."
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "incident-resolved/trigger-board",
    group: "Back to normal",
    label: "Trigger recovered, on the workspace board",
    element: (
      <IncidentResolved
        agentName="Scout"
        sourceLabel='Trigger "on-push"'
        reason="You created this trigger."
        boardUrl={boardSampleUrl()}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "budget-exhausted/named",
    group: "Budget",
    label: "Named workspace",
    element: (
      <BudgetExhausted
        workspaceName="Acme"
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "budget-exhausted/unnamed",
    group: "Budget",
    label: "No workspace name",
    element: <BudgetExhausted workspaceName={null} appUrl={APP_URL} />,
  },
  {
    id: "workspace-invite/with-inviter",
    group: "Workspace invite",
    label: "With inviter",
    element: (
      <WorkspaceInvite
        workspaceName="Acme Inc."
        inviteUrl={`${APP_URL}/invite/abc123`}
        invitedByEmail="ada@acme.com"
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "workspace-invite/anonymous",
    group: "Workspace invite",
    label: "Without inviter",
    element: (
      <WorkspaceInvite
        workspaceName="Acme Inc."
        inviteUrl={`${APP_URL}/invite/abc123`}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "sign-in-code/default",
    group: "Sign-in code",
    label: "Code and link",
    element: (
      <SignInCode
        code="482913"
        signInUrl={`${APP_URL}/auth/confirm?token_hash=abc123&type=magiclink`}
        expiresInMinutes={15}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "published-access-code/default",
    group: "Published page code",
    label: "Invited visitor",
    element: (
      <PublishedAccessCode
        code="482913"
        workspaceName="Acme"
        pageTitle="Q3 proposal for Northwind"
        expiresInMinutes={10}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "lifetime-code/default",
    group: "Lifetime code",
    label: "Bought on rerun.build",
    element: (
      <LifetimeCode
        code="RERUN-7KQ4-M2XW-9HTD"
        redeemUrl={`${APP_URL}/redeem?code=RERUN-7KQ4-M2XW-9HTD`}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "creator-invite/outreach",
    group: "Creator invite",
    label: "Outreach",
    element: (
      <CreatorInvite
        firstName="Alex"
        joinUrl={`${APP_URL}/creator/join/q3qmbe89`}
        appUrl={APP_URL}
        context="outreach"
        cardImageUrl={`${APP_URL}/experts/alex-mercier/card.png`}
        unsubscribeUrl="https://rerun.build/community/experts/unsubscribe/q3qmbe89"
      />
    ),
  },
  {
    id: "creator-invite/application",
    group: "Creator invite",
    label: "Application accepted",
    element: (
      <CreatorInvite
        firstName="Alex"
        joinUrl={`${APP_URL}/creator/join/q3qmbe89`}
        appUrl={APP_URL}
        context="application"
        cardImageUrl={`${APP_URL}/experts/alex-mercier/card.png`}
      />
    ),
  },
  {
    id: "onboarding-resume/named",
    group: "Onboarding resume",
    label: "Name known",
    element: (
      <OnboardingResume
        firstName="Clément"
        resumeUrl={APP_URL}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "onboarding-resume/anonymous",
    group: "Onboarding resume",
    label: "No name",
    element: (
      <OnboardingResume
        firstName={null}
        resumeUrl={APP_URL}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "agent-recommendations/three",
    group: "Coworker recommendations",
    label: "Three picks",
    element: (
      <AgentRecommendations
        companyName="Acme"
        websiteDomain="acme.com"
        templates={RECOMMENDED}
        browseUrl={APP_URL}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "agent-recommendations/two",
    group: "Coworker recommendations",
    label: "Two picks, no site",
    element: (
      <AgentRecommendations
        companyName={null}
        websiteDomain={null}
        templates={RECOMMENDED.slice(0, 2)}
        browseUrl={APP_URL}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "agent-recommendations/no-card",
    group: "Coworker recommendations",
    label: "No captured card",
    element: (
      <AgentRecommendations
        companyName="Acme"
        websiteDomain="acme.com"
        templates={RECOMMENDED_NO_IMAGE}
        browseUrl={APP_URL}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "agent-idle/default",
    group: "Coworker idle",
    label: "Never ran",
    element: (
      <AgentIdle
        agentName="Atlas"
        createdLabel="3 hours ago"
        agentUrl={`${APP_URL}/?agent=8f2b`}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "team-invite/default",
    group: "Team invite",
    label: "First result",
    element: (
      <TeamInvite
        workspaceName="Acme"
        agentName="Atlas"
        inviteUrl={`${APP_URL}/?members=1`}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "automate-agent/with-result",
    group: "Automate coworker",
    label: "With last result",
    element: (
      <AutomateAgent
        agentName="Atlas"
        manualRuns={4}
        periodLabel="the last two weeks"
        lastResult="Checked 84 invoices against the Stripe payouts, 2 did not match and are listed in the Notion page."
        scheduleUrl={`${APP_URL}/?agent=8f2b`}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "automate-agent/bare",
    group: "Automate coworker",
    label: "No last result",
    element: (
      <AutomateAgent
        agentName="Atlas"
        manualRuns={2}
        periodLabel="the last week"
        scheduleUrl={`${APP_URL}/?agent=8f2b`}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "trial-started/default",
    group: "Trial started",
    label: "Seven days",
    element: (
      <TrialStarted
        workspaceName="Acme"
        trialDays={5}
        trialEndsLabel="12 March"
        monthlyPriceLabel="$49"
        includedLabel="3 coworkers and 350 credits"
        workspaceUrl={APP_URL}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "trial-started/no-card",
    group: "Trial started",
    label: "No card",
    element: (
      <TrialStarted
        workspaceName="Acme"
        trialDays={5}
        trialEndsLabel="12 March"
        monthlyPriceLabel="$29"
        includedLabel="3 coworkers and 350 credits"
        hasCard={false}
        workspaceUrl={APP_URL}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "trial-ending/one-day",
    group: "Trial ending",
    label: "A day left",
    element: (
      <TrialEnding
        workspaceName="Acme"
        trialEndsLabel="12 March"
        daysLeft={1}
        keptUntilLabel="10 June"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "trial-ending/board",
    group: "Trial ending",
    label: "On the workspace board",
    element: (
      <TrialEnding
        workspaceName="Acme"
        trialEndsLabel="12 March"
        daysLeft={3}
        keptUntilLabel="10 June"
        boardUrl={boardSampleUrl()}
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "trial-final-notice/no-card",
    group: "Trial final notice",
    label: "No card",
    element: (
      <TrialFinalNotice
        hasCard={false}
        workspaceName="Acme"
        trialEndsLabel="12 March, 14:00 UTC"
        pausedLabel="12 March, 16:00 UTC"
        keptUntilLabel="10 June"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "trial-final-notice/card",
    group: "Trial final notice",
    label: "Card on file",
    element: (
      <TrialFinalNotice
        hasCard
        workspaceName="Acme"
        trialEndsLabel="12 March, 14:00 UTC"
        pausedLabel="12 March, 16:00 UTC"
        keptUntilLabel="10 June"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "payment-failed",
    group: "Payment failed",
    label: "Renewal declined",
    element: (
      <PaymentFailed
        workspaceName="Acme"
        amountLabel="$49.00"
        declinedLabel="12 March"
        pausedLabel="13 March, 16:00 UTC"
        keptUntilLabel="10 June"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "payment-failed/board",
    group: "Payment failed",
    label: "On the workspace board",
    element: (
      <PaymentFailed
        workspaceName="Acme"
        amountLabel="$49.00"
        declinedLabel="12 March"
        pausedLabel="13 March, 16:00 UTC"
        keptUntilLabel="10 June"
        boardUrl={boardSampleUrl()}
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "trial-ended/with-summary",
    group: "Trial ended",
    label: "With summary",
    element: (
      <TrialEnded
        reason="no_card"
        workspaceName="Acme"
        trialEndedLabel="12 March"
        pausedLabel="12 March, 16:00 UTC"
        keptUntilLabel="10 June"
        summary={{ agents: 3, runs: 41 }}
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "trial-ended/bare",
    group: "Trial ended",
    label: "Nothing ran",
    element: (
      <TrialEnded
        reason="no_card"
        workspaceName="Acme"
        trialEndedLabel="12 March"
        pausedLabel="12 March, 16:00 UTC"
        keptUntilLabel="10 June"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "trial-ended/payment-failed",
    group: "Trial ended",
    label: "First payment failed",
    element: (
      <TrialEnded
        reason="payment_failed"
        workspaceName="Acme"
        trialEndedLabel="12 March"
        pausedLabel="12 March, 17:00 UTC"
        keptUntilLabel="10 June"
        summary={{ agents: 3, runs: 41 }}
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "subscription-ending/seven-days",
    group: "Subscription ending",
    label: "Seven days left",
    element: (
      <SubscriptionEnding
        workspaceName="Acme"
        endsLabel="12 March"
        daysLeft={7}
        keptUntilLabel="10 June"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "subscription-ending/three-days",
    group: "Subscription ending",
    label: "Three days left",
    element: (
      <SubscriptionEnding
        workspaceName="Acme"
        endsLabel="12 March"
        daysLeft={3}
        keptUntilLabel="10 June"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "subscription-ending/tomorrow",
    group: "Subscription ending",
    label: "Last day",
    element: (
      <SubscriptionEnding
        workspaceName="Acme"
        endsLabel="12 March"
        daysLeft={1}
        keptUntilLabel="10 June"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "archive-expiring/with-agents",
    group: "Archive expiring",
    label: "With coworkers",
    element: (
      <ArchiveExpiring
        workspaceName="Acme"
        pausedLabel="12 March"
        deletionLabel="10 June"
        agentCount={3}
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "archive-expiring/no-agents",
    group: "Archive expiring",
    label: "No coworkers",
    element: (
      <ArchiveExpiring
        workspaceName={null}
        pausedLabel="12 March"
        deletionLabel="10 June"
        agentCount={0}
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "archive-expiring/sandbox",
    group: "Archive expiring",
    label: "Archived sandbox",
    element: (
      <ArchiveExpiring
        workspaceName="Sandbox"
        pausedLabel="12 March"
        deletionLabel="10 June"
        agentCount={2}
        billingUrl={APP_URL}
        sandbox
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "sandbox-idle/notice",
    group: "Sandbox idle",
    label: "Two days before the archive",
    element: (
      <SandboxIdle
        lastActiveLabel="4 September"
        archiveLabel="6 October"
        agentCount={2}
        sandboxUrl={APP_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "renewal-reminder/seven-days",
    group: "Renewal reminder",
    label: "A week before the renewal",
    element: (
      <RenewalReminder
        workspaceName="Acme"
        renewsLabel="29 October"
        daysLeft={7}
        amountLabel="$49.00"
        billingUrl={BILLING_URL}
        appUrl={APP_URL}
      />
    ),
  },
  {
    id: "creator-pitch/named-agent",
    group: "Creator pitch",
    label: "With a coworker",
    element: (
      <CreatorPitch
        firstName="Clément"
        agentName="Atlas"
        creatorUrl={`${APP_URL}/creator`}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
  {
    id: "creator-pitch/bare",
    group: "Creator pitch",
    label: "No coworker named",
    element: (
      <CreatorPitch
        firstName={null}
        agentName={null}
        creatorUrl={`${APP_URL}/creator`}
        appUrl={APP_URL}
        unsubscribeUrl={`${APP_URL}/unsubscribe`}
      />
    ),
  },
];

export function findEmailPreview(id: string): EmailPreview | undefined {
  return EMAIL_PREVIEWS.find((preview) => preview.id === id);
}
