// ============================================================================
// Sign-up password policy (client side).
// ----------------------------------------------------------------------------
// Applies ONLY when a password is CHOSEN (register, "set a password" for a
// Google account). It is never checked at sign-in, so existing accounts with
// shorter passwords are not locked out.
//
// This is a convenience for users, not a security boundary: the enforceable
// version is Firebase Console -> Authentication -> Settings -> Password policy.
// ============================================================================

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_TOO_SHORT_MESSAGE =
  `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

export const isAcceptableNewPassword = password =>
  typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;

// One wording for "no such account" and "wrong password", so the login form
// cannot be used to find out which emails are registered.
export const LOGIN_FAILED_MESSAGE = "Incorrect email or password.";
