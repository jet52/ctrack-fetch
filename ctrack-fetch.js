#!/usr/bin/env node

/**
 * ND Supreme Court Brief Downloader
 *
 * Downloads all briefs for cases scheduled in the next N days
 * from the ND Supreme Court calendar.
 */

const puppeteer = require('puppeteer');
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
    } else if (arg.startsWith('-')) {
      console.error(`Error: Unknown option: ${arg}`);
      console.error('Use --help to see available options');
      process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
ND Supreme Court Brief Downloader

Downloads all briefs for cases scheduled on the ND Supreme Court calendar,
or briefs for a specific case by case number.

Usage: node ctrack-fetch.js [options]

Options:
  -h, --help          Show this help message
  -v, --verbose       Enable debug output
  -q, --quiet         Silent mode (no output)
  -o, --output DIR    Output directory for downloaded PDFs (default: current directory)
  -d, --days N        Number of days to look ahead (default: 7)
  -c, --case NUMBER   Download briefs for a specific 8-digit case number

Examples:
  node ctrack-fetch.js                     # Download briefs for next 7 days
  node ctrack-fetch.js -v                  # With debug output
  node ctrack-fetch.js -o ~/briefs         # Save to specific directory
  node ctrack-fetch.js -d 14               # Look ahead 14 days
  node ctrack-fetch.js -c 20250339         # Download briefs for specific case
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
  startUrl: 'https://www.ndcourts.gov/supreme-court/calendar#',
  // The cTrack portal URL with 7-day calendar filter
  // courtID is for Supreme Court
  ctrackCalendarUrl: 'https://portal.ctrack.ndcourts.gov/portal/search/calendar/results',
  // Case search URL for single case lookup
  caseSearchUrl: 'https://portal.ctrack.ndcourts.gov/portal/search/case',
  downloadDir: parsedArgs.outputDir,
  verbosity: parsedArgs.verbosity,
  days: parsedArgs.days,
  caseNumber: parsedArgs.caseNumber,
  timeout: 30000,
};

/**
 * Build the cTrack calendar URL with proper date range
 */
function buildCalendarUrl() {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + CONFIG.days);

  const formatDate = (d) => {
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month}*2f${day}*2f${year}`; // URL encoded MM/DD/YYYY
  };

  const startDateStr = formatDate(today);
  const endDateStr = formatDate(endDate);

  // Build the criteria parameter (this is a weird URL encoding format used by cTrack)
  const criteria = `~(advanced~false~courtID~%2768f021c4-6a44-4735-9a76-5360b2e8af13~paging~(totalItems~0~itemsPerPage~100~page~1~sortBy~%27startDate~sortDesc~false)~calendar~(calendarNameQueryTypeID~300054~judgeNameQueryTypeID~300054~calendarDateChoice~%277d~calendarDateStart~%27${startDateStr}~calendarDateEnd~%27${endDateStr}))`;

  return `${CONFIG.ctrackCalendarUrl}?criteria=${criteria}`;
}

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

function silent(message) {
  log(message, 0); // Only shows if verbosity explicitly set to show everything
}

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
 * Convert a brief name from the docket to our abbreviated format
 */
function abbreviateBriefType(briefName) {
  const normalized = briefName.toLowerCase().trim();

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

  debug(`Unknown brief type "${briefName}" -> "${abbrev}"`);
  return abbrev;
}

/**
 * Format case number to 8 digits without separators
 */
function formatCaseNumber(caseNum) {
  // Remove any non-numeric characters and ensure 8 digits
  const cleaned = caseNum.replace(/\D/g, '');
  debug(`Case number "${caseNum}" -> "${cleaned}"`);
  return cleaned;
}

/**
 * Format case title for use in filename
 * e.g., "Klebe v. Klebe" -> "Klebe-v-Klebe"
 */
function formatCaseTitleForFilename(caseTitle) {
  if (!caseTitle) return '';

  // Replace common separators and clean up
  let formatted = caseTitle
    .replace(/\s+v\.\s+/gi, '-v-')      // "v." with spaces
    .replace(/\s+vs\.\s+/gi, '-v-')     // "vs." with spaces
    .replace(/\s+v\s+/gi, '-v-')        // "v" with spaces
    .replace(/\s+vs\s+/gi, '-v-')       // "vs" with spaces
    .replace(/[^\w\s-]/g, '')           // Remove special chars except hyphen
    .replace(/\s+/g, '-')               // Replace spaces with hyphens
    .replace(/-+/g, '-')                // Collapse multiple hyphens
    .replace(/^-|-$/g, '')              // Trim leading/trailing hyphens
    .substring(0, 50);                  // Limit length

  debug(`Case title "${caseTitle}" -> "${formatted}"`);
  return formatted;
}

/**
 * Generate filename for a brief or document
 */
function generateFilename(caseNumber, caseTitle, docType, index = null) {
  const formattedCase = formatCaseNumber(caseNumber);
  const formattedTitle = formatCaseTitleForFilename(caseTitle);
  const abbrevType = abbreviateBriefType(docType);
  const suffix = index !== null ? index : '';

  // Include case title if available
  if (formattedTitle) {
    return `${formattedCase}_${formattedTitle}_${abbrevType}${suffix}.pdf`;
  }
  return `${formattedCase}_${abbrevType}${suffix}.pdf`;
}

/**
 * Download a file from a URL
 */
async function downloadFile(page, url, filename) {
  const filePath = path.join(CONFIG.downloadDir, filename);

  debug(`Downloading: ${url}`);
  debug(`Saving to: ${filePath}`);

  try {
    // Use page.evaluate to fetch the file as a blob
    const buffer = await page.evaluate(async (fileUrl) => {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      return Array.from(new Uint8Array(arrayBuffer));
    }, url);

    fs.writeFileSync(filePath, Buffer.from(buffer));
    progress(`  Downloaded: ${filename}`);
    return true;
  } catch (error) {
    progress(`  ERROR downloading ${filename}: ${error.message}`);
    debug(`  Full error: ${error.stack}`);
    return false;
  }
}

/**
 * Search for a specific case by case number
 * @param {Page} page - Puppeteer page object
 * @param {string} caseNumber - 8-digit case number
 * @returns {Object|null} - Case info object or null if not found
 */
async function searchForCase(page, caseNumber) {
  progress(`Searching for case ${caseNumber}...`);
  debug(`Navigating to case search: ${CONFIG.caseSearchUrl}`);

  await page.goto(CONFIG.caseSearchUrl, { waitUntil: 'networkidle2' });
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Take screenshot in debug mode
  if (CONFIG.verbosity >= 2) {
    const screenshotPath = path.join(CONFIG.downloadDir, 'case-search-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    debug(`Screenshot saved to: ${screenshotPath}`);
  }

  // Find the case number input field and enter the case number
  // The field is typically labeled "Case Number" with an input
  const inputFound = await page.evaluate((caseNum) => {
    // Look for input fields that might be for case number
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const input of inputs) {
      // Check the label or placeholder
      const label = input.getAttribute('aria-label') ||
                    input.getAttribute('placeholder') ||
                    input.closest('label')?.textContent || '';
      const id = input.id || '';
      const name = input.name || '';

      // Also check for nearby label elements
      let nearbyLabel = '';
      if (input.id) {
        const labelEl = document.querySelector(`label[for="${input.id}"]`);
        if (labelEl) nearbyLabel = labelEl.textContent;
      }

      const allText = (label + id + name + nearbyLabel).toLowerCase();

      if (allText.includes('case') && allText.includes('number')) {
        input.value = caseNum;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, fieldInfo: allText.substring(0, 100) };
      }
    }

    // If not found by label, try the first prominent input field
    const firstInput = document.querySelector('input[type="text"], input:not([type])');
    if (firstInput) {
      firstInput.value = caseNum;
      firstInput.dispatchEvent(new Event('input', { bubbles: true }));
      firstInput.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, fieldInfo: 'first text input' };
    }

    return { found: false };
  }, caseNumber);

  debug(`Input field search result: ${JSON.stringify(inputFound)}`);

  if (!inputFound.found) {
    progress('Could not find case number input field');
    return null;
  }

  // Wait a moment for any autocomplete/validation
  await new Promise(resolve => setTimeout(resolve, 500));

  // Click the search button using Puppeteer's click
  debug('Looking for SEARCH button...');
  try {
    // Try to find and click the SEARCH button
    await page.waitForSelector('button', { timeout: 5000 });

    const searchClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toUpperCase();
        if (text === 'SEARCH') {
          btn.click();
          return { clicked: true, text: text };
        }
      }
      return { clicked: false };
    });

    debug(`Search button click result: ${JSON.stringify(searchClicked)}`);

    if (!searchClicked.clicked) {
      // Try pressing Enter as fallback
      debug('SEARCH button not found, trying Enter key...');
      await page.keyboard.press('Enter');
    }
  } catch (e) {
    debug(`Error clicking search: ${e.message}`);
    await page.keyboard.press('Enter');
  }

  debug('Search initiated, waiting for results...');

  // Wait for navigation or results to appear
  try {
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
  } catch (e) {
    debug('Navigation wait ended');
  }

  // Give extra time for results to render
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Take screenshot of results in debug mode
  if (CONFIG.verbosity >= 2) {
    const screenshotPath = path.join(CONFIG.downloadDir, 'case-search-results.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    debug(`Screenshot saved to: ${screenshotPath}`);
  }

  // Debug: show what's on the page now
  const pageText = await page.evaluate(() => document.body.innerText);
  debug(`Results page text (first 500 chars): ${pageText.substring(0, 500)}`);

  // Look for the case in the results and click on it
  // Results appear in a table with clickable rows or links
  const caseFound = await page.evaluate((caseNum) => {
    // First, look in table rows (results are usually in a table)
    const rows = document.querySelectorAll('table tr, .v-data-table tr');
    for (const row of rows) {
      const text = row.textContent || '';
      // Skip if this is a header row or the search form input
      if (row.querySelector('th') || row.querySelector('input')) continue;

      if (text.includes(caseNum)) {
        // Extract case name if available
        const match = text.match(new RegExp(caseNum + '\\s*[-–]\\s*([^\\n]+)'));
        const caseName = match ? match[1].trim().split('\n')[0].trim() : '';

        // Click on the row or a link within it
        const link = row.querySelector('a');
        if (link) {
          link.click();
        } else {
          row.click();
        }
        return { found: true, caseName: caseName.substring(0, 100), method: 'table row' };
      }
    }

    // Also look for links containing the case number (not in input fields)
    const links = document.querySelectorAll('a');
    for (const link of links) {
      const text = link.textContent || '';
      if (text.includes(caseNum) && !link.closest('form')) {
        const match = text.match(new RegExp(caseNum + '\\s*[-–]\\s*([^\\n]+)'));
        const caseName = match ? match[1].trim().split('\n')[0].trim() : '';
        link.click();
        return { found: true, caseName: caseName.substring(0, 100), method: 'link' };
      }
    }

    return { found: false };
  }, caseNumber);

  if (!caseFound.found) {
    progress(`Case ${caseNumber} not found in search results`);
    return null;
  }

  debug(`Found case: ${caseNumber} - ${caseFound.caseName}`);

  // Wait for case page to load
  await new Promise(resolve => setTimeout(resolve, 3000));

  return {
    caseNumber: caseNumber,
    caseName: caseFound.caseName,
    href: page.url()
  };
}

/**
 * Main scraping function
 */
async function main() {
  progress('Starting ND Supreme Court Brief Downloader');
  debug(`Configuration: ${JSON.stringify(CONFIG, null, 2)}`);

  const browser = await puppeteer.launch({
    headless: CONFIG.verbosity < 2, // Show browser in debug mode
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(CONFIG.timeout);

  // Track downloaded briefs to handle duplicates
  const downloadedBriefs = new Map(); // key: caseNumber_briefType, value: count

  try {
    let cases = [];

    // Check if we're searching for a specific case or using the calendar
    if (CONFIG.caseNumber) {
      // Single case mode - search by case number
      const caseInfo = await searchForCase(page, CONFIG.caseNumber);
      if (caseInfo) {
        cases = [caseInfo];
      } else {
        progress(`Could not find case ${CONFIG.caseNumber}`);
        await browser.close();
        return;
      }
    } else {
      // Calendar mode - get cases from calendar
      // Step 1: Navigate directly to cTrack portal with calendar
      const calendarUrl = buildCalendarUrl();
      progress(`Navigating to cTrack portal calendar (${CONFIG.days}-day view)...`);
      debug(`Calendar URL: ${calendarUrl}`);

    await page.goto(calendarUrl, { waitUntil: 'networkidle2' });
    debug(`Current URL: ${page.url()}`);

    // Step 2: Wait for the Angular/React app to render
    progress('Waiting for calendar to load...');

    // The cTrack portal is a JavaScript app, wait for content to appear
    // Look for common elements that indicate the page has loaded
    try {
      await page.waitForFunction(() => {
        // Check if there's any meaningful content loaded
        const body = document.body.innerText;
        return body.length > 500 && !body.includes("doesn't work properly without JavaScript");
      }, { timeout: CONFIG.timeout });
    } catch (e) {
      debug('Timeout waiting for page content, checking what we have...');
    }

    // Give extra time for dynamic content
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Take a screenshot to see what loaded
    if (CONFIG.verbosity >= 2) {
      const screenshotPath = path.join(CONFIG.downloadDir, 'calendar-page.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      debug(`Screenshot saved to: ${screenshotPath}`);
    }

    // Step 3: Extract case information from calendar
    progress('Extracting cases from calendar...');

    // Debug: Show page content
    const pageContent = await page.evaluate(() => document.body.innerText);
    debug(`Page text (first 1000 chars): ${pageContent.substring(0, 1000)}`);

    // Look for case numbers - they should be clickable links to case details
    cases = await page.evaluate(() => {
      const caseLinks = [];
      const seen = new Set();

      // Look for table cells containing case numbers in "Calendar Name" format:
      // "20250362 - Klebe v. Klebe"
      // Use td elements to avoid grabbing text from adjacent columns
      const cells = document.querySelectorAll('td, a');
      for (const cell of cells) {
        // Use only the cell's own text content, not descendant elements' text
        // For <a> tags use textContent directly; for <td> check innerText
        const text = cell.textContent.trim();

        const caseMatch = text.match(/\b(20\d{6})\s*-\s*/);
        if (!caseMatch || seen.has(caseMatch[1])) continue;

        // Extract case name: everything after "NUMBER - " up to the end of this cell's text,
        // but stop before common calendar column text that may bleed in
        const afterNumber = text.substring(caseMatch.index + caseMatch[0].length);
        // Take only the first line, and stop before "Oral Argument", "Reliable Electronic", etc.
        const caseName = afterNumber
          .split('\n')[0]
          .replace(/Oral Argument.*/, '')
          .replace(/Reliable Electronic.*/, '')
          .replace(/North Dakota Supreme Court.*/, '')
          .replace(/\d{2}\/\d{2}\/\d{4}.*/, '')
          .trim();

        const href = cell.tagName === 'A' ? cell.href : (cell.querySelector('a') || {}).href || null;

        seen.add(caseMatch[1]);
        caseLinks.push({
          caseNumber: caseMatch[1],
          caseName: caseName || '',
          href: href,
          text: text.substring(0, 100)
        });
      }

      return caseLinks;
    });

      progress(`Found ${cases.length} case(s) scheduled`);
      debug(`Cases: ${JSON.stringify(cases, null, 2)}`);
    } // end of calendar mode else block

    if (cases.length === 0) {
      progress('No cases found.');

      // Dump page content for debugging
      if (CONFIG.verbosity >= 2) {
        const content = await page.content();
        debug(`Page HTML (first 2000 chars): ${content.substring(0, 2000)}`);
      }

      await browser.close();
      return;
    }

    // Step 4: For each case, find and download briefs
    let totalBriefs = 0;

    for (const caseInfo of cases) {
      progress(`\nProcessing case ${caseInfo.caseNumber}${caseInfo.caseName ? ' - ' + caseInfo.caseName : ''}...`);

      // Create a fresh page for each case to avoid frame detachment issues
      let casePage;
      try {
        casePage = await browser.newPage();
        casePage.setDefaultTimeout(CONFIG.timeout);

        // Search for the case directly by case number
        const searchResult = await searchForCase(casePage, caseInfo.caseNumber);
        if (!searchResult) {
          progress(`  Could not find case ${caseInfo.caseNumber}`);
          await casePage.close().catch(() => {});
          continue;
        }

        const currentUrl = casePage.url();
        debug(`Current URL: ${currentUrl}`);

        // Wait for docket entries to load and scroll to ensure all content loads
        debug('Waiting for docket content to load...');
        try {
          await casePage.waitForFunction(
            () => document.body.innerText.toLowerCase().includes('docket entries') ||
                  document.body.innerText.toLowerCase().includes('filed date'),
            { timeout: 15000 }
          );
        } catch (e) {
          debug('Timeout waiting for docket content');
        }

        // Scroll down to trigger lazy loading of docket entries
        await casePage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(resolve => setTimeout(resolve, 2000));
        await casePage.evaluate(() => window.scrollTo(0, 0));
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Extract case title from the page if not already set
        if (!caseInfo.caseName) {
          const extractedTitle = await casePage.evaluate(() => {
            // Look for "Case View <title>" pattern in page text
            const pageText = document.body.innerText;
            const caseViewMatch = pageText.match(/Case View\s+([^\n]+)/i);
            if (caseViewMatch) {
              return caseViewMatch[1].trim();
            }
            // Also try looking for the case title element directly
            const titleEl = document.querySelector('h1, [class*="case-title"], [class*="caseTitle"]');
            if (titleEl) {
              const text = titleEl.textContent.trim();
              // Remove "Case View" prefix if present
              return text.replace(/^Case View\s*/i, '').trim();
            }
            return '';
          });
          if (extractedTitle) {
            caseInfo.caseName = extractedTitle;
            debug(`Extracted case title: "${extractedTitle}"`);
          }
        }

        // Take screenshot of case page for debugging
        if (CONFIG.verbosity >= 2) {
          const screenshotPath = path.join(CONFIG.downloadDir, `case-${caseInfo.caseNumber}.png`);
          await casePage.screenshot({ path: screenshotPath, fullPage: true });
          debug(`Case screenshot saved to: ${screenshotPath}`);
        }

        // Get page content for debugging
        const pageText = await casePage.evaluate(() => document.body.innerText);
        debug(`Case page text (first 1000 chars): ${pageText.substring(0, 1000)}`);

        // Debug: Check if "brief" appears anywhere on the page
        const hasBrief = pageText.toLowerCase().includes('brief');
        debug(`Page contains "brief": ${hasBrief}`);

        // Debug: Check for expandable sections like "DOCKET ENTRIES"
        const expandableSections = await casePage.evaluate(() => {
          const results = [];
          // Look for accordion headers or expandable sections
          const headers = document.querySelectorAll('[class*="expan"], [class*="accord"], [class*="collap"], [role="button"], h2, h3, .v-expansion-panel-header');
          for (const h of headers) {
            results.push({
              text: h.textContent.trim().substring(0, 50),
              tag: h.tagName,
              classes: h.className
            });
          }
          return results.slice(0, 20);
        });
        debug(`Expandable sections: ${JSON.stringify(expandableSections, null, 2)}`);

        // Try clicking on "DOCKET ENTRIES" to expand it
        const expandedDocket = await casePage.evaluate(() => {
          const elements = document.querySelectorAll('*');
          for (const el of elements) {
            const text = el.textContent.trim().toLowerCase();
            if (text === 'docket entries' || text.includes('docket entries')) {
              if (el.textContent.length < 50) {
                el.click();
                return { clicked: true, text: el.textContent.trim() };
              }
            }
          }
          return { clicked: false };
        });
        debug(`Expand docket result: ${JSON.stringify(expandedDocket)}`);

        if (expandedDocket.clicked) {
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Scroll within the docket section to load entries
          await casePage.evaluate(() => {
            const docketSection = document.querySelector('[class*="docket"], [class*="entries"]') ||
                                  document.querySelector('.v-data-table') ||
                                  document.body;
            if (docketSection) {
              docketSection.scrollTop = docketSection.scrollHeight;
            }
            window.scrollTo(0, document.body.scrollHeight / 2);
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Debug: Check the HTML structure of the page
        const htmlStructure = await casePage.evaluate(() => {
          // Get a sample of the HTML around "brief" text
          const bodyHtml = document.body.innerHTML;
          const briefIndex = bodyHtml.toLowerCase().indexOf('brief');
          if (briefIndex > -1) {
            return bodyHtml.substring(Math.max(0, briefIndex - 200), briefIndex + 300);
          }
          return 'brief not found in HTML';
        });
        debug(`HTML around "brief": ${htmlStructure.substring(0, 500)}`);

        // Debug: Show all buttons on the page (View buttons are likely buttons, not links)
        const pageButtons = await casePage.evaluate(() => {
          return Array.from(document.querySelectorAll('button, .link-button')).slice(0, 30).map(b => ({
            text: b.textContent.trim().substring(0, 50),
            classes: b.className,
            tag: b.tagName
          }));
        });
        debug(`Buttons on case page: ${JSON.stringify(pageButtons, null, 2)}`);

        // Also show rows that contain "brief"
        const briefRows = await casePage.evaluate(() => {
          const rows = document.querySelectorAll('tr');
          const results = [];
          for (const row of rows) {
            if (row.textContent.toLowerCase().includes('brief')) {
              results.push({
                text: row.textContent.trim().substring(0, 150),
                hasButton: !!row.querySelector('button'),
                hasLink: !!row.querySelector('a'),
                buttonText: row.querySelector('button')?.textContent?.trim()?.substring(0, 30),
                linkHref: row.querySelector('a')?.href?.substring(0, 80)
              });
            }
          }
          return results;
        });
        debug(`Rows containing "brief": ${JSON.stringify(briefRows, null, 2)}`);

        // Find all brief documents in the docket entries
        // The docket uses Vue/Vuetify table with data-header attributes
        // Structure: <tr> with <td data-header="Type">Brief</td>, <td data-header="Description">...<td>, <td data-header="View"><button>
        // We need to paginate through all docket pages to find all documents

        // Helper function to extract briefs from current page
        const extractBriefsFromPage = async () => {
          return await casePage.evaluate(() => {
            const briefLinks = [];

            const rows = document.querySelectorAll('tr');

            for (const row of rows) {
              const typeCell = row.querySelector('td[data-header="Type"]');
              const descCell = row.querySelector('td[data-header="Description"]');
              const subtypeCell = row.querySelector('td[data-header="Subtype"]');
              const viewCell = row.querySelector('td[data-header="View"]');

              const typeText = typeCell?.textContent?.trim().toLowerCase() || '';
              const descText = descCell?.textContent?.trim() || '';
              const subtypeText = subtypeCell?.textContent?.trim() || '';

              const descLower = descText.toLowerCase();

              // Check if this row is a brief or notice of appeal
              // Only match rows where the Type is "Brief", not notices/motions that mention briefs
              const isBrief = typeText === 'brief';
              // Match "Notice of Appeal" or "Amended Notice of Appeal" exactly (at start of description)
              // Skip "Notice of Filing...", "Notice - From Clerk", "Motion for Extension..." etc.
              const isNoticeOfAppeal = descLower.startsWith('notice of appeal') ||
                                       descLower.startsWith('amended notice of appeal');

              if (isBrief || isNoticeOfAppeal) {
                // Skip service documents
                if (typeText.includes('service') ||
                    descLower.startsWith('service document') ||
                    descLower.startsWith('service -') ||
                    descLower.includes('declaration of service')) {
                  continue;
                }

                // Build document name from description and subtype
                let briefName = descText || subtypeText + ' Brief' || 'Unknown Brief';

                // Find the View button
                const viewButton = viewCell?.querySelector('button') || row.querySelector('button.v-btn');

                if (viewButton) {
                  briefLinks.push({
                    name: briefName,
                    rowIndex: Array.from(document.querySelectorAll('tr')).indexOf(row),
                    type: typeText,
                    subtype: subtypeText
                  });
                }
              }
            }

            return briefLinks;
          });
        };

        // Helper to check if there's a next page and click it
        const goToNextPage = async () => {
          return await casePage.evaluate(() => {
            // Look for the "Go forward to page X" button
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
              const text = btn.textContent || '';
              if (text.includes('Go forward to page') && !btn.disabled) {
                btn.click();
                return true;
              }
            }
            return false;
          });
        };

        // Collect briefs from all pages
        const allBriefs = [];
        const seenDescriptions = new Set();
        let pageNum = 1;
        const maxPages = 10; // Safety limit

        while (pageNum <= maxPages) {
          debug(`Scanning docket page ${pageNum}...`);

          const pageBriefs = await extractBriefsFromPage();
          debug(`  Found ${pageBriefs.length} document(s) on page ${pageNum}`);

          // Add new briefs (avoiding duplicates)
          for (const brief of pageBriefs) {
            if (!seenDescriptions.has(brief.name)) {
              seenDescriptions.add(brief.name);
              // Store the page number so we know which page to navigate to for download
              brief.pageNum = pageNum;
              allBriefs.push(brief);
            }
          }

          // Try to go to next page
          const hasNextPage = await goToNextPage();
          if (!hasNextPage) {
            debug(`  No more pages after page ${pageNum}`);
            break;
          }

          // Wait for the new page to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          pageNum++;
        }

        const briefs = allBriefs;
        debug(`Found ${briefs.length} document(s) total for case ${caseInfo.caseNumber}`);
        debug(`Documents: ${JSON.stringify(briefs, null, 2)}`);

        if (briefs.length === 0) {
          progress(`  No briefs or notices found for case ${caseInfo.caseNumber}`);
          continue;
        }

        // Download each brief/document by clicking View buttons
        for (let briefIndex = 0; briefIndex < briefs.length; briefIndex++) {
          const brief = briefs[briefIndex];

          // Generate unique filename
          const key = `${caseInfo.caseNumber}_${abbreviateBriefType(brief.name)}`;
          const count = (downloadedBriefs.get(key) || 0) + 1;
          downloadedBriefs.set(key, count);

          const filename = generateFilename(
            caseInfo.caseNumber,
            caseInfo.caseName,
            brief.name,
            count > 1 ? count : null
          );

          debug(`Document ${briefIndex + 1}/${briefs.length}: "${brief.name}" -> ${filename} (page ${brief.pageNum})`);

          // Create a fresh page for each brief to avoid frame detachment
          let briefPage;
          let briefClient;
          try {
            briefPage = await browser.newPage();
            briefPage.setDefaultTimeout(CONFIG.timeout);

            // Navigate to case page
            await briefPage.goto(currentUrl, { waitUntil: 'networkidle2' });
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Expand docket entries
            await briefPage.evaluate(() => {
              const elements = document.querySelectorAll('*');
              for (const el of elements) {
                const text = el.textContent.trim().toLowerCase();
                if (text === 'docket entries' || text.includes('docket entries')) {
                  if (el.textContent.length < 50) {
                    el.click();
                    return;
                  }
                }
              }
            });
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Navigate to the correct page if needed
            if (brief.pageNum > 1) {
              debug(`  Navigating to docket page ${brief.pageNum}...`);
              for (let p = 1; p < brief.pageNum; p++) {
                const clicked = await briefPage.evaluate(() => {
                  const buttons = document.querySelectorAll('button');
                  for (const btn of buttons) {
                    const text = btn.textContent || '';
                    if (text.includes('Go forward to page') && !btn.disabled) {
                      btn.click();
                      return true;
                    }
                  }
                  return false;
                });
                if (!clicked) break;
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }

            briefClient = await briefPage.createCDPSession();
            await briefClient.send('Network.enable');

          try {
            // Set up network monitoring to capture PDF URL
            let pdfUrl = null;
            let documentUuid = null;
            const networkRequests = [];

            // Use a promise to wait for the document UUID to be captured
            let resolveUuidPromise;
            const uuidPromise = new Promise(resolve => {
              resolveUuidPromise = resolve;
              // Timeout after 5 seconds if no UUID found
              setTimeout(() => resolve(null), 5000);
            });

            const requestHandler = (params) => {
              const url = params.request.url;
              networkRequests.push(url);

              // Look for document-related URLs
              if (url.includes('document') || url.includes('pdf') || url.includes('blob')) {
                debug(`    Network request: ${url}`);
              }

              // Capture documentLinkUUID from API calls
              if (url.includes('docketentrydocumentsaccess') || url.includes('documentlink')) {
                debug(`    Document API call: ${url}`);
              }
            };

            const responseHandler = async (params) => {
              const url = params.response.url;
              const contentType = params.response.headers['content-type'] || params.response.headers['Content-Type'] || '';

              // Check if this is a PDF response
              if (contentType.includes('pdf') || url.endsWith('.pdf')) {
                debug(`    PDF response found: ${url}`);
                pdfUrl = url;
              }

              // Also check for JSON responses that might contain document URLs
              if (url.includes('docketentrydocumentsaccess') && contentType.includes('json')) {
                debug(`    Document metadata response: ${url}`);
                try {
                  // Wait a moment for the response body to be available
                  await new Promise(r => setTimeout(r, 100));

                  // Try to get the response body
                  const result = await briefClient.send('Network.getResponseBody', { requestId: params.requestId }).catch(() => null);
                  if (result && result.body) {
                    const data = JSON.parse(result.body);
                    debug(`    API response: ${JSON.stringify(data).substring(0, 300)}`);

                    // The API returns embedded results
                    if (data._embedded?.results?.[0]?.documentLinkUUID) {
                      documentUuid = data._embedded.results[0].documentLinkUUID;
                      debug(`    Found documentLinkUUID: ${documentUuid}`);
                      resolveUuidPromise(documentUuid);
                    } else if (data.documentLinkUUID) {
                      documentUuid = data.documentLinkUUID;
                      debug(`    Found documentLinkUUID: ${documentUuid}`);
                      resolveUuidPromise(documentUuid);
                    }
                  }
                } catch (e) {
                  debug(`    Could not parse response: ${e.message}`);
                }
              }
            };

            briefClient.on('Network.requestWillBeSent', requestHandler);
            briefClient.on('Network.responseReceived', responseHandler);

            // Click the View button for this brief (find by description text)
            const downloadStarted = await briefPage.evaluate((briefName) => {
              const rows = document.querySelectorAll('tr');
              for (const row of rows) {
                const descCell = row.querySelector('td[data-header="Description"]');
                const descText = descCell?.textContent?.trim() || '';

                if (descText === briefName) {
                  const viewButton = row.querySelector('td[data-header="View"] button') ||
                                     row.querySelector('button.v-btn');
                  if (viewButton) {
                    viewButton.click();
                    return true;
                  }
                }
              }
              return false;
            }, brief.name);

            if (downloadStarted) {
              // Wait for the API call to complete and capture documentLinkUUID
              debug(`  Waiting for document UUID...`);
              const capturedUuid = await uuidPromise;
              documentUuid = capturedUuid || documentUuid;

              debug(`  documentUuid captured: ${documentUuid}`);

              // Get cookies from briefPage
              let cookieHeader = '';
              try {
                const cookies = await briefPage.cookies();
                cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                debug(`  Got ${cookies.length} cookies`);
              } catch (e) {
                debug(`  Could not get cookies: ${e.message}`);
              }

              // Close any extra tabs that might have been opened
              const allPages = await browser.pages();
              for (let i = allPages.length - 1; i >= 0; i--) {
                if (allPages[i] !== page && allPages[i] !== briefPage) {
                  await allPages[i].close().catch(() => {});
                }
              }

              // Try to download using documentLinkUUID directly
              if (documentUuid && cookieHeader) {
                debug(`  Using documentLinkUUID: ${documentUuid}`);

                // Try various URL patterns with the UUID
                const baseUrl = 'https://portal-api.ctrack.ndcourts.gov';
                // Get the docketEntryUUID from the network request URL if available
                const docketEntryMatch = networkRequests.find(u => u.includes('docketEntryUUID='));
                let docketEntryUuid = '';
                let caseInstanceUuid = '';
                if (docketEntryMatch) {
                  const docketMatch = docketEntryMatch.match(/docketEntryUUID=([^&]+)/);
                  const caseMatch = docketEntryMatch.match(/caseInstanceUUID=([^&]+)/);
                  docketEntryUuid = docketMatch ? docketMatch[1] : '';
                  caseInstanceUuid = caseMatch ? caseMatch[1] : '';
                  debug(`  docketEntryUUID: ${docketEntryUuid}`);
                  debug(`  caseInstanceUUID: ${caseInstanceUuid}`);
                }

                // The correct URL pattern is:
                // /courts/{courtId}/cms/case/{caseInstanceUUID}/docketentrydocuments/{docketEntryUUID}
                const courtId = '68f021c4-6a44-4735-9a76-5360b2e8af13';

                const urlPatterns = [
                  // Correct pattern - uses documentLinkUUID in the docketentrydocuments path
                  `${baseUrl}/courts/${courtId}/cms/case/${caseInstanceUuid}/docketentrydocuments/${documentUuid}`,
                ];

                for (const tryUrl of urlPatterns) {
                  debug(`  Trying URL: ${tryUrl}`);
                  try {
                    // Use Node.js native fetch instead of browser context
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);

                    const res = await fetch(tryUrl, {
                      headers: {
                        'Cookie': cookieHeader,
                        'Accept': 'application/pdf, */*',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                      },
                      signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    debug(`  Response: status=${res.status}, contentType=${res.headers.get('content-type')}`);

                    if (!res.ok) {
                      const text = await res.text().catch(() => '');
                      debug(`  Error response: ${text.substring(0, 200)}`);
                      continue;
                    }

                    const contentType = res.headers.get('content-type') || '';
                    const buffer = await res.arrayBuffer();
                    const bytes = new Uint8Array(buffer.slice(0, 4));
                    const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

                    debug(`  isPdf=${isPdf}, size=${buffer.byteLength}`);
                    if (isPdf) {
                      // Write the PDF directly
                      const filePath = path.join(CONFIG.downloadDir, filename);
                      fs.writeFileSync(filePath, Buffer.from(buffer));
                      progress(`  Downloaded: ${filename} (${Math.round(buffer.byteLength / 1024)} KB)`);
                      totalBriefs++;
                      pdfUrl = tryUrl; // Mark as found
                      break;
                    } else {
                      debug(`  Not a PDF, preview: ${new TextDecoder().decode(buffer.slice(0, 200))}`);
                    }
                  } catch (e) {
                    debug(`  URL ${tryUrl} failed: ${e.message}`);
                  }
                }

                if (!pdfUrl) {
                  debug(`  No working PDF URL found for ${brief.name}`);
                }
              } else if (pdfUrl) {
                // We found a PDF URL in network traffic
                debug(`  Downloading from network-captured URL: ${pdfUrl}`);
                const success = await downloadFile(briefPage, pdfUrl, filename);
                if (success) totalBriefs++;
              }

              // Close any modal that might be open
              await briefPage.keyboard.press('Escape').catch(() => {});
            } else {
              debug(`  Could not click View button for ${brief.name}`);
            }

            // Clean up handlers
            briefClient.off('Network.requestWillBeSent', requestHandler);
            briefClient.off('Network.responseReceived', responseHandler);

          } catch (error) {
            progress(`  ERROR downloading ${brief.name}: ${error.message}`);
            debug(`  Full error: ${error.stack}`);
          } finally {
            // Clean up briefPage and briefClient for this brief
            if (briefClient) {
              await briefClient.detach().catch(() => {});
            }
            if (briefPage) {
              await briefPage.close().catch(() => {});
            }
          }
          } catch (briefSetupError) {
            progress(`  ERROR setting up page for ${brief.name}: ${briefSetupError.message}`);
            debug(`  Full error: ${briefSetupError.stack}`);
            // Clean up if page was created but setup failed
            if (briefClient) {
              await briefClient.detach().catch(() => {});
            }
            if (briefPage) {
              await briefPage.close().catch(() => {});
            }
          }
        }

        // The old client reference is no longer needed

      } catch (error) {
        progress(`  ERROR processing case ${caseInfo.caseNumber}: ${error.message}`);
        debug(`  Full error: ${error.stack}`);
      } finally {
        // Close the case page to free resources
        if (casePage) {
          await casePage.close().catch(() => {});
        }
      }
    }

    progress(`\n========================================`);
    progress(`Download complete!`);
    progress(`Total briefs downloaded: ${totalBriefs}`);
    progress(`Files saved to: ${CONFIG.downloadDir}`);

  } catch (error) {
    progress(`FATAL ERROR: ${error.message}`);
    debug(`Stack trace: ${error.stack}`);

    // Take screenshot for debugging
    if (CONFIG.verbosity >= 2) {
      const screenshotPath = path.join(CONFIG.downloadDir, 'error-screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      debug(`Screenshot saved to: ${screenshotPath}`);
    }

  } finally {
    await browser.close();
  }
}

// Run the script
main().catch(console.error);
