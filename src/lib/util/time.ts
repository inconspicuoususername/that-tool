export function addDaysUnixSeconds(days: number): number {
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec + days * 24 * 60 * 60;
}
