'use client';

import { useEffect } from 'react';

import { useTheme } from 'next-themes';

const THEME_COOKIE_NAME = 'theme';
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_YEAR = 365;
const THEME_COOKIE_MAX_AGE_SECONDS =
  SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY * DAYS_PER_YEAR;

export const ThemeCookieSync = () => {
  const { theme } = useTheme();

  useEffect(() => {
    if (theme === undefined) {
      return;
    }

    document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  }, [theme]);

  return null;
};
