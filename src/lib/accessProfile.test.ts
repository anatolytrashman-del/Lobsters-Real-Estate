import { describe, expect, it } from 'vitest';
import {
  getCurrentProfile,
  isPageAllowed,
  isSuperAdminAllowed,
  isTaskVisible,
  setAccessProfilesCache,
  setCurrentUserId,
} from './accessProfile';
import type { AccessProfile } from '../data/accessProfiles';

function profile(overrides: Partial<AccessProfile> = {}): AccessProfile {
  return {
    id: 'p1',
    userId: 'user-1',
    displayName: 'Тест',
    pages: 'all',
    isSuperAdmin: false,
    ...overrides,
  };
}

describe('isPageAllowed', () => {
  it('"all" разрешает любую страницу', () => {
    expect(isPageAllowed(profile({ pages: 'all' }), 'tasks')).toBe(true);
    expect(isPageAllowed(profile({ pages: 'all' }), 'settings')).toBe(true);
  });

  it('список страниц разрешает только перечисленные', () => {
    const p = profile({ pages: ['tasks', 'objects'] });
    expect(isPageAllowed(p, 'tasks')).toBe(true);
    expect(isPageAllowed(p, 'objects')).toBe(true);
    expect(isPageAllowed(p, 'settings')).toBe(false);
  });

  it('пустой список не разрешает ничего', () => {
    expect(isPageAllowed(profile({ pages: [] }), 'tasks')).toBe(false);
  });
});

describe('isSuperAdminAllowed', () => {
  it('следует полю isSuperAdmin независимо от pages', () => {
    expect(isSuperAdminAllowed(profile({ isSuperAdmin: true, pages: [] }))).toBe(true);
    expect(isSuperAdminAllowed(profile({ isSuperAdmin: false, pages: 'all' }))).toBe(false);
  });
});

describe('getCurrentProfile', () => {
  it('находит профиль по userId вошедшей auth-сессии', () => {
    const alice = profile({ id: 'a', userId: 'user-a', displayName: 'Alice' });
    const bob = profile({ id: 'b', userId: 'user-b', displayName: 'Bob' });
    setAccessProfilesCache([alice, bob]);
    setCurrentUserId('user-b');
    expect(getCurrentProfile()).toBe(bob);
  });

  it('фолбэк на профиль с pages:"all", если userId не совпал ни с одним профилем', () => {
    const restricted = profile({ id: 'r', userId: 'user-restricted', pages: ['tasks'] });
    const full = profile({ id: 'f', userId: 'user-full', pages: 'all' });
    setAccessProfilesCache([restricted, full]);
    setCurrentUserId('unknown-user-id');
    expect(getCurrentProfile()).toBe(full);
  });

  it('фолбэк на первый профиль в списке, если нет ни совпадения, ни pages:"all"', () => {
    const first = profile({ id: 'x', userId: 'user-x', pages: ['tasks'] });
    const second = profile({ id: 'y', userId: 'user-y', pages: ['objects'] });
    setAccessProfilesCache([first, second]);
    setCurrentUserId('unknown-user-id');
    expect(getCurrentProfile()).toBe(first);
  });
});

describe('isTaskVisible', () => {
  it('супер-админ видит любую задачу, включая чужую', () => {
    const p = profile({ isSuperAdmin: true, displayName: 'Трэшмен' });
    expect(isTaskVisible(p, ['Светлана'])).toBe(true);
    expect(isTaskVisible(p, [])).toBe(true);
  });

  it('обычный профиль видит только задачи, где он в ответственных', () => {
    const p = profile({ displayName: 'Светлана' });
    expect(isTaskVisible(p, ['Светлана'])).toBe(true);
    expect(isTaskVisible(p, ['Альмира', 'Светлана'])).toBe(true);
    expect(isTaskVisible(p, ['Альмира'])).toBe(false);
    expect(isTaskVisible(p, [])).toBe(false);
  });

  it('pages:"all" сам по себе не открывает чужие задачи', () => {
    expect(isTaskVisible(profile({ pages: 'all', displayName: 'Светлана' }), ['Альмира'])).toBe(false);
  });
});
