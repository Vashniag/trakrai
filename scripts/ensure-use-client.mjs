#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const USE_CLIENT_SINGLE = "'use client';";
const USE_CLIENT_DOUBLE = '"use client";';

const files = process.argv.slice(2);
if (files.length === 0) {
  process.exit(0);
}

for (const file of files) {
  const absolutePath = resolve(file);
  const content = readFileSync(absolutePath, 'utf8');
  if (content.startsWith(USE_CLIENT_SINGLE) || content.startsWith(USE_CLIENT_DOUBLE)) {
    continue;
  }
  writeFileSync(absolutePath, `${USE_CLIENT_SINGLE}\n\n${content}`);
}
