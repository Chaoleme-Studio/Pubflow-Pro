import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    args.set(arg, process.argv[i + 1]?.startsWith('--') ? '1' : process.argv[i + 1] || '1');
    if (args.get(arg) !== '1') i += 1;
  }
}

const evidencePath = resolve(rootDir, args.get('--file') || '.manual-security/evidence.json');
const requiredChecks = [
  'profile_a_activate_verify_permit',
  'copied_extension_clean_profile_no_auth',
  'copied_storage_without_indexeddb_fails_or_recovers',
  'full_profile_copy_documented',
  'local_clock_rollback_restricted',
  'fetch_hook_shows_online_permit',
  'queryselector_hook_cannot_bypass_permit',
  'legacy_unbound_no_proof_rejected',
  'admin_audit_events_present',
];

if (!existsSync(evidencePath)) {
  console.error(`Manual security evidence file not found: ${evidencePath}`);
  console.error('Run pnpm prepare:manual-security, then fill .manual-security/evidence.json after the browser smoke.');
  process.exit(1);
}

let evidence;
try {
  evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
} catch (error) {
  console.error(`Manual security evidence is not valid JSON: ${error.message}`);
  process.exit(1);
}

const failures = [];
for (const key of requiredChecks) {
  const item = evidence.checks?.[key];
  if (!item) {
    failures.push(`${key}: missing`);
    continue;
  }
  if (item.status !== 'pass') {
    failures.push(`${key}: status must be "pass", got "${item.status || 'empty'}"`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.filter(Boolean).length === 0) {
    failures.push(`${key}: evidence must include at least one note, screenshot path, log row, or network export`);
  }
}

for (const field of ['extension_version', 'server_version', 'browser_version', 'activation_code', 'tested_at', 'tester']) {
  if (!String(evidence[field] || '').trim()) {
    failures.push(`${field}: missing`);
  }
}

if (failures.length) {
  console.error('Manual security evidence is incomplete:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Manual security evidence passed: ${evidencePath}`);
