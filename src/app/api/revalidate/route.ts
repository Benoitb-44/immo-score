import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/revalidate?path=/communes/bordeaux&secret=XXX
 * On-demand ISR invalidation. Protégée par REVALIDATE_SECRET.
 */
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.REVALIDATE_SECRET;
  const { searchParams } = request.nextUrl;
  const providedSecret = searchParams.get('secret');

  // Fail-closed: refuse all requests when the env var is not configured server-side.
  // Prevents the undefined === undefined bypass.
  if (!expectedSecret) {
    console.error('[revalidate] REVALIDATE_SECRET env var is not set — refusing all requests');
    return NextResponse.json(
      { message: 'Server misconfigured' },
      { status: 500 }
    );
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ message: 'Invalid token' }, { status: 401 });
  }

  const path = searchParams.get('path');
  if (!path) {
    return NextResponse.json({ message: 'Missing path' }, { status: 400 });
  }

  revalidatePath(path);
  return NextResponse.json({ revalidated: true, path });
}
