/**
 * JavaScript Unpacker for Dean Edwards' Packed format
 * Handles: eval(function(p,a,c,k,e,d){...}(...))
 * This is commonly used by MixDrop and similar sites to obfuscate video URLs
 */

/**
 * Detect if a string contains packed JavaScript code
 */
export function detectPacked(code: string): boolean {
  return /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)/.test(code);
}

/**
 * Extract the payload and word list from a packed JS string.
 * The packed format is:
 * eval(function(p,a,c,k,e,d){...})('payload',a,c,'word1|word2|...'.split('|'),...)
 */
export function unpackPacked(code: string): string | null {
  try {
    if (!detectPacked(code)) {
      return null;
    }

    // Try multiple patterns to extract the packed data
    let match: RegExpMatchArray | null = null;
    
    // Pattern 1: Standard format with .split('|')
    match = code.match(/}\s*\(\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'\s*\.split\s*\(\s*['"]\|['"]\s*\)/);
    
    // Pattern 2: Alternative format with different quoting
    if (!match) {
      match = code.match(/}\(([^,]+),([^,]+),([^,]+),'([^']*)'\.split\(['"]\|['"]\)/);
    }

    if (match) {
      let payload: string;
      let keywordCount: number;
      let words: string[];

      if (match[1].startsWith("'") || match[1].startsWith('"')) {
        // Pattern 1 format
        payload = match[1].replace(/^['"]|['"]$/g, '');
        keywordCount = parseInt(match[3]);
        const wordListRaw = match[4];
        words = wordListRaw.split('|');
      } else {
        // Pattern 2 format  
        payload = match[1].replace(/^['"]|['"]$/g, '').replace(/^['"]|['"]$/g, '');
        keywordCount = parseInt(match[3].trim());
        const wordListRaw = match[4];
        words = wordListRaw.split('|');
      }

      if (words.length === 0) return null;

      // Determine if the indices are base-36 encoded
      // If e=function(c){return c.toString(36)}, indices are base-36
      // If e=function(c){return c}, indices are plain numbers
      const usesBase36 = code.includes('c.toString(36)') || code.includes('c.toString(a)');

      // Unpack: replace placeholders with words
      let result = payload;
      for (let i = 0; i < words.length && i < keywordCount; i++) {
        const key = usesBase36 ? i.toString(36) : i.toString();
        // Use word boundary to match whole keys only
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        result = result.replace(regex, words[i]);
      }

      return result;
    }

    return null;
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
  if (wurlMatch) {
    return wurlMatch[1];
  }

  // Look for file: "url" pattern
  const fileMatch = unpacked.match(/["']file["']\s*:\s*["']([^"']+)["']/);
  if (fileMatch) {
    return fileMatch[1];
  }

  // Look for any URL
  const urlMatch = unpacked.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  return null;
}
