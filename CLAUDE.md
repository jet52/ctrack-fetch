# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ctrack-fetch is a Node.js script that downloads briefs and documents from the North Dakota Supreme Court cTrack portal (`https://portal.ctrack.ndcourts.gov`). It has two modes: calendar mode (cases scheduled in the next N days) and single-case mode (`-c` flag).

It talks **directly to the cTrack JSON APIs over HTTP** (`https://portal-api.ctrack.ndcourts.gov`). There is no browser, no scraping, and no external dependency — just Node's built-in `fetch`.

## Commands

```bash
npm install                    # No runtime deps; just sets up the lockfile
npm run download               # Normal run with timestamp logging
npm run download:debug         # Verbose/debug output (-v)
npm run download:silent        # No console output (-q)
node ctrack-fetch.js [options] # Direct execution
```

Key flags: `-v` verbose, `-q` quiet, `-o DIR` output dir, `-d N` days lookahead (default 7), `-c NUMBER` specific 8-digit case number, `-a` download all documents (not just briefs/NOA), `-O` opinions only, `-t N` per-request HTTP timeout in seconds (default 90).

## Architecture

The entire application is a single file: `ctrack-fetch.js` (~700 lines). Key sections in order:

1. **CLI argument parsing** - custom arg parser, no external CLI library
2. **`BRIEF_TYPE_MAP` / `abbreviateBriefType`** - maps docket entry descriptions to abbreviated brief type codes (e.g., `Apt-Br`, `Ape-Br`); opinions keyed on the Subtype
3. **HTTP layer** - `httpFetch` (per-request timeout via `AbortSignal.timeout`, retries on network errors and 5xx/429) and `getJson`
4. **`resolveCase`** - case number → `caseInstanceUUID` via the `/courts/cms/cases` search API
5. **`getDocketEntries`** - one call to `/cms/cases/{uuid}/docketentries?size=500&sort=...filedDate,desc`; assigns each entry a `docketId` (oldest = 1)
6. **`shouldInclude`** - classification (brief / notice of appeal / opinion / all), skipping service documents
7. **`getDocumentLinks` + `downloadDocument`** - per docket entry, fetch `documentLinkUUID`(s) from `docketentrydocumentsaccess`, then GET the PDF directly
8. **`getCalendarCases`** - parses case numbers from the `/courts/cms/events` calendar API

### cTrack JSON APIs (all anonymous, no auth)

- **Case search**: `/courts/cms/cases?caseHeader.caseNumber={N}&caseHeader.caseNumberSearchType=10463&caseHeader.courtID={courtId}` → `caseInstanceUUID`, `caseTitle`
- **Docket entries**: `/courts/{courtId}/cms/cases/{caseUUID}/docketentries?size=500&sort=docketEntryHeader.filedDate,desc` → all entries with `docketEntryUUID`, `docketEntryType`, `docketEntrySubType`, `docketEntryDescription`, `documentCount`
- **Document links**: `/courts/cms/docketentrydocumentsaccess?...&docketEntryHeader.docketEntryUUID={de}&caseHeader.caseInstanceUUID={caseUUID}` → `documentLinkUUID`(s)
- **PDF**: `/courts/{courtId}/cms/case/{caseUUID}/docketentrydocuments/{documentLinkUUID}` (note singular `case`)
- **Calendar**: `/courts/cms/events?startDateFrom={ISO}&startDateTo={ISO}&courtID={courtId}` → `eventName` like `"20990338 - Doe v. Roe"`

The `courtId` for the ND Supreme Court is the fixed UUID `68f021c4-6a44-4735-9a76-5360b2e8af13`. Downloaded PDFs are validated by checking for `%PDF` magic bytes.

### Classification (API field mapping)

The portal's docket table columns map to API fields: Type = `docketEntryType`, Subtype = `docketEntrySubType`, Description = `docketEntryDescription`. Opinions (including corrected/amended) are identified by `docketEntrySubType === "Opinion"`; non-document opinion entries (dispositions, split-opinion holdings) carry a different subtype and have `documentCount: null`, so requiring `documentCount >= 1` excludes them.

### Filename Convention

`{caseNumber}_{docketId}_{briefType}[{index}].pdf` — e.g., `20260027_015_Resp-Br.pdf`. The `docketId` is a zero-padded sequential number (oldest entry = 001) derived from the entry's chronological position. To reproduce it, the docket is consumed newest-first (`filedDate,desc`) and `docketId = totalEntries - position + 1`. `generateFilename` strips path-illegal characters (e.g. the `/` in "and/or") from the abbreviation.

### Error Handling

Each case and each document download is wrapped in try-catch so failures don't halt the batch. `httpFetch` retries transient failures; the per-request timeout is configurable with `-t` (large PDFs on a slow portal can exceed the 90s default).

## Authentication

None. All cTrack data APIs are served anonymously. No credentials, cookies, or sessions are used.

## Dependencies

None at runtime. Requires Node ≥ 18 (for built-in `fetch` and `AbortSignal.timeout`). No build step, no transpilation.
