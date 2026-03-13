# ctrack-fetch

Downloads briefs and documents from the North Dakota Supreme Court public [cTrack portal](https://portal.ctrack.ndcourts.gov). Can download all briefs for cases on the upcoming calendar, target a specific case by number, or download all documents for a case.

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

> `npm install` downloads Puppeteer and a bundled Chromium browser (~150 MB). This only needs to happen once.

## Usage

### Download briefs from the calendar

```
node ctrack-fetch.js
```

This downloads briefs for all cases scheduled in the next 7 days. No login is required — the script uses the public cTrack portal as an anonymous visitor.

### Download briefs for a specific case

```
node ctrack-fetch.js -c 20250384
```

### Download all documents for a case

```
node ctrack-fetch.js -c 20250384 -a
```

This downloads every document with a viewable attachment (motions, notices, affidavits, etc.), not just briefs and notices of appeal. Service documents are always skipped.

### npm scripts

```
npm run download               # Normal run
npm run download:debug         # Opens visible browser, verbose output
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

### Examples

```
node ctrack-fetch.js -v                    # With debug output
node ctrack-fetch.js -o ~/briefs           # Save to specific directory
node ctrack-fetch.js -d 14                 # Look ahead 14 days
node ctrack-fetch.js -c 20250339           # Specific case
node ctrack-fetch.js -c 20250339 -a        # All documents for a case
node ctrack-fetch.js -v -o ~/briefs -d 7   # Combine options
```

