/**
 * Next.js instrumentation hook.
 *
 * Intentionally minimal. Background schedulers are NOT started here because
 * this project ships an edge middleware, so instrumentation is compiled for
 * both the edge and Node runtimes — and the Node-only scheduler (which
 * transitively imports mongodb) cannot be reliably imported here without
 * either breaking the edge bundle or failing runtime resolution
 * (ERR_MODULE_NOT_FOUND). See lib/services/trial-nudges.ts for where the
 * scheduler actually starts (lazily, from the Node-bundled /api/health route).
 */
export async function register() {
  // no-op
}
