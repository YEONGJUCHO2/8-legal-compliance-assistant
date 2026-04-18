export function createDeadline({
  totalMs,
  safetyMarginMs
}: {
  totalMs: number;
  safetyMarginMs: number;
}) {
  const startedAt = Date.now();

  return {
    remaining() {
      return Math.max(0, totalMs - (Date.now() - startedAt));
    },
    expired() {
      return totalMs - (Date.now() - startedAt) <= 0;
    },
    shouldPreempt() {
      return this.remaining() <= safetyMarginMs;
    }
  };
}
