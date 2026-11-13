/**
 * DOM-02: barrel buku alamat pelanggan. `customer-address.ts` re-export modul
 * ini agar seluruh pemanggil lama tetap kompatibel.
 */
export * from './types';
export * from './matching';
export * from './list';
export * from './tombstones';
