import type { ChannelProvider } from "./types.ts";
import { discussProvider } from "./discuss.ts";

/* ── Built-in providers ── */

const providers: Record<string, ChannelProvider> = {
  discuss: discussProvider,
};

/* ── Public API ── */

/**
 * Register a custom provider at runtime.
 * Overwrites any existing provider with the same id.
 */
export function registerProvider(provider: ChannelProvider): void {
  providers[provider.id] = provider;
}

/**
 * Look up a provider by id.
 * Falls back to `"discuss"` when `providerId` is omitted or empty,
 * ensuring full backward-compatibility with existing configs.
 */
export function getProvider(providerId?: string): ChannelProvider {
  const id = providerId || "discuss";
  const provider = providers[id];
  if (!provider) {
    throw new Error(
      `Unknown channel provider "${id}". Available: ${Object.keys(providers).join(", ")}`,
    );
  }
  return provider;
}

/** List all registered provider ids. */
export function listProviderIds(): string[] {
  return Object.keys(providers);
}
