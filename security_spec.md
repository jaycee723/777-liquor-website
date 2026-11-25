# 777 Liquor Firestore Security Specification

## 1. Data Invariants

1. **Default Deny**: All unspecified paths under `/databases/{database}/documents` are denied by default.
2. **Cooler Catalog Integrity (`/coolerItems/{itemId}`)**:
   - Only verified store administrators (`isAdmin()`) may create, update, or delete items.
   - Public `get` and `list` queries are strictly constrained to documents where `resource.data.visibility == 'public'` (admins may also read `hidden` items).
   - Every document must pass `isValidCoolerItem()` enforcing strict key allowlists, string length ceilings (`name <= 140`, `brand <= 80`, `size <= 40`), valid categories (`Beer`, `RTD`, `Spirits`, `Wine`, `Beverages`), bounded positive prices (`0 < price <= 10000`), identity integrity (`updatedBy == request.auth.uid`), and server timestamp integrity (`updatedAt == request.time`).
3. **Administrator Role Isolation (`/admins/{adminUid}`)**:
   - No regular user may create, update, or delete admin records (prevents self-assigned privilege escalation).
   - Only the bootstrapped store owner (`777liquorstorehi@gmail.com` with `email_verified == true`) may manage `/admins/{adminUid}`.
   - PII (`email`) is readable only by the owner (`request.auth.uid == adminUid`) or an administrator.
4. **Keg Inquiry Privacy & State Integrity (`/kegInquiries/{inquiryId}`)**:
   - Contains customer PII (`name`, `phone`); `get` and `list` are strictly restricted to the owning user (`resource.data.userId == request.auth.uid`) or `isAdmin()`.
   - Creation requires a verified signed-in user, `userId == request.auth.uid`, initial `status == 'submitted'`, and `createdAt == request.time && updatedAt == request.time`.
   - `userId` and `createdAt` are immutable after creation.
   - Once `status == 'cancelled'` (terminal state), non-admins cannot update the inquiry.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Vector | Target Path | Adversarial Payload / Action | Expected Result |
|---|---------------|-------------|------------------------------|-----------------|
| 1 | **Unauthorized Catalog Write** | `/coolerItems/heineken-12pk` | Non-admin user tries to `create` a valid `CoolerItem` | `PERMISSION_DENIED` |
| 2 | **Shadow Field Injection** | `/coolerItems/heineken-12pk` | Admin tries to `create` item with extra ghost field `isFeatured: true` | `PERMISSION_DENIED` |
| 3 | **Email Spoofing (Unverified Admin)** | `/coolerItems/heineken-12pk` | Auth token has `email: "777liquorstorehi@gmail.com"` but `email_verified: false` | `PERMISSION_DENIED` |
| 4 | **ID Poisoning** | `/coolerItems/../../bad id!@#*200chars` | Admin tries to `create` with invalid/oversized `itemId` | `PERMISSION_DENIED` |
| 5 | **Value Poisoning (Price)** | `/coolerItems/heineken-12pk` | Admin tries to `update` `price` to `-50` or `"free"` | `PERMISSION_DENIED` |
| 6 | **Client Timestamp Forgery** | `/coolerItems/heineken-12pk` | Admin tries to `create` with backdated client `updatedAt` instead of `request.time` | `PERMISSION_DENIED` |
| 7 | **Self-Assigned Admin Escalation** | `/admins/{attackerUid}` | Signed-in customer tries to `create` their own `/admins/{uid}` document | `PERMISSION_DENIED` |
| 8 | **Admin PII Blanket Read** | `/admins/{otherAdminUid}` | Regular signed-in user tries to `get` another user's `/admins` doc | `PERMISSION_DENIED` |
| 9 | **Keg Inquiry Identity Spoofing** | `/kegInquiries/inq-1` | User A tries to `create` inquiry with `userId: "user-b"` | `PERMISSION_DENIED` |
| 10 | **Keg Inquiry PII Scraping** | `/kegInquiries` | User A tries to `list` all keg inquiries without scoping to `userId == request.auth.uid` | `PERMISSION_DENIED` |
| 11 | **State Shortcutting** | `/kegInquiries/inq-1` | User A tries to `create` inquiry directly with `status: "confirmed"` | `PERMISSION_DENIED` |
| 12 | **Terminal State Bypass & Immutability Breach** | `/kegInquiries/inq-1` | User A tries to `update` a `cancelled` inquiry back to `submitted` or alter `createdAt` | `PERMISSION_DENIED` |
