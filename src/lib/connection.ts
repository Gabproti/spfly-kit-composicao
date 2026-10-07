export const connectionMessage = "Não foi possível conectar ao servidor de acesso. Tente novamente em alguns instantes. Se continuar, peça ao administrador para verificar o Supabase.";

export function withTimeout<T>(operation: PromiseLike<T>, milliseconds = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(connectionMessage)), milliseconds);
    Promise.resolve(operation).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

// Abort the underlying request too, so failed connections do not hold auth locks.
export async function boundedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const requestUrl = input instanceof Request ? input.url : String(input);
  // Photo and spreadsheet writes need time on slower connections; auth should
  // fail quickly when its server is unavailable.
  const timeout = new URL(requestUrl).pathname.startsWith("/auth/v1/") ? 12000 : 120000;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
