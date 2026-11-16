import type { TypeB } from './type-only-cycle-b';

export interface TypeA {
  b: TypeB;
  id: string;
}
