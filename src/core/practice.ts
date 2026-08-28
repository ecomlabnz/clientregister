/**
 * Details of the practice itself.
 *
 * These appear on documents that leave the office — quotes, and later
 * outgoing email — so they live in core rather than in one module: several
 * modules need them, and none of them owns them.
 *
 * The terms-of-engagement link is configuration rather than something retyped
 * on each quote: a practice changes its terms occasionally, and every quote
 * should then point at the current version.
 */

import type { Env } from '../types';
import { readSettings, type SettingsGroup } from './settings';

export const PRACTICE_SETTINGS: SettingsGroup = {
  id: 'practice',
  title: 'Practice',
  description: 'Who you are, as it appears on quotes and outgoing correspondence.',
  order: 10,
  settings: [
    { key: 'practice.legal_name', type: 'string', label: 'Practice name',
      default: '', maxLength: 200,
      help: 'Shown at the top of printed quotes.' },
    { key: 'practice.contact_email', type: 'string', label: 'Contact email',
      default: '', maxLength: 320,
      help: 'Where clients should reply. Shown on quotes.' },
    { key: 'practice.contact_phone', type: 'string', label: 'Contact phone',
      default: '', maxLength: 60 },
    { key: 'practice.postal_address', type: 'text', label: 'Address',
      default: '', maxLength: 300,
      help: 'Shown on quotes, one line per line.' },
    { key: 'practice.gst_number', type: 'string', label: 'GST number',
      default: '', maxLength: 20,
      help: 'Printed on every quote when set. Leave blank if the practice is not GST registered.' },
    { key: 'practice.adviser_details', type: 'text', label: 'Adviser or barrister details',
      default: '', maxLength: 500,
      help: 'Licence or admission details, as they should appear on a quote.' },
    { key: 'practice.terms_url', type: 'string', label: 'Terms of engagement — link',
      default: 'https://www.immigration.kiwi/_files/ugd/796b4b_09e26cdcd3fd4360ba5569ae15bd67d7.pdf',
      maxLength: 500,
      help: 'Referenced on every quote. Clients download the terms from here.' },
    { key: 'practice.terms_label', type: 'string', label: 'Terms of engagement — wording',
      default: 'Barrister’s Terms of Engagement', maxLength: 200,
      help: 'How the document is named on the quote.' },
  ],
};

export interface PracticeDetails {
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  postalAddress: string;
  gstNumber: string;
  adviserDetails: string;
  termsUrl: string;
  termsLabel: string;
}

export async function practiceDetails(env: Env): Promise<PracticeDetails> {
  const values = await readSettings(env, PRACTICE_SETTINGS.settings);
  return {
    legalName: values['practice.legal_name'] || env.APP_NAME || 'Client Register',
    contactEmail: values['practice.contact_email'] ?? '',
    contactPhone: values['practice.contact_phone'] ?? '',
    postalAddress: values['practice.postal_address'] ?? '',
    gstNumber: values['practice.gst_number'] ?? '',
    adviserDetails: values['practice.adviser_details'] ?? '',
    termsUrl: values['practice.terms_url'] ?? '',
    termsLabel: values['practice.terms_label'] || 'Terms of Engagement',
  };
}
