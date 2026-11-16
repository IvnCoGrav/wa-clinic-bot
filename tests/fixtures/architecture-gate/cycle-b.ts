// Fixture: cycle-b
import { helperA } from './cycle-a';

export function helperB(): string {
  return 'B' + helperA();
}
