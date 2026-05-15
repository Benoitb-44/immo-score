import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.REVALIDATE_SECRET;
  const providedSecret = request.nextUrl.searchParams.get('secret');

  // Fail-closed: refuse all requests when the env var is not configured server-side.
  // Prevents the undefined === undefined bypass that existed before this fix.
  if (!expectedSecret) {
    console.error('[revalidate] REVALIDATE_SECRET env var is not set — refusing all requests');
    return NextResponse.json(
      { message: 'Server misconfigured' },
      { status: 500 }
    );
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { message: 'Invalid token' },
      { status: 401 }
    );
  }

  const path = request.nextUrl.searchParams.get('path') ?? '/';
  revalidatePath(path);

  return NextResponse.json({ revalidated: true, path });
}
