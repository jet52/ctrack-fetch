# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ctrack-fetch is a Node.js Puppeteer script that downloads briefs and documents from the North Dakota Supreme Court cTrack portal (`https://portal.ctrack.ndcourts.gov`). It has two modes: calendar mode (scrapes upcoming cases) and single-case mode (`-c` flag).

## Commands

```bash
npm install                    # Install dependencies (Puppeteer + bundled Chromium)
npm run download               # Normal run with timestamp logging
npm run download:debug         # Opens visible browser, verbose output
npm run download:silent        # No console output
node ctrack-fetch.js [options] # Direct execution
```

Key flags: `-v` verbose, `-q` quiet, `-o DIR` output dir, `-d N` days lookahead (default 7), `-c NUMBER` specific 8-digit case number.

## Architecture

The entire application is a single file: `ctrack-fetch.js` (~1,300 lines). Key sections in order:

1. **CLI argument parsing** - custom arg parser, no external CLI library
2. **`BRIEF_TYPE_MAP`** - maps docket entry descriptions to abbreviated brief type codes (e.g., `Apt-Br`, `Ape-Br`)
3. **Calendar mode** - constructs date-filtered URL, parses calendar HTML to extract case numbers/titles
4. **Single-case mode** - navigates search UI to find a specific case
5. **Docket scraping** - paginates through docket entries looking for briefs/notices of appeal
6. **PDF download pipeline** - uses CDP network monitoring to capture `documentLinkUUID` from API responses, then constructs authenticated download URLs

### PDF Download Strategy

Downloads use Chrome DevTools Protocol (CDP) sessions to intercept network traffic. When a document link is clicked, the code monitors for API responses containing `documentLinkUUID`, then builds a direct download URL with the court ID and UUID. Falls back to direct fetch if capture fails. Downloaded PDFs are validated by checking for `%PDF` magic bytes.

### Filename Convention

`{caseNumber}_{caseTitle}_{briefType}[{index}].pdf` — e.g., `20250305_State-v-Landen_Apt-Br.pdf`

### Error Handling

Each case and each document download is wrapped in try-catch so failures don't halt the batch. Debug mode (`-v`) saves screenshots and logs page HTML for troubleshooting.

## Authentication

None. The script uses the public cTrack portal as an anonymous visitor. No login credentials are stored or used. Session cookies are obtained automatically during each run and discarded when the browser closes.

## Dependencies

Single dependency: `puppeteer` (^24.0.0). No build step, no transpilation.
