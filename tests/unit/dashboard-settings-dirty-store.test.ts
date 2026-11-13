import { beforeEach, describe, expect, it } from 'vitest';
import {
  isAnySettingsDirty,
  reportSettingsDirty,
  resetSettingsDirtyForTest,
  subscribeSettingsDirty,
} from '../../packages/admin-dashboard/src/components/settings/settingsDirtyStore';

describe('settingsDirtyStore', () => {
  beforeEach(() => {
    resetSettingsDirtyForTest();
  });

  it('menandai halaman kotor saat satu panel melaporkan draft', () => {
    expect(isAnySettingsDirty()).toBe(false);
    reportSettingsDirty('panel-a', true);
    expect(isAnySettingsDirty()).toBe(true);
  });

  it('tetap kotor selama masih ada panel lain yang belum disimpan', () => {
    reportSettingsDirty('panel-a', true);
    reportSettingsDirty('panel-b', true);
    reportSettingsDirty('panel-a', false);
    expect(isAnySettingsDirty()).toBe(true);
    reportSettingsDirty('panel-b', false);
    expect(isAnySettingsDirty()).toBe(false);
  });

  it('laporan berulang dengan nilai sama tidak mengumumkan perubahan lagi', () => {
    let emits = 0;
    const unsubscribe = subscribeSettingsDirty(() => {
      emits += 1;
    });

    reportSettingsDirty('panel-a', true);
    reportSettingsDirty('panel-a', true);
    reportSettingsDirty('panel-a', true);
    expect(emits).toBe(1);

    reportSettingsDirty('panel-a', false);
    reportSettingsDirty('panel-a', false);
    expect(emits).toBe(2);

    unsubscribe();
  });

  it('berhenti mengumumkan setelah panel di-unmount dan langganan dilepas', () => {
    let emits = 0;
    const unsubscribe = subscribeSettingsDirty(() => {
      emits += 1;
    });
    unsubscribe();
    reportSettingsDirty('panel-a', true);
    expect(emits).toBe(0);
    expect(isAnySettingsDirty()).toBe(true);
  });

  it('panel yang dilepas tanpa laporan bersih tidak menyisakan status kotor palsu', () => {
    reportSettingsDirty('panel-a', true);
    // Simulasi cleanup useEffect saat panel di-unmount.
    reportSettingsDirty('panel-a', false);
    expect(isAnySettingsDirty()).toBe(false);
  });
});
