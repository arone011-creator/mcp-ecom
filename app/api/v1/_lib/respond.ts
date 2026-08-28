// app/api/v1/_lib/respond.ts
//
// One JSON envelope for every v1 route: `{ data }` on success, `{ error }`
// on failure. Consumers (the MCP server, then the agents) can branch on the
// shape without knowing which route they called.
import { NextResponse } from 'next/server';

/**
 * Prisma hands back `Decimal` for every money column and `Date` for every
 * timestamp. JSON.stringify renders a Decimal as its internal representation
 * -- `{"s":1,"e":1,"d":[...]}` -- which is useless to a client. Normalising
 * once here keeps every route from having to remember.
 *
 * Money becomes a string rather than a number on purpose: `10.50` survives
 * as "10.50", where a float would lose the scale and, for larger totals,
 * the exactness.
 */
function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Duck-typed rather than importing Prisma's Decimal, so this module
    // stays free of a runtime dependency on the client.
    if (
      typeof obj.toFixed === 'function' &&
      typeof obj.toString === 'function'
    ) {
      return obj.toString();
    }

    return Object.fromEntries(
      Object.entries(obj).map(([key, nested]) => [key, normalise(nested)])
    );
  }

  return value;
}

// Every v1 response is scoped to one caller, so none of them may sit in a
// shared cache. M1 leaked one user's orders to another through a cached
// read; this is the belt to that braces.
const NO_STORE = { 'cache-control': 'no-store' } as const;

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(
    { data: normalise(data) },
    { status, headers: NO_STORE }
  );
}

export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}
