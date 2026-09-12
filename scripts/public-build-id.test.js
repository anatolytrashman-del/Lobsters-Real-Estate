import { describe, expect, it } from 'vitest';
import { collectPublicSourceFiles, computePublicBuildId } from './public-build-id.mjs';

// Отпечаток решает, нужен ли полный пререндер (десять минут сборки против
// одной), поэтому граница «публичное против админки» проверяется на реальном
// дереве проекта, а не на фикстуре.
describe('отпечаток публичного кода', () => {
  const files = collectPublicSourceFiles();

  it('включает публичные страницы и SPA-шелл', () => {
    expect(files).toContain('index.html');
    expect(files).toContain('src/main.tsx');
    expect(files).toContain('src/App.tsx');
    // дизайн OG-обложек — тоже публичный вывод (быстрый режим копирует PNG с прода)
    expect(files).toContain('scripts/generate-og-cards.mjs');
    expect(files).toContain('public/fonts/Montserrat-SemiBold.woff2');
    for (const page of [
      'src/pages/MinskHub.tsx',
      'src/pages/ObjectLandingPage.tsx',
      'src/pages/BusinessCentersMinskPage.tsx',
      'src/pages/BusinessCenterDetailPage.tsx',
      'src/pages/DistrictGuidePage.tsx',
    ]) {
      expect(files).toContain(page);
    }
  });

  it('не включает админ-страницы (они за lazy() в App.tsx)', () => {
    for (const page of [
      'src/pages/Suppliers.tsx',
      'src/pages/Leads.tsx',
      'src/pages/Objects.tsx',
      'src/pages/Estimates.tsx',
      'src/pages/Settings.tsx',
      'src/components/layout/AppLayout.tsx',
    ]) {
      expect(files).not.toContain(page);
    }
  });

  it('стабилен между вызовами и выглядит как короткий hex', () => {
    const { id } = computePublicBuildId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(computePublicBuildId().id).toBe(id);
  });
});
