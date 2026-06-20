# ctrack-fetch

Downloads docket documents from the North Dakota Supreme Court public [cTrack portal](https://portal.ctrack.ndcourts.gov). By default it fetches the briefs and notices of appeal for cases on the upcoming calendar or for a specific case by number. It can also target other docket entries — published opinions (including corrected, amended, on-rehearing, and on-motion opinions) — or download every document on a case's docket.

## Requirements

- [Node.js](https://nodejs.org/) v18 or later

## Installation

### Windows

1. Download and install Node.js from https://nodejs.org/ (LTS version recommended).
2. Open **Command Prompt** or **PowerShell**.
3. Clone the repository and install dependencies:

```
git clone https://github.com/jet52/ctrack-fetch.git
cd ctrack-fetch
npm install
```

### macOS

1. Install Node.js using [Homebrew](https://brew.sh/) or download from https://nodejs.org/:

```
brew install node
```

2. Clone the repository and install dependencies:

```
git clone https://github.com/jet52/ctrack-fetch.git
cd ctrack-fetch
npm install
```

### Linux

1. Install Node.js using your package manager. For Ubuntu/Debian:

```
sudo apt update
sudo apt install nodejs npm
```

For Fedora:

```
sudo dnf install nodejs npm
```

2. Clone the repository and install dependencies:

```
git clone https://github.com/jet52/ctrack-fetch.git
cd ctrack-fetch
npm install
```

> ctrack-fetch has **no runtime dependencies** — it uses Node's built-in `fetch` to talk to the cTrack JSON APIs directly. `npm install` just sets up the lockfile; nothing is downloaded.

## Usage

### Download briefs from the calendar

```
node ctrack-fetch.js
```

This downloads briefs for all cases scheduled in the next 7 days. No login is required — the script uses the public cTrack portal as an anonymous visitor.

### Download briefs for a specific case

```
node ctrack-fetch.js -c 20990002
```

### Download all documents for a case

```
node ctrack-fetch.js -c 20990002 -a
```

This downloads every docket entry that has a downloadable document (motions, notices, affidavits, etc.), not just briefs and notices of appeal. Service documents are always skipped.

### Download only the opinion(s) for a case

```
node ctrack-fetch.js -c 20990002 -O
```

This downloads only published opinions, skipping briefs and everything else. A single docket may hold more than one opinion — the original plus any corrected, amended, on-rehearing, or on-motion opinions — and each is saved under a distinct name. `-O` overrides `-a`.

### npm scripts

```
npm run download               # Normal run
npm run download:debug         # Verbose/debug output
npm run download:silent        # No console output
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-h, --help` | Show help message | |
| `-v, --verbose` | Enable debug output | |
| `-q, --quiet` | Silent mode (no output) | |
| `-o, --output DIR` | Output directory for downloaded PDFs | current directory |
| `-d, --days N` | Number of days to look ahead on calendar | 7 |
| `-c, --case NUMBER` | Download briefs for a specific 8-digit case number | |
| `-a, --all` | Download all documents, not just briefs/NOA | |
| `-O, --opinions` | Download only opinions (incl. corrected/amended); overrides `-a` | |
| `-t, --timeout N` | Per-request HTTP timeout in seconds (raise for very large PDFs on a slow day) | 90 |

### Examples

```
node ctrack-fetch.js -v                    # With debug output
node ctrack-fetch.js -o ~/briefs           # Save to specific directory
node ctrack-fetch.js -d 14                 # Look ahead 14 days
node ctrack-fetch.js -c 20990001           # Specific case
node ctrack-fetch.js -c 20990001 -a        # All documents for a case
node ctrack-fetch.js -c 20990001 -O        # Only the opinion(s) for a case
node ctrack-fetch.js -v -o ~/briefs -d 7   # Combine options
```


## Contributing

On a fresh clone, activate the local pre-push sensitive-content check:

```bash
git config --local core.hooksPath .githooks
```

It scans commits being pushed for likely ND court dockets, confidential-case
captions, and committed binaries. Bypass once with `git push --no-verify`.
