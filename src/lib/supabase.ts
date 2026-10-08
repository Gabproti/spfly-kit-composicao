import { createClient } from "@supabase/supabase-js";
import { boundedFetch } from "./connection";
import { hasRecoveryLink, hasRecoveryError } from "./passwordRecovery";
// Capture only the intent before the Auth client consumes the URL fragment.
export const recoveryRequested = hasRecoveryLink(window.location.hash);
export const recoveryLinkError = hasRecoveryError(window.location.hash);
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(
  url && key && !url.includes("SEU-PROJETO") && !key.startsWith("SUA_"),
);
export const supabase = configured
  ? createClient(url, key, { global: { fetch: boundedFetch } })
  : null;
export function db() {
  if (!supabase) throw new Error("Configure a conexão com o Supabase.");
  return supabase;
}
export function fail(error: { message: string } | null) {
  if (error) throw error;
}
