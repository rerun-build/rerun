// A session the team opened on a customer's account, from the sign-in link of the admin. The cookie
// names that account, so it says nothing about another one signed in later on the same browser.
export const TEAM_SIGN_IN_PARAM = 'team'
export const TEAM_SIGN_IN_VALUE = '1'
export const TEAM_SESSION_COOKIE = 'rr_team_session'
// As long as the session cookies of Supabase, which it describes.
export const TEAM_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 400

export function isTeamSession(cookie: string | undefined, userId: string | null | undefined): boolean {
    return !!userId && cookie === userId
}
