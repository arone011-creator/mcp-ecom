// lib/assistant/relative-time.ts
//
// How old a chat is, in the fewest characters that still mean something.
//
// `now` is a parameter rather than Date.now() so this is a pure function
// of its inputs. A function that reads the clock can only be tested by
// mocking the clock, and then the test is about the mock.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function relativeTime(when: Date, now: Date = new Date()): string {
  // The value came from JSON. A malformed one must not reach the list as
  // "Invalid Date".
  if (Number.isNaN(when.getTime())) return '';

  // A future timestamp falls out as "just now" without needing a clamp:
  // a negative age is below every threshold, so the first branch takes
  // it. Clock skew between the server that wrote the row and the browser
  // reading it is ordinary, and this is what stops it reading "-1m ago".
  // A Math.max here looked like the guard and was provably dead code --
  // no mutation of it could change an answer.
  const age = now.getTime() - when.getTime();

  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d ago`;

  // Past a week, "37d ago" stops being useful and a date starts being
  // useful. Built by hand rather than through toLocaleDateString so the
  // output does not depend on the machine's locale -- including the
  // machine CI runs on.
  const day = when.getUTCDate();
  const month = MONTHS[when.getUTCMonth()];
  const year = when.getUTCFullYear();

  return year === now.getUTCFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${year}`;
}
