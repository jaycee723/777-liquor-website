# Security Specification — 777 Inventory Operations Firestore Rules

## 1. Data Invariants & Relationship Mapping
- **Master Source of Truth**:
  - `/users/{userId}` stores private staff profiles (contains PII `email`). Read/write strictly limited to `userId == request.auth.uid` or verified admin. Self-created users may ONLY set `role: "staff"`; role escalation is blocked on both create and update.
  - `/admins/{userId}` is the trusted RBAC lookup collection. Only the bootstrapped store owner (`777liquorstorehi@gmail.com` with `email_verified == true`) or existing admins may write.
  - `/items/{itemId}` stores canonical inventory SKUs. Every document carries an immutable `ownerUid` matching `request.auth.uid` on create, strict field allowlisting (`hasAll`/`hasOnly`), bounded string/array lengths, numeric bounds (`price >= 0`, `quantity >= 0`), and server-enforced timestamps (`createdAt == request.time`, `updatedAt == request.time`).
  - `/storeState/{docId}` stores per-user operational snapshots (`analytics_summary`, `cooler_door_push`) keyed by `ownerUid` with strict schema validation and immutable ownership.
- **Verified Identity Gate**: Every write requires `request.auth != null && request.auth.token.email_verified == true`.
- **Secure List Queries**: Every `allow list` checks `resource.data.ownerUid == request.auth.uid || isAdmin()` (never blanket `isSignedIn()` and zero `get()` lookups inside list rules).

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Read or write `/items/CLV-001` with `auth == null`.
2. **Unverified Email Write**: Create `/items/CLV-001` with `auth.token.email_verified == false`.
3. **Admin Email Spoofing**: Access `/admins/attacker` using `email: "777liquorstorehi@gmail.com"` with `email_verified: false`.
4. **Cross-User PII Leak**: Read `/users/other-uid` as a non-admin signed-in staff user.
5. **Privilege Escalation on Create**: Create `/users/me` with `role: "owner"` instead of `"staff"`.
6. **Privilege Escalation on Update**: Update `/users/me` modifying `role` from `"staff"` to `"owner"`.
7. **Shadow Field Injection (Ghost Field)**: Create or update `/items/CLV-001` with extra undeclared field `isVerified: true`.
8. **ID Poisoning**: Create `/items/../../../etc/passwd` or a 200-char invalid document ID.
9. **Identity Spoofing (`ownerUid`)**: Create `/items/CLV-002` with `ownerUid: "victim-uid"` while signed in as `"attacker-uid"`.
10. **Immutable Field Tampering**: Update `/items/CLV-001` attempting to alter `ownerUid` or `createdAt`.
11. **Value & Array Poisoning**: Update `/items/CLV-001` with `price: -50`, `flags` array exceeding 5 entries, invalid flag string `"HACKED"`, or a 500-char `name`.
12. **Client Timestamp Forgery**: Create `/items/CLV-001` with a forged `createdAt` not equal to `request.time`.
