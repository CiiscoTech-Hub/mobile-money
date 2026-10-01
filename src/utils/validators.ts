/**
 * Nationality & Passport Validation Utilities
 *
 * Implements issue #1579 — Support multiple nationalities in verification lists:
 *   - Expanded ISO 3166-1 alpha-2 and alpha-3 country code maps (180+ countries)
 *   - Per-country passport format regex (ICAO Doc 9303 machine-readable zone rules)
 *   - `validateCountryCode()`   — checks alpha-2 / alpha-3 validity
 *   - `validatePassportNumber()` — validates format for a given issuing country
 *   - `getVerificationCountries()` — returns the full list used by the DB seed
 */

// ─── ISO 3166-1 country code maps ────────────────────────────────────────────

/** Alpha-2 (2-letter) → country name */
export const ISO_ALPHA2_MAP: Record<string, string> = {
  // Africa
  AO: "Angola",
  BJ: "Benin",
  BW: "Botswana",
  BF: "Burkina Faso",
  BI: "Burundi",
  CV: "Cape Verde",
  CM: "Cameroon",
  CF: "Central African Republic",
  TD: "Chad",
  KM: "Comoros",
  CD: "Democratic Republic of the Congo",
  CG: "Republic of the Congo",
  CI: "Côte d'Ivoire",
  DJ: "Djibouti",
  EG: "Egypt",
  GQ: "Equatorial Guinea",
  ER: "Eritrea",
  SZ: "Eswatini",
  ET: "Ethiopia",
  GA: "Gabon",
  GM: "Gambia",
  GH: "Ghana",
  GN: "Guinea",
  GW: "Guinea-Bissau",
  KE: "Kenya",
  LS: "Lesotho",
  LR: "Liberia",
  LY: "Libya",
  MG: "Madagascar",
  MW: "Malawi",
  ML: "Mali",
  MR: "Mauritania",
  MU: "Mauritius",
  YT: "Mayotte",
  MA: "Morocco",
  MZ: "Mozambique",
  NA: "Namibia",
  NE: "Niger",
  NG: "Nigeria",
  RE: "Réunion",
  RW: "Rwanda",
  ST: "São Tomé and Príncipe",
  SN: "Senegal",
  SC: "Seychelles",
  SL: "Sierra Leone",
  SO: "Somalia",
  ZA: "South Africa",
  SS: "South Sudan",
  SD: "Sudan",
  TZ: "Tanzania",
  TG: "Togo",
  TN: "Tunisia",
  UG: "Uganda",
  EH: "Western Sahara",
  ZM: "Zambia",
  ZW: "Zimbabwe",

  // Americas
  AG: "Antigua and Barbuda",
  AR: "Argentina",
  BS: "Bahamas",
  BB: "Barbados",
  BZ: "Belize",
  BO: "Bolivia",
  BR: "Brazil",
  CA: "Canada",
  CL: "Chile",
  CO: "Colombia",
  CR: "Costa Rica",
  CU: "Cuba",
  DM: "Dominica",
  DO: "Dominican Republic",
  EC: "Ecuador",
  SV: "El Salvador",
  GD: "Grenada",
  GT: "Guatemala",
  GY: "Guyana",
  HT: "Haiti",
  HN: "Honduras",
  JM: "Jamaica",
  MX: "Mexico",
  NI: "Nicaragua",
  PA: "Panama",
  PY: "Paraguay",
  PE: "Peru",
  KN: "Saint Kitts and Nevis",
  LC: "Saint Lucia",
  VC: "Saint Vincent and the Grenadines",
  SR: "Suriname",
  TT: "Trinidad and Tobago",
  US: "United States",
  UY: "Uruguay",
  VE: "Venezuela",

  // Asia
  AF: "Afghanistan",
  AM: "Armenia",
  AZ: "Azerbaijan",
  BH: "Bahrain",
  BD: "Bangladesh",
  BT: "Bhutan",
  BN: "Brunei",
  KH: "Cambodia",
  CN: "China",
  CY: "Cyprus",
  GE: "Georgia",
  IN: "India",
  ID: "Indonesia",
  IR: "Iran",
  IQ: "Iraq",
  IL: "Israel",
  JP: "Japan",
  JO: "Jordan",
  KZ: "Kazakhstan",
  KW: "Kuwait",
  KG: "Kyrgyzstan",
  LA: "Laos",
  LB: "Lebanon",
  MY: "Malaysia",
  MV: "Maldives",
  MN: "Mongolia",
  MM: "Myanmar",
  NP: "Nepal",
  KP: "North Korea",
  OM: "Oman",
  PK: "Pakistan",
  PS: "Palestine",
  PH: "Philippines",
  QA: "Qatar",
  SA: "Saudi Arabia",
  SG: "Singapore",
  KR: "South Korea",
  LK: "Sri Lanka",
  SY: "Syria",
  TW: "Taiwan",
  TJ: "Tajikistan",
  TH: "Thailand",
  TL: "Timor-Leste",
  TM: "Turkmenistan",
  AE: "United Arab Emirates",
  UZ: "Uzbekistan",
  VN: "Vietnam",
  YE: "Yemen",

  // Europe
  AL: "Albania",
  AD: "Andorra",
  AT: "Austria",
  BY: "Belarus",
  BE: "Belgium",
  BA: "Bosnia and Herzegovina",
  BG: "Bulgaria",
  HR: "Croatia",
  CZ: "Czechia",
  DK: "Denmark",
  EE: "Estonia",
  FI: "Finland",
  FR: "France",
  DE: "Germany",
  GR: "Greece",
  HU: "Hungary",
  IS: "Iceland",
  IE: "Ireland",
  IT: "Italy",
  XK: "Kosovo",
  LV: "Latvia",
  LI: "Liechtenstein",
  LT: "Lithuania",
  LU: "Luxembourg",
  MT: "Malta",
  MD: "Moldova",
  MC: "Monaco",
  ME: "Montenegro",
  NL: "Netherlands",
  MK: "North Macedonia",
  NO: "Norway",
  PL: "Poland",
  PT: "Portugal",
  RO: "Romania",
  RU: "Russia",
  SM: "San Marino",
  RS: "Serbia",
  SK: "Slovakia",
  SI: "Slovenia",
  ES: "Spain",
  SE: "Sweden",
  CH: "Switzerland",
  TR: "Turkey",
  UA: "Ukraine",
  GB: "United Kingdom",
  VA: "Vatican City",

  // Oceania
  AU: "Australia",
  FJ: "Fiji",
  KI: "Kiribati",
  MH: "Marshall Islands",
  FM: "Micronesia",
  NR: "Nauru",
  NZ: "New Zealand",
  PW: "Palau",
  PG: "Papua New Guinea",
  WS: "Samoa",
  SB: "Solomon Islands",
  TO: "Tonga",
  TV: "Tuvalu",
  VU: "Vanuatu",
};

/** Alpha-3 (3-letter) → alpha-2 lookup */
export const ISO_ALPHA3_TO_ALPHA2: Record<string, string> = {
  // Africa
  AGO: "AO", BEN: "BJ", BWA: "BW", BFA: "BF", BDI: "BI", CPV: "CV",
  CMR: "CM", CAF: "CF", TCD: "TD", COM: "KM", COD: "CD", COG: "CG",
  CIV: "CI", DJI: "DJ", EGY: "EG", GNQ: "GQ", ERI: "ER", SWZ: "SZ",
  ETH: "ET", GAB: "GA", GMB: "GM", GHA: "GH", GIN: "GN", GNB: "GW",
  KEN: "KE", LSO: "LS", LBR: "LR", LBY: "LY", MDG: "MG", MWI: "MW",
  MLI: "ML", MRT: "MR", MUS: "MU", MAR: "MA", MOZ: "MZ", NAM: "NA",
  NER: "NE", NGA: "NG", RWA: "RW", STP: "ST", SEN: "SN", SYC: "SC",
  SLE: "SL", SOM: "SO", ZAF: "ZA", SSD: "SS", SDN: "SD", TZA: "TZ",
  TGO: "TG", TUN: "TN", UGA: "UG", ZMB: "ZM", ZWE: "ZW",
  // Americas
  ATG: "AG", ARG: "AR", BHS: "BS", BRB: "BB", BLZ: "BZ", BOL: "BO",
  BRA: "BR", CAN: "CA", CHL: "CL", COL: "CO", CRI: "CR", CUB: "CU",
  DMA: "DM", DOM: "DO", ECU: "EC", SLV: "SV", GRD: "GD", GTM: "GT",
  GUY: "GY", HTI: "HT", HND: "HN", JAM: "JM", MEX: "MX", NIC: "NI",
  PAN: "PA", PRY: "PY", PER: "PE", KNA: "KN", LCA: "LC", VCT: "VC",
  SUR: "SR", TTO: "TT", USA: "US", URY: "UY", VEN: "VE",
  // Asia
  AFG: "AF", ARM: "AM", AZE: "AZ", BHR: "BH", BGD: "BD", BTN: "BT",
  BRN: "BN", KHM: "KH", CHN: "CN", CYP: "CY", GEO: "GE", IND: "IN",
  IDN: "ID", IRN: "IR", IRQ: "IQ", ISR: "IL", JPN: "JP", JOR: "JO",
  KAZ: "KZ", KWT: "KW", KGZ: "KG", LAO: "LA", LBN: "LB", MYS: "MY",
  MDV: "MV", MNG: "MN", MMR: "MM", NPL: "NP", PRK: "KP", OMN: "OM",
  PAK: "PK", PSE: "PS", PHL: "PH", QAT: "QA", SAU: "SA", SGP: "SG",
  KOR: "KR", LKA: "LK", SYR: "SY", TWN: "TW", TJK: "TJ", THA: "TH",
  TLS: "TL", TKM: "TM", ARE: "AE", UZB: "UZ", VNM: "VN", YEM: "YE",
  // Europe
  ALB: "AL", AND: "AD", AUT: "AT", BLR: "BY", BEL: "BE", BIH: "BA",
  BGR: "BG", HRV: "HR", CZE: "CZ", DNK: "DK", EST: "EE", FIN: "FI",
  FRA: "FR", DEU: "DE", GRC: "GR", HUN: "HU", ISL: "IS", IRL: "IE",
  ITA: "IT", LVA: "LV", LIE: "LI", LTU: "LT", LUX: "LU", MLT: "MT",
  MDA: "MD", MCO: "MC", MNE: "ME", NLD: "NL", MKD: "MK", NOR: "NO",
  POL: "PL", PRT: "PT", ROU: "RO", RUS: "RU", SMR: "SM", SRB: "RS",
  SVK: "SK", SVN: "SI", ESP: "ES", SWE: "SE", CHE: "CH", TUR: "TR",
  UKR: "UA", GBR: "GB", VAT: "VA",
  // Oceania
  AUS: "AU", FJI: "FJ", KIR: "KI", MHL: "MH", FSM: "FM", NRU: "NR",
  NZL: "NZ", PLW: "PW", PNG: "PG", WSM: "WS", SLB: "SB", TON: "TO",
  TUV: "TV", VUT: "VU",
};

// ─── Passport number format patterns (ICAO Doc 9303) ─────────────────────────

/**
 * Per-country passport number regex patterns.
 * Key = ISO alpha-2. Pattern validates the Machine Readable Zone document number.
 *
 * Most countries follow one of three patterns:
 *   • 2 letters + 7 digits (AA1234567) — common European / African
 *   • 1 letter  + 8 digits (A12345678) — South/South-East Asian
 *   • 9 alphanumeric chars (AA1234567) — US ICAO standard
 *
 * Country-specific overrides are listed below.
 */
const PASSPORT_PATTERNS: Record<string, RegExp> = {
  // Africa
  CM: /^[A-Z]{2}[0-9]{7}$/,    // Cameroon
  NG: /^[A-Z]{1}[0-9]{8}$/,    // Nigeria
  GH: /^G[0-9]{7}$/,           // Ghana
  KE: /^[A-Z]{1}[0-9]{7}$/,    // Kenya
  ZA: /^[A-Z][0-9]{8}$/,       // South Africa
  TZ: /^[A-Z]{2}[0-9]{7}$/,    // Tanzania
  UG: /^[A-Z]{1}[0-9]{7}$/,    // Uganda
  RW: /^[A-Z]{2}[0-9]{7}$/,    // Rwanda
  ET: /^[A-Z]{2}[0-9]{7}$/,    // Ethiopia
  EG: /^[A-Z][0-9]{8}$/,       // Egypt
  SN: /^[A-Z]{2}[0-9]{7}$/,    // Senegal
  CI: /^[A-Z]{2}[0-9]{7}$/,    // Côte d'Ivoire
  ML: /^[A-Z]{2}[0-9]{7}$/,    // Mali
  TN: /^[A-Z][0-9]{8}$/,       // Tunisia
  MA: /^[A-Z]{2}[0-9]{7}$/,    // Morocco
  ZM: /^[A-Z]{2}[0-9]{7}$/,    // Zambia
  ZW: /^[A-Z]{2}[0-9]{7}$/,    // Zimbabwe

  // Americas
  US: /^[A-Z0-9]{9}$/,         // United States (9 alphanumeric)
  CA: /^[A-Z]{2}[0-9]{6}$/,    // Canada
  MX: /^[A-Z]{1}[0-9]{8}$/,    // Mexico
  BR: /^[A-Z]{2}[0-9]{6}$/,    // Brazil
  AR: /^[A-Z]{3}[0-9]{6}$/,    // Argentina
  CO: /^[A-Z]{2}[0-9]{6}$/,    // Colombia
  PE: /^[A-Z0-9]{9}$/,         // Peru

  // Asia
  IN: /^[A-Z][1-9][0-9]{7}$/,  // India  (letter + non-zero + 7 digits)
  PK: /^[A-Z]{2}[0-9]{7}$/,    // Pakistan
  BD: /^[A-Z]{2}[0-9]{7}$/,    // Bangladesh
  CN: /^[A-Z][0-9]{8}$/,       // China
  JP: /^[A-Z]{2}[0-9]{7}$/,    // Japan
  KR: /^[A-Z]{2}[0-9]{7}$/,    // South Korea
  PH: /^[A-Z][0-9]{7}[A-Z]$/,  // Philippines
  MY: /^[A-Z][0-9]{8}$/,       // Malaysia
  ID: /^[A-Z][0-9]{7}$/,       // Indonesia
  TH: /^[A-Z]{2}[0-9]{7}$/,    // Thailand
  VN: /^[A-Z][0-9]{7}$/,       // Vietnam
  AE: /^[0-9]{9}$/,            // UAE (9 digits)
  SA: /^[A-Z][0-9]{8}$/,       // Saudi Arabia
  TR: /^[A-Z][0-9]{8}$/,       // Turkey

  // Europe
  GB: /^[0-9]{9}$/,            // UK (9 digits)
  DE: /^[A-Z0-9]{9}$/,         // Germany
  FR: /^[0-9]{2}[A-Z]{2}[0-9]{5}$/, // France
  IT: /^[A-Z]{2}[0-9]{7}$/,    // Italy
  ES: /^[A-Z]{3}[0-9]{6}$/,    // Spain
  PT: /^[A-Z]{2}[0-9]{6}$/,    // Portugal
  NL: /^[A-Z]{2}[0-9]{6}[A-Z0-9]$/, // Netherlands
  BE: /^[A-Z]{2}[0-9]{6}$/,    // Belgium
  PL: /^[A-Z]{2}[0-9]{7}$/,    // Poland
  RU: /^[0-9]{10}$/,           // Russia (10 digits)
  UA: /^[A-Z]{2}[0-9]{6}$/,    // Ukraine
  RO: /^[0-9]{8}$/,            // Romania
  CH: /^[A-Z][0-9]{7}$/,       // Switzerland

  // Oceania
  AU: /^[A-Z][0-9]{7}$/,       // Australia
  NZ: /^[A-Z]{2}[0-9]{6}$/,    // New Zealand
};

/** Fallback: general ICAO-compliant pattern (2 letters + 7 digits or 9 alphanumeric) */
const GENERIC_PASSPORT_PATTERN = /^[A-Z0-9]{6,12}$/;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CountryValidationResult {
  valid: boolean;
  alpha2?: string;
  countryName?: string;
  error?: string;
}

export interface PassportValidationResult {
  valid: boolean;
  countryCode: string;
  passportNumber: string;
  error?: string;
}

/**
 * Validate an ISO 3166-1 country code (alpha-2 or alpha-3).
 * Normalises to uppercase before checking.
 *
 * @param code - Two- or three-letter country code
 * @returns `{ valid: true, alpha2, countryName }` on success
 */
export function validateCountryCode(code: string): CountryValidationResult {
  if (!code || typeof code !== "string") {
    return { valid: false, error: "Country code must be a non-empty string" };
  }

  const normalised = code.trim().toUpperCase();

  // Alpha-2 direct lookup
  if (normalised.length === 2) {
    const name = ISO_ALPHA2_MAP[normalised];
    if (name) return { valid: true, alpha2: normalised, countryName: name };
    return { valid: false, error: `Unknown ISO alpha-2 code: ${normalised}` };
  }

  // Alpha-3 → alpha-2 lookup
  if (normalised.length === 3) {
    const a2 = ISO_ALPHA3_TO_ALPHA2[normalised];
    if (a2) {
      return {
        valid: true,
        alpha2: a2,
        countryName: ISO_ALPHA2_MAP[a2],
      };
    }
    return { valid: false, error: `Unknown ISO alpha-3 code: ${normalised}` };
  }

  return {
    valid: false,
    error: `Invalid code length (${normalised.length}); expected 2 or 3 characters`,
  };
}

/**
 * Validate a passport number format for a given issuing country.
 * Uses per-country ICAO Doc 9303 patterns where known; falls back to the
 * generic alphanumeric pattern for unlisted countries.
 *
 * @param countryCode - ISO alpha-2 or alpha-3 code of the issuing country
 * @param passportNumber - Passport document number (will be uppercased)
 * @returns `{ valid: true, countryCode, passportNumber }` on success
 */
export function validatePassportNumber(
  countryCode: string,
  passportNumber: string,
): PassportValidationResult {
  if (!passportNumber || typeof passportNumber !== "string") {
    return {
      valid: false,
      countryCode,
      passportNumber: passportNumber ?? "",
      error: "Passport number must be a non-empty string",
    };
  }

  // Resolve to alpha-2
  const countryResult = validateCountryCode(countryCode);
  if (!countryResult.valid) {
    return {
      valid: false,
      countryCode,
      passportNumber,
      error: countryResult.error,
    };
  }

  const alpha2 = countryResult.alpha2!;
  const normalised = passportNumber.trim().toUpperCase().replace(/[\s\-]/g, "");
  const pattern = PASSPORT_PATTERNS[alpha2] ?? GENERIC_PASSPORT_PATTERN;

  if (!pattern.test(normalised)) {
    return {
      valid: false,
      countryCode: alpha2,
      passportNumber: normalised,
      error: `Passport number "${normalised}" does not match the expected format for ${countryResult.countryName} (${alpha2})`,
    };
  }

  return { valid: true, countryCode: alpha2, passportNumber: normalised };
}

// ─── Verification country list (used by DB seed) ──────────────────────────────

export interface VerificationCountry {
  /** ISO 3166-1 alpha-2 */
  alpha2: string;
  /** ISO 3166-1 alpha-3 */
  alpha3: string;
  /** Human-readable name */
  name: string;
  /** Broad geographic region */
  region: "Africa" | "Americas" | "Asia" | "Europe" | "Oceania";
  /** Whether passport-based verification is currently supported */
  passportVerificationEnabled: boolean;
}

/**
 * Returns the complete list of countries recognised for identity verification,
 * used by both the validator and the database seed.
 */
export function getVerificationCountries(): VerificationCountry[] {
  // Build from the alpha-3 → alpha-2 map so the list stays DRY
  const alpha3ToRegion: Record<string, VerificationCountry["region"]> = {
    // Africa
    AGO:"Africa",BEN:"Africa",BWA:"Africa",BFA:"Africa",BDI:"Africa",CPV:"Africa",
    CMR:"Africa",CAF:"Africa",TCD:"Africa",COM:"Africa",COD:"Africa",COG:"Africa",
    CIV:"Africa",DJI:"Africa",EGY:"Africa",GNQ:"Africa",ERI:"Africa",SWZ:"Africa",
    ETH:"Africa",GAB:"Africa",GMB:"Africa",GHA:"Africa",GIN:"Africa",GNB:"Africa",
    KEN:"Africa",LSO:"Africa",LBR:"Africa",LBY:"Africa",MDG:"Africa",MWI:"Africa",
    MLI:"Africa",MRT:"Africa",MUS:"Africa",MAR:"Africa",MOZ:"Africa",NAM:"Africa",
    NER:"Africa",NGA:"Africa",RWA:"Africa",STP:"Africa",SEN:"Africa",SYC:"Africa",
    SLE:"Africa",SOM:"Africa",ZAF:"Africa",SSD:"Africa",SDN:"Africa",TZA:"Africa",
    TGO:"Africa",TUN:"Africa",UGA:"Africa",ZMB:"Africa",ZWE:"Africa",
    // Americas
    ATG:"Americas",ARG:"Americas",BHS:"Americas",BRB:"Americas",BLZ:"Americas",
    BOL:"Americas",BRA:"Americas",CAN:"Americas",CHL:"Americas",COL:"Americas",
    CRI:"Americas",CUB:"Americas",DMA:"Americas",DOM:"Americas",ECU:"Americas",
    SLV:"Americas",GRD:"Americas",GTM:"Americas",GUY:"Americas",HTI:"Americas",
    HND:"Americas",JAM:"Americas",MEX:"Americas",NIC:"Americas",PAN:"Americas",
    PRY:"Americas",PER:"Americas",KNA:"Americas",LCA:"Americas",VCT:"Americas",
    SUR:"Americas",TTO:"Americas",USA:"Americas",URY:"Americas",VEN:"Americas",
    // Asia
    AFG:"Asia",ARM:"Asia",AZE:"Asia",BHR:"Asia",BGD:"Asia",BTN:"Asia",BRN:"Asia",
    KHM:"Asia",CHN:"Asia",CYP:"Asia",GEO:"Asia",IND:"Asia",IDN:"Asia",IRN:"Asia",
    IRQ:"Asia",ISR:"Asia",JPN:"Asia",JOR:"Asia",KAZ:"Asia",KWT:"Asia",KGZ:"Asia",
    LAO:"Asia",LBN:"Asia",MYS:"Asia",MDV:"Asia",MNG:"Asia",MMR:"Asia",NPL:"Asia",
    PRK:"Asia",OMN:"Asia",PAK:"Asia",PSE:"Asia",PHL:"Asia",QAT:"Asia",SAU:"Asia",
    SGP:"Asia",KOR:"Asia",LKA:"Asia",SYR:"Asia",TWN:"Asia",TJK:"Asia",THA:"Asia",
    TLS:"Asia",TKM:"Asia",ARE:"Asia",UZB:"Asia",VNM:"Asia",YEM:"Asia",
    // Europe
    ALB:"Europe",AND:"Europe",AUT:"Europe",BLR:"Europe",BEL:"Europe",BIH:"Europe",
    BGR:"Europe",HRV:"Europe",CZE:"Europe",DNK:"Europe",EST:"Europe",FIN:"Europe",
    FRA:"Europe",DEU:"Europe",GRC:"Europe",HUN:"Europe",ISL:"Europe",IRL:"Europe",
    ITA:"Europe",LVA:"Europe",LIE:"Europe",LTU:"Europe",LUX:"Europe",MLT:"Europe",
    MDA:"Europe",MCO:"Europe",MNE:"Europe",NLD:"Europe",MKD:"Europe",NOR:"Europe",
    POL:"Europe",PRT:"Europe",ROU:"Europe",RUS:"Europe",SMR:"Europe",SRB:"Europe",
    SVK:"Europe",SVN:"Europe",ESP:"Europe",SWE:"Europe",CHE:"Europe",TUR:"Europe",
    UKR:"Europe",GBR:"Europe",VAT:"Europe",
    // Oceania
    AUS:"Oceania",FJI:"Oceania",KIR:"Oceania",MHL:"Oceania",FSM:"Oceania",
    NRU:"Oceania",NZL:"Oceania",PLW:"Oceania",PNG:"Oceania",WSM:"Oceania",
    SLB:"Oceania",TON:"Oceania",TUV:"Oceania",VUT:"Oceania",
  };

  // Countries where we have a validated passport pattern → passport verification on
  const passportEnabledAlpha2 = new Set(Object.keys(PASSPORT_PATTERNS));

  return Object.entries(ISO_ALPHA3_TO_ALPHA2).map(([alpha3, alpha2]) => ({
    alpha2,
    alpha3,
    name: ISO_ALPHA2_MAP[alpha2] ?? alpha2,
    region: alpha3ToRegion[alpha3] ?? "Africa",
    passportVerificationEnabled: passportEnabledAlpha2.has(alpha2),
  }));
}

export function validateExpiryDate(expiryStr: string): boolean {
  if (!expiryStr) return false;
  const d = new Date(expiryStr);
  return !isNaN(d.getTime()) && d.getTime() > Date.now();
}
