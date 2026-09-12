import { describe, expect, it } from 'vitest';
import { mergeScope, normalizeScope } from './_rebuildScope.js';

describe('scope пересборки прода', () => {
  it('нормализует известные значения, всё остальное — «всё»', () => {
    expect(normalizeScope('objects')).toBe('objects');
    expect(normalizeScope('business_centers')).toBe('business_centers');
    expect(normalizeScope(undefined)).toBe('all');
    expect(normalizeScope(null)).toBe('all');
    expect(normalizeScope('leads')).toBe('all');
    expect(normalizeScope(42)).toBe('all');
  });

  it('объединяет срабатывания в одном окне debounce в сторону большего рендера', () => {
    expect(mergeScope('objects', 'objects')).toBe('objects');
    expect(mergeScope('objects', 'business_centers')).toBe('all');
    expect(mergeScope(null, 'objects')).toBe('all'); // строку записал старый код без scope
    expect(mergeScope('all', 'objects')).toBe('all');
    expect(mergeScope('business_centers', 'business_centers')).toBe('business_centers');
  });
});
