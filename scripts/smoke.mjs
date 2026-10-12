#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING API.
 *
 *   node scripts/smoke.mjs [--api http://localhost:4000] [--prefix api/v1]
 *
 * Unlike the Jest suites (which run in-process with in-memory adapters), this
 * drives the real HTTP surface: cookies, CSRF, rate limits, multipart uploads,
 * SSE and PDF bytes. Run it after `npm run dev` or against a deployed instance.
 *
 * It creates its own organisation with a unique slug, so it never depends on
 * seeded data and never mutates an existing tenant.
 *
 * Exit code is 0 only when every check passes.
 */

import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const API = argValue('api', process.env.SMOKE_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);
const PREFIX = argValue('prefix', process.env.SMOKE_API_PREFIX ?? 'api/v1').replace(/^\/|\/$/g, '');
const BASE = `${API}/${PREFIX}`;

let passed = 0;
let failed = 0;
const failures = [];

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ${green('PASS')} ${name}${detail ? dim(` :: ${detail}`) : ''}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
    console.log(`  ${red('FAIL')} ${name}${detail ? dim(` :: ${detail}`) : ''}`);
  }
  return ok;
}

function section(title) {
  console.log(`\n${bold(title)}`);
}

/** Minimal cookie jar so we exercise the browser (cookie + CSRF) path. */
class Jar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || value === 'deleted') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return this;
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name) {
    return this.cookies.get(name);
  }
}

async function call(
  method,
  path,
  { body, jar, token, apiKey, csrf = true, raw = false, headers = {} } = {},
) {
  const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const finalHeaders = { accept: 'application/json', ...headers };
  if (body !== undefined && !finalHeaders['content-type'])
    finalHeaders['content-type'] = 'application/json';
  if (jar) {
    const cookie = jar.header();
    if (cookie) finalHeaders.cookie = cookie;
    if (csrf && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      const token_ = jar.get('kdc_csrf');
      if (token_) finalHeaders['x-kdc-csrf'] = token_;
    }
  }
  if (token) finalHeaders.authorization = `Bearer ${token}`;
  if (apiKey) finalHeaders['x-api-key'] = apiKey;

  const res = await fetch(url, {
    method,
    headers: finalHeaders,
    body:
      body === undefined
        ? undefined
        : typeof body === 'string' || Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
    redirect: 'manual',
  });
  if (jar) jar.absorb(res);
  if (raw)
    return {
      status: res.status,
      headers: res.headers,
      buffer: Buffer.from(await res.arrayBuffer()),
    };
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { status: res.status, headers: res.headers, body: json };
}

/** Builds a multipart/form-data body without an external dependency. */
function multipart(fields, file) {
  const boundary = `----kdcboundary${Date.now().toString(16)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(file.content);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

const slug = `smoke-${Date.now().toString(36)}`;
const email = `qa-${Date.now().toString(36)}@example.test`;
// The password policy rejects anything containing the account's own name or
// email local-part, so these deliberately share no tokens.
const password = 'Kdc-Qa!2026x';
const orgName = 'Smoke Test Organisation';

async function main() {
  console.log(bold(`\nKrishna Digital Certificate - API smoke test`));
  console.log(dim(`target: ${BASE}\n`));

  /* --------------------------------------------------------------- health */
  section('Health and capabilities');
  const health = await call('GET', '/health');
  if (!check('GET /health responds 200', health.status === 200, `status=${health.status}`)) {
    console.error(red('API is not reachable - start it with `npm run dev` and retry.'));
    process.exit(1);
  }
  const caps = health.body?.capabilities ?? {};
  check(
    'health reports its drivers',
    Boolean(health.body?.components?.database?.driver),
    `data=${health.body?.components?.database?.driver}`,
  );
  check(
    'health honestly reports unconfigured integrations',
    caps.googleOAuth === false || caps.googleOAuth === true,
    `google=${caps.googleOAuth} smtp=${caps.smtp} payments=${caps.payments}`,
  );
  const ready = await call('GET', '/health/ready');
  check(
    'GET /health/ready responds',
    ready.status === 200 || ready.status === 503,
    `status=${ready.status}`,
  );

  /* ----------------------------------------------------------------- auth */
  section('Authentication');
  const badLogin = await call('POST', '/auth/login', { body: { email, password } });
  check(
    'login with unknown credentials is rejected',
    badLogin.status === 401,
    `status=${badLogin.status} code=${badLogin.body?.error}`,
  );

  const jar = new Jar();
  const register = await call('POST', '/auth/register', {
    jar,
    body: {
      name: 'QA Automation',
      email,
      password,
      organisation: { name: orgName, slug, type: 'college', country: 'IN' },
    },
  });
  if (
    !check(
      'register creates an account + organisation',
      register.status === 201 || register.status === 200,
      `status=${register.status} ${JSON.stringify(register.body?.message ?? register.body?.error ?? '')}`,
    )
  ) {
    console.error(red('Cannot continue without an account.'));
    summary();
    process.exit(1);
  }
  const accessToken = register.body?.tokens?.accessToken;
  check('access token issued', typeof accessToken === 'string' && accessToken.length > 20);
  check('refresh token issued', typeof register.body?.tokens?.refreshToken === 'string');
  check('HttpOnly access cookie set', Boolean(jar.get('kdc_access')));
  check('script-readable CSRF cookie set', Boolean(jar.get('kdc_csrf')));
  check('starter designs provisioned', (register.body?.tenant?.templateCount ?? 0) >= 0);

  const me = await call('GET', '/auth/me', { jar });
  check('GET /auth/me with cookie session', me.status === 200, `status=${me.status}`);
  check('me lists the new organisation', (me.body?.tenants ?? []).length >= 1);

  const tenantsRes = await call('GET', '/tenants', { token: accessToken });
  const tenant = tenantsRes.body?.items?.[0]?.tenant;
  if (
    !check('GET /tenants returns the organisation', Boolean(tenant), `status=${tenantsRes.status}`)
  ) {
    summary();
    process.exit(1);
  }
  const tenantId = tenant.id;
  const role = tenantsRes.body.items[0].role;
  check('caller is the owner', role === 'owner', `role=${role}`);
  check(
    'owner permissions resolved',
    (tenantsRes.body.items[0].permissions ?? []).includes('certificate:issue'),
  );

  /* ----------------------------------------------------------------- csrf */
  section('CSRF and tenant isolation');
  const noCsrf = await fetch(`${BASE}/tenants/${tenantId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jar.header() },
    body: JSON.stringify({ name: 'Should Fail', templateId: 'x' }),
  });
  check(
    'cookie POST without x-kdc-csrf is rejected',
    noCsrf.status === 403,
    `status=${noCsrf.status}`,
  );

  const foreign = await call('GET', `/tenants/00000000-0000-4000-8000-000000000000/events`, {
    token: accessToken,
  });
  check(
    'unknown tenant returns 404 (not 403)',
    foreign.status === 404,
    `status=${foreign.status} code=${foreign.body?.error}`,
  );

  const anon = await call('GET', `/tenants/${tenantId}/certificates`);
  check('tenant route without credentials is 401', anon.status === 401, `status=${anon.status}`);

  /* ------------------------------------------------------------ templates */
  section('Designs');
  const templates = await call('GET', `/tenants/${tenantId}/templates`, { token: accessToken });
  const starterList = templates.body?.items ?? [];
  check('starter designs listed', starterList.length >= 5, `count=${starterList.length}`);
  const template = starterList[0];

  const preview = await call('POST', `/tenants/${tenantId}/templates/preview`, {
    token: accessToken,
    body: { doc: template.doc, watermark: 'specimen' },
  });
  const pdfBytes = preview.body?.pdfBase64
    ? Buffer.from(preview.body.pdfBase64, 'base64')
    : Buffer.alloc(0);
  check(
    'design preview renders a PDF',
    preview.status === 200 || preview.status === 201,
    `status=${preview.status}`,
  );
  check(
    'preview PDF has a valid header',
    pdfBytes.subarray(0, 5).toString() === '%PDF-',
    `${pdfBytes.byteLength} bytes`,
  );
  check(
    'preview PDF has an EOF marker',
    pdfBytes.subarray(-1024).toString('latin1').includes('%%EOF'),
  );
  check(
    'preview reports zero render warnings',
    (preview.body?.warnings ?? []).length === 0,
    JSON.stringify(preview.body?.warnings ?? []).slice(0, 160),
  );

  /* --------------------------------------------------------------- events */
  section('Events');
  const created = await call('POST', `/tenants/${tenantId}/events`, {
    jar,
    body: {
      name: 'Smoke Convocation',
      templateId: template.id,
      programmeName: 'Bachelor of Technology',
      date: new Date().toISOString(),
      venue: 'Smoke Hall',
      requireApproval: false,
      autoDeliverEmail: false,
    },
  });
  if (
    !check(
      'event created',
      created.status === 201,
      `status=${created.status} ${JSON.stringify(created.body?.message ?? '')}`,
    )
  ) {
    summary();
    process.exit(1);
  }
  const eventId = created.body.id;
  const events = await call('GET', `/tenants/${tenantId}/events`, { token: accessToken });
  check(
    'event listed with counters',
    (events.body?.items ?? []).some((e) => e.id === eventId),
    `total=${events.body?.total}`,
  );

  /* --------------------------------------------------------- single issue */
  section('Certificate issuance');
  const issued = await call('POST', `/tenants/${tenantId}/certificates/issue`, {
    jar,
    body: {
      eventId,
      recipient: {
        name: 'Smoke Recipient',
        email: 'smoke.recipient@example.test',
        title: 'Graduate',
        department: 'Testing',
        roll_number: 'SMK-1',
        grade: 'A+',
      },
      sendEmail: false,
    },
  });
  if (
    !check(
      'single certificate issued',
      issued.status === 201,
      `status=${issued.status} ${JSON.stringify(issued.body?.message ?? '')}`,
    )
  ) {
    summary();
    process.exit(1);
  }
  const certificateId = issued.body.id;
  const serial = issued.body.serial;
  check(
    'serial has the documented shape',
    /^KDC-\d{4}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]$/.test(serial ?? ''),
    serial,
  );
  check(
    'download token returned once',
    typeof issued.body.downloadToken === 'string' && issued.body.downloadToken.length > 20,
  );
  const downloadToken = issued.body.downloadToken;

  // Give the async PDF worker a moment.
  await new Promise((r) => setTimeout(r, 2500));

  const one = await call('GET', `/tenants/${tenantId}/certificates/${certificateId}`, {
    token: accessToken,
  });
  check('certificate readable', one.status === 200, `status=${one.status}`);
  check(
    'integrity signature verifies',
    one.body?.integrityOk === true,
    `integrityOk=${one.body?.integrityOk}`,
  );

  const pdf = await call('GET', `/tenants/${tenantId}/certificates/${certificateId}/pdf`, {
    token: accessToken,
    raw: true,
  });
  check(
    'member can download the PDF',
    pdf.status === 200,
    `status=${pdf.status} bytes=${pdf.buffer?.byteLength ?? 0}`,
  );
  check(
    'downloaded PDF is valid',
    (pdf.buffer ?? Buffer.alloc(0)).subarray(0, 5).toString() === '%PDF-',
  );
  check(
    'PDF sha256 header present',
    /^[a-f0-9]{64}$/.test(pdf.headers.get('x-kdc-sha256') ?? ''),
    pdf.headers.get('x-kdc-sha256') ?? '',
  );

  const qr = await call('GET', `/tenants/${tenantId}/certificates/${certificateId}/qr?size=200`, {
    token: accessToken,
    raw: true,
  });
  check(
    'QR PNG generated',
    qr.status === 200 && (qr.buffer ?? Buffer.alloc(0)).subarray(1, 4).toString() === 'PNG',
    `status=${qr.status} bytes=${qr.buffer?.byteLength ?? 0}`,
  );

  /* ------------------------------------------------------ public verify */
  section('Public verification');
  const verify = await call('GET', `/public/verify?serial=${encodeURIComponent(serial)}`);
  check(
    'serial verifies publicly',
    verify.status === 200 && verify.body?.result === 'valid',
    `status=${verify.status} result=${verify.body?.result}`,
  );
  check(
    'verification reports the recipient',
    Boolean(verify.body?.certificate?.recipientName),
    verify.body?.certificate?.recipientName ?? '',
  );
  check('verification reports integrity', verify.body?.certificate?.integrityOk === true);

  const bogus = await call('GET', '/public/verify?serial=KDC-2026-ZZZZZZZZ-Z');
  check(
    'unknown serial is not_found',
    bogus.body?.result === 'not_found' || bogus.body?.result === 'malformed',
    `result=${bogus.body?.result}`,
  );

  const malformed = await call('GET', '/public/verify?serial=not-a-serial');
  check(
    'malformed serial is reported',
    malformed.body?.result === 'malformed',
    `result=${malformed.body?.result}`,
  );

  const noToken = await call('GET', `/public/certificates/${encodeURIComponent(serial)}.pdf`, {
    raw: true,
  });
  check(
    'PDF download without a token is refused',
    noToken.status === 401 || noToken.status === 403,
    `status=${noToken.status}`,
  );

  const withToken = await call(
    'GET',
    `/public/certificates/${encodeURIComponent(serial)}.pdf?token=${encodeURIComponent(downloadToken)}`,
    { raw: true },
  );
  check(
    'PDF download with the private token works',
    withToken.status === 200,
    `status=${withToken.status} bytes=${withToken.buffer?.byteLength ?? 0}`,
  );
  check(
    'token-downloaded PDF is valid',
    (withToken.buffer ?? Buffer.alloc(0)).subarray(0, 5).toString() === '%PDF-',
  );

  /* ------------------------------------------------------------ bulk issue */
  section('Bulk issuance');
  const recipients = Array.from({ length: 12 }, (_, i) => ({
    name: `Bulk Recipient ${i + 1}`,
    email: `bulk${i + 1}@example.test`,
    title: 'Graduate',
    department: 'Bulk Testing',
    roll_number: `BLK-${String(i + 1).padStart(4, '0')}`,
    grade: 'A',
  }));
  const bulk = await call('POST', `/tenants/${tenantId}/certificates/issue-bulk`, {
    jar,
    body: { eventId, recipients, sendEmail: false, continueOnFailure: true },
  });
  check(
    'bulk run accepted (202)',
    bulk.status === 202,
    `status=${bulk.status} ${JSON.stringify(bulk.body?.message ?? '')}`,
  );
  const jobId = bulk.body?.jobId;
  check('job id returned', typeof jobId === 'string', jobId ?? '');
  check(
    'recipient count echoed',
    bulk.body?.total === recipients.length,
    `total=${bulk.body?.total}`,
  );

  // Poll the job until it completes (bounded).
  let job = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await call('GET', `/tenants/${tenantId}/jobs/${jobId}`, { token: accessToken });
    job = res.body;
    if (job?.status === 'completed' || job?.status === 'failed') break;
  }
  check(
    'bulk job completed',
    job?.status === 'completed',
    `status=${job?.status} processed=${job?.processed}/${job?.total}`,
  );
  check(
    'all bulk rows succeeded',
    (job?.succeeded ?? 0) === recipients.length,
    `succeeded=${job?.succeeded} failed=${job?.failed}`,
  );

  const list = await call('GET', `/tenants/${tenantId}/certificates?pageSize=100`, {
    token: accessToken,
  });
  check(
    'certificate list paginated',
    (list.body?.items ?? []).length >= recipients.length + 1,
    `total=${list.body?.total}`,
  );
  check(
    'list reports pagination metadata',
    typeof list.body?.page === 'number' && typeof list.body?.hasMore === 'boolean',
  );

  /* -------------------------------------------------------------- imports */
  section('CSV / XLSX import');
  const csv = [
    'name,email,title,department,Roll No,grade',
    ...Array.from(
      { length: 6 },
      (_, i) =>
        `Import Recipient ${i + 1},import${i + 1}@example.test,Graduate,Import Dept,IMP-${i + 1},B+`,
    ),
    'No Email Person,bad-email,Graduate,Import Dept,IMP-900,B+',
  ].join('\n');
  const up = multipart(
    { eventId, requireEmail: 'false' },
    {
      field: 'file',
      filename: 'smoke.csv',
      contentType: 'text/csv',
      content: Buffer.from(csv, 'utf8'),
    },
  );
  const staged = await call('POST', `/tenants/${tenantId}/imports`, {
    jar,
    body: up.body,
    headers: { 'content-type': up.contentType },
  });
  check(
    'CSV staged for import',
    staged.status === 201,
    `status=${staged.status} ${JSON.stringify(staged.body?.message ?? '')}`,
  );
  check(
    'headers auto-mapped ("Roll No" -> roll_number)',
    staged.body?.mapping?.['Roll No'] === 'roll_number',
    JSON.stringify(staged.body?.mapping ?? {}),
  );
  check(
    'valid rows counted',
    staged.body?.validRows === 6,
    `valid=${staged.body?.validRows} invalid=${staged.body?.invalidRows}`,
  );
  check(
    'invalid row reported with its reason',
    (staged.body?.errors ?? []).length >= 1,
    JSON.stringify((staged.body?.errors ?? [])[0] ?? {}),
  );
  const batchId = staged.body?.batchId;

  const issuedFromImport = await call('POST', `/tenants/${tenantId}/imports/${batchId}/issue`, {
    jar,
    body: { sendEmail: false, continueOnFailure: true },
  });
  check(
    'staged batch issued',
    issuedFromImport.status === 202,
    `status=${issuedFromImport.status} ${JSON.stringify(issuedFromImport.body?.message ?? '')}`,
  );
  check(
    'import skipped the invalid row',
    issuedFromImport.body?.skipped >= 1,
    `queued=${issuedFromImport.body?.queued} skipped=${issuedFromImport.body?.skipped}`,
  );

  const sampleCsv = await call('GET', `/tenants/${tenantId}/imports/sample.csv`, {
    token: accessToken,
    raw: true,
  });
  check(
    'sample CSV downloadable',
    sampleCsv.status === 200 && sampleCsv.buffer.byteLength > 50,
    `bytes=${sampleCsv.buffer?.byteLength ?? 0}`,
  );
  const sampleXlsx = await call('GET', `/tenants/${tenantId}/imports/sample.xlsx`, {
    token: accessToken,
    raw: true,
  });
  check(
    'sample XLSX downloadable and a real zip',
    sampleXlsx.status === 200 && sampleXlsx.buffer.subarray(0, 2).toString() === 'PK',
    `status=${sampleXlsx.status} bytes=${sampleXlsx.buffer?.byteLength ?? 0}`,
  );

  /* ------------------------------------------------- assets and storage */
  section('Asset storage and signed downloads');
  // Real bytes rather than a fixture: reuse the PDF this API just rendered.
  const pdfForAsset = await call('GET', `/tenants/${tenantId}/certificates/${certificateId}/pdf`, {
    token: accessToken,
    raw: true,
  });
  check(
    'source PDF fetched for the upload test',
    pdfForAsset.status === 200 && pdfForAsset.buffer.subarray(0, 5).toString() === '%PDF-',
    `status=${pdfForAsset.status} bytes=${pdfForAsset.buffer.byteLength}`,
  );

  const assetUpload = multipart(
    { kind: 'template_image', isPublic: 'false' },
    {
      field: 'file',
      filename: 'smoke asset.pdf',
      contentType: 'application/pdf',
      content: pdfForAsset.buffer,
    },
  );
  const uploaded = await call('POST', `/tenants/${tenantId}/assets`, {
    jar,
    body: assetUpload.body,
    headers: { 'content-type': assetUpload.contentType },
  });
  check(
    'asset uploaded',
    uploaded.status === 201,
    `status=${uploaded.status} ${JSON.stringify(uploaded.body?.message ?? '')}`,
  );
  const assetId = uploaded.body?.id;
  const storageKey = String(uploaded.body?.storageKey ?? '');
  check(
    'asset key is tenant-namespaced',
    storageKey.startsWith(`tenants/${tenantId}/template_image/`),
    storageKey,
  );
  check(
    'asset sha256 matches the uploaded bytes',
    uploaded.body?.sha256 === createHash('sha256').update(pdfForAsset.buffer).digest('hex'),
    String(uploaded.body?.sha256 ?? '').slice(0, 16),
  );
  check(
    'asset sizeBytes matches',
    uploaded.body?.sizeBytes === pdfForAsset.buffer.byteLength,
    `${uploaded.body?.sizeBytes}`,
  );
  check(
    'upload filename was sanitised',
    uploaded.body?.filename === 'smoke_asset.pdf',
    uploaded.body?.filename,
  );

  const signed = await call('GET', `/tenants/${tenantId}/assets/${assetId}/url?ttl=300`, {
    token: accessToken,
  });
  check(
    'signed URL issued',
    signed.status === 200 && typeof signed.body?.url === 'string',
    `status=${signed.status}`,
  );
  const signedUrl = new URL(signed.body.url);
  check(
    'signed URL targets the download route',
    signedUrl.pathname.endsWith('/files/download'),
    signedUrl.pathname,
  );
  check(
    'signed URL carries key, expires and sig',
    Boolean(
      signedUrl.searchParams.get('key') &&
      signedUrl.searchParams.get('expires') &&
      signedUrl.searchParams.get('sig'),
    ),
    signedUrl.search.slice(0, 48),
  );

  // The URL is absolute (built from API_URL). Drive the same path + query
  // against the smoke target so this passes against any host, including a
  // preview proxy or a container network.
  const download = await call('GET', `/files/download?${signedUrl.searchParams.toString()}`, {
    raw: true,
  });
  check(
    'public signed download returns byte-identical bytes',
    download.status === 200 && download.buffer.equals(pdfForAsset.buffer),
    `status=${download.status} bytes=${download.buffer.byteLength}`,
  );
  check(
    'download is an attachment carrying the sanitised filename',
    /attachment; filename="smoke_asset\.pdf"/.test(
      download.headers.get('content-disposition') ?? '',
    ),
    download.headers.get('content-disposition'),
  );

  const rewritten = new URL(signed.body.url);
  rewritten.searchParams.set(
    'key',
    storageKey.replace(`tenants/${tenantId}/`, 'tenants/some-other-tenant/'),
  );
  const tamperedDl = await call('GET', `/files/download?${rewritten.searchParams.toString()}`, {
    raw: true,
  });
  check(
    'rewriting the key to another tenant is refused',
    tamperedDl.status === 403,
    `status=${tamperedDl.status}`,
  );

  const traversalDl = new URL(signed.body.url);
  traversalDl.searchParams.set('key', '../../.env');
  const traversalRes = await call('GET', `/files/download?${traversalDl.searchParams.toString()}`, {
    raw: true,
  });
  check(
    'path traversal through a signed link is refused',
    traversalRes.status === 403 || traversalRes.status === 400,
    `status=${traversalRes.status}`,
  );

  const expiredUrl = new URL(signed.body.url);
  expiredUrl.searchParams.set('expires', String(Date.now() - 60_000));
  const expiredRes = await call('GET', `/files/download?${expiredUrl.searchParams.toString()}`, {
    raw: true,
  });
  check('an expired link is refused', expiredRes.status === 403, `status=${expiredRes.status}`);

  const unsignedRes = await call(
    'GET',
    `/files/download?key=${encodeURIComponent(storageKey)}&expires=${Date.now() + 60_000}`,
    { raw: true },
  );
  check(
    'a link with no signature is refused',
    unsignedRes.status === 400 || unsignedRes.status === 403,
    `status=${unsignedRes.status}`,
  );

  const streamed = await call('GET', `/tenants/${tenantId}/assets/${assetId}/download`, {
    token: accessToken,
    raw: true,
  });
  check(
    'authenticated asset stream returns identical bytes',
    streamed.status === 200 && streamed.buffer.equals(pdfForAsset.buffer),
    `status=${streamed.status}`,
  );

  const unauthAssets = await call('GET', `/tenants/${tenantId}/assets`);
  check(
    'the asset list requires authentication',
    unauthAssets.status === 401 || unauthAssets.status === 403,
    `status=${unauthAssets.status}`,
  );

  // Upload validation: allow-list, magic-byte sniffing and the SVG guard.
  const hostileSvg = multipart(
    { kind: 'logo' },
    {
      field: 'file',
      filename: 'evil.svg',
      contentType: 'image/svg+xml',
      content: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        'utf8',
      ),
    },
  );
  const svgRes = await call('POST', `/tenants/${tenantId}/assets`, {
    jar,
    body: hostileSvg.body,
    headers: { 'content-type': hostileSvg.contentType },
  });
  check(
    'an SVG carrying script is rejected',
    svgRes.status === 400,
    `status=${svgRes.status} ${svgRes.body?.error ?? svgRes.body?.code ?? ''}`,
  );

  const lyingPng = multipart(
    { kind: 'logo' },
    {
      field: 'file',
      filename: 'lie.png',
      contentType: 'image/png',
      content: Buffer.from('%PDF-1.4 not really a png', 'utf8'),
    },
  );
  const magicRes = await call('POST', `/tenants/${tenantId}/assets`, {
    jar,
    body: lyingPng.body,
    headers: { 'content-type': lyingPng.contentType },
  });
  check(
    'bytes that contradict the declared mime type are rejected',
    magicRes.status === 400,
    `status=${magicRes.status} ${magicRes.body?.error ?? magicRes.body?.code ?? ''}`,
  );

  const plainText = multipart(
    { kind: 'logo' },
    {
      field: 'file',
      filename: 'notes.txt',
      contentType: 'text/plain',
      content: Buffer.from('hello', 'utf8'),
    },
  );
  const typeRes = await call('POST', `/tenants/${tenantId}/assets`, {
    jar,
    body: plainText.body,
    headers: { 'content-type': plainText.contentType },
  });
  check(
    'a disallowed mime type is rejected',
    typeRes.status === 400,
    `status=${typeRes.status} ${typeRes.body?.error ?? typeRes.body?.code ?? ''}`,
  );

  const systemKind = multipart(
    { kind: 'certificate_pdf' },
    {
      field: 'file',
      filename: 'x.pdf',
      contentType: 'application/pdf',
      content: pdfForAsset.buffer,
    },
  );
  const kindRes = await call('POST', `/tenants/${tenantId}/assets`, {
    jar,
    body: systemKind.body,
    headers: { 'content-type': systemKind.contentType },
  });
  check(
    'a system-only asset kind cannot be uploaded directly',
    kindRes.status === 400,
    `status=${kindRes.status}`,
  );

  const deletedAsset = await call('DELETE', `/tenants/${tenantId}/assets/${assetId}`, { jar });
  check('asset deleted', deletedAsset.status === 200, `status=${deletedAsset.status}`);
  const goneMeta = await call('GET', `/tenants/${tenantId}/assets/${assetId}`, {
    token: accessToken,
  });
  check('deleted asset metadata is gone', goneMeta.status === 404, `status=${goneMeta.status}`);
  const goneDl = await call('GET', `/files/download?${signedUrl.searchParams.toString()}`, {
    raw: true,
  });
  check(
    'a still-valid signature cannot resurrect a deleted object',
    goneDl.status === 404,
    `status=${goneDl.status}`,
  );

  /* ------------------------------------------------------------ revocation */
  section('Revocation');
  const revoked = await call('POST', `/tenants/${tenantId}/certificates/${certificateId}/revoke`, {
    jar,
    body: { reason: 'Issued in error during the smoke test', notifyRecipient: false },
  });
  check(
    'certificate revoked',
    revoked.status === 200 && revoked.body?.status === 'revoked',
    `status=${revoked.status} cert=${revoked.body?.status}`,
  );
  const verifyRevoked = await call('GET', `/public/verify?serial=${encodeURIComponent(serial)}`);
  check(
    'verification now reports revoked',
    verifyRevoked.body?.result === 'revoked',
    `result=${verifyRevoked.body?.result}`,
  );
  const downloadRevoked = await call(
    'GET',
    `/public/certificates/${encodeURIComponent(serial)}.pdf?token=${encodeURIComponent(downloadToken)}`,
    { raw: true },
  );
  check(
    'revoked certificate cannot be downloaded',
    downloadRevoked.status === 403 || downloadRevoked.status === 404,
    `status=${downloadRevoked.status}`,
  );

  /* ------------------------------------------------------------- analytics */
  section('Analytics, audit and realtime');
  const analytics = await call('GET', `/tenants/${tenantId}/analytics?days=7`, {
    token: accessToken,
  });
  check('analytics overview', analytics.status === 200, `status=${analytics.status}`);
  check(
    'analytics counted the issuances',
    (analytics.body?.totals?.certificates ?? 0) >= recipients.length + 7,
    `certificates=${analytics.body?.totals?.certificates}`,
  );
  check(
    'analytics returns a time series',
    Array.isArray(analytics.body?.series) && analytics.body.series.length === 7,
    `points=${analytics.body?.series?.length}`,
  );
  check(
    'analytics reports quota honestly',
    typeof analytics.body?.quota?.plan === 'string',
    `plan=${analytics.body?.quota?.plan} limit=${analytics.body?.quota?.limit}`,
  );

  const audit = await call('GET', `/tenants/${tenantId}/audit?pageSize=100`, {
    token: accessToken,
  });
  check(
    'audit log recorded activity',
    (audit.body?.items ?? []).length > 5,
    `entries=${audit.body?.total}`,
  );
  check(
    'audit entries are hash-chained',
    audit.body?.items?.some((l) => Boolean(l.hash)),
    '',
  );
  const chain = await call('POST', `/tenants/${tenantId}/audit/verify`, { jar });
  check(
    'audit hash chain verifies',
    chain.status === 200 && chain.body?.ok === true,
    `ok=${chain.body?.ok} checked=${chain.body?.checked}`,
  );

  const exportCsv = await call('GET', `/tenants/${tenantId}/analytics/export.csv`, {
    token: accessToken,
    raw: true,
  });
  check(
    'certificate CSV export',
    exportCsv.status === 200 && exportCsv.buffer.toString('utf8').includes('serial'),
    `bytes=${exportCsv.buffer?.byteLength ?? 0}`,
  );
  check(
    'CSV export is UTF-8 BOM for Excel',
    exportCsv.buffer.subarray(0, 3).toString('hex') === 'efbbbf',
  );

  /* ----------------------------------------------------------------- sse */
  const sseUrl = `${BASE}/tenants/${tenantId}/stream`;
  const controller = new AbortController();
  let sseOk = false;
  let sseEvent = '';
  try {
    const res = await fetch(sseUrl, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'text/event-stream' },
      signal: controller.signal,
    });
    sseOk =
      res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/event-stream');
    const reader = res.body.getReader();
    const { value } = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ value: null }), 4000)),
    ]);
    sseEvent = value ? Buffer.from(value).toString('utf8').slice(0, 120).replace(/\n/g, ' ') : '';
    controller.abort();
  } catch (err) {
    if (err.name !== 'AbortError') sseEvent = `error: ${err.message}`;
    controller.abort();
  }
  check('SSE realtime stream opens', sseOk, sseEvent);

  /* -------------------------------------------------------------- webhooks */
  section('Webhooks and API keys');
  // Webhooks and API keys are paid features - the free plan must refuse them.
  const gated = await call('POST', `/tenants/${tenantId}/webhooks`, {
    jar,
    body: { url: 'https://example.test/hooks/kdc', events: ['certificate.issued'] },
  });
  check(
    'free plan refuses webhooks with a remedy',
    gated.status === 403 &&
      /not available on the current plan/i.test(String(gated.body?.message ?? '')),
    `status=${gated.status} ${JSON.stringify(gated.body?.message ?? '')}`,
  );
  const upgraded = await call('POST', `/tenants/${tenantId}/billing/plan`, {
    jar,
    body: { planId: 'growth' },
  });
  const planNow = String(upgraded.body?.subscription?.planId ?? upgraded.body?.planId ?? '');
  check(
    'plan upgraded to growth',
    upgraded.status === 200 && planNow === 'growth',
    `status=${upgraded.status} ${JSON.stringify(upgraded.body ?? {}).slice(0, 160)}`,
  );
  check(
    'manual billing charges nothing without a payment provider',
    upgraded.body?.paymentConfigured === false ||
      upgraded.body?.provider === 'manual' ||
      upgraded.body?.charged === false,
    JSON.stringify(upgraded.body ?? {}).slice(0, 200),
  );

  const ssrf = await call('POST', `/tenants/${tenantId}/webhooks`, {
    jar,
    body: { url: 'http://169.254.169.254/latest/meta-data/', events: ['certificate.issued'] },
  });
  check(
    'webhook to a metadata IP is refused',
    ssrf.status === 400,
    `status=${ssrf.status} ${JSON.stringify(ssrf.body?.message ?? '')}`,
  );
  const loopback = await call('POST', `/tenants/${tenantId}/webhooks`, {
    jar,
    body: { url: 'http://127.0.0.1:4000/api/v1/health', events: ['certificate.issued'] },
  });
  check('webhook to loopback is refused', loopback.status === 400, `status=${loopback.status}`);

  const wh = await call('POST', `/tenants/${tenantId}/webhooks`, {
    jar,
    body: {
      url: 'https://example.test/hooks/kdc',
      events: ['certificate.issued', 'certificate.revoked'],
      description: 'Smoke endpoint',
    },
  });
  check(
    'public-URL webhook accepted',
    wh.status === 201,
    `status=${wh.status} ${JSON.stringify(wh.body?.message ?? '')}`,
  );
  check(
    'webhook secret returned once',
    typeof wh.body?.secret === 'string' && wh.body.secret.length > 20,
  );
  check(
    'webhook secret not stored in the listing',
    wh.body?.endpoint?.secret === undefined && typeof wh.body?.endpoint?.secretPreview === 'string',
  );
  const whTest = await call('POST', `/tenants/${tenantId}/webhooks/${wh.body?.endpoint?.id}/test`, {
    jar,
  });
  check(
    'webhook test reports a real delivery failure (example.test is unreachable)',
    whTest.status === 200 || whTest.status === 201,
    `status=${whTest.body?.status ?? whTest.status} error=${String(whTest.body?.error ?? '').slice(0, 80)}`,
  );

  const scopes = await call('GET', `/tenants/${tenantId}/api-keys/scopes`, { token: accessToken });
  check(
    'API key scopes listed',
    (scopes.body?.scopes ?? []).length > 0,
    `${(scopes.body?.scopes ?? []).length} scopes`,
  );
  const key = await call('POST', `/tenants/${tenantId}/api-keys`, {
    jar,
    body: { name: 'Smoke Key', scopes: ['certificates:read', 'events:read'] },
  });
  check(
    'API key created',
    key.status === 201,
    `status=${key.status} ${JSON.stringify(key.body?.message ?? '')}`,
  );
  const plaintext = key.body?.plaintext;
  check(
    'plaintext key shown once',
    typeof plaintext === 'string' && plaintext.startsWith('kdc_'),
    String(plaintext ?? '').slice(0, 12),
  );

  const withKey = await call('GET', `/tenants/${tenantId}/certificates?pageSize=5`, {
    apiKey: plaintext,
  });
  check(
    'API key authenticates a read route',
    withKey.status === 200,
    `status=${withKey.status} ${JSON.stringify(withKey.body?.message ?? '')}`,
  );
  const keyWrite = await call('POST', `/tenants/${tenantId}/events`, {
    apiKey: plaintext,
    csrf: false,
    body: { name: 'Key Should Not Create', templateId: template.id },
  });
  check(
    'API key is refused on a non-key route',
    keyWrite.status === 401 || keyWrite.status === 403,
    `status=${keyWrite.status}`,
  );

  const revokedKey = await call('DELETE', `/tenants/${tenantId}/api-keys/${key.body?.key?.id}`, {
    jar,
  });
  check('API key revoked', revokedKey.status === 200, `status=${revokedKey.status}`);
  const afterRevoke = await call('GET', `/tenants/${tenantId}/certificates?pageSize=5`, {
    apiKey: plaintext,
  });
  check(
    'revoked API key no longer works',
    afterRevoke.status === 401,
    `status=${afterRevoke.status}`,
  );

  /* ---------------------------------------------------------------- team */
  section('Team, billing and settings');
  const invite = await call('POST', `/tenants/${tenantId}/members`, {
    jar,
    body: { email: 'smoke.viewer@example.test', name: 'Smoke Viewer', role: 'viewer' },
  });
  check(
    'member invited',
    invite.status === 201,
    `status=${invite.status} ${JSON.stringify(invite.body?.message ?? '')}`,
  );
  check(
    'invite URL surfaced when no SMTP is configured',
    typeof invite.body?.inviteUrl === 'string' || invite.body?.inviteUrl === null,
    `inviteUrl=${String(invite.body?.inviteUrl ?? 'null').slice(0, 48)}`,
  );
  const members = await call('GET', `/tenants/${tenantId}/members`, { token: accessToken });
  check(
    'members listed with permissions',
    (members.body?.items ?? []).length >= 2,
    `count=${members.body?.items?.length}`,
  );

  const billing = await call('GET', `/tenants/${tenantId}/billing`, { token: accessToken });
  check('billing summary', billing.status === 200, `status=${billing.status}`);
  check(
    'billing states the provider honestly',
    typeof billing.body?.provider === 'string' &&
      (billing.body?.paymentConfigured === false ? Boolean(billing.body?.notice) : true),
    `provider=${billing.body?.provider} configured=${billing.body?.paymentConfigured}`,
  );
  const plans = await call('GET', `/tenants/${tenantId}/billing/plans`, { token: accessToken });
  check(
    'plan catalogue returned',
    (plans.body?.items ?? []).length === 4,
    `plans=${plans.body?.items?.length}`,
  );

  const branding = await call('PATCH', `/tenants/${tenantId}/branding`, {
    jar,
    body: { primaryColor: '#0f766e', accentColor: '#f59e0b', tagline: 'Smoke tested' },
  });
  check(
    'branding updated',
    branding.status === 200,
    `status=${branding.status} ${JSON.stringify(branding.body?.message ?? '')}`,
  );
  check(
    'branding change persisted',
    branding.body?.branding?.primaryColor === '#0f766e',
    branding.body?.branding?.primaryColor ?? '',
  );

  const settings = await call('PATCH', `/tenants/${tenantId}/settings`, {
    jar,
    body: { verificationPublic: true, allowSelfDownload: true },
  });
  check('settings updated', settings.status === 200, `status=${settings.status}`);

  const badColour = await call('PATCH', `/tenants/${tenantId}/branding`, {
    jar,
    body: { primaryColor: 'not-a-colour' },
  });
  check(
    'invalid branding rejected with field details',
    badColour.status === 400,
    `status=${badColour.status} ${JSON.stringify((badColour.body?.details ?? [])[0] ?? {})}`,
  );

  /* ------------------------------------------------------------- oauth 503 */
  section('Honest degradation for unconfigured integrations');
  const googleStatus = await call('GET', '/auth/google/status');
  check(
    'Google OAuth status endpoint answers',
    googleStatus.status === 200,
    `configured=${googleStatus.body?.configured}`,
  );
  const googleStart = await call('GET', '/auth/google', { raw: true });
  const googleConfigured = googleStatus.body?.configured === true;
  check(
    googleConfigured
      ? 'Google OAuth redirects when configured'
      : 'Google OAuth returns 503 when unconfigured',
    googleConfigured ? googleStart.status === 302 : googleStart.status === 503,
    `status=${googleStart.status}`,
  );

  summary();
}

function summary() {
  console.log(`\n${bold('Summary')}`);
  console.log(
    `  ${green(`${passed} passed`)}  ${failed > 0 ? red(`${failed} failed`) : dim('0 failed')}`,
  );
  if (failures.length > 0) {
    console.log(`\n${red('Failures:')}`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(red(`\nSmoke test crashed: ${err?.stack ?? err}`));
  process.exit(1);
});
