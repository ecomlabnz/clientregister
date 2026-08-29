import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { composeFullName, familyNameFor, plainAscii, splitFullName } from '../src/core/names';

/**
 * Converting an inquiry creates a client, so it must create the same kind of
 * client the client form does.
 *
 * It used to ask for one box called "name" and assume everybody was a person.
 * That produced clients written unlike every other client — "Nguyễn Văn An"
 * rather than "Van An NGUYEN" — and turned a company inquiry into an
 * individual named after the company. Neither is a display problem: the
 * register sorts, searches and exports on those columns.
 *
 * The rule this pins is that the conversion asks for the client form's fields,
 * by the client form's names, and derives what it stores through the same
 * helpers. When a field is added to one, this test is where the other is
 * remembered.
 */

const convert = readFileSync('src/modules/inquiries/index.ts', 'utf8');
const clientForm = readFileSync('src/modules/clients/index.ts', 'utf8');
const js = readFileSync('public/app.js', 'utf8');

describe('the conversion form asks what the client form asks', () => {
  it('splits the name into given names and a family name', () => {
    expect(convert).toContain("name: 'given_names'");
    expect(convert).toContain("name: 'family_name'");
  });

  it('no longer offers a single name box', () => {
    // The field it replaced. Named here so reintroducing it fails loudly.
    expect(convert).not.toContain('new_client_name');
  });

  it('asks which kind of record this is, rather than assuming a person', () => {
    expect(convert).toContain("name: 'kind'");
    expect(convert).toContain("value: 'organisation', label: 'Company or organisation'");
    // The one that made a company into a person named after itself.
    expect(convert).not.toContain("VALUES (?,?,'individual'");
  });

  it('offers an organisation its registered name and nothing else', () => {
    expect(convert).toContain("name: 'organisation_name'");
    const organisation = convert.slice(convert.indexOf('<div data-kind="organisation"'));
    expect(organisation.slice(0, 400)).not.toContain("name: 'given_names'");
  });

  it('takes nationality from the country list, as the client form does', () => {
    expect(convert).toContain('options: countryOptions()');
    expect(clientForm).toContain('options: countryOptions()');
  });
});

describe('the conversion stores what it read the way the client form does', () => {
  for (const helper of ['composeFullName', 'familyNameFor', 'plainAscii']) {
    it(`derives the name through ${helper}`, () => {
      expect(convert).toContain(helper);
      expect(clientForm).toContain(helper);
    });
  }

  it('resolves nationality to a code rather than trusting the form', () => {
    // The column is guarded by a trigger. A request built by hand carrying
    // "Vietnam" should land as VN, not as a 500.
    expect(convert).toContain('countryCodeFor(');
  });

  it('never writes a matter with no owner', () => {
    // The database refuses one, so a form offering the choice would fail on
    // submit rather than at the point the choice was made. An inquiry itself
    // may still be unassigned — it is not work until it is converted — so this
    // looks only at the conversion.
    const assign = convert.slice(convert.indexOf("label: 'Assign to'"));
    expect(assign.slice(0, 200)).toContain('includeBlank: false');
    expect(convert).toContain('isAssignable(');
    const route = convert.slice(convert.indexOf("r.post('/:id/convert'"));
    expect(route).not.toContain('assignedTo || null');
  });
});

describe('the two halves of the new-client block', () => {
  it('are hidden by the server as well as by the script', () => {
    // With scripting blocked nothing on this page runs, and the registered
    // name would otherwise sit under an individual's family name.
    expect(convert).toContain(`<div data-kind="organisation" \${raw('hidden')}>`);
  });

  it('are kept up to date by a handler that does not need tabs', () => {
    // The client form's toggle lives inside its tab rendering. This form has
    // no tabs, so it would never have switched.
    expect(js).toContain("document.querySelectorAll('.js-kind')");
    expect(js).toContain("el.getAttribute('data-kind') !== kindSelect.value");
    expect(convert).toContain('js-kind');
  });
});

describe('a name arriving from a chat message', () => {
  // What the conversion actually does with what it is given, exercised
  // directly rather than described.
  const asStored = (contactName: string) => {
    const split = splitFullName(contactName);
    const given = plainAscii(split.givenNames);
    const family = familyNameFor(split.familyName);
    return composeFullName('individual', { givenNames: given, familyName: family });
  };

  it('is stored the way the register stores every other name', () => {
    expect(asStored('Nguyễn Văn An')).toBe('Nguyen Van AN');
    expect(asStored('thi thu thuy truong')).toBe('thi thu thuy TRUONG');
  });

  it('reads "Family, Given" the way it is written', () => {
    expect(asStored('TRUONG, Thi Thu Thuy')).toBe('Thi Thu Thuy TRUONG');
  });

  it('treats a single word as the family name, so the list can be sorted', () => {
    expect(asStored('Ravi')).toBe('RAVI');
  });

  it('leaves an organisation named by its registered name alone', () => {
    expect(composeFullName('organisation', { givenNames: '', familyName: '' }, 'Kiwi Orchards Ltd'))
      .toBe('Kiwi Orchards Ltd');
  });
});
