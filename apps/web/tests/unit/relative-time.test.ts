// tests/unit/relative-time.test.ts
//
// `now` is a parameter, not Date.now(). A function that reads the clock
// itself can only be tested by mocking the clock, and then the test is
// about the mock.

import { relativeTime } from '@/lib/assistant/relative-time';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('calls anything under a minute "just now"', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now');
    expect(relativeTime(ago(59 * SECOND), NOW)).toBe('just now');
  });

  it('counts whole minutes up to an hour', () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1m ago');
    expect(relativeTime(ago(59 * MINUTE), NOW)).toBe('59m ago');
  });

  it('counts whole hours up to a day', () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe('1h ago');
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe('23h ago');
  });

  it('counts whole days up to a week', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('1d ago');
    expect(relativeTime(ago(6 * DAY), NOW)).toBe('6d ago');
  });

  it('gives a date once it is a week old', () => {
    // Past a week "37d ago" stops being useful and a date starts being
    // useful. Locale-independent so this does not fail on another machine.
    expect(relativeTime(new Date('2026-08-14T09:00:00.000Z'), NOW)).toBe(
      '14 Aug'
    );
  });

  it('includes the year once it is not this year', () => {
    expect(relativeTime(new Date('2025-12-30T09:00:00.000Z'), NOW)).toBe(
      '30 Dec 2025'
    );
  });

  it('never renders a future timestamp as a negative age', () => {
    // Clock skew between the server that wrote the row and the browser
    // reading it is normal. "-1m ago" is not.
    expect(relativeTime(new Date(NOW.getTime() + 5 * MINUTE), NOW)).toBe(
      'just now'
    );
  });

  it('answers an empty string for something that is not a date', () => {
    // The value arrives as JSON from a route. A malformed one must not
    // put "Invalid Date" into the list.
    expect(relativeTime(new Date('nonsense'), NOW)).toBe('');
  });
});
