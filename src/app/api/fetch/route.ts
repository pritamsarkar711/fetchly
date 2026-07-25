import { NextRequest, NextResponse } from 'next/server';
import { parseUrl } from '@/lib/parsers';
import { validatePublicUrl } from '@/lib/proxy-utils';
import { takeRateLimit } from '@/lib/rate-limit';

export const maxDuration = 60;

async function validateUrl(input: string | null): Promise<string | null> {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return normalized.length <= 2000 ? validatePublicUrl(normalized, 2000) : null;
}

async function resolve(request: NextRequest, url: string | null) {
  const rate = takeRateLimit(request, 'fetch', 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests. Try again shortly.' }, { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } });
  }

  const validated = await validateUrl(url);
  if (!validated) {
    return NextResponse.json({ success: false, error: 'Enter a valid URL.' }, { status: 400 });
  }

  try {
    const result = await parseUrl(validated);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error: unknown) {
    console.error('Fetch API error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Could not fetch this video.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const url = typeof body === 'object' && body !== null && 'url' in body && typeof body.url === 'string' ? body.url : null;
  return resolve(request, url);
}

export async function GET(request: NextRequest) {
  return resolve(request, request.nextUrl.searchParams.get('url'));
}
