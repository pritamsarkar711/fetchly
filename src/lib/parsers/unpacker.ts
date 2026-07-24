/**
 * JavaScript Unpacker for Dean Edwards' Packed format
 * Handles: eval(function(p,a,c,k,e,d){...}(...))
 * This is commonly used by MixDrop and similar sites to obfuscate video URLs
 */

/**
 * Detect if a string contains packed JavaScript code
 */
export function detectPacked(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  return /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)/.test(code);
}

/**
 * Extract the payload and word list from a packed JS string.
 * The packed format is:
 * eval(function(p,a,c,k,e,d){...})('payload',a,c,'word1|word2|...'.split('|'),...)
 *
 * Returns the unpacked JavaScript string.
 */
export function unpackPacked(code: string): string | null {
  try {
    if (!detectPacked(code)) return null;

    // Extract the closing function call: })('payload',a,c,'words'.split('|'),...)
    // Pattern: closing }) then ( then 'PAYLOAD' , NUM , NUM , 'WORD_LIST' .split('|') , ...
    const match = code.match(/}\)\s*\(\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'\s*\.split\s*\(\s*['"]\|['"]\s*\)/);

    if (!match) return code; // Not unpackable, return as-is

    const payload = match[1];
    const _argCount = parseInt(match[2], 10); // a
    const keywordCount = parseInt(match[3], 10); // c
    const wordListRaw = match[4];
    const words = wordListRaw.split('|');

    if (words.length === 0) return payload;

    // Determine if the indices are base-36 encoded
    // If the unpack function uses c.toString(36), indices are base-36
    // If it just returns c, indices are plain numbers
    const usesBase36 = code.includes('toString(36)') || code.includes('toString(a)');

    // Unpack: replace placeholders with words
    let result = payload;
    const maxIdx = Math.min(words.length, keywordCount);

    for (let i = 0; i < maxIdx; i++) {
      const key = usesBase36 ? i.toString(36) : i.toString();
      // Use word boundary to match whole keys only
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      result = result.replace(regex, words[i]);
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Try to unpack and then extract wurl from the result
 */
export function extractWurlFromPacked(code: string): string | null {
  const unpacked = unpackPacked(code);
  if (!unpacked) return null;

  // Look for wurl = "url" pattern
  const wurlMatch = unpacked.match(/wurl\s*=\s*["']([^"']+)["']/);
  if (wurlMatch) return wurlMatch[1];

  // Look for file: "url" pattern
  const fileMatch = unpacked.match(/["']file["']\s*:\s*["']([^"']+)["']/);
  if (fileMatch) return fileMatch[1];

  // Look for any video URL
  const urlMatch = unpacked.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*)/);
  if (urlMatch) return urlMatch[1];

  return null;
}
