#!/usr/bin/env node
/**
 * Local development orchestrator.
 *
 *   node scripts/dev.mjs           # API on :4000 + web on :3000 (watch mode)
 *   node scripts/dev.mjs --prod    # built output via `next start` / node dist
 *   node scripts/dev.mjs --api-only
 *   node scripts/dev.mjs --web-only
 *
 * Builds @kdc/shared first (both apps import it), then supervises the children
 * and forwards SIGINT/SIGTERM so Ctrl-C stops everything cleanly. Exits with
 * the code of whichever child died first, so a crash is never silent.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const prod = args.includes('--prod');
const apiOnly = args.includes('--api-only');
const webOnly = args.includes('--web-only');

const API_PORT = Number(process.env.API_PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);

/** @type {{ name: string; child: import('node:child_process').ChildProcess }[]} */
const children = [];
let shuttingDown = false;
let exitCode = 0;

function run(name, command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      API_PORT: String(API_PORT),
      WEB_PORT: String(WEB_PORT),
      FORCE_COLOR: '1',
    },
    ...options,
  });
  const prefix = `[${name}]`;
  const tag = (stream) => (data) => {
    for (const line of String(data).split('\n')) {
      if (line.trim()) process.stdout.write(`${prefix} ${line}\n`);
    }
    void stream;
  };
  child.stdout?.on('data', tag('out'));
  child.stderr?.on('data', tag('err'));
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stdout.write(`${prefix} exited (code=${code ?? 'null'} signal=${signal ?? 'null'})\n`);
    if (code !== 0 && exitCode === 0) exitCode = code ?? 1;
    shutdown(exitCode);
  });
  children.push({ name, child });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { name, child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      process.stdout.write(`[dev] stopping ${name}\n`);
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 400).unref();
}

function sharedNeedsBuild() {
  return !existsSync(resolve(ROOT, 'packages/shared/dist/index.js'));
}

function main() {
  process.stdout.write(`[dev] workspace ${ROOT}\n`);
  if (sharedNeedsBuild()) {
    process.stdout.write('[dev] building @kdc/shared first\n');
    const build = spawn('npm', ['run', 'build', '--workspace', '@kdc/shared'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    build.on('exit', (code) => {
      if (code !== 0) process.exit(code ?? 1);
      start();
    });
  } else {
    start();
  }
}

function start() {
  if (!webOnly) {
    run(
      'api',
      'npm',
      prod
        ? ['run', 'start', '--workspace', '@kdc/api']
        : ['run', 'dev', '--workspace', '@kdc/api'],
    );
  }
  if (!apiOnly) {
    // Give the API a head start so the web proxy has a target on first paint.
    setTimeout(() => {
      if (shuttingDown) return;
      run(
        'web',
        'npm',
        prod
          ? ['run', 'start', '--workspace', '@kdc/web']
          : ['run', 'dev', '--workspace', '@kdc/web'],
      );
    }, 1500);
  }
  process.stdout.write(
    `[dev] API http://localhost:${API_PORT}/api/v1 · docs http://localhost:${API_PORT}/api/v1/docs\n`,
  );
  process.stdout.write(`[dev] web http://localhost:${WEB_PORT}\n`);
}

process.on('SIGINT', () => shutdown(exitCode));
process.on('SIGTERM', () => shutdown(exitCode));

main();
