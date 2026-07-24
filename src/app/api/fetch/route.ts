import { NextRequest, NextResponse } from 'next/server';
import { parseUrl } from '@/lib/parsers';

// Block requests to private/internal IP ranges to prevent SSRF
const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', '192.168.',
];

function isInternalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOSTS.some(blocked =>
      hostname === blocked || hostname.startsWith(blocked)
    );
  } catch {
    return false;
  }
}

function validateUrl(input: string | null): string | null {
  if (!input || typeof input !== 'string') return null;

  let normalized = input.trim();

  // Only allow http and https
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }

  // Validate URL format
  try {
    const parsed = new URL(normalized);
    if (!parsed.hostname.includes('.')) return null;
    if (isInternalUrl(normalized)) return null;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Limit URL length
    if (normalized.length > 2000) return null;
  } catch {
    return null;
  }

  return normalized;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const url: string | null = typeof body?.url === 'string' ? body.url : null;

    const validated = validateUrl(url);
    if (!validated) {
      return NextResponse.json(
        { success: false, error: 'A valid URL is required (http/https only)' },
        { status: 400 }
      );
    }

    const result = await parseUrl(validated);

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const validated = validateUrl(url);

  if (!validated) {
    return NextResponse.json(
      { success: false, error: 'A valid URL is required (http/https only)' },
      { status: 400 }
    );
  }

  try {
    const result = await parseUrl(validated);

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
