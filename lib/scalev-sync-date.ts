import { getDatePartsInTimeZone } from './utils';

export function getStartOfTodayWibIso(now: Date = new Date()): string {
  const { iso } = getDatePartsInTimeZone('Asia/Jakarta', now);
  return `${iso}T00:00:00+07:00`;
}
