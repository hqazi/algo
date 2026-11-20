/** T32: what the reader shows for a source link: the site's domain, or the mail address. */
export function sourceLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return decodeURIComponent(u.pathname) || url;
    return u.hostname.replace(/^www\./i, '') || url;
  } catch {
    return url;
  }
}
