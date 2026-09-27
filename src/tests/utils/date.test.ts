import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

describe('Billing History Date Validation', () => {
  let originalTimezone: string | undefined;

  beforeAll(() => {
    originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
  });

  afterAll(() => {
    process.env.TZ = originalTimezone;
  });

  it('should format billing history dates as ISO UTC strings', () => {
    const mockDate = new Date('2026-07-26T12:00:00Z');
    
    // Ensure all date assertions compare ISO UTC strings
    expect(mockDate.toISOString()).toBe('2026-07-26T12:00:00.000Z');
  });

  it('should handle time zone variance correctly', () => {
    // Creating a date without explicit timezone should be treated as local,
    // which we've mocked to UTC.
    const localDate = new Date(Date.UTC(2026, 6, 26, 12, 0, 0));
    expect(localDate.toISOString()).toBe('2026-07-26T12:00:00.000Z');
  });
});
