/**
 * The tutor's "off" reason as read on this page: main writes it for every
 * page ("… in Settings …"), but here the controls are right below.
 */
export function reasonHere(reason: string): string {
  return reason
    .replace(/ in Settings → Tutor\b/g, ' below')
    .replace(/^The tutor is turned off in Settings\.$/, 'The backend below is set to Off.')
    .replace(/ in Settings\b/g, ' below');
}
