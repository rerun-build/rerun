// Android signs in with Apple through the browser: PKCE keeps the code useless to any other app that
// would catch the rerun:// redirect.
export const AUTH_FLOW_TYPE = 'pkce' as const
