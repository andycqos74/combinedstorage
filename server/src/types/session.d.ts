import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Admin username once logged in. */
    user?: string;
    /** CSRF/anti-forgery state for the OneDrive OAuth round-trip. */
    oauthState?: string;
  }
}
