import type { TypeA } from './type-only-cycle-a';

export interface TypeB {
  a: TypeA;
  count: number;
}
