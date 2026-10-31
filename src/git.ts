import { execFile } from 'child_process';
import * as path from 'path';

export interface GitContext {
  branch?: string;
  /** Subjects of the latest commits touching the file, newest first. */
  recentCommits: string[];
}

function git(cwd: string, args: string[], { trim = true } = {}): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      { cwd, timeout: 10000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => resolve(error ? undefined : trim ? stdout.trim() : stdout),
    );
  });
}

function lines(output: string | undefined): string[] {
  return output ? output.split('\n').filter(Boolean) : [];
}

export function repoRoot(cwd: string): Promise<string | undefined> {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

export interface Base {
  /** Commit hash. */
  ref: string;
  label: string;
}

/** `branch` means where the current branch left main/master; anything else is a git ref such as `HEAD` or `v1.2`. */
export async function resolveBase(root: string, spec: string): Promise<Base | undefined> {
  if (spec === 'branch') {
    for (const trunk of ['main', 'master', 'origin/main', 'origin/master']) {
      const ref = await git(root, ['merge-base', 'HEAD', trunk]);
      if (ref) return { ref, label: `where this branch left ${trunk} (${ref.slice(0, 7)})` };
    }
    return undefined;
  }
  const ref = await git(root, ['rev-parse', '--verify', '--quiet', `${spec}^{commit}`]);
  if (!ref) return undefined;
  return { ref, label: spec === 'HEAD' ? `the last commit (${ref.slice(0, 7)})` : `${spec} (${ref.slice(0, 7)})` };
}

/** Paths relative to the repo root that differ between `ref` and the working tree, including untracked files. */
export async function changedFiles(root: string, ref: string): Promise<string[]> {
  const [diff, untracked] = await Promise.all([
    git(root, ['diff', '--name-only', '--no-renames', ref]),
    git(root, ['ls-files', '--others', '--exclude-standard']),
  ]);
  return [...new Set([...lines(diff), ...lines(untracked)])];
}

/** Contents of a file at a commit, or undefined if it did not exist there. */
export function fileAt(root: string, ref: string, relativePath: string): Promise<string | undefined> {
  return git(root, ['show', `${ref}:${relativePath}`], { trim: false });
}

export async function gitContext(filePath: string): Promise<GitContext> {
  const cwd = path.dirname(filePath);
  const [branch, log] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['log', '-n', '5', '--format=%s', '--', path.basename(filePath)]),
  ]);
  return { branch: branch && branch !== 'HEAD' ? branch : undefined, recentCommits: lines(log) };
}
