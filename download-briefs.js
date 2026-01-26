#!/usr/bin/env node

/**
 * ND Supreme Court Brief Downloader
 *
 * Downloads all briefs for cases scheduled in the next 7 days
 * from the ND Supreme Court calendar.
 *
 * Usage: node download-briefs.js [verbosity]
 *   verbosity: 0=silent, 1=normal (default), 2=debug
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  startUrl: 'https://www.ndcourts.gov/supreme-court/calendar#',
  // The cTrack portal URL with 7-day calendar filter
  // courtID is for Supreme Court, calendarDateChoice '7d' means 7 days
  ctrackCalendarUrl: 'https://portal.ctrack.ndcourts.gov/portal/search/calendar/results',
  downloadDir: process.cwd(),
  verbosity: parseInt(process.argv[2] || '1', 10),
  timeout: 30000,
};

/**
 * Build the cTrack calendar URL with proper date range
 */
function buildCalendarUrl() {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 7);

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

  // Check for partial matches
  for (const [pattern, abbrev] of Object.entries(BRIEF_TYPE_MAP)) {
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
 * Generate filename for a brief
 */
function generateFilename(caseNumber, briefType, index = null) {
  const formattedCase = formatCaseNumber(caseNumber);
  const abbrevType = abbreviateBriefType(briefType);
  const suffix = index !== null ? index : '';
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
    // Step 1: Navigate directly to cTrack portal with 7-day calendar
    const calendarUrl = buildCalendarUrl();
    progress('Navigating to cTrack portal calendar (7-day view)...');
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
    const cases = await page.evaluate(() => {
      const caseLinks = [];
      const seen = new Set();

      // First, look for links containing case numbers
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        const text = link.textContent.trim();
        const href = link.href;

        // Look for case number patterns (8 digits starting with 20)
        const caseMatch = text.match(/\b(20\d{6})\b/);
        if (caseMatch && !seen.has(caseMatch[1])) {
          seen.add(caseMatch[1]);
          caseLinks.push({
            caseNumber: caseMatch[1],
            href: href,
            text: text.substring(0, 100)
          });
        }
      }

      // Also look for any element containing case numbers that might be clickable
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = el.textContent || '';
        const caseMatch = text.match(/\b(20\d{6})\s*-\s*([^,\n]+)/);
        if (caseMatch && !seen.has(caseMatch[1])) {
          // Check if this element or a parent is clickable
          let clickable = el.closest('a, button, [onclick], [role="button"]');
          if (!clickable && el.tagName === 'A') clickable = el;

          // Also check if clicking would navigate (has href in URL pattern)
          const href = clickable ? clickable.href : null;

          seen.add(caseMatch[1]);
          caseLinks.push({
            caseNumber: caseMatch[1],
            caseName: caseMatch[2].trim(),
            href: href,
            text: text.substring(0, 100).trim()
          });
        }
      }

      return caseLinks;
    });

    progress(`Found ${cases.length} case(s) scheduled`);
    debug(`Cases: ${JSON.stringify(cases, null, 2)}`);

    if (cases.length === 0) {
      progress('No cases found. Page structure may have changed.');

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

        // Navigate to calendar page
        const calendarUrl = buildCalendarUrl();
        await casePage.goto(calendarUrl, { waitUntil: 'networkidle2' });

        // Wait for the calendar content to load (SPA needs time)
        debug('Waiting for calendar content to load...');
        try {
          await casePage.waitForFunction(
            (caseNum) => document.body.innerText.includes(caseNum),
            { timeout: 15000 },
            caseInfo.caseNumber
          );
        } catch (e) {
          debug(`Timeout waiting for case ${caseInfo.caseNumber} to appear in calendar`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Click on the DATE link (not case number) in the calendar to navigate to case page
        // The date/time is the clickable link (shown in orange), not the case number
        debug(`Looking for date link associated with case ${caseInfo.caseNumber}...`);

        // Debug: look for date-like elements (they may not be <a> tags)
        const dateElementsDebug = await casePage.evaluate(() => {
          const results = [];
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            const text = (el.textContent || '').trim();
            // Look for elements containing date patterns
            if (text.match(/\d{2}\/\d{2}\/\d{4}/) && text.length < 100) {
              results.push({
                tag: el.tagName,
                text: text.substring(0, 60),
                classes: el.className,
                hasHref: !!el.href,
                isClickable: el.tagName === 'A' || el.tagName === 'BUTTON' || el.onclick !== null || el.getAttribute('role') === 'button'
              });
            }
          }
          return results;
        });
        debug(`Date-like elements: ${JSON.stringify(dateElementsDebug, null, 2)}`);

        const clickedCase = await casePage.evaluate((caseNum) => {
          // The dates are BUTTON elements with class "link-button", not <a> tags
          // Find the table row containing this case number and click its date button

          const rows = document.querySelectorAll('tr');
          for (const row of rows) {
            if (row.textContent.includes(caseNum)) {
              // Look for the date button in this row
              const dateButton = row.querySelector('button.link-button');
              if (dateButton) {
                dateButton.click();
                return {
                  clicked: true,
                  buttonText: dateButton.textContent.trim(),
                  method: 'date button in table row'
                };
              }

              // Also try any button in the row
              const anyButton = row.querySelector('button');
              if (anyButton) {
                anyButton.click();
                return {
                  clicked: true,
                  buttonText: anyButton.textContent.trim(),
                  method: 'any button in table row'
                };
              }
            }
          }

          // Fallback: look for button with date near case number
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            const text = el.textContent || '';
            if (text.includes(caseNum) && text.length < 500) {
              const dateButton = el.querySelector('button.link-button') || el.querySelector('button');
              if (dateButton && dateButton.textContent.match(/\d{2}\/\d{2}\/\d{4}/)) {
                dateButton.click();
                return {
                  clicked: true,
                  buttonText: dateButton.textContent.trim(),
                  method: 'date button in case container'
                };
              }
            }
          }

          return { clicked: false };
        }, caseInfo.caseNumber);

        debug(`Click result: ${JSON.stringify(clickedCase)}`);

        if (!clickedCase.clicked) {
          progress(`  Could not find date button for case ${caseInfo.caseNumber}`);
          continue;
        }

        // Wait for navigation to event details page
        await casePage.waitForNavigation({ waitUntil: 'networkidle2', timeout: CONFIG.timeout }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 2000));

        debug(`After clicking date, URL: ${casePage.url()}`);

        // Step 2: Now click on the case number link to get to the docket
        debug(`Looking for case number link (${caseInfo.caseNumber}) on event details page...`);

        const clickedCaseLink = await casePage.evaluate((caseNum) => {
          // Look for a link containing the case number
          const links = Array.from(document.querySelectorAll('a'));
          for (const link of links) {
            if (link.textContent.includes(caseNum)) {
              link.click();
              return {
                clicked: true,
                href: link.href,
                text: link.textContent.trim(),
                method: 'case number link'
              };
            }
          }

          // Also try buttons
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const button of buttons) {
            if (button.textContent.includes(caseNum)) {
              button.click();
              return {
                clicked: true,
                text: button.textContent.trim(),
                method: 'case number button'
              };
            }
          }

          return { clicked: false };
        }, caseInfo.caseNumber);

        debug(`Case link click result: ${JSON.stringify(clickedCaseLink)}`);

        if (!clickedCaseLink.clicked) {
          progress(`  Could not find case number link for ${caseInfo.caseNumber}`);
          continue;
        }

        // Wait for navigation to docket page
        await casePage.waitForNavigation({ waitUntil: 'networkidle2', timeout: CONFIG.timeout }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 2000));

        const currentUrl = casePage.url();
        debug(`After clicking case link, URL: ${currentUrl}`);

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
        const briefs = await casePage.evaluate(() => {
          const briefLinks = [];
          const seenDescriptions = new Set();

          // Look for table rows where Type or Description contains "brief"
          const rows = document.querySelectorAll('tr');

          for (const row of rows) {
            // Check if Type column contains "Brief" or Description mentions brief
            const typeCell = row.querySelector('td[data-header="Type"]');
            const descCell = row.querySelector('td[data-header="Description"]');
            const subtypeCell = row.querySelector('td[data-header="Subtype"]');
            const viewCell = row.querySelector('td[data-header="View"]');

            const typeText = typeCell?.textContent?.trim().toLowerCase() || '';
            const descText = descCell?.textContent?.trim() || '';
            const subtypeText = subtypeCell?.textContent?.trim() || '';

            // Check if this row is a brief entry
            if (typeText.includes('brief') || descText.toLowerCase().includes('brief')) {
              // Skip service documents - these are just proof of delivery, not actual briefs
              const descLower = descText.toLowerCase();
              if (typeText.includes('service') ||
                  descLower.startsWith('service document') ||
                  descLower.startsWith('service -') ||
                  descLower.includes('declaration of service')) {
                continue;
              }

              // Build brief name from description and subtype
              let briefName = descText || subtypeText + ' Brief' || 'Unknown Brief';

              // Avoid duplicates
              if (seenDescriptions.has(briefName)) continue;
              seenDescriptions.add(briefName);

              // Find the View button (v-btn class)
              const viewButton = viewCell?.querySelector('button') || row.querySelector('button.v-btn');

              if (viewButton) {
                briefLinks.push({
                  name: briefName,
                  buttonIndex: Array.from(document.querySelectorAll('button.v-btn')).indexOf(viewButton),
                  rowIndex: Array.from(document.querySelectorAll('tr')).indexOf(row),
                  type: typeText,
                  subtype: subtypeText
                });
              }
            }
          }

          return briefLinks;
        });

        debug(`Found ${briefs.length} brief(s) for case ${caseInfo.caseNumber}`);
        debug(`Briefs: ${JSON.stringify(briefs, null, 2)}`);

        if (briefs.length === 0) {
          progress(`  No briefs found for case ${caseInfo.caseNumber}`);
          continue;
        }

        // Download each brief by clicking View buttons
        for (let briefIndex = 0; briefIndex < briefs.length; briefIndex++) {
          const brief = briefs[briefIndex];

          // Generate unique filename
          const key = `${caseInfo.caseNumber}_${abbreviateBriefType(brief.name)}`;
          const count = (downloadedBriefs.get(key) || 0) + 1;
          downloadedBriefs.set(key, count);

          const filename = generateFilename(
            caseInfo.caseNumber,
            brief.name,
            count > 1 ? count : null
          );

          debug(`Brief ${briefIndex + 1}/${briefs.length}: "${brief.name}" -> ${filename}`);
          debug(`Row index: ${brief.rowIndex}`);

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

            // Click the View button for this brief
            const downloadStarted = await briefPage.evaluate((rowIndex) => {
              const rows = document.querySelectorAll('tr');
              if (rows[rowIndex]) {
                const viewButton = rows[rowIndex].querySelector('td[data-header="View"] button') ||
                                   rows[rowIndex].querySelector('button.v-btn');
                if (viewButton) {
                  viewButton.click();
                  return true;
                }
              }
              return false;
            }, brief.rowIndex);

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
