// Fixture: utils-imports-service.ts
import { customerService } from 'src/services/customer.service';

export function badUtilFunction() {
  return customerService;
}
