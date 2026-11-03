const DANGEROUS_UNICODE =
  /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/** Removes bidi/zero-width controls that can visually spoof a filename. */
export function removeInvisibleControls(value: string): string {
  return value.replace(DANGEROUS_UNICODE, '')
}

/** Replaces invisible controls with a visible marker for display. */
export function displayName(value: string): string {
  return value.replace(DANGEROUS_UNICODE, '\uFFFD')
}
