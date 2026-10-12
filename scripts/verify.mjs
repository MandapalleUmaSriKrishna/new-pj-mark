#!/usr/bin/env node
/**
 * One-command verification of the whole monorepo.
 *
 *   node scripts/verify.mjs              # everything that needs no services
 *   node scripts/verify.mjs --smoke      # + boot the API and run the E2E suite
 *   node scripts/verify.mjs --build      # + production builds (api and web)
 *   node scripts/verify.mjs --quick      # skip formatting and dependency audit
 *   node scripts/verify.mjs --all        # --smoke --build
 *
 * Every step runs against the working tree, in the order a reviewer would want
 * to see failures: cheap and broad first (types, lint), then unit tests, then
 * the parts that need a process to be started.
 *
 * The optional --smoke step deliberately uses the IN-PROCESS adapters
 * (memory store, memory queue, log mail, local storage) and `KDC_SKIP_DOTENV`
 * so it is reproducible and cannot pick up a developer's local .env. It proves
 * the HTTP surface end to end; it does NOT prove MongoDB or Redis work - those
 * need docker compose (see docs/DEPLOYMENT.md).
 *
 * Exit code is 0 only when every selected step passed.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

const quick = has('--quick');
const withSmoke = has('--smoke') || has('--all');
const withBuild = has('--build') || has('--all');

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/** @type {{ name: string; ok: boolean; ms: number; detail: string }[]} */
const results = [];

/**
 * Runs a command, streaming its output only when it fails (or when VERBOSE=1),
 * so a green run stays readable and a red one shows exactly what broke.
 */
function run(name, command, commandArgs, options = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1', ...options.env },
    });
    let output = '';
    const collect = (chunk) => {
      output += String(chunk);
      if (process.env.VERBOSE === '1') process.stdout.write(String(chunk));
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      results.push({ name, ok: false, ms: Date.now() - started, detail: err.message });
      done(false);
    });
    child.on('close', (code) => {
      const ok = code === 0;
      const detail = ok ? '' : tail(output);
      results.push({ name, ok, ms: Date.now() - started, detail });
      if (ok) {
        process.stdout.write(
          `  ${green('PASS')} ${name} ${dim(`(${((Date.now() - started) / 1000).toFixed(1)}s)`)}\n`,
        );
      } else {
        process.stdout.write(`  ${red('FAIL')} ${name} ${dim(`(exit ${code})`)}\n`);
        if (output.trim() && process.env.VERBOSE !== '1') {
          process.stdout.write(dim(indent(tail(output, 40))) + '\n');
        }
      }
      done(ok);
    });
    if (options.timeoutMs) {
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
          output += `\n[killed after ${options.timeoutMs}ms]`;
        }
      }, options.timeoutMs).unref();
    }
  });
}

function tail(text, lines = 25) {
  const all = String(text)
    .split('\n')
    .filter((line) => line.trim());
  return all.slice(-lines).join('\n');
}

function indent(text) {
  return String(text)
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
}

/** Asks the OS for an unused TCP port rather than guessing a number. */
function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not started';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/health/live`);
      if (res.ok) return true;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`API did not become healthy within ${timeoutMs}ms (${lastError})`);
}

/** Boots the API with in-process adapters and runs scripts/smoke.mjs against it. */
async function runSmoke() {
  // The check count is reported by the step itself, so this name never drifts.
  const name = 'E2E smoke (live HTTP surface)';
  const started = Date.now();
  const port = await freePort();
  const dataDir = mkdtempSync(resolve(tmpdir(), 'kdc-verify-'));
  const api = spawn('node', ['-r', 'ts-node/register', 'src/main.ts'], {
    cwd: resolve(ROOT, 'apps/api'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Never inherit a developer's .env: verification must be reproducible.
      KDC_SKIP_DOTENV: 'true',
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      HOST: '127.0.0.1',
      PORT: String(port),
      API_PREFIX: 'api/v1',
      DATA_DRIVER: 'memory',
      QUEUE_DRIVER: 'memory',
      CACHE_DRIVER: 'memory',
      EVENT_BUS_DRIVER: 'memory',
      MAIL_DRIVER: 'log',
      MAIL_LOG_DIR: resolve(dataDir, 'mail'),
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: resolve(dataDir, 'storage'),
      SEED_DEMO_DATA: 'false',
      MEMORY_STORE_SEED: 'false',
      RATE_LIMIT_DISABLED: 'false',
      APP_URL: `http://127.0.0.1:${port}`,
      API_URL: `http://127.0.0.1:${port}`,
      ENCRYPTION_MASTER_KEY: 'verification-only-master-key-32bytes',
      JWT_ACCESS_SECRET: 'verification-only-access-secret-32b',
      JWT_REFRESH_SECRET: 'verification-only-refresh-secret-32',
      SESSION_COOKIE_SECRET: 'verification-only-cookie-secret-32b',
      WEBHOOK_SIGNING_FALLBACK_SECRET: 'verification-only-webhook-secret-32',
    },
  });

  let apiLog = '';
  api.stdout.on('data', (d) => {
    apiLog += String(d);
  });
  api.stderr.on('data', (d) => {
    apiLog += String(d);
  });

  const stop = () => {
    if (api.exitCode === null) api.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(`http://127.0.0.1:${port}`);
    const ok = await new Promise((done) => {
      const smoke = spawn(
        'node',
        ['scripts/smoke.mjs', '--api', `http://127.0.0.1:${port}`, '--prefix', 'api/v1'],
        {
          cwd: ROOT,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let out = '';
      smoke.stdout.on('data', (d) => {
        out += String(d);
      });
      smoke.stderr.on('data', (d) => {
        out += String(d);
      });
      smoke.on('close', (code) => {
        // Reading the summary means stripping ANSI colour codes, i.e. matching
        // the ESC control character on purpose - the one legitimate case for
        // what no-control-regex otherwise (correctly) forbids.
        // eslint-disable-next-line no-control-regex
        const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
        const summary = /(\d+) passed\s+(\d+) failed/.exec(plain);
        if (code !== 0) {
          process.stdout.write(`  ${red('FAIL')} ${name}\n`);
          process.stdout.write(dim(indent(tail(out, 40))) + '\n');
        } else {
          process.stdout.write(
            `  ${green('PASS')} ${name} ${dim(`(${summary ? `${summary[1]} checks` : 'ok'}, ${((Date.now() - started) / 1000).toFixed(1)}s)`)}\n`,
          );
        }
        results.push({
          name,
          ok: code === 0,
          ms: Date.now() - started,
          detail: code === 0 ? '' : tail(out),
        });
        done(code === 0);
      });
    });
    if (!ok && apiLog.trim()) {
      process.stdout.write(dim(indent(`--- api log tail ---\n${tail(apiLog, 20)}`)) + '\n');
    }
    return ok;
  } catch (err) {
    process.stdout.write(`  ${red('FAIL')} ${name} :: ${err.message}\n`);
    if (apiLog.trim()) process.stdout.write(dim(indent(tail(apiLog, 30))) + '\n');
    results.push({ name, ok: false, ms: Date.now() - started, detail: err.message });
    return false;
  } finally {
    stop();
  }
}

async function main() {
  process.stdout.write(
    `${bold('\nKrishna Digital Certificate - verification')}\n${dim(`workspace ${ROOT}\n\n`)}`,
  );

  // The engines field is a real constraint: the API uses Node 22 APIs.
  const major = Number(process.versions.node.split('.')[0]);
  results.push({
    name: `Node.js ${process.versions.node} satisfies engines (>=22.12.0)`,
    ok: major >= 22,
    ms: 0,
    detail: major >= 22 ? '' : 'upgrade Node.js',
  });
  process.stdout.write(
    `  ${major >= 22 ? green('PASS') : red('FAIL')} Node.js ${process.versions.node} satisfies engines (>=22.12.0)\n`,
  );

  await run('dependencies installed', 'node', [
    '-e',
    'require.resolve("@nestjs/core");require.resolve("next");console.log("ok")',
  ]);
  // A wrong-libc native addon (lightningcss) makes EVERY web page 500 at runtime
  // while typecheck, lint and both unit-test suites stay green - so it gets its
  // own check, before anything that would pass regardless.
  await run(
    'native bindings load (lightningcss, argon2)',
    'node',
    ['scripts/ensure-native.mjs', '--check'],
    {
      timeoutMs: 180_000,
    },
  );
  await run('build @kdc/shared (both apps import it)', 'npm', [
    'run',
    'build',
    '--workspace',
    '@kdc/shared',
  ]);

  await run('typecheck (shared + api + web)', 'npm', ['run', 'typecheck'], { timeoutMs: 600_000 });
  await run('lint (eslint --max-warnings=0)', 'npx', ['eslint', '.', '--max-warnings=0'], {
    timeoutMs: 600_000,
  });
  if (!quick) {
    await run('format (prettier --check)', 'npm', ['run', 'format:check'], { timeoutMs: 300_000 });
    await run(
      'dependency audit (production, high+)',
      'npm',
      ['audit', '--omit=dev', '--audit-level=high'],
      {
        timeoutMs: 300_000,
      },
    );
  }

  await run('API unit tests (jest)', 'npm', ['run', 'test', '--workspace', '@kdc/api'], {
    timeoutMs: 600_000,
  });
  await run('web unit tests (vitest)', 'npm', ['run', 'test', '--workspace', '@kdc/web'], {
    timeoutMs: 600_000,
  });

  if (withBuild) {
    await run('production build: API', 'npm', ['run', 'build', '--workspace', '@kdc/api'], {
      timeoutMs: 900_000,
    });
    await run('production build: web', 'npm', ['run', 'build', '--workspace', '@kdc/web'], {
      timeoutMs: 1_800_000,
    });
  }

  if (withSmoke) {
    await runSmoke();
  }

  const failed = results.filter((r) => !r.ok);
  const seconds = results.reduce((sum, r) => sum + r.ms, 0) / 1000;
  process.stdout.write(`\n${bold('Summary')}\n`);
  process.stdout.write(`  ${green(`${results.length - failed.length} passed`)}  `);
  process.stdout.write(failed.length ? `${red(`${failed.length} failed`)}` : dim('0 failed'));
  process.stdout.write(dim(`  (${seconds.toFixed(1)}s)\n`));
  if (failed.length) {
    process.stdout.write(`\n${red('Failed steps:')}\n`);
    for (const f of failed)
      process.stdout.write(
        `  - ${f.name}${f.detail ? dim(` :: ${f.detail.split('\n')[0]}`) : ''}\n`,
      );
  }
  if (!withSmoke) {
    process.stdout.write(
      dim(
        '\nNot covered by this run: the live HTTP surface (use --smoke) and MongoDB/Redis\nbehaviour (use docker compose - see docs/DEPLOYMENT.md).\n',
      ),
    );
  }
  process.stdout.write('\n');
  process.exit(failed.length ? 1 : 0);
}

await main();
