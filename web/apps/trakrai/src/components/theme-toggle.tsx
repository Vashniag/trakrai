'use client';

import { useEffect, useState } from 'react';

import { LaptopMinimal, MoonStar, SunMedium } from 'lucide-react';
import { useTheme } from 'next-themes';

const themeOptions = [
  { value: 'light', label: 'Light', icon: SunMedium },
  { value: 'dark', label: 'Dark', icon: MoonStar },
  { value: 'system', label: 'System', icon: LaptopMinimal },
] as const;

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/85 p-1 shadow-lg shadow-black/10 backdrop-blur-sm">
      {themeOptions.map((option) => {
        const Icon = option.icon;
        const active = mounted && theme === option.value;

        return (
          <button
            key={option.value}
            className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium transition-colors ${
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            }`}
            type="button"
            onClick={() => {
              setTheme(option.value);
            }}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};
