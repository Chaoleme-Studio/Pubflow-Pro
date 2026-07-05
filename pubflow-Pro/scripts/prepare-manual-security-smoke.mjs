import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = resolve(rootDir, '.output/chrome-mv3');
const outDir = resolve(rootDir, '.manual-security');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(distDir)) {
  console.error(`Missing extension build: ${distDir}`);
  console.error('Run a protected build first, for example: OBFUSCATE=1 pnpm -s build');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const extensionA = resolve(outDir, 'extension-copy-a');
const extensionB = resolve(outDir, 'extension-copy-b');
const profilesDir = resolve(outDir, 'profiles');
const profileA = resolve(profilesDir, 'profile-a');
const profileB = resolve(profilesDir, 'profile-b');
const profileCopied = resolve(profilesDir, 'profile-copied-from-a');

cpSync(distDir, extensionA, { recursive: true });
cpSync(extensionA, extensionB, { recursive: true });
mkdirSync(profileA, { recursive: true });
mkdirSync(profileB, { recursive: true });
mkdirSync(profileCopied, { recursive: true });

writeFileSync(resolve(outDir, 'launch-profile-a.sh'), launchScript(profileA, extensionA));
writeFileSync(resolve(outDir, 'launch-profile-b-clean-copied-extension.sh'), launchScript(profileB, extensionB));
writeFileSync(resolve(outDir, 'launch-profile-copied-from-a.sh'), launchScript(profileCopied, extensionA));
writeFileSync(resolve(outDir, 'copy-profile-a-to-copied.sh'), copyProfileScript(profileA, profileCopied));
writeFileSync(resolve(outDir, 'hook-fetch-queryselector.js'), hookSnippet());
writeFileSync(resolve(outDir, 'server-event-query.sql'), serverEventQuery());
writeFileSync(resolve(outDir, 'evidence.json'), evidenceTemplate());
writeFileSync(resolve(outDir, 'README.md'), readme());
for (const scriptName of [
  'launch-profile-a.sh',
  'launch-profile-b-clean-copied-extension.sh',
  'launch-profile-copied-from-a.sh',
  'copy-profile-a-to-copied.sh',
]) {
  chmodSync(resolve(outDir, scriptName), 0o755);
}

console.log(`Manual security smoke assets prepared: ${outDir}`);
console.log(`1. Open ${resolve(outDir, 'README.md')}`);
console.log('2. Run the launch scripts from a terminal after making them executable if needed.');

function launchScript(profileDir, extensionDir) {
  return `#!/usr/bin/env bash
set -euo pipefail

CHROME_BIN="\${CHROME_BIN:-${chromeBin}}"
"$CHROME_BIN" \\
  --user-data-dir="${profileDir}" \\
  --disable-extensions-except="${extensionDir}" \\
  --load-extension="${extensionDir}" \\
  chrome://extensions/
`;
}

function copyProfileScript(sourceProfileDir, targetProfileDir) {
  return `#!/usr/bin/env bash
set -euo pipefail

SOURCE_PROFILE="${sourceProfileDir}"
TARGET_PROFILE="${targetProfileDir}"

rm -rf "$TARGET_PROFILE"
mkdir -p "$TARGET_PROFILE"
cp -a "$SOURCE_PROFILE"/. "$TARGET_PROFILE"/
echo "Copied Profile A into $TARGET_PROFILE"
`;
}

function demoActivationCode(email) {
  const digest = createHash('sha256')
    .update('pubflow-demo-seed')
    .update(':')
    .update(email)
    .digest('hex');
  return `PF-${digest.slice(0, 16).toUpperCase()}`;
}

function hookSnippet() {
  return `(() => {
  const calls = [];
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = String(args[0]?.url || args[0] || '');
    const init = args[1] || {};
    if (/\\/v1\\/(lease|selector)\\//.test(url)) {
      calls.push({
        type: 'fetch',
        url,
        method: init.method || 'GET',
        body: typeof init.body === 'string' ? init.body.slice(0, 800) : '[non-string-body]',
        at: new Date().toISOString(),
      });
      console.info('[PubFlow security hook] fetch', calls.at(-1));
    }
    return originalFetch.apply(this, args);
  };

  const patchQuery = (proto, label) => {
    const original = proto.querySelector;
    proto.querySelector = function patchedQuerySelector(selector) {
      if (typeof selector === 'string') {
        calls.push({
          type: label,
          selector: selector.slice(0, 300),
          at: new Date().toISOString(),
        });
      }
      return original.call(this, selector);
    };
  };
  patchQuery(Document.prototype, 'document.querySelector');
  patchQuery(Element.prototype, 'element.querySelector');
  window.__PUBFLOW_SECURITY_HOOK_CALLS__ = calls;
  console.info('[PubFlow security hook] installed. Read window.__PUBFLOW_SECURITY_HOOK_CALLS__ for evidence.');
})();`;
}

function serverEventQuery() {
  return `-- Replace the activation code before running.
-- Expected event types include activate, verify, permit, device_migration_risk, admin_* or selector_publish.
select
  created_at,
  event_type,
  status,
  reason,
  activation_code,
  client_install_id,
  device_key_id,
  ip_address,
  operator
from license_events
where activation_code = 'PF-REPLACE-ME'
order by created_at desc
limit 100;
`;
}

function evidenceTemplate() {
  return JSON.stringify({
    extension_version: '0.1.0',
    server_version: '',
    browser_version: '',
    activation_code: '',
    tested_at: new Date().toISOString(),
    tester: '',
    checks: {
      profile_a_activate_verify_permit: pending('Profile A activated, verified, and requested start_distribution permit before publish.'),
      copied_extension_clean_profile_no_auth: pending('Copied extension directory with clean profile did not inherit authorization.'),
      copied_storage_without_indexeddb_fails_or_recovers: pending('Copied chrome.storage.local without IndexedDB private key failed verify/permit or entered recovery flow.'),
      full_profile_copy_documented: pending('Full Chrome profile copy behavior documented as browser-profile identity-root limit.'),
      local_clock_rollback_restricted: pending('Local clock rollback did not bypass server-time-calibrated restricted/expired state.'),
      fetch_hook_shows_online_permit: pending('Hooked fetch observed /v1/lease/permit before publish.'),
      queryselector_hook_cannot_bypass_permit: pending('Hooked querySelector could observe runtime selectors but could not bypass authorization/permit.'),
      legacy_unbound_no_proof_rejected: pending('Legacy or forced unbound lease verify/renew without device_proof rejected outside compat window.'),
      admin_audit_events_present: pending('Server license_events/admin audit rows found for activation, verify, permit, migration/risk/admin actions.'),
    },
  }, null, 2);
}

function pending(note) {
  return {
    status: 'pending',
    expected: note,
    evidence: [],
  };
}

function readme() {
  return `# PubFlow Pro Manual Security Smoke

Generated at: ${new Date().toISOString()}

## Assets

- Extension A: \`${extensionA}\`
- Extension B, copied from A: \`${extensionB}\`
- Profile A: \`${profileA}\`
- Profile B clean: \`${profileB}\`
- Profile copied from A target: \`${profileCopied}\`
- Hook snippet: \`${resolve(outDir, 'hook-fetch-queryselector.js')}\`
- Server event query: \`${resolve(outDir, 'server-event-query.sql')}\`
- Evidence file: \`${resolve(outDir, 'evidence.json')}\`

## Run Order

1. Run \`launch-profile-a.sh\`, install/activate with a test activation code, then verify once and start a small publish flow.
2. Run \`launch-profile-b-clean-copied-extension.sh\`. This uses a copied extension directory but a clean Chrome profile. Expected: it must not inherit Profile A authorization.
3. Close Chrome completely. Run \`copy-profile-a-to-copied.sh\`, then run \`launch-profile-copied-from-a.sh\`. Expected: full profile copy may inherit the browser-profile private key; record this as the known browser-only identity-root limit and verify server-side event/risk signals.
4. Paste \`hook-fetch-queryselector.js\` into the extension page or target platform DevTools console before starting publish. Expected: authorization requests remain online; publish still needs \`/v1/lease/permit\`; runtime selectors may be visible, but that must not bypass permit.
5. Record screenshots, DevTools network exports, and server \`license_events\` rows in \`_doc/manual-security-test-plan.md\`.
6. Fill \`evidence.json\`, then run \`pnpm verify:manual-security\`. The checklist should only be marked complete after that command passes.

## Local Demo Seed Codes

These codes exist only when the backend is started with \`APP_SEED_DEMO=true\`.

| Email | Plan | Activation code |
| --- | --- | --- |
| creator@northlab.cn | yearly | ${demoActivationCode('creator@northlab.cn')} |
| ops@aurora.video | yearly | ${demoActivationCode('ops@aurora.video')} |
| growth@bluehour.ai | monthly | ${demoActivationCode('growth@bluehour.ai')} |
| shorts@pixelbay.cn | monthly | ${demoActivationCode('shorts@pixelbay.cn')} |

## Evidence Checklist

- [ ] Copied extension directory with clean profile did not inherit authorization.
- [ ] Copied full Chrome profile behavior documented as browser-profile key limit.
- [ ] Hooked fetch shows \`/v1/lease/permit\` before publish.
- [ ] Hooked querySelector can observe runtime selectors but cannot bypass authorization/permit.
- [ ] Server event log contains activation / verify / permit / migration or risk events for the test.

## Evidence Validation

\`\`\`bash
pnpm verify:manual-security
\`\`\`

The command fails until every required smoke item in \`.manual-security/evidence.json\` has \`"status": "pass"\` and at least one evidence note/path/log reference.

## Optional API Smoke

This does not replace the Chrome profile test, but it verifies a live backend with the same P-256 challenge/proof shape used by the extension:

\`\`\`bash
APP_SEED_DEMO=true cargo run -p app
pnpm smoke:lease-api -- --api http://127.0.0.1:5189 --code ${demoActivationCode('creator@northlab.cn')}

# If demo seed codes are stale/revoked in your local DB, explicitly generate a temporary smoke license:
pnpm smoke:lease-api -- --api http://127.0.0.1:5189 --generate-license
\`\`\`
`;
}
