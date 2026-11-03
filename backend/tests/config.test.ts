import { describe, it, expect } from 'vitest';

// config lee el entorno al importarse: DATABASE_URL y JWT_SECRET son obligatorias.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test';
process.env.JWT_SECRET ??= 'secreto-de-test';
const { parseTrustProxy } = await import('../src/config');

describe('parseTrustProxy (TRUST_PROXY)', () => {
  it('sin definir, vacío, false o 0 → no confía en el proxy', () => {
    for (const v of [undefined, '', '  ', 'false', 'FALSE', '0']) expect(parseTrustProxy(v)).toBe(false);
  });

  it('true → true; un número → cantidad de saltos', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy(' 1 ')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('una lista de IPs/subredes pasa tal cual a Express', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});
