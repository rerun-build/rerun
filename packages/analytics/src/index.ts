export type SignupMethod = 'google' | 'apple' | 'email' | 'phone'

export const SIGNUP_INTENT_COOKIE = 'rr_signup_intent'

export type SignupSurface = 'welcome_wall' | 'foreman_intake' | 'signin_dialog' | 'auth_page' | 'ready_made_arrival'
export type SignupStep = 'phone' | 'phone_code' | 'email' | 'email_code'
export type SignupAbandonTrigger = 'tab_hidden' | 'page_left' | 'dismissed'
export type BillingPeriod = 'monthly' | 'annual'
export type TrialType = 'card_required_5d' | 'no_card_5d' | 'no_card_3d' | 'card_required_3d' | 'card_required_7d' | 'no_card_7d'

export type ExpertProps = {
    expert_id: string
    expert_slug: string
}

export function expertDistinctId(expert: { id: string; email?: string | null }): string {
    return expert.email?.trim().toLowerCase() || `expert:${expert.id}`
}

export type PhoneVerificationContext = 'sign_in' | 'wall' | 'settings'
export type CaptchaProvider = 'turnstile' | 'hcaptcha'
export type PhoneDeliveryStatus = 'sent' | 'delivered' | 'undelivered' | 'failed' | 'verified'

export type OnboardingArrival = 'template' | 'share' | 'prompt' | 'none'

export type AgentRunProps = {
    agent_id: string
    workspace_id?: number
    session_id?: string
    run_id?: string
    steps?: number
    model?: string
    cost_micros?: number
}

export type Attribution = {
    referrer_domain?: string
    utm_source?: string
    utm_campaign?: string
}

export type SubscriptionLifecycleProps = {
    plan: string
    workspace_id: number
    user_id?: string
    stripe_customer_id: string
    stripe_subscription_id: string
    addons: Record<string, number>
    mrr: number
    currency: string
    billing_period: BillingPeriod
    trial_start?: string
    trial_end?: string
}

export type ExperimentExposure = Record<string, string>

export type HeroCta =
    | 'start_trial'
    | 'explore_library'
    | 'mockup'
    | 'video'
    | 'composer'

export type CancelFlowPhase = 'paid' | 'trial'

export type AiConnectionMethod = 'oauth' | 'token' | 'api_key'
export type AiConnectionSurface = 'add_provider' | 'reconnect' | 'subscription_offer'
export type AiConnectionFailureReason = 'rejected' | 'invalid_token' | 'oauth_exchange_failed' | 'code_expired' | 'device_auth_failed' | 'start_failed'

export type AiConnectionProps = { provider: string; method: AiConnectionMethod; surface: AiConnectionSurface }

export interface AnalyticsEventMap {
    account_created: { method: SignupMethod } & Attribution
    checkout_started: { plan: string; source: 'template_cta' | 'billing_dialog' | 'agent_share' | 'foreman' | 'pay_now' | 'ai_providers' }
    paywall_viewed: { trigger: string; addon_shown?: string; variant?: string }
    trial_started: SubscriptionLifecycleProps & { trial_type: TrialType; origin?: 'web' | 'ios' | 'android' }
    trial_converted: SubscriptionLifecycleProps
    trial_payment_failed: SubscriptionLifecycleProps & { invoice_id: string; amount_due: number }
    trial_skipped_card_reused: SubscriptionLifecycleProps
    subscription_started: SubscriptionLifecycleProps
    subscription_cancel_requested: SubscriptionLifecycleProps & {
        cancel_at?: string
        cancellation_reason?: string
        cancellation_feedback?: string
        cancellation_comment?: string
        cancel_comeback?: string
        cancel_reason_check?: string
    }
    subscription_cancelled: SubscriptionLifecycleProps & { cancellation_reason?: string; cancellation_feedback?: string; cancellation_comment?: string }

    cancel_flow_started: { phase: CancelFlowPhase }
    cancel_flow_abandoned: { phase: CancelFlowPhase; step: string }
    renewal_reminder_requested: { phase: CancelFlowPhase }
    retention_offer_shown: { phase: CancelFlowPhase; reason: string; offer: string }
    retention_offer_accepted: { phase: CancelFlowPhase; reason: string; offer: string }
    retention_offer_declined: { phase: CancelFlowPhase; reason: string; offer: string }
    invoice_paid: SubscriptionLifecycleProps & { invoice_id: string; amount_paid: number; billing_reason?: string }

    signup_gate_viewed: { surface: SignupSurface }
    signup_started: { surface?: SignupSurface; in_app_browser?: string }
    signup_method_selected: { method: SignupMethod; in_app_browser?: string }
    oauth_sign_in_failed: { code: string; provider: SignupMethod | null }
    signup_field_error: { field: string; error_type: string }
    email_verification_sent: Record<string, never>
    email_verification_failed: { reason: string; captcha_provider?: CaptchaProvider; captcha_code?: string; in_app_browser?: string; message?: string }
    captcha_puzzle_shown: { turnstile_reason?: string; turnstile_code?: string }
    captcha_puzzle_solved: Record<string, never>
    email_verification_completed: { via: 'code' | 'link'; delay_seconds?: number }
    phone_wall_viewed: Record<string, never>
    phone_wall_skipped: Record<string, never>
    phone_wall_submitted: { country: string }
    phone_verification_sent: { channel: 'sms' | 'whatsapp'; context: PhoneVerificationContext }
    phone_verification_completed: { channel: 'sms' | 'whatsapp'; context: PhoneVerificationContext }
    phone_verification_failed: { channel: 'sms' | 'whatsapp'; context: PhoneVerificationContext; reason: string; country: string; message?: string; captcha_provider?: CaptchaProvider; captcha_code?: string }
    phone_verification_delivery: { status: PhoneDeliveryStatus; channel?: string; reason?: string; country?: string; context?: string }
    signup_abandoned: { last_step: SignupStep; seconds_spent: number; surface?: SignupSurface; trigger: SignupAbandonTrigger }

    expert_application_submitted: ExpertProps & { expert_type: string }
    expert_invite_sent: ExpertProps & { email_id?: string }
    expert_profile_published: ExpertProps
    expert_invite_declined: ExpertProps

    creator_application_accepted: ExpertProps & { email_id?: string }
    creator_application_rejected: ExpertProps
    creator_sandbox_claimed: ExpertProps
    creator_terms_accepted: ExpertProps

    template_link_opened: { slug: string; has_space: boolean }
    template_import_completed: { slug: string; imported: number; failed: number }
    template_purchase_started: { slug: string; price_kind: string; amount_cents: number }
    template_purchase_completed: { slug: string }

    agent_share_created: { carries_memories: boolean; carries_database: boolean; carries_files: boolean }
    agent_share_opened: { has_account: boolean }
    agent_share_installed: { inactive: boolean }

    agent_duplicated: { schedules: number; triggers: number }

    onboarding_started: { mode: 'foreman'; arrival: OnboardingArrival }
    onboarding_step_viewed: { step: string }
    onboarding_step_completed: { step: string; via?: 'plan_card' | 'template' | 'starter_pack' | 'custom' }
    onboarding_next_step_clicked: { step: string }
    getting_started_step_completed: { step: string }
    getting_started_step_clicked: { step: string }
    trial_extended: { days: number; source: 'getting_started' }
    onboarding_website_submitted: { provided: boolean; industry?: string }
    onboarding_company_analyzed: { ok: boolean }
    onboarding_use_cases_selected: { proposed: number; selected: number; custom: boolean }
    onboarding_either_answered: { outcome: 'picked' | 'neither' | 'typed' | 'dismissed' | 'abandoned' }
    onboarding_plan_answered: { confirmed: boolean; agents: number; via?: 'starter_pack' | 'custom'; picked?: string[]; from?: 'intake' | 'pack' }
    onboarding_checkout_answered: { ok: boolean; reason?: 'trial_refused' | 'dismissed' | 'pending' }
    onboarding_help_answered: { sent: boolean }
    onboarding_team_built: { agents: number; failed: number; error: boolean }
    first_agent_created: { template: string }
    agent_run_started: { agent_id: string }
    agent_run_completed: AgentRunProps
    agent_run_failed: Partial<AgentRunProps> & { error_type: string }
    agent_install_started: { agent_id: string }
    agent_install_skipped: { agent_id: string }

    connection_cta_clicked: { source: string }
    ai_connection_connected: AiConnectionProps
    ai_connection_failed: AiConnectionProps & { reason: AiConnectionFailureReason; error?: string }
    ai_connection_disconnected: { provider: string }

    lifecycle_email_sent: { sequence: string; category: string }

    api_key_created: Record<string, never>
    agent_import_prepared: { source: string }

    experiment_viewed: ExperimentExposure
    hero_cta_clicked: { cta: HeroCta; prompt?: string; prompt_length?: number; agent_name?: string; apps_count?: number; scheduled?: boolean; suggestion?: string }
    hero_composer_engaged: { via: 'typing' | 'suggestion' }
    workspace_preview_agent_opened: { agent: string }
    workspace_preview_hitl_answered: { agent: string; kind: 'question' | 'permission' | 'approval' }
    workspace_preview_cta_clicked: { agent: string }
    workspace_preview_inbox_opened: Record<string, never>
    workspace_preview_foreman_opened: Record<string, never>
    workspace_preview_foreman_asked: { prompt: string }
    workspace_preview_foreman_tab: { tab: 'assistant' | 'routines' }

    tab_nudge_shown: { path: string; reduced_motion: boolean }
    tab_nudge_returned: { away_seconds: number; nudge_index: number; bar_shown: boolean }
    tab_nudge_cta_clicked: { signed_in: boolean; away_seconds: number }
    tab_nudge_dismissed: { seconds_visible: number }

    template_lead_magnet_shown: { slug: string }
    template_lead_magnet_dismissed: { slug: string; seconds_visible: number }

    app_connected: { app: string; allowance: string; reconnect: boolean }
    app_slot_added: { app: string; trial_slot: boolean }
    app_trial_started: { app: string }
    app_trial_converted: { app: string; outcome: 'charged' | 'declined' | 'nothing_to_charge' }
    app_quota_hit: { app: string; action: string }
    app_event_fired: { app: string; event: string; woken: number }
}

export type EventName = keyof AnalyticsEventMap
