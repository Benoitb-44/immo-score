/**
 * LIMITATION: This file tests an inlined copy of the auth logic, not the
 * actual route.ts module. ESM/tsx cycle prevents direct import under
 * node --test (test runner cannot resolve the route.ts module at runtime).
 *
 * If you change the auth logic in route.ts, update handleRevalidate here too.
 *
 * Refactor path: when the test runner is upgraded to support ESM dynamic
 * import for App Router routes (or migrated to Vitest), this file should
 * import { GET } from '../route' directly and remove the inlined copy.
 *
 * Tracked in: SEC-AUDIT-ENV-VAR-AUTH-PATTERNS (broader test infra refactor)
 */

/**
 * Auth guard tests for /api/revalidate — fail-closed behavior.
 * Run with: npm run test:revalidate
 *
 * Plain assertion script (no test framework required).
 */
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline auth logic under test (mirrors route.ts exactly)
// ---------------------------------------------------------------------------

function handleRevalidate(
  envSecret: string | undefined,
  querySecret: string | null
): { status: number; body: Record<string, unknown> } {
  if (!envSecret) {
    return { status: 500, body: { message: 'Server misconfigured' } };
  }
  if (!querySecret || querySecret !== envSecret) {
    return { status: 401, body: { message: 'Invalid token' } };
  }
  return { status: 200, body: { revalidated: true } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

console.log('GET /api/revalidate — auth guard\n');

test('returns 500 when REVALIDATE_SECRET env var is not set', () => {
  const { status, body } = handleRevalidate(undefined, 'any-value');
  assert.equal(status, 500);
  assert.equal(body.message, 'Server misconfigured');
});

test('returns 401 when secret query param is missing', () => {
  const { status, body } = handleRevalidate('correct-secret', null);
  assert.equal(status, 401);
  assert.equal(body.message, 'Invalid token');
});

test('returns 401 when secret query param is wrong', () => {
  const { status, body } = handleRevalidate('correct-secret', 'wrong-secret');
  assert.equal(status, 401);
  assert.equal(body.message, 'Invalid token');
});

test('returns 200 when secret matches env var', () => {
  const { status, body } = handleRevalidate('correct-secret', 'correct-secret');
  assert.equal(status, 200);
  assert.equal(body.revalidated, true);
});

test('returns 401 when env var is set but query param is empty string', () => {
  const { status, body } = handleRevalidate('correct-secret', '');
  assert.equal(status, 401);
  assert.equal(body.message, 'Invalid token');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
