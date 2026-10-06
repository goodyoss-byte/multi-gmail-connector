// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
// Token bucket per account. Google allows 6,000 Gmail quota units per user per
// minute; we budget 4,800 so bursts from Claude don't hit Google's limit.

export const DEFAULT_UNITS_PER_MINUTE = 4800;

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Per-account request budget exhausted');
  }
}

export class QuotaLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly unitsPerMinute = DEFAULT_UNITS_PER_MINUTE,
    private readonly now: () => number = Date.now,
  ) {}

  charge(key: string, units: number): void {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.unitsPerMinute, updated: t };
    b.tokens = Math.min(this.unitsPerMinute, b.tokens + ((t - b.updated) / 60_000) * this.unitsPerMinute);
    b.updated = t;
    if (b.tokens < units) {
      this.buckets.set(key, b);
      const wait = Math.ceil(((units - b.tokens) / this.unitsPerMinute) * 60);
      throw new RateLimitedError(Math.max(1, wait));
    }
    b.tokens -= units;
    this.buckets.set(key, b);
  }
}
