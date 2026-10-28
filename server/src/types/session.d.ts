import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Id of the signed-in user. */
    userId?: string;
    /** CSRF/anti-forgery state for the cloud-drive OAuth round-trip. */
    oauthState?: string;
  }
}
