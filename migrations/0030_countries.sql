-- Nationality becomes a country, not a sentence.
--
-- It was a text box, so "Vietnam", "Viet Nam", "VN" and "Vietnamese" were four
-- different nationalities as far as the register was concerned — and none of
-- them could be counted, filtered or trusted. It is now an ISO 3166-1 alpha-2
-- code, and the database refuses anything else.
--
-- Codes rather than names because countries rename themselves: Swaziland became
-- Eswatini, Turkey became Turkiye, Macedonia became North Macedonia. A register
-- holding codes changes one label when that happens. A register holding names
-- needs a migration and an argument about what the old records meant.
--
-- This table is generated from `src/core/countries.ts`, and
-- `test/countries.test.ts` fails if the two ever disagree. Edit the array, not
-- this file.

CREATE TABLE countries (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

INSERT INTO countries (code, name) VALUES
  ('AF', 'Afghanistan'),
  ('AX', 'Aland Islands'),
  ('AL', 'Albania'),
  ('DZ', 'Algeria'),
  ('AS', 'American Samoa'),
  ('AD', 'Andorra'),
  ('AO', 'Angola'),
  ('AI', 'Anguilla'),
  ('AQ', 'Antarctica'),
  ('AG', 'Antigua and Barbuda'),
  ('AR', 'Argentina'),
  ('AM', 'Armenia'),
  ('AW', 'Aruba'),
  ('AU', 'Australia'),
  ('AT', 'Austria'),
  ('AZ', 'Azerbaijan'),
  ('BS', 'Bahamas'),
  ('BH', 'Bahrain'),
  ('BD', 'Bangladesh'),
  ('BB', 'Barbados'),
  ('BY', 'Belarus'),
  ('BE', 'Belgium'),
  ('BZ', 'Belize'),
  ('BJ', 'Benin'),
  ('BM', 'Bermuda'),
  ('BT', 'Bhutan'),
  ('BO', 'Bolivia'),
  ('BQ', 'Bonaire, Sint Eustatius and Saba'),
  ('BA', 'Bosnia and Herzegovina'),
  ('BW', 'Botswana'),
  ('BV', 'Bouvet Island'),
  ('BR', 'Brazil'),
  ('IO', 'British Indian Ocean Territory'),
  ('VG', 'British Virgin Islands'),
  ('BN', 'Brunei'),
  ('BG', 'Bulgaria'),
  ('BF', 'Burkina Faso'),
  ('BI', 'Burundi'),
  ('KH', 'Cambodia'),
  ('CM', 'Cameroon'),
  ('CA', 'Canada'),
  ('CV', 'Cape Verde'),
  ('KY', 'Cayman Islands'),
  ('CF', 'Central African Republic'),
  ('TD', 'Chad'),
  ('CL', 'Chile'),
  ('CN', 'China'),
  ('CX', 'Christmas Island'),
  ('CC', 'Cocos (Keeling) Islands'),
  ('CO', 'Colombia'),
  ('KM', 'Comoros'),
  ('CK', 'Cook Islands'),
  ('CR', 'Costa Rica'),
  ('CI', 'Cote d''Ivoire'),
  ('HR', 'Croatia'),
  ('CU', 'Cuba'),
  ('CW', 'Curacao'),
  ('CY', 'Cyprus'),
  ('CZ', 'Czechia'),
  ('CD', 'Democratic Republic of the Congo'),
  ('DK', 'Denmark'),
  ('DJ', 'Djibouti'),
  ('DM', 'Dominica'),
  ('DO', 'Dominican Republic'),
  ('EC', 'Ecuador'),
  ('EG', 'Egypt'),
  ('SV', 'El Salvador'),
  ('GQ', 'Equatorial Guinea'),
  ('ER', 'Eritrea'),
  ('EE', 'Estonia'),
  ('SZ', 'Eswatini'),
  ('ET', 'Ethiopia'),
  ('FK', 'Falkland Islands'),
  ('FO', 'Faroe Islands'),
  ('FJ', 'Fiji'),
  ('FI', 'Finland'),
  ('FR', 'France'),
  ('GF', 'French Guiana'),
  ('PF', 'French Polynesia'),
  ('TF', 'French Southern Territories'),
  ('GA', 'Gabon'),
  ('GM', 'Gambia'),
  ('GE', 'Georgia'),
  ('DE', 'Germany'),
  ('GH', 'Ghana'),
  ('GI', 'Gibraltar'),
  ('GR', 'Greece'),
  ('GL', 'Greenland'),
  ('GD', 'Grenada'),
  ('GP', 'Guadeloupe'),
  ('GU', 'Guam'),
  ('GT', 'Guatemala'),
  ('GG', 'Guernsey'),
  ('GN', 'Guinea'),
  ('GW', 'Guinea-Bissau'),
  ('GY', 'Guyana'),
  ('HT', 'Haiti'),
  ('HM', 'Heard Island and McDonald Islands'),
  ('HN', 'Honduras'),
  ('HK', 'Hong Kong'),
  ('HU', 'Hungary'),
  ('IS', 'Iceland'),
  ('IN', 'India'),
  ('ID', 'Indonesia'),
  ('IR', 'Iran'),
  ('IQ', 'Iraq'),
  ('IE', 'Ireland'),
  ('IM', 'Isle of Man'),
  ('IL', 'Israel'),
  ('IT', 'Italy'),
  ('JM', 'Jamaica'),
  ('JP', 'Japan'),
  ('JE', 'Jersey'),
  ('JO', 'Jordan'),
  ('KZ', 'Kazakhstan'),
  ('KE', 'Kenya'),
  ('KI', 'Kiribati'),
  ('KW', 'Kuwait'),
  ('KG', 'Kyrgyzstan'),
  ('LA', 'Laos'),
  ('LV', 'Latvia'),
  ('LB', 'Lebanon'),
  ('LS', 'Lesotho'),
  ('LR', 'Liberia'),
  ('LY', 'Libya'),
  ('LI', 'Liechtenstein'),
  ('LT', 'Lithuania'),
  ('LU', 'Luxembourg'),
  ('MO', 'Macau'),
  ('MG', 'Madagascar'),
  ('MW', 'Malawi'),
  ('MY', 'Malaysia'),
  ('MV', 'Maldives'),
  ('ML', 'Mali'),
  ('MT', 'Malta'),
  ('MH', 'Marshall Islands'),
  ('MQ', 'Martinique'),
  ('MR', 'Mauritania'),
  ('MU', 'Mauritius'),
  ('YT', 'Mayotte'),
  ('MX', 'Mexico'),
  ('FM', 'Micronesia'),
  ('MD', 'Moldova'),
  ('MC', 'Monaco'),
  ('MN', 'Mongolia'),
  ('ME', 'Montenegro'),
  ('MS', 'Montserrat'),
  ('MA', 'Morocco'),
  ('MZ', 'Mozambique'),
  ('MM', 'Myanmar'),
  ('NA', 'Namibia'),
  ('NR', 'Nauru'),
  ('NP', 'Nepal'),
  ('NL', 'Netherlands'),
  ('NC', 'New Caledonia'),
  ('NZ', 'New Zealand'),
  ('NI', 'Nicaragua'),
  ('NE', 'Niger'),
  ('NG', 'Nigeria'),
  ('NU', 'Niue'),
  ('NF', 'Norfolk Island'),
  ('KP', 'North Korea'),
  ('MK', 'North Macedonia'),
  ('MP', 'Northern Mariana Islands'),
  ('NO', 'Norway'),
  ('OM', 'Oman'),
  ('PK', 'Pakistan'),
  ('PW', 'Palau'),
  ('PS', 'Palestine'),
  ('PA', 'Panama'),
  ('PG', 'Papua New Guinea'),
  ('PY', 'Paraguay'),
  ('PE', 'Peru'),
  ('PH', 'Philippines'),
  ('PN', 'Pitcairn Islands'),
  ('PL', 'Poland'),
  ('PT', 'Portugal'),
  ('PR', 'Puerto Rico'),
  ('QA', 'Qatar'),
  ('CG', 'Republic of the Congo'),
  ('RE', 'Reunion'),
  ('RO', 'Romania'),
  ('RU', 'Russia'),
  ('RW', 'Rwanda'),
  ('BL', 'Saint Barthelemy'),
  ('SH', 'Saint Helena'),
  ('KN', 'Saint Kitts and Nevis'),
  ('LC', 'Saint Lucia'),
  ('MF', 'Saint Martin'),
  ('PM', 'Saint Pierre and Miquelon'),
  ('VC', 'Saint Vincent and Grenadines'),
  ('WS', 'Samoa'),
  ('SM', 'San Marino'),
  ('ST', 'Sao Tome and Principe'),
  ('SA', 'Saudi Arabia'),
  ('SN', 'Senegal'),
  ('RS', 'Serbia'),
  ('SC', 'Seychelles'),
  ('SL', 'Sierra Leone'),
  ('SG', 'Singapore'),
  ('SX', 'Sint Maarten'),
  ('SK', 'Slovakia'),
  ('SI', 'Slovenia'),
  ('SB', 'Solomon Islands'),
  ('SO', 'Somalia'),
  ('ZA', 'South Africa'),
  ('GS', 'South Georgia and the South Sandwich Islands'),
  ('KR', 'South Korea'),
  ('SS', 'South Sudan'),
  ('ES', 'Spain'),
  ('LK', 'Sri Lanka'),
  ('SD', 'Sudan'),
  ('SR', 'Suriname'),
  ('SJ', 'Svalbard and Jan Mayen'),
  ('SE', 'Sweden'),
  ('CH', 'Switzerland'),
  ('SY', 'Syria'),
  ('TW', 'Taiwan'),
  ('TJ', 'Tajikistan'),
  ('TZ', 'Tanzania'),
  ('TH', 'Thailand'),
  ('TL', 'Timor-Leste'),
  ('TG', 'Togo'),
  ('TK', 'Tokelau'),
  ('TO', 'Tonga'),
  ('TT', 'Trinidad and Tobago'),
  ('TN', 'Tunisia'),
  ('TR', 'Turkiye'),
  ('TM', 'Turkmenistan'),
  ('TC', 'Turks and Caicos Islands'),
  ('TV', 'Tuvalu'),
  ('UG', 'Uganda'),
  ('UA', 'Ukraine'),
  ('AE', 'United Arab Emirates'),
  ('GB', 'United Kingdom'),
  ('US', 'United States'),
  ('UM', 'United States Minor Outlying Islands'),
  ('VI', 'United States Virgin Islands'),
  ('UY', 'Uruguay'),
  ('UZ', 'Uzbekistan'),
  ('VU', 'Vanuatu'),
  ('VA', 'Vatican City'),
  ('VE', 'Venezuela'),
  ('VN', 'Vietnam'),
  ('WF', 'Wallis and Futuna'),
  ('EH', 'Western Sahara'),
  ('YE', 'Yemen'),
  ('ZM', 'Zambia'),
  ('ZW', 'Zimbabwe');

-- What is already recorded, brought across.
--
-- Two passes, deliberately narrow: the country's own name, and the code itself.
-- A handful of variants that a New Zealand practice actually writes are listed
-- as well. Demonyms and looser spellings are handled in the application, where
-- they are needed for reading documents; repeating that list here would be two
-- copies of the same judgement, in a file that runs once.
UPDATE clients
   SET nationality = (SELECT c.code FROM countries c
                       WHERE lower(c.name) = lower(trim(clients.nationality)))
 WHERE nationality IS NOT NULL AND trim(nationality) <> ''
   AND EXISTS (SELECT 1 FROM countries c WHERE lower(c.name) = lower(trim(clients.nationality)));

UPDATE clients
   SET nationality = upper(trim(nationality))
 WHERE nationality IS NOT NULL
   AND EXISTS (SELECT 1 FROM countries c WHERE c.code = upper(trim(clients.nationality)));

UPDATE clients
   SET nationality = CASE lower(trim(nationality))
         WHEN 'uk' THEN 'GB' WHEN 'britain' THEN 'GB' WHEN 'great britain' THEN 'GB'
         WHEN 'england' THEN 'GB' WHEN 'scotland' THEN 'GB' WHEN 'wales' THEN 'GB'
         WHEN 'usa' THEN 'US' WHEN 'america' THEN 'US'
         WHEN 'united states of america' THEN 'US'
         WHEN 'holland' THEN 'NL' WHEN 'the netherlands' THEN 'NL'
         WHEN 'viet nam' THEN 'VN' WHEN 'burma' THEN 'MM'
         WHEN 'ivory coast' THEN 'CI' WHEN 'czech republic' THEN 'CZ'
         WHEN 'swaziland' THEN 'SZ' WHEN 'east timor' THEN 'TL'
         WHEN 'cape verde' THEN 'CV' WHEN 'macedonia' THEN 'MK'
         WHEN 'turkey' THEN 'TR' WHEN 'korea' THEN 'KR'
         WHEN 'russian federation' THEN 'RU' WHEN 'the philippines' THEN 'PH'
         WHEN 'uae' THEN 'AE' WHEN 'the gambia' THEN 'GM'
         ELSE nationality END
 WHERE nationality IS NOT NULL;

-- Anything still unmatched is kept, not discarded. It goes into the file notes
-- where a person will see it and can choose the right country; the column is
-- cleared so it holds only codes. Never trade a record for a tidy column.
UPDATE clients
   SET notes = COALESCE(notes || char(10), '')
               || 'Nationality was recorded as "' || trim(nationality)
               || '", which is not a country this register knows. Please set it.',
       nationality = NULL
 WHERE nationality IS NOT NULL AND trim(nationality) <> ''
   AND NOT EXISTS (SELECT 1 FROM countries c WHERE c.code = clients.nationality);

UPDATE clients SET nationality = NULL WHERE trim(COALESCE(nationality, '')) = '';

-- From here the column holds a code or nothing. A guarantee in the route that
-- happens to write the row lasts until somebody adds a second route.
CREATE TRIGGER clients_nationality_is_a_country_insert
AFTER INSERT ON clients
WHEN NEW.nationality IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.nationality)
BEGIN
  SELECT RAISE(ABORT, 'nationality must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER clients_nationality_is_a_country_update
AFTER UPDATE OF nationality ON clients
WHEN NEW.nationality IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.nationality)
BEGIN
  SELECT RAISE(ABORT, 'nationality must be an ISO 3166-1 alpha-2 country code');
END;
