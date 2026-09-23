/**
 * Back-compat shim — the LLM layer is now multi-provider.
 * New code should import from "./providers" or "./settings" directly.
 */
export { chat, isLlmConfigured, testProvider } from "./providers";
export type { ChatMessage, ChatOptions } from "./providers";
export {
  getLlmSettings,
  getProviderChain,
  getLlmFeatures,
  saveLlmSettings,
  type ProviderConfig,
  type LlmSettings,
  type LlmFeatures,
} from "./settings";
