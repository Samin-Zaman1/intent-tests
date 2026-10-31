import { execFile } from 'child_process';
import * as path from 'path';

export interface GitContext {
  branch?: string;
  /** Subjects of the latest commits touching the file, newest first. */
  recentCommits: string[];
}

function git(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 3000 }, (error, stdout) => resolve(error ? undefined : stdout.trim()));
  });
}

export async function gitContext(filePath: string): Promise<GitContext> {
  const cwd = path.dirname(filePath);
  const [branch, log] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['log', '-n', '5', '--format=%s', '--', path.basename(filePath)]),
  ]);
  return {
    branch: branch && branch !== 'HEAD' ? branch : undefined,
    recentCommits: log ? log.split('\n').filter(Boolean) : [],
  };
}
