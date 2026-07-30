import { AsyncLocalStorage } from 'async_hooks';

export const llmOutageStorage = new AsyncLocalStorage<{ simulateOutage: boolean }>();
