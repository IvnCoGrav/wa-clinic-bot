// Fixture: cycle-a
import { helperB } from './cycle-b';

export function helperA(): string {
  return 'A' + helperB();
}
