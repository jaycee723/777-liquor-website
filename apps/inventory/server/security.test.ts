import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateIpAddress,
  parseAndValidateExternalUrl,
  sanitizeText,
  sanitizeUpc,
} from './security';

test('isPrivateIpAddress blocks loopback, RFC1918, metadata, and IPv6 private ranges', () => {
  assert.equal(isPrivateIpAddress('127.0.0.1'), true);
  assert.equal(isPrivateIpAddress('10.0.0.5'), true);
  assert.equal(isPrivateIpAddress('172.16.0.1'), true);
  assert.equal(isPrivateIpAddress('192.168.1.10'), true);
  assert.equal(isPrivateIpAddress('169.254.169.254'), true);
  assert.equal(isPrivateIpAddress('::1'), true);
  assert.equal(isPrivateIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIpAddress('fe80::1'), true);

  assert.equal(isPrivateIpAddress('8.8.8.8'), false);
  assert.equal(isPrivateIpAddress('1.1.1.1'), false);
  assert.equal(isPrivateIpAddress('2606:4700:4700::1111'), false);
});

test('parseAndValidateExternalUrl allows public HTTPS URLs and blocks unsafe schemes and local hosts', () => {
  const valid = parseAndValidateExternalUrl('https://world.openfoodfacts.org/api/v2/product/079603011001.json');
  assert.equal(valid.ok, true);

  assert.equal(parseAndValidateExternalUrl('http://example.com/logo.png').ok, false);
  assert.equal(parseAndValidateExternalUrl('javascript:alert(1)').ok, false);
  assert.equal(parseAndValidateExternalUrl('file:///etc/passwd').ok, false);
  assert.equal(parseAndValidateExternalUrl('https://localhost:3000/api').ok, false);
  assert.equal(parseAndValidateExternalUrl('https://169.254.169.254/latest/meta-data').ok, false);
  assert.equal(parseAndValidateExternalUrl('https://user:pass@example.com/img.png').ok, false);
  assert.equal(parseAndValidateExternalUrl('https://service.internal/secret').ok, false);
});

test('sanitizeUpc and sanitizeText normalize inputs safely', () => {
  assert.equal(sanitizeUpc('79603-011001'), '079603011001');
  assert.equal(sanitizeUpc('079603011001'), '079603011001');
  assert.equal(sanitizeText('  Kona\nBig\tWave  ', 12), 'Kona Big Wav');
});
