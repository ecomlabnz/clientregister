/**
 * Countries, as ISO 3166-1 alpha-2.
 *
 * Nationality used to be a text box, which meant "Vietnam", "Viet Nam", "VN" and
 * "Vietnamese" were four different nationalities as far as the register was
 * concerned. It is now a code from this list, and the database refuses one that
 * is not — see `migrations/0030_countries.sql`, which is generated from exactly
 * this array and is checked against it by `test/countries.test.ts`.
 *
 * The names are the runtime's own CLDR names rather than hand-typed ones, with a
 * short list of corrections where CLDR writes something an adviser would not:
 * "Hong Kong SAR China" is "Hong Kong" on a form, "Myanmar (Burma)" is
 * "Myanmar", and the two Congos are named rather than distinguished by their
 * capital cities. Ampersands are spelled out and diacritics dropped, for the
 * same reason client names are: these are copied into INZ forms.
 *
 * Codes, not names, are stored. A country renames itself every few years —
 * Swaziland to Eswatini, Turkey to Turkiye, Macedonia to North Macedonia — and
 * when it does, a register holding codes needs one line changed here and a
 * register holding names needs a migration and an argument about history.
 */

export interface Country {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
}

/** The officially assigned alpha-2 codes, in alphabetical order by name. */
export const COUNTRIES: Country[] = ([
  ['AF', "Afghanistan"],
  ['AX', "Aland Islands"],
  ['AL', "Albania"],
  ['DZ', "Algeria"],
  ['AS', "American Samoa"],
  ['AD', "Andorra"],
  ['AO', "Angola"],
  ['AI', "Anguilla"],
  ['AQ', "Antarctica"],
  ['AG', "Antigua and Barbuda"],
  ['AR', "Argentina"],
  ['AM', "Armenia"],
  ['AW', "Aruba"],
  ['AU', "Australia"],
  ['AT', "Austria"],
  ['AZ', "Azerbaijan"],
  ['BS', "Bahamas"],
  ['BH', "Bahrain"],
  ['BD', "Bangladesh"],
  ['BB', "Barbados"],
  ['BY', "Belarus"],
  ['BE', "Belgium"],
  ['BZ', "Belize"],
  ['BJ', "Benin"],
  ['BM', "Bermuda"],
  ['BT', "Bhutan"],
  ['BO', "Bolivia"],
  ['BQ', "Bonaire, Sint Eustatius and Saba"],
  ['BA', "Bosnia and Herzegovina"],
  ['BW', "Botswana"],
  ['BV', "Bouvet Island"],
  ['BR', "Brazil"],
  ['IO', "British Indian Ocean Territory"],
  ['VG', "British Virgin Islands"],
  ['BN', "Brunei"],
  ['BG', "Bulgaria"],
  ['BF', "Burkina Faso"],
  ['BI', "Burundi"],
  ['KH', "Cambodia"],
  ['CM', "Cameroon"],
  ['CA', "Canada"],
  ['CV', "Cape Verde"],
  ['KY', "Cayman Islands"],
  ['CF', "Central African Republic"],
  ['TD', "Chad"],
  ['CL', "Chile"],
  ['CN', "China"],
  ['CX', "Christmas Island"],
  ['CC', "Cocos (Keeling) Islands"],
  ['CO', "Colombia"],
  ['KM', "Comoros"],
  ['CK', "Cook Islands"],
  ['CR', "Costa Rica"],
  ['CI', "Cote d'Ivoire"],
  ['HR', "Croatia"],
  ['CU', "Cuba"],
  ['CW', "Curacao"],
  ['CY', "Cyprus"],
  ['CZ', "Czechia"],
  ['CD', "Democratic Republic of the Congo"],
  ['DK', "Denmark"],
  ['DJ', "Djibouti"],
  ['DM', "Dominica"],
  ['DO', "Dominican Republic"],
  ['EC', "Ecuador"],
  ['EG', "Egypt"],
  ['SV', "El Salvador"],
  ['GQ', "Equatorial Guinea"],
  ['ER', "Eritrea"],
  ['EE', "Estonia"],
  ['SZ', "Eswatini"],
  ['ET', "Ethiopia"],
  ['FK', "Falkland Islands"],
  ['FO', "Faroe Islands"],
  ['FJ', "Fiji"],
  ['FI', "Finland"],
  ['FR', "France"],
  ['GF', "French Guiana"],
  ['PF', "French Polynesia"],
  ['TF', "French Southern Territories"],
  ['GA', "Gabon"],
  ['GM', "Gambia"],
  ['GE', "Georgia"],
  ['DE', "Germany"],
  ['GH', "Ghana"],
  ['GI', "Gibraltar"],
  ['GR', "Greece"],
  ['GL', "Greenland"],
  ['GD', "Grenada"],
  ['GP', "Guadeloupe"],
  ['GU', "Guam"],
  ['GT', "Guatemala"],
  ['GG', "Guernsey"],
  ['GN', "Guinea"],
  ['GW', "Guinea-Bissau"],
  ['GY', "Guyana"],
  ['HT', "Haiti"],
  ['HM', "Heard Island and McDonald Islands"],
  ['HN', "Honduras"],
  ['HK', "Hong Kong"],
  ['HU', "Hungary"],
  ['IS', "Iceland"],
  ['IN', "India"],
  ['ID', "Indonesia"],
  ['IR', "Iran"],
  ['IQ', "Iraq"],
  ['IE', "Ireland"],
  ['IM', "Isle of Man"],
  ['IL', "Israel"],
  ['IT', "Italy"],
  ['JM', "Jamaica"],
  ['JP', "Japan"],
  ['JE', "Jersey"],
  ['JO', "Jordan"],
  ['KZ', "Kazakhstan"],
  ['KE', "Kenya"],
  ['KI', "Kiribati"],
  ['KW', "Kuwait"],
  ['KG', "Kyrgyzstan"],
  ['LA', "Laos"],
  ['LV', "Latvia"],
  ['LB', "Lebanon"],
  ['LS', "Lesotho"],
  ['LR', "Liberia"],
  ['LY', "Libya"],
  ['LI', "Liechtenstein"],
  ['LT', "Lithuania"],
  ['LU', "Luxembourg"],
  ['MO', "Macau"],
  ['MG', "Madagascar"],
  ['MW', "Malawi"],
  ['MY', "Malaysia"],
  ['MV', "Maldives"],
  ['ML', "Mali"],
  ['MT', "Malta"],
  ['MH', "Marshall Islands"],
  ['MQ', "Martinique"],
  ['MR', "Mauritania"],
  ['MU', "Mauritius"],
  ['YT', "Mayotte"],
  ['MX', "Mexico"],
  ['FM', "Micronesia"],
  ['MD', "Moldova"],
  ['MC', "Monaco"],
  ['MN', "Mongolia"],
  ['ME', "Montenegro"],
  ['MS', "Montserrat"],
  ['MA', "Morocco"],
  ['MZ', "Mozambique"],
  ['MM', "Myanmar"],
  ['NA', "Namibia"],
  ['NR', "Nauru"],
  ['NP', "Nepal"],
  ['NL', "Netherlands"],
  ['NC', "New Caledonia"],
  ['NZ', "New Zealand"],
  ['NI', "Nicaragua"],
  ['NE', "Niger"],
  ['NG', "Nigeria"],
  ['NU', "Niue"],
  ['NF', "Norfolk Island"],
  ['KP', "North Korea"],
  ['MK', "North Macedonia"],
  ['MP', "Northern Mariana Islands"],
  ['NO', "Norway"],
  ['OM', "Oman"],
  ['PK', "Pakistan"],
  ['PW', "Palau"],
  ['PS', "Palestine"],
  ['PA', "Panama"],
  ['PG', "Papua New Guinea"],
  ['PY', "Paraguay"],
  ['PE', "Peru"],
  ['PH', "Philippines"],
  ['PN', "Pitcairn Islands"],
  ['PL', "Poland"],
  ['PT', "Portugal"],
  ['PR', "Puerto Rico"],
  ['QA', "Qatar"],
  ['CG', "Republic of the Congo"],
  ['RE', "Reunion"],
  ['RO', "Romania"],
  ['RU', "Russia"],
  ['RW', "Rwanda"],
  ['BL', "Saint Barthelemy"],
  ['SH', "Saint Helena"],
  ['KN', "Saint Kitts and Nevis"],
  ['LC', "Saint Lucia"],
  ['MF', "Saint Martin"],
  ['PM', "Saint Pierre and Miquelon"],
  ['VC', "Saint Vincent and Grenadines"],
  ['WS', "Samoa"],
  ['SM', "San Marino"],
  ['ST', "Sao Tome and Principe"],
  ['SA', "Saudi Arabia"],
  ['SN', "Senegal"],
  ['RS', "Serbia"],
  ['SC', "Seychelles"],
  ['SL', "Sierra Leone"],
  ['SG', "Singapore"],
  ['SX', "Sint Maarten"],
  ['SK', "Slovakia"],
  ['SI', "Slovenia"],
  ['SB', "Solomon Islands"],
  ['SO', "Somalia"],
  ['ZA', "South Africa"],
  ['GS', "South Georgia and the South Sandwich Islands"],
  ['KR', "South Korea"],
  ['SS', "South Sudan"],
  ['ES', "Spain"],
  ['LK', "Sri Lanka"],
  ['SD', "Sudan"],
  ['SR', "Suriname"],
  ['SJ', "Svalbard and Jan Mayen"],
  ['SE', "Sweden"],
  ['CH', "Switzerland"],
  ['SY', "Syria"],
  ['TW', "Taiwan"],
  ['TJ', "Tajikistan"],
  ['TZ', "Tanzania"],
  ['TH', "Thailand"],
  ['TL', "Timor-Leste"],
  ['TG', "Togo"],
  ['TK', "Tokelau"],
  ['TO', "Tonga"],
  ['TT', "Trinidad and Tobago"],
  ['TN', "Tunisia"],
  ['TR', "Turkiye"],
  ['TM', "Turkmenistan"],
  ['TC', "Turks and Caicos Islands"],
  ['TV', "Tuvalu"],
  ['UG', "Uganda"],
  ['UA', "Ukraine"],
  ['AE', "United Arab Emirates"],
  ['GB', "United Kingdom"],
  ['US', "United States"],
  ['UM', "United States Minor Outlying Islands"],
  ['VI', "United States Virgin Islands"],
  ['UY', "Uruguay"],
  ['UZ', "Uzbekistan"],
  ['VU', "Vanuatu"],
  ['VA', "Vatican City"],
  ['VE', "Venezuela"],
  ['VN', "Vietnam"],
  ['WF', "Wallis and Futuna"],
  ['EH', "Western Sahara"],
  ['YE', "Yemen"],
  ['ZM', "Zambia"],
  ['ZW', "Zimbabwe"],
] as Array<[string, string]>).map(([code, name]) => ({ code, name }));

export const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.name]),
);

/** The name for a stored code, or the code itself if it is not one of ours. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  return COUNTRY_NAMES[code] ?? code;
}

/** Options for a select, ready to hand to `select()`. */
export function countryOptions(): Array<{ value: string; label: string }> {
  return COUNTRIES.map((c) => ({ value: c.code, label: c.name }));
}

/**
 * Alternatives people and models actually write.
 *
 * Not an attempt at every demonym in the world — that list would be wrong in
 * ways nobody would notice. It covers the two cases that matter here: the names
 * this practice's caseload arrives under, and the variants that are common
 * everywhere ("UK", "USA", "Holland", "Burma"). Anything not matched resolves to
 * nothing, and the person picks from the list — which is the right failure.
 *
 * Used when reading a nationality out of a document or a model's answer. It is
 * never used to store a value that a person typed into the form: the form is a
 * dropdown, so there is nothing to guess at.
 */
const ALIASES: Record<string, string> = {
  // Variants and older names.
  uk: 'GB', 'u.k.': 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB',
  scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  usa: 'US', 'u.s.a.': 'US', 'u.s.': 'US', america: 'US',
  'united states of america': 'US',
  holland: 'NL', 'the netherlands': 'NL',
  burma: 'MM', 'viet nam': 'VN', 'ivory coast': 'CI',
  'czech republic': 'CZ', czechia: 'CZ',
  swaziland: 'SZ', 'east timor': 'TL', 'cape verde': 'CV',
  macedonia: 'MK', turkey: 'TR', 'republic of korea': 'KR', korea: 'KR',
  'south korea': 'KR', 'north korea': 'KP',
  'russian federation': 'RU', 'the philippines': 'PH',
  uae: 'AE', 'u.a.e.': 'AE', emirates: 'AE',
  'hong kong sar': 'HK', prc: 'CN', 'peoples republic of china': 'CN',
  "people's republic of china": 'CN', 'mainland china': 'CN',
  drc: 'CD', 'congo-kinshasa': 'CD', 'congo-brazzaville': 'CG',
  'vatican': 'VA', 'holy see': 'VA', 'palestinian territories': 'PS',

  // Demonyms, for the nationalities this practice sees.
  afghan: 'AF', american: 'US', argentine: 'AR', argentinian: 'AR',
  australian: 'AU', bangladeshi: 'BD', brazilian: 'BR', british: 'GB',
  cambodian: 'KH', canadian: 'CA', chilean: 'CL', chinese: 'CN',
  colombian: 'CO', dutch: 'NL', egyptian: 'EG', emirati: 'AE',
  ethiopian: 'ET', fijian: 'FJ', filipino: 'PH', filipina: 'PH',
  french: 'FR', german: 'DE', ghanaian: 'GH', indian: 'IN',
  indonesian: 'ID', iranian: 'IR', iraqi: 'IQ', irish: 'IE',
  israeli: 'IL', italian: 'IT', japanese: 'JP', jordanian: 'JO',
  kenyan: 'KE', korean: 'KR', lebanese: 'LB', malaysian: 'MY',
  nepalese: 'NP', nepali: 'NP', 'new zealander': 'NZ', nigerian: 'NG',
  pakistani: 'PK', peruvian: 'PE', philippine: 'PH', polish: 'PL',
  portuguese: 'PT', russian: 'RU', samoan: 'WS', saudi: 'SA',
  'south african': 'ZA', spanish: 'ES', 'sri lankan': 'LK', syrian: 'SY',
  thai: 'TH', tongan: 'TO', turkish: 'TR', ukrainian: 'UA',
  vietnamese: 'VN', zimbabwean: 'ZW',
};

const BY_NAME: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.name.toLowerCase(), c.code]),
);

/**
 * A code for whatever somebody wrote, or null.
 *
 * Null is a real answer: better an empty field a person fills in than a
 * confident guess at somebody's nationality.
 */
export function countryCodeFor(text: string | null | undefined): string | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (COUNTRY_NAMES[upper]) return upper;

  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  return BY_NAME[key] ?? ALIASES[key] ?? null;
}
