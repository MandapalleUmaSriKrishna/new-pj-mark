#!/usr/bin/env node
/**
 * Native-binding guard.
 *
 * WHY THIS EXISTS (this is a real failure, observed in practice):
 * Tailwind CSS v4 compiles CSS through `lightningcss`, which loads a
 * platform-specific native addon. Its per-platform packages
 * (`lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl`, ...) declare
 * `os` and `cpu` but the lockfile records no `libc` field, so npm cannot tell
 * glibc from musl and may install the WRONG one. On a Debian/glibc host that
 * leaves the app failing at runtime with:
 *
 *   Error: Cannot find module '../lightningcss.linux-x64-gnu.node'
 *
 * which surfaces as a 500 on every page (globals.css cannot be compiled).
 *
 * This script verifies the binding actually loads, and if it does not, repairs
 * it by downloading the EXACT tarball recorded in package-lock.json - same
 * resolved URL, same version - and checking its sha512 against the lockfile
 * integrity value before extracting. It never touches package.json or the
 * lockfile, and it never installs a version that is not already pinned.
 *
 *   node scripts/ensure-native.mjs           # verify, and repair if possible
 *   node scripts/ensure-native.mjs --check    # verify only (exit 1 on failure)
 */

import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHECK_ONLY = process.argv.includes('--check');

/** Which libc this Node is running against. */
function detectLibc() {
  const report = process.report?.getReport?.();
  const glibc = report?.header?.glibcVersionRuntime;
  if (glibc) return 'gnu';
  // musl builds report no glibc runtime; confirm with ldd where available.
  try {
    const out = execFileSync('ldd', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return /musl/i.test(out) ? 'musl' : 'gnu';
  } catch {
    return 'gnu';
  }
}

function loadLockfile() {
  const lockPath = join(ROOT, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  return lock.packages ?? {};
}

/** sha512-<base64> of a file, matching the lockfile's `integrity` format. */
function integrityOf(buffer) {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function tryRequire(specifier) {
  // This script is ESM (.mjs), so `require` has to be created explicitly.
  // Resolving from this file's URL walks up to the workspace node_modules.
  const localRequire = createRequire(import.meta.url);
  try {
    localRequire(specifier);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message.split('\n')[0] };
  }
}

/**
 * Repairs one platform package by extracting its pinned tarball into
 * node_modules. Deliberately does not use `npm install --no-save`, which fails
 * inside a workspace tree ("Cannot read properties of null (reading 'edgesOut')").
 */
async function installFromLockfile(packageName, entry) {
  if (!entry?.resolved || !entry?.integrity) {
    throw new Error(`${packageName} has no resolved/integrity in package-lock.json`);
  }
  process.stdout.write(`  downloading ${entry.resolved}\n`);
  const res = await fetch(entry.resolved);
  if (!res.ok) throw new Error(`${entry.resolved} responded ${res.status}`);
  const tarball = Buffer.from(await res.arrayBuffer());

  const expected = entry.integrity;
  const actual = integrityOf(tarball);
  if (!constantTimeEqual(expected, actual)) {
    throw new Error(
      `integrity mismatch for ${packageName}\n    expected ${expected}\n    actual   ${actual}`,
    );
  }
  process.stdout.write(`  integrity verified (${expected.slice(0, 24)}…)\n`);

  const target = join(ROOT, 'node_modules', packageName);
  const tmpTar = join(ROOT, 'node_modules', `.tmp-${packageName.replace('/', '-')}.tgz`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(tmpTar, tarball);
  try {
    execFileSync('tar', ['-xzf', tmpTar, '-C', target, '--strip-components=1'], {
      stdio: 'inherit',
    });
  } finally {
    rmSync(tmpTar, { force: true });
  }
  return target;
}

async function main() {
  const libc = detectLibc();
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch;
  process.stdout.write(
    `platform: ${process.platform}-${arch} libc=${libc} node=${process.versions.node}\n`,
  );

  const lockPackages = loadLockfile();
  let failures = 0;

  /* ------------------------------- lightningcss -------------------------- */
  const lcss = tryRequire('lightningcss');
  if (lcss.ok) {
    process.stdout.write('  ok   lightningcss native binding loads\n');
  } else {
    const wanted = `lightningcss-${process.platform}-${arch}-${libc}`;
    const entry = lockPackages[`node_modules/${wanted}`];
    process.stdout.write(`  FAIL lightningcss: ${lcss.message}\n`);
    if (CHECK_ONLY) {
      process.stdout.write(
        `       remedy: npm install --no-save ${wanted}@${entry?.version ?? '<pinned>'}\n`,
      );
      failures += 1;
    } else if (!entry) {
      process.stdout.write(`       no lockfile entry for ${wanted}; cannot repair automatically\n`);
      failures += 1;
    } else {
      process.stdout.write(`       repairing from the lockfile: ${wanted}@${entry.version}\n`);
      try {
        await installFromLockfile(wanted, entry);
        const retry = tryRequire('lightningcss');
        if (retry.ok) process.stdout.write('  ok   lightningcss loads after repair\n');
        else {
          process.stdout.write(`  FAIL lightningcss still does not load: ${retry.message}\n`);
          failures += 1;
        }
      } catch (err) {
        process.stdout.write(`  FAIL repair failed: ${err.message}\n`);
        failures += 1;
      }
    }
  }

  /* --------------------------------- argon2 ------------------------------ */
  // Password hashing. Unlike lightningcss, argon2 can compile from source when
  // no prebuild matches, so this is a report rather than a repair.
  const argon2 = tryRequire('argon2');
  if (argon2.ok) {
    process.stdout.write('  ok   argon2 native binding loads\n');
  } else {
    process.stdout.write(`  FAIL argon2: ${argon2.message}\n`);
    process.stdout.write(
      '       remedy: reinstall with a toolchain available (python3, make, g++)\n',
    );
    failures += 1;
  }

  if (failures) {
    process.stdout.write(
      `\n${failures} native binding(s) unusable - the web app would 500 on every page.\n`,
    );
    process.exit(1);
  }
  process.stdout.write('\nAll native bindings load.\n');
}

await main();
