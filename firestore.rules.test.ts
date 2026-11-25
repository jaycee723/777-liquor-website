/**
 * Phase 0 Security TDD Specification & Dirty Dozen Payload Test Suite
 *
 * Verifies that all 12 adversarial payloads against 777 Liquor's Firestore
 * Security Rules (/coolerItems, /admins, /kegInquiries) are rejected with
 * PERMISSION_DENIED.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: "get" | "list" | "create" | "update" | "delete";
  path: string;
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: "PERMISSION_DENIED";
}

export const DIRTY_DOZEN_PAYLOADS: readonly DirtyDozenCase[] = [
  {
    id: 1,
    name: "Unauthorized Catalog Write by Customer",
    operation: "create",
    path: "/coolerItems/heineken-12pk",
    auth: { uid: "customer-1", email: "customer@example.com", email_verified: true },
    payload: {
      name: "Heineken Lager 12pk 12oz Bottles",
      brand: "Heineken",
      category: "Beer",
      size: "12pk 12oz",
      price: 19.99,
      visibility: "public",
      updatedBy: "customer-1",
      updatedAt: "SERVER_TIMESTAMP",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 2,
    name: "Shadow Field Injection on CoolerItem",
    operation: "create",
    path: "/coolerItems/heineken-12pk",
    auth: { uid: "admin-1", email: "777liquorstorehi@gmail.com", email_verified: true },
    payload: {
      name: "Heineken Lager 12pk 12oz Bottles",
      brand: "Heineken",
      category: "Beer",
      size: "12pk 12oz",
      price: 19.99,
      visibility: "public",
      updatedBy: "admin-1",
      updatedAt: "SERVER_TIMESTAMP",
      isFeatured: true,
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 3,
    name: "Unverified Admin Email Spoof",
    operation: "create",
    path: "/coolerItems/heineken-12pk",
    auth: { uid: "spoof-1", email: "777liquorstorehi@gmail.com", email_verified: false },
    payload: {
      name: "Heineken Lager 12pk 12oz Bottles",
      brand: "Heineken",
      category: "Beer",
      size: "12pk 12oz",
      price: 19.99,
      visibility: "public",
      updatedBy: "spoof-1",
      updatedAt: "SERVER_TIMESTAMP",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 4,
    name: "Document ID Poisoning",
    operation: "create",
    path: `/coolerItems/${"a".repeat(200)}!@#`,
    auth: { uid: "admin-1", email: "777liquorstorehi@gmail.com", email_verified: true },
    payload: {
      name: "Corona Extra 12pk 12oz",
      brand: "Corona Extra",
      category: "Beer",
      size: "12pk 12oz",
      price: 19.99,
      visibility: "public",
      updatedBy: "admin-1",
      updatedAt: "SERVER_TIMESTAMP",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 5,
    name: "Value Poisoning on Price Field",
    operation: "update",
    path: "/coolerItems/heineken-12pk",
    auth: { uid: "admin-1", email: "777liquorstorehi@gmail.com", email_verified: true },
    payload: {
      price: -10,
      updatedBy: "admin-1",
      updatedAt: "SERVER_TIMESTAMP",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 6,
    name: "Client Timestamp Forgery",
    operation: "create",
    path: "/coolerItems/heineken-12pk",
    auth: { uid: "admin-1", email: "777liquorstorehi@gmail.com", email_verified: true },
    payload: {
      name: "Heineken Lager 12pk 12oz Bottles",
      brand: "Heineken",
      category: "Beer",
      size: "12pk 12oz",
      price: 19.99,
      visibility: "public",
      updatedBy: "admin-1",
      updatedAt: "2020-01-01T00:00:00Z",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 7,
    name: "Self-Assigned Admin Role Escalation",
    operation: "create",
    path: "/admins/attacker-uid",
    auth: { uid: "attacker-uid", email: "attacker@example.com", email_verified: true },
    payload: {
      uid: "attacker-uid",
      email: "attacker@example.com",
      role: "admin",
      createdAt: "SERVER_TIMESTAMP",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 8,
    name: "Cross-User Admin PII Read",
    operation: "get",
    path: "/admins/owner-uid",
    auth: { uid: "customer-1", email: "customer@example.com", email_verified: true },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 9,
    name: "Keg Inquiry Identity Spoofing",
    operation: "create",
    path: "/kegInquiries/inq-spoof",
    auth: { uid: "user-a", email: "a@example.com", email_verified: true },
    payload: {
      userId: "user-b",
      name: "Spoof User",
      phone: "(808) 555-0199",
      brand: "Heineken",
      pickupDay: "Friday",
      notes: "",
      status: "submitted",
      createdAt: "SERVER_TIMESTAMP",
      updatedAt: "SERVER_TIMESTAMP",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 10,
    name: "Unscoped Keg Inquiry List Scraping",
    operation: "list",
    path: "/kegInquiries",
    auth: { uid: "user-a", email: "a@example.com", email_verified: true },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 11,
    name: "Keg Inquiry State Shortcutting on Create",
    operation: "create",
    path: "/kegInquiries/inq-shortcut",
    auth: { uid: "user-a", email: "a@example.com", email_verified: true },
    payload: {
      userId: "user-a",
      name: "User A",
      phone: "(808) 555-0199",
      brand: "Heineken",
      pickupDay: "Friday",
      notes: "",
      status: "confirmed",
      createdAt: "SERVER_TIMESTAMP",
      updatedAt: "SERVER_TIMESTAMP",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 12,
    name: "Terminal State Bypass & CreatedAt Tampering",
    operation: "update",
    path: "/kegInquiries/inq-cancelled",
    auth: { uid: "user-a", email: "a@example.com", email_verified: true },
    payload: {
      status: "submitted",
      createdAt: "SERVER_TIMESTAMP",
      updatedAt: "SERVER_TIMESTAMP",
    },
    expected: "PERMISSION_DENIED",
  },
];
