#!/usr/bin/env node

/**
 * ND Supreme Court Brief Downloader
 *
 * Downloads briefs and documents from the North Dakota Supreme Court cTrack
 * portal. Two modes: calendar mode (cases scheduled in the next N days) and
 * single-case mode (-c).
 *
 * The cTrack portal is a JavaScript SPA, but every piece of data it shows is
 * served by anonymous JSON APIs on portal-api.ctrack.ndcourts.gov. This tool
 * talks to those APIs directly over HTTP -- no browser, no scraping.
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    verbosity: 1,
    outputDir: process.cwd(),
    days: 7,
    caseNumber: null,
    allDocs: false,
    opinionsOnly: false,
    timeout: 90000,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbosity = 2;
    } else if (arg === '-q' || arg === '--quiet') {
      options.verbosity = 0;
    } else if (arg === '-o' || arg === '--output') {
      if (i + 1 < args.length) {
        options.outputDir = path.resolve(args[++i]);
      } else {
        console.error('Error: -o/--output requires a directory path');
        process.exit(1);
      }
    } else if (arg === '-d' || arg === '--days') {
      if (i + 1 < args.length) {
        options.days = parseInt(args[++i], 10);
        if (isNaN(options.days) || options.days < 1) {
          console.error('Error: -d/--days requires a positive number');
          process.exit(1);
        }
      } else {
        console.error('Error: -d/--days requires a number');
        process.exit(1);
      }
    } else if (arg === '-c' || arg === '--case') {
      if (i + 1 < args.length) {
        options.caseNumber = args[++i];
        if (!/^\d{8}$/.test(options.caseNumber)) {
          console.error('Error: -c/--case requires an 8-digit case number');
          process.exit(1);
        }
      } else {
        console.error('Error: -c/--case requires an 8-digit case number');
        process.exit(1);
      }
    } else if (arg === '-t' || arg === '--timeout') {
      if (i + 1 < args.length) {
        const seconds = parseInt(args[++i], 10);
        if (isNaN(seconds) || seconds < 1) {
          console.error('Error: -t/--timeout requires a positive number of seconds');
          process.exit(1);
        }
        options.timeout = seconds * 1000;
      } else {
        console.error('Error: -t/--timeout requires a number of seconds');
        process.exit(1);
      }
    } else if (arg === '-a' || arg === '--all') {
      options.allDocs = true;
    } else if (arg === '-O' || arg === '--opinions') {
      options.opinionsOnly = true;
    } else if (/^\d{8}$/.test(arg)) {
      options.caseNumber = arg;
    } else if (arg.startsWith('-')) {
      console.error(`Error: Unknown option: ${arg}`);
      console.error('Use --help to see available options');
      process.exit(1);
    } else {
      console.error(`Error: Unexpected argument: ${arg}`);
      console.error('Use --help to see available options');
      process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
ND Supreme Court Brief Downloader

Downloads briefs for cases scheduled on the ND Supreme Court calendar,
or documents for a specific case by case number. Talks directly to the
cTrack JSON APIs over HTTP -- no browser required.

Usage: node ctrack-fetch.js [options]

Options:
  -h, --help          Show this help message
  -v, --verbose       Enable debug output
  -q, --quiet         Silent mode (no output)
  -o, --output DIR    Output directory for downloaded PDFs (default: current directory)
  -d, --days N        Number of days to look ahead (default: 7)
  -c, --case NUMBER   Download documents for a specific 8-digit case number
  -a, --all           Download all documents (not just briefs/NOA)
  -O, --opinions      Download only opinions (incl. corrected/amended); overrides -a
  -t, --timeout N     Per-request HTTP timeout in seconds (default: 90)

Examples:
  node ctrack-fetch.js                     # Download briefs for next 7 days
  node ctrack-fetch.js -v                  # With debug output
  node ctrack-fetch.js -o ~/briefs         # Save to specific directory
  node ctrack-fetch.js -d 14               # Look ahead 14 days
  node ctrack-fetch.js -c 20990001         # Download briefs for specific case
  node ctrack-fetch.js 20990001            # Same -- bare 8-digit case number
  node ctrack-fetch.js -c 20990001 -a      # Download all documents for a case
  node ctrack-fetch.js -c 20990001 -O      # Download only the opinion(s) for a case
  node ctrack-fetch.js -v -o ~/briefs -d 7 # Combine options
`);
}

const parsedArgs = parseArgs();

if (parsedArgs.help) {
  showHelp();
  process.exit(0);
}

// Configuration
const CONFIG = {
  // Base URL for the cTrack data API (anonymous; no auth)
  apiBase: 'https://portal-api.ctrack.ndcourts.gov',
  // courtID for the ND Supreme Court (a fixed UUID in the cTrack instance)
  courtId: '68f021c4-6a44-4735-9a76-5360b2e8af13',
  downloadDir: parsedArgs.outputDir,
  verbosity: parsedArgs.verbosity,
  days: parsedArgs.days,
  caseNumber: parsedArgs.caseNumber,
  allDocs: parsedArgs.allDocs,
  opinionsOnly: parsedArgs.opinionsOnly,
  timeout: parsedArgs.timeout,
};

// The exact-match case-number search type used by the cTrack search form.
const CASE_NUMBER_SEARCH_TYPE = '10463';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ctrack-fetch';

fs.mkdirSync(CONFIG.downloadDir, { recursive: true });

// Logging utilities
function log(message, level = 1) {
  if (CONFIG.verbosity >= level) {
    const timestamp = new Date().toISOString().substr(11, 8);
    console.log(`[${timestamp}] ${message}`);
  }
}

function debug(message) {
  log(`DEBUG: ${message}`, 2);
}

function progress(message) {
  log(message, 1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Brief type mapping - maps common brief names to abbreviations
const BRIEF_TYPE_MAP = {
  // Appellant briefs
  'appellant brief': 'Apt-Br',
  'appellant\'s brief': 'Apt-Br',
  'appellants brief': 'Apt-Br',
  'appellants\' brief': 'Apt-Br',
  'brief of appellant': 'Apt-Br',
  'opening brief': 'Apt-Br',

  // Appellee briefs
  'appellee brief': 'Ape-Br',
  'appellee\'s brief': 'Ape-Br',
  'appellees brief': 'Ape-Br',
  'appellees\' brief': 'Ape-Br',
  'brief of appellee': 'Ape-Br',
  'response brief': 'Ape-Br',
  'answering brief': 'Ape-Br',

  // Reply briefs
  'reply brief': 'Apt-Reply-Br',
  'appellant reply brief': 'Apt-Reply-Br',
  'appellant\'s reply brief': 'Apt-Reply-Br',
  'reply brief of appellant': 'Apt-Reply-Br',

  // Amicus briefs
  'amicus brief': 'Amicus-Br',
  'amicus curiae brief': 'Amicus-Br',
  'brief of amicus curiae': 'Amicus-Br',
  'brief amicus curiae': 'Amicus-Br',

  // Cross-appeal briefs
  'cross-appellant brief': 'Cross-Apt-Br',
  'cross-appellee brief': 'Cross-Ape-Br',
  'cross appeal brief': 'Cross-Apt-Br',

  // Petitioner/Respondent (for original proceedings)
  'petitioner brief': 'Pet-Br',
  'petitioner\'s brief': 'Pet-Br',
  'brief of petitioner': 'Pet-Br',
  'respondent brief': 'Resp-Br',
  'respondent\'s brief': 'Resp-Br',
  'brief of respondent': 'Resp-Br',

  // Motion-related briefs
  'brief in support': 'Supp-Br',
  'brief in support of motion': 'Supp-Br',
  'brief in opposition': 'Opp-Br',
  'opposition brief': 'Opp-Br',
  'brief in response': 'Resp-Br',

  // Supplemental briefs
  'supplemental brief': 'Suppl-Br',
  'supplemental appellant brief': 'Suppl-Apt-Br',
  'supplemental appellee brief': 'Suppl-Ape-Br',

  // Notice of Appeal
  'amended notice of appeal': 'Amended-Notice-of-Appeal',
  'notice of appeal': 'Notice-of-Appeal',
  'notice appeal': 'Notice-of-Appeal',
};

/**
 * Convert a brief name from the docket to our abbreviated format.
 * `subtype` is the docket's Subtype column; for opinions it is "Opinion",
 * which is the reliable signal (the description may be a long correction note).
 */
function abbreviateBriefType(briefName, subtype = '') {
  const normalized = briefName.toLowerCase().trim();
  const subtypeNorm = (subtype || '').toLowerCase().trim();

  // Opinions: keyed primarily on the Subtype column, with specific name
  // patterns as a backstop. A docket may carry several (original plus
  // corrected/amended/rehearing); distinct docketIds keep filenames unique.
  const looksLikeOpinion =
    subtypeNorm === 'opinion' ||
    normalized === 'opinion - opinion' ||
    /\bcorrected opinion\b/.test(normalized) ||
    /\bamended opinion\b/.test(normalized) ||
    /\bsubstituted? opinion\b/.test(normalized) ||
    /\bopinion on rehearing\b/.test(normalized);
  if (looksLikeOpinion) {
    if (/correct/.test(normalized)) return 'Opinion-Corrected';
    if (/amend|substitut/.test(normalized)) return 'Opinion-Amended';
    if (/rehear/.test(normalized)) return 'Opinion-Rehearing';
    if (/\bon motion\b/.test(normalized)) return 'Opinion-Motion';
    return 'Opinion';
  }

  // Check for exact matches first
  if (BRIEF_TYPE_MAP[normalized]) {
    return BRIEF_TYPE_MAP[normalized];
  }

  // Check for partial matches (longer patterns first to prefer specific matches)
  const sortedEntries = Object.entries(BRIEF_TYPE_MAP)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [pattern, abbrev] of sortedEntries) {
    if (normalized.includes(pattern)) {
      return abbrev;
    }
  }

  // Fallback: create abbreviation from the name
  // Remove common words and abbreviate
  let abbrev = briefName
    .replace(/\b(of|the|in|and|for)\b/gi, '')
    .replace(/brief/gi, 'Br')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Cap length: some docket descriptions run to hundreds of characters
  // (e.g. clerk correction notes), which otherwise produce filenames that
  // exceed the filesystem limit and fail to write (ENAMETOOLONG).
  abbrev = abbrev.substring(0, 60).replace(/-+$/, '');

  debug(`Unknown brief type "${briefName}" -> "${abbrev}"`);
  return abbrev;
}

/**
 * Format case number to 8 digits without separators
 */
function formatCaseNumber(caseNum) {
  // Remove any non-numeric characters and ensure 8 digits
  const cleaned = caseNum.replace(/\D/g, '');
  return cleaned;
}

/**
 * Generate filename for a brief or document
 * Format: {caseNumber}_{docketId}_{docType}.pdf
 */
function generateFilename(caseNumber, docketId, docType, index = null, subtype = '') {
  const formattedCase = formatCaseNumber(caseNumber);
  const paddedDocketId = String(docketId).padStart(3, '0');
  // Strip characters that are illegal in a filename. Free-form docket
  // descriptions can contain path separators (e.g. "and/or") and other
  // unsafe characters that would otherwise break the write.
  const abbrevType = abbreviateBriefType(docType, subtype)
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = index !== null ? index : '';

  return `${formattedCase}_${paddedDocketId}_${abbrevType}${suffix}.pdf`;
}

/**
 * Fetch a URL with a per-request timeout and a few retries. Retries on
 * network errors and on 5xx/429 (the portal is occasionally slow/overloaded).
 * Returns the Response (caller checks res.ok for 4xx).
 */
async function httpFetch(url, { accept = 'application/json' } = {}) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': accept, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(CONFIG.timeout),
      });
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (e) {
      lastErr = e;
      debug(`  Request attempt ${attempt}/${maxAttempts} failed for ${url}: ${e.message}`);
      if (attempt < maxAttempts) await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

async function getJson(url) {
  const res = await httpFetch(url, { accept: 'application/json' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Resolve an 8-digit case number to its cTrack caseInstanceUUID and title.
 * Returns null if the case is not found.
 */
async function resolveCase(caseNumber) {
  const url = `${CONFIG.apiBase}/courts/cms/cases` +
    `?caseHeader.caseNumber=${encodeURIComponent(caseNumber)}` +
    `&caseHeader.caseNumberSearchType=${CASE_NUMBER_SEARCH_TYPE}` +
    `&caseHeader.courtID=${CONFIG.courtId}` +
    `&page=0&size=25&sort=caseHeader.filedDate%2Cdesc`;
  debug(`Resolving case ${caseNumber}: ${url}`);
  const data = await getJson(url);
  const results = data?._embedded?.results || [];
  const match = results.find((r) => r?.caseHeader?.caseNumber === caseNumber) || results[0];
  if (!match) return null;
  return {
    uuid: match.caseHeader.caseInstanceUUID,
    title: match.caseHeader.caseTitle || '',
  };
}

/**
 * Fetch all docket entries for a case, newest-first (matching the portal's
 * docket table). Each entry gets a docketId: the 1-based chronological
 * position counting from the oldest entry (oldest = 1), which keeps filenames
 * stable and matches the prior scraping behavior.
 */
async function getDocketEntries(caseUuid) {
  const url = `${CONFIG.apiBase}/courts/${CONFIG.courtId}/cms/cases/${caseUuid}` +
    `/docketentries?page=0&size=500&sort=docketEntryHeader.filedDate%2Cdesc`;
  debug(`Fetching docket entries: ${url}`);
  const data = await getJson(url);
  const results = data?._embedded?.results || [];
  const n = results.length;
  return results.map((r, idx) => {
    const h = r.docketEntryHeader || {};
    return {
      docketEntryUUID: h.docketEntryUUID,
      type: h.docketEntryType || '',
      subtype: h.docketEntrySubType || '',
      description: h.docketEntryDescription || '',
      documentCount: Number(h.documentCount) || 0,
      // newest-first index -> oldest-first docketId
      docketId: n - idx,
    };
  });
}

/**
 * Decide whether a docket entry should be downloaded, given the current flags.
 * Mirrors the prior column-based classification (Type / Subtype / Description).
 */
function shouldInclude(entry) {
  const typeText = entry.type.toLowerCase();
  const descLower = entry.description.toLowerCase();
  const subtypeNorm = entry.subtype.toLowerCase().trim();

  // Skip service documents in all modes
  if (typeText.includes('service') ||
      descLower.startsWith('service document') ||
      descLower.startsWith('service -') ||
      descLower.includes('declaration of service')) {
    return false;
  }

  const isBrief = typeText === 'brief';
  const isNoticeOfAppeal = descLower.startsWith('notice of appeal') ||
                           descLower.startsWith('amended notice of appeal');
  // Opinions are identified by the Subtype being "Opinion". This catches the
  // original (type "Opinion") and any corrected/amended opinion (type
  // "Correction"). Non-document opinion-related entries (dispositions,
  // split-opinion holdings) carry a different subtype and are excluded.
  const isOpinion = subtypeNorm === 'opinion';

  return CONFIG.opinionsOnly
    ? isOpinion
    : (CONFIG.allDocs || isBrief || isNoticeOfAppeal);
}

/**
 * Fetch the downloadable document link(s) for a docket entry. An entry may
 * carry more than one document; all are returned.
 */
async function getDocumentLinks(caseUuid, docketEntryUuid) {
  const url = `${CONFIG.apiBase}/courts/cms/docketentrydocumentsaccess` +
    `?page=0&size=100&sort=documentName%2Casc` +
    `&caseHeader.courtID=${CONFIG.courtId}` +
    `&docketEntryHeader.docketEntryUUID=${docketEntryUuid}` +
    `&caseHeader.caseInstanceUUID=${caseUuid}`;
  debug(`  Fetching document links: ${url}`);
  const data = await getJson(url);
  const results = data?._embedded?.results || [];
  return results.map((r) => ({
    documentLinkUUID: r.documentLinkUUID,
    documentName: r.documentName || '',
    contentType: r.documentInfo?.contentType || '',
    fileSize: r.documentInfo?.fileSize || null,
  }));
}

/**
 * Download a single document (by its documentLinkUUID) to `filename`.
 * Validates the %PDF magic bytes before writing.
 */
async function downloadDocument(caseUuid, documentLinkUuid, filename) {
  const url = `${CONFIG.apiBase}/courts/${CONFIG.courtId}/cms/case/${caseUuid}` +
    `/docketentrydocuments/${documentLinkUuid}`;
  debug(`  Downloading: ${url}`);

  const res = await httpFetch(url, { accept: 'application/pdf, */*' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const isPdf = buffer.length >= 4 &&
    buffer[0] === 0x25 && buffer[1] === 0x50 &&
    buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
  if (!isPdf) {
    throw new Error(`response was not a PDF (first bytes: ${buffer.subarray(0, 8).toString('utf8')})`);
  }

  const filePath = path.join(CONFIG.downloadDir, filename);
  fs.writeFileSync(filePath, buffer);
  return { url, size: buffer.length };
}

/**
 * Format a local Date as an ISO-8601 timestamp with the machine's UTC offset.
 */
function isoWithOffset(date, time) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${y}-${m}-${d}T${time}${sign}${oh}:${om}`;
}

/**
 * Get the cases scheduled on the Supreme Court calendar within the lookahead
 * window. Returns [{caseNumber, caseName}], de-duplicated.
 */
async function getCalendarCases() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + CONFIG.days);

  const from = isoWithOffset(today, '00:00:00.001');
  const to = isoWithOffset(end, '23:59:59.900');
  const url = `${CONFIG.apiBase}/courts/cms/events` +
    `?startDateFrom=${encodeURIComponent(from)}` +
    `&startDateTo=${encodeURIComponent(to)}` +
    `&courtID=${CONFIG.courtId}&page=0&size=100&sort=startDate%2Casc`;
  debug(`Fetching calendar events: ${url}`);

  const data = await getJson(url);
  const results = data?._embedded?.results || [];
  const seen = new Set();
  const cases = [];
  for (const ev of results) {
    // eventName looks like "20990338 - Doe v. Roe"
    const m = (ev.eventName || '').match(/\b(20\d{6})\s*-\s*(.*)$/);
    if (!m) continue;
    const caseNumber = m[1];
    if (seen.has(caseNumber)) continue;
    seen.add(caseNumber);
    cases.push({ caseNumber, caseName: (m[2] || '').trim() });
  }
  return cases;
}

/**
 * Process one case: resolve it, enumerate its docket, and download the
 * matching documents. Appends to `manifest` and returns the number of
 * documents successfully downloaded.
 */
async function processCase(caseInfo, downloadedBriefs, manifest) {
  const { caseNumber } = caseInfo;
  progress(`\nProcessing case ${caseNumber}${caseInfo.caseName ? ' - ' + caseInfo.caseName : ''}...`);

  let resolved;
  try {
    resolved = await resolveCase(caseNumber);
  } catch (e) {
    progress(`  ERROR resolving case ${caseNumber}: ${e.message}`);
    return 0;
  }
  if (!resolved) {
    progress(`  Could not find case ${caseNumber}`);
    return 0;
  }
  const caseName = caseInfo.caseName || resolved.title || null;
  debug(`  caseInstanceUUID: ${resolved.uuid} (${resolved.title})`);

  let entries;
  try {
    entries = await getDocketEntries(resolved.uuid);
  } catch (e) {
    progress(`  ERROR fetching docket for ${caseNumber}: ${e.message}`);
    return 0;
  }

  const wanted = entries.filter((e) => e.documentCount >= 1 && shouldInclude(e));
  debug(`  ${wanted.length} matching docket entr${wanted.length === 1 ? 'y' : 'ies'} of ${entries.length} total`);

  if (wanted.length === 0) {
    const noun = CONFIG.opinionsOnly ? 'opinions' : (CONFIG.allDocs ? 'documents' : 'briefs or notices');
    progress(`  No ${noun} found for case ${caseNumber}`);
    return 0;
  }

  let downloaded = 0;
  for (const entry of wanted) {
    let links;
    try {
      links = await getDocumentLinks(resolved.uuid, entry.docketEntryUUID);
    } catch (e) {
      progress(`  ERROR listing documents for "${entry.description}": ${e.message}`);
      continue;
    }
    if (links.length === 0) {
      debug(`  No document links for "${entry.description}"`);
      continue;
    }

    for (const link of links) {
      // Build a unique filename; multiple documents in one entry (or repeated
      // type+docketId) get a numeric suffix.
      const key = `${caseNumber}_${entry.docketId}_${abbreviateBriefType(entry.description, entry.subtype)}`;
      const count = (downloadedBriefs.get(key) || 0) + 1;
      downloadedBriefs.set(key, count);
      const filename = generateFilename(
        caseNumber,
        entry.docketId,
        entry.description,
        count > 1 ? count : null,
        entry.subtype
      );

      let downloadUrl = null;
      let downloadSize = null;
      let success = false;
      try {
        const result = await downloadDocument(resolved.uuid, link.documentLinkUUID, filename);
        downloadUrl = result.url;
        downloadSize = result.size;
        success = true;
        downloaded++;
        progress(`  Downloaded: ${filename} (${Math.round(result.size / 1024)} KB)`);
      } catch (e) {
        progress(`  ERROR downloading ${filename}: ${e.message}`);
      }

      manifest.push({
        caseNumber,
        caseName,
        docketId: entry.docketId,
        description: entry.description,
        type: entry.type || null,
        subtype: entry.subtype || null,
        filename,
        url: downloadUrl,
        size: downloadSize,
        success,
      });
    }
  }

  return downloaded;
}

/**
 * Main entry point.
 */
async function main() {
  progress('Starting ND Supreme Court Brief Downloader');
  debug(`Configuration: ${JSON.stringify(CONFIG, null, 2)}`);

  // Determine the list of cases to process.
  let cases;
  if (CONFIG.caseNumber) {
    cases = [{ caseNumber: CONFIG.caseNumber, caseName: '' }];
  } else {
    progress(`Fetching cTrack calendar (${CONFIG.days}-day lookahead)...`);
    try {
      cases = await getCalendarCases();
    } catch (e) {
      progress(`FATAL ERROR: could not fetch calendar: ${e.message}`);
      debug(`Stack trace: ${e.stack}`);
      process.exitCode = 1;
      return;
    }
    progress(`Found ${cases.length} case(s) scheduled`);
    debug(`Cases: ${JSON.stringify(cases, null, 2)}`);
  }

  if (cases.length === 0) {
    progress('No cases found.');
    return;
  }

  // Track downloaded documents to handle duplicate filenames
  const downloadedBriefs = new Map();
  const manifest = [];
  let totalBriefs = 0;

  for (const caseInfo of cases) {
    try {
      totalBriefs += await processCase(caseInfo, downloadedBriefs, manifest);
    } catch (e) {
      progress(`  ERROR processing case ${caseInfo.caseNumber}: ${e.message}`);
      debug(`  Full error: ${e.stack}`);
    }
  }

  if (manifest.length > 0) {
    const manifestPath = path.join(CONFIG.downloadDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    progress(`\nManifest written to: ${manifestPath}`);
  }

  progress(`\n========================================`);
  progress(`Download complete!`);
  progress(`Total documents downloaded: ${totalBriefs}`);
  progress(`Files saved to: ${CONFIG.downloadDir}`);
}

// Run the script
main().catch((e) => {
  progress(`FATAL ERROR: ${e.message}`);
  debug(`Stack trace: ${e.stack}`);
  process.exitCode = 1;
});
