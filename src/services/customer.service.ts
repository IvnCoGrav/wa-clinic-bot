/**
 * @deprecated File ini telah dipecah ke folder modular `src/services/customer/`.
 * Re-export ini dipertahankan untuk kompatibilitas import backward 100%.
 */
export {
  CustomerService,
  customerService,
  customerService as default,
  computeCustomerLtv,
  recalculateCustomerLtv,
  memoryCustomers,
  isTestRuntime,
  CustomerNameSource,
  CustomerGroundTruth,
} from './customer';
