import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const DRAFT_PATH = path.resolve(process.cwd(), 'DRAFT_firestore.rules');
const BLUEPRINT_PATH = path.resolve(process.cwd(), 'firebase-blueprint.json');

function readActiveRules(): string {
  if (fs.existsSync(RULES_PATH)) return fs.readFileSync(RULES_PATH, 'utf8');
  return fs.readFileSync(DRAFT_PATH, 'utf8');
}

test('Firestore rules enforce global default-deny, rules_version 2, and all blueprint collections', () => {
  const rules = readActiveRules();
  const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8')) as {
    firestore: Record<string, unknown>;
  };

  assert.match(rules, /rules_version\s*=\s*'2';/);
  assert.match(rules, /match\s+\/\{document=\*\*\}\s*\{\s*allow read, write:\s*if false;\s*\}/);

  for (const colPath of Object.keys(blueprint.firestore)) {
    const escaped = colPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(rules, new RegExp(`match\\s+${escaped}\\s*\\{`), `Missing match block for ${colPath}`);
  }
});

test('Dirty Dozen security invariants: verified email, no privilege escalation, strict keys, immutable owner/timestamps, bounded arrays', () => {
  const rules = readActiveRules();

  // Dirty Dozen #2 & #3: email_verified required for writes and bootstrapped admin
  assert.match(rules, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(rules, /isVerified\(\)\s*&&\s*request\.auth\.token\.email\s*==\s*'777liquorstorehi@gmail\.com'/);

  // Dirty Dozen #4: PII isolated in /users/{userId}
  assert.doesNotMatch(rules, /allow\s+(read|get|list):\s*if\s+isSignedIn\(\);/);

  // Dirty Dozen #5 & #6: self-registration locked to role == 'staff', update locks role
  assert.match(rules, /incoming\(\)\.role\s*==\s*'staff'/);
  assert.match(rules, /incoming\(\)\.role\s*==\s*existing\(\)\.role/);

  // Dirty Dozen #7: Shadow field prevention via hasOnly + affectedKeys().hasOnly()
  assert.match(rules, /data\.keys\(\)\.hasAll\(/);
  assert.match(rules, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rules, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(/);

  // Dirty Dozen #8: Path ID poisoning guard
  assert.match(rules, /function isValidId\(id\)/);
  assert.match(rules, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);

  // Dirty Dozen #9 & #10: Owner & createdAt immutability
  assert.match(rules, /incoming\(\)\.ownerUid\s*==\s*request\.auth\.uid/);
  assert.match(rules, /incoming\(\)\.ownerUid\s*==\s*existing\(\)\.ownerUid/);
  assert.match(rules, /incoming\(\)\.createdAt\s*==\s*existing\(\)\.createdAt/);

  // Dirty Dozen #11: Array & string size bounds + flag allowlist
  assert.match(rules, /flags\.size\(\)\s*<=\s*5/);
  assert.match(rules, /flags\.hasOnly\(\['NO_COST',\s*'NEED_PACK_CONFIG',\s*'PRICE_DROP',\s*'REVIEW',\s*'HI5_CONFIRM'\]\)/);

  // Dirty Dozen #12: Server-enforced timestamps
  assert.match(rules, /incoming\(\)\.createdAt\s*==\s*request\.time/);
  assert.match(rules, /incoming\(\)\.updatedAt\s*==\s*request\.time/);
});
