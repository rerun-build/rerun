// What a session holds of the caller's `users` row and of the workspace it acts in. Read by the
// browser's SessionProvider and by getServerSession on the server, which hands its read to the
// provider on the board's page load.
export const SESSION_USER_COLUMNS = ['id', 'created_at', 'workspace_id', 'email_notification_prefs', 'account_role', 'expert_profile_id', 'signed_up_at', 'locale'] as const

export const SESSION_WORKSPACE_COLUMNS = ['id', 'name', 'icon_url', 'created_at', 'plan', 'stripe_customer_id', 'max_agents', 'max_seats', 'model_access', 'custom_integrations', 'subscription_status', 'current_period_end', 'trial_ends_at', 'rerun_used_micros', 'rerun_budget_micros', 'rerun_topup_micros', 'rerun_period_anchor', 'rerun_credit_paused_at', 'is_sandbox', 'boxes_disabled_at', 'boxes_archived_at', 'onboarded_at', 'locale', 'organization_id'] as const
