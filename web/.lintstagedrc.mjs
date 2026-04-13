import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOTS = ['apps', 'packages'];

const toPosixPath = (value) => value.split(path.sep).join('/');

const toRepoRelative = (file) => {
  const relative = path.isAbsolute(file) ? path.relative(process.cwd(), file) : file;
  return toPosixPath(relative);
};

const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;

const uniq = (files) => [...new Set(files)];

const makeCommand = (base, files) => {
  if (files.length === 0) {
    return null;
  }

  return `${base} ${files.map(quote).join(' ')}`;
};

const stripWorkspacePrefix = (file, workspacePath) => {
  const prefix = `${workspacePath}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : null;
};

const readLintWorkspaces = () => {
  const lintWorkspaces = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const workspaceRootPath = path.join(process.cwd(), workspaceRoot);
    if (!fs.existsSync(workspaceRootPath)) {
      continue;
    }

    for (const entry of fs.readdirSync(workspaceRootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspacePath = toPosixPath(path.join(workspaceRoot, entry.name));
      const packageJsonPath = path.join(process.cwd(), workspacePath, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (typeof packageJson.name !== 'string' || typeof packageJson.scripts?.lint !== 'string') {
        continue;
      }

      lintWorkspaces.push({
        name: packageJson.name,
        path: workspacePath,
      });
    }
  }

  return lintWorkspaces.sort((left, right) => right.path.length - left.path.length);
};

const lintWorkspaces = readLintWorkspaces();

const groupFilesByWorkspace = (files) => {
  const groupedFiles = new Map();

  for (const file of uniq(files.map(toRepoRelative))) {
    const workspace = lintWorkspaces.find(({ path: workspacePath }) =>
      file.startsWith(`${workspacePath}/`),
    );
    if (!workspace) {
      continue;
    }

    const workspaceFile = stripWorkspacePrefix(file, workspace.path);
    if (!workspaceFile) {
      continue;
    }

    const existingGroup = groupedFiles.get(workspace.name);
    if (existingGroup) {
      existingGroup.push(workspaceFile);
      continue;
    }

    groupedFiles.set(workspace.name, [workspaceFile]);
  }

  return [...groupedFiles.entries()].map(([workspaceName, workspaceFiles]) => ({
    workspaceName,
    workspaceFiles: uniq(workspaceFiles),
  }));
};

export default {
  '**/*.{ts,tsx,js,jsx,mdx,mjs}': (files) => {
    const command = makeCommand('prettier --write', uniq(files.map(toRepoRelative)));
    return command ? [command] : [];
  },
  '**/*.{ts,tsx,js,jsx,mjs}': (files) => {
    return groupFilesByWorkspace(files)
      .map(({ workspaceName, workspaceFiles }) =>
        makeCommand(
          `pnpm --filter ${quote(workspaceName)} exec eslint --max-warnings=0 --no-warn-ignored --fix`,
          workspaceFiles,
        ),
      )
      .filter(Boolean);
  },
};
