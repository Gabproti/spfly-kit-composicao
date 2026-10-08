export function passwordResetUrl(origin: string, base: string) {
  return new URL(base, origin).href;
}
export function passwordError(password: string, confirmation: string) {
  if (password.length < 12 || password.length > 128)
    return "Use uma senha entre 12 e 128 caracteres.";
  if (password !== confirmation) return "As senhas não conferem.";
  return "";
}
export function hasRecoveryLink(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get("type") === "recovery" || hasRecoveryError(hash);
}
export function hasRecoveryError(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.has("error") || params.has("error_code");
}
const key = "spfly-password-recovery-user";
export function rememberRecovery(userId: string | null) {
  try {
    if (userId) sessionStorage.setItem(key, userId);
    else sessionStorage.removeItem(key);
  } catch {
    /* Storage can be disabled. */
  }
}
export function isRecoverySession(userId: string) {
  try {
    return sessionStorage.getItem(key) === userId;
  } catch {
    return false;
  }
}
