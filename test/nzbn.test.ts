import { describe, expect, it } from 'vitest';
import { isValidNzbnFormat, normaliseNzbn, toEntity, toEntityList } from '../src/integrations/nzbn';

describe('NZBN format', () => {
  it('accepts a 13-digit number, with or without spacing', () => {
    expect(isValidNzbnFormat('9429041234567')).toBe(true);
    expect(isValidNzbnFormat('9429 0412 34567')).toBe(true);
    expect(normaliseNzbn('9429 0412 34567')).toBe('9429041234567');
  });

  it('rejects the wrong length or non-digits', () => {
    expect(isValidNzbnFormat('942904123456')).toBe(false);
    expect(isValidNzbnFormat('94290412345678')).toBe(false);
    expect(isValidNzbnFormat('9429O41234567')).toBe(false);
    expect(isValidNzbnFormat('')).toBe(false);
  });
});

describe('mapping a register record', () => {
  // The register's payloads are treated as loosely-shaped: field names vary by
  // entity type, so the reader has to cope rather than assume one schema.
  const full = {
    nzbn: '9429041234567',
    entityName: 'Kiwi Orchards Limited',
    entityTypeDescription: 'NZ Limited Company',
    entityStatusDescription: 'Registered',
    registrationDate: '2011-04-05',
    sourceRegisterUniqueIdentifier: '1234567',
    addresses: { addressList: [{ fullAddress: '12 Queen Street, Auckland 1010' }] },
    contacts: [
      { contactType: 'EMAIL', contactValue: 'accounts@kiwiorchards.example' },
      { contactType: 'PHONE', contactValue: '+64 9 555 0100' },
    ],
  };

  it('reads the fields the register stores', () => {
    const entity = toEntity(full)!;
    expect(entity.nzbn).toBe('9429041234567');
    expect(entity.name).toBe('Kiwi Orchards Limited');
    expect(entity.companyNumber).toBe('1234567');
    expect(entity.entityType).toBe('NZ Limited Company');
    expect(entity.entityStatus).toBe('Registered');
    expect(entity.address).toBe('12 Queen Street, Auckland 1010');
    expect(entity.emailAddress).toBe('accounts@kiwiorchards.example');
    expect(entity.phoneNumber).toBe('+64 9 555 0100');
  });

  it('copes with the alternative field names and a flat address list', () => {
    const entity = toEntity({
      NZBN: '9429041234567',
      name: 'Southern Vineyards Limited',
      entityIdentifiers: [{ uniqueIdentifierType: 'COMPANY_NUMBER', uniqueIdentifier: '7654321' }],
      entityAddresses: [{ address1: '5 Vine Road, Blenheim' }],
      entityContacts: [{ type: 'EMAIL_ADDRESS', value: 'hello@vineyards.example' }],
    })!;
    expect(entity.name).toBe('Southern Vineyards Limited');
    expect(entity.companyNumber).toBe('7654321');
    expect(entity.address).toBe('5 Vine Road, Blenheim');
    expect(entity.emailAddress).toBe('hello@vineyards.example');
  });

  it('returns nulls rather than inventing values for a sparse record', () => {
    const entity = toEntity({ nzbn: '9429041234567', entityName: 'Sole Trader' })!;
    expect(entity.companyNumber).toBeNull();
    expect(entity.address).toBeNull();
    expect(entity.emailAddress).toBeNull();
    expect(entity.entityStatus).toBeNull();
  });

  it('refuses a record with no NZBN or no name', () => {
    expect(toEntity({ entityName: 'Nameless' })).toBeNull();
    expect(toEntity({ nzbn: '9429041234567' })).toBeNull();
    expect(toEntity(null)).toBeNull();
    expect(toEntity('a string')).toBeNull();
  });
});

describe('mapping a search response', () => {
  const entity = { nzbn: '9429041234567', entityName: 'Kiwi Orchards Limited' };

  it('finds the list whichever envelope the API used', () => {
    expect(toEntityList({ items: [entity] })).toHaveLength(1);
    expect(toEntityList({ entityList: [entity] })).toHaveLength(1);
    expect(toEntityList({ results: [entity] })).toHaveLength(1);
    expect(toEntityList([entity])).toHaveLength(1);
  });

  it('accepts a single entity returned on its own', () => {
    expect(toEntityList(entity)).toHaveLength(1);
  });

  it('drops unusable records instead of failing the whole search', () => {
    const list = toEntityList({ items: [entity, { entityName: 'no nzbn' }, null, 'nonsense'] });
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Kiwi Orchards Limited');
  });

  it('returns nothing for an empty or unrecognised response', () => {
    expect(toEntityList({})).toEqual([]);
    expect(toEntityList({ items: [] })).toEqual([]);
    expect(toEntityList(null)).toEqual([]);
  });
});
