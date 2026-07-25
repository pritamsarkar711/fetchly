/**
 * JavaScript Unpacker for Dean Edwards' Packed format
 * Handles: eval(function(p,a,c,k,e,d){...}(...))
 * This is commonly used by MixDrop and similar sites to obfuscate video URLs
 * Improved version that handles base62 and multiple quoting styles.
 */

export function detectPacked(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  // Match various packer signatures: eval(function(p,a,c,k,e,d) or eval(function(p,a,c,k,e,r)
  return /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*(?:d|r)\s*\)/.test(code);
}

/**
 * Unescape a JS string literal content (handles \' \" \\ \n etc)
 */
function unescapeJsString(str: string): string {
  return str
    .replace(/\\\\/g, '\\')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

/**
 * Encode a number using the same algorithm as the packer:
 * e(c) = (c<a?'':e(parseInt(c/a))) + ((c=c%a)>35?String.fromCharCode(c+29):c.toString(36))
 */
function encodeBase(num: number, base: number): string {
  const encodeRec = (c: number): string => {
    if (c < base) {
      const mod = c % base;
      return mod > 35 ? String.fromCharCode(mod + 29) : mod.toString(36);
    } else {
      return encodeRec(Math.floor(c / base)) + (c % base > 35 ? String.fromCharCode((c % base) + 29) : (c % base).toString(36));
    }
  };
  return encodeRec(num);
}

/**
 * Try to find and parse packed arguments from a code string.
 * Returns array of { payload, radix, count, symtab } if found.
 */
function findPackedArgs(code: string): Array<{ payload: string; radix: number; count: number; symtab: string[]; rawWords: string }> {
  const results: Array<{ payload: string; radix: number; count: number; symtab: string[]; rawWords: string }> = [];

  // More permissive: looks for 'payload', radix, count, 'symtab'.split('|')
  // Works for both }('payload',.. and })('payload',.. patterns
  const packedRegex = /(['"])((?:\\.|(?!\1).){10,}?)\1\s*,\s*(\d{1,3})\s*,\s*(\d{1,4})\s*,\s*(['"])((?:\\.|(?!\5).){3,}?)\5\s*\.split\s*\(\s*['"]\|['"]\s*\)/g;

  let m: RegExpExecArray | null;
  while ((m = packedRegex.exec(code)) !== null) {
    try {
      const payloadRaw = m[2];
      const radix = parseInt(m[3], 10);
      const count = parseInt(m[4], 10);
      const wordsRaw = m[6];

      // Basic sanity checks
      if (radix < 2 || radix > 62) continue;
      if (count < 1 || count > 5000) continue;
      if (payloadRaw.length < 20) continue;
      if (wordsRaw.length < 3) continue;

      const payload = unescapeJsString(payloadRaw);
      const symtab = wordsRaw.split('|').map(w => unescapeJsString(w));
      if (symtab.length < 5) continue; // too short, likely false positive
      results.push({ payload, radix, count, symtab, rawWords: wordsRaw });
    } catch {
      continue;
    }
  }
  return results;
}

export function unpackPacked(code: string): string | null {
  try {
    if (!detectPacked(code)) return null;

    const argsList = findPackedArgs(code);
    if (argsList.length === 0) {
      // fallback looser match
      const fallback = code.match(/['"]([^'"]{20,})['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]([^'"]{5,})['"]\.split/);
      if (!fallback) return null;
      const payload = fallback[1];
      const radix = parseInt(fallback[2], 10);
      const count = parseInt(fallback[3], 10);
      const symtab = fallback[4].split('|');
      argsList.push({ payload, radix, count, symtab, rawWords: fallback[4] });
    }

    let bestPayload: string | null = null;

    for (const args of argsList) {
      const { payload, radix, count, symtab } = args;
      if (!payload || symtab.length === 0) continue;

      const dict: Map<string, string> = new Map();
      const limit = Math.min(count, symtab.length);
      for (let i = 0; i < limit; i++) {
        const word = symtab[i];
        if (!word) continue;
        const key = encodeBase(i, radix);
        dict.set(key, word);
      }

      const sortedKeys = Array.from(dict.keys()).sort((a, b) => b.length - a.length);

      let result = payload;
      for (const key of sortedKeys) {
        const word = dict.get(key);
        if (!word) continue;
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const useBoundary = /^[a-zA-Z0-9_]+$/.test(key);
        const pattern = useBoundary ? `\\b${escapedKey}\\b` : escapedKey;
        try {
          const re = new RegExp(pattern, 'g');
          result = result.replace(re, word);
        } catch {
          result = result.split(key).join(word);
        }
      }

      if (/(MDCore|wurl|furl|vsrc|\.mp4|m3u8|mxcontent|mxdcontent)/i.test(result)) {
        return result;
      }
      if (!bestPayload || result.length > bestPayload.length) {
        bestPayload = result;
      }
    }

    return bestPayload;
  } catch (e) {
    console.error('Unpack error:', e);
    return null;
  }
}

export function unpackAllLayers(code: string, maxDepth = 3): string {
  let current = code;
  for (let i = 0; i < maxDepth; i++) {
    if (!detectPacked(current)) break;
    const unpacked = unpackPacked(current);
    if (!unpacked || unpacked === current) break;
    current = unpacked;
  }
  return current;
}

export function extractWurlFromPacked(code: string): string | null {
  const unpacked = unpackAllLayers(code);
  const effective = unpacked || code;

  const mdcorePattern = /MDCore\.\w+\s*=\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = mdcorePattern.exec(effective)) !== null) {
    const url = m[1];
    if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('mxcontent') || url.includes('mxdcontent')) {
      return url;
    }
  }

  const fileMatch = effective.match(/["']file["']\s*:\s*["']([^"']+)["']/);
  if (fileMatch) return fileMatch[1];

  const urlMatch = effective.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*)/i);
  if (urlMatch) return urlMatch[1];

  const protoMatch = effective.match(/\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*/i);
  if (protoMatch) return 'https:' + protoMatch[0];

  return null;
}
