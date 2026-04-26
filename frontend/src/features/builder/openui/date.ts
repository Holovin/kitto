const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type StrictIsoDateIssue = 'calendar' | 'format';

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number) {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

export function getStrictIsoDateIssue(value: unknown): StrictIsoDateIssue | null {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return 'format';
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return 'calendar';
  }

  if (month < 1 || month > 12) {
    return 'calendar';
  }

  return day >= 1 && day <= getDaysInMonth(year, month) ? null : 'calendar';
}

export function isStrictIsoDateString(value: unknown): value is string {
  return getStrictIsoDateIssue(value) === null;
}
