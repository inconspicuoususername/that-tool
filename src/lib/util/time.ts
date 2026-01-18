export function addHoursUnixSeconds(hours: number): number {
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec + hours * 60 * 60;
}
