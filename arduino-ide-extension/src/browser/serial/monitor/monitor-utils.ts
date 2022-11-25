import dateFormat = require('dateformat');

export interface Line {
  message: string;
  timestamp?: Date;
  length: number;
}

export interface SelectOption<T> {
  readonly label: string;
  readonly value: T;
}

export const MAX_CHARACTERS = 1_000_000;

export function format(timestamp: Date | undefined): string {
  return timestamp ? `${dateFormat(timestamp, 'HH:MM:ss.l')} -> ` : '';
}
