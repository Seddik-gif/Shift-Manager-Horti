/**
 * The Windows desktop shell identifies itself with "HortiDesktop/<version>" in its user agent.
 * It is for administrators; employees use the phone app. This is a courtesy screen, not a security boundary:
 * what a person may do is decided by the database, not by which program they use.
 */
export function isDesktopClient(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && /\bHortiDesktop\/\d/.test(userAgent);
}
