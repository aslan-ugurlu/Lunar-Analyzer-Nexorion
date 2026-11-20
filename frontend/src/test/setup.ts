import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetLangForTests } from '../i18n';

afterEach(() => {
  cleanup();
  // Every test starts in the default language (English) with no remembered choice.
  resetLangForTests();
  try {
    localStorage.clear();
  } catch { /* storage unavailable */ }
  document.documentElement.lang = 'en';
});
