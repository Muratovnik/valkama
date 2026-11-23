import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'

/**
 * What was processed anew: input, cache writes and output. Cached reads are left out because
 * they dwarf the rest, and reasoning because it is already part of output at both clients.
 */
export function tokensAnew(tokens: UsageTokens): number | null {
  const kinds = [tokens.input, tokens.cache_write_5m, tokens.cache_write_1h, tokens.output]
  const known = kinds.filter((count) => count !== null)
  return known.length ? known.reduce((sum, count) => sum + count, 0) : null
}
