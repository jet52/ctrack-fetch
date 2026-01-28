# ctrack-fetch

Downloads briefs and documents from the North Dakota Supreme Court [cTrack portal](https://portal.ctrack.ndcourts.gov). Can download all briefs for cases on the upcoming calendar or target a specific case by number.

Also includes Python utilities for extracting bookmarks from and splitting large PDF memo packets.

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- Python 3.8+ (only needed for the PDF utilities)

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
node download-briefs.js
```

This downloads briefs for all cases scheduled in the next 7 days.

### Download briefs for a specific case

```
node download-briefs.js -c 20250384
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

### Examples

```
node download-briefs.js -v                    # With debug output
node download-briefs.js -o ~/briefs           # Save to specific directory
node download-briefs.js -d 14                 # Look ahead 14 days
node download-briefs.js -c 20250339           # Specific case
node download-briefs.js -v -o ~/briefs -d 7   # Combine options
```

## PDF Utilities

These Python scripts process the large memo packet PDFs that the court distributes for oral argument cases.

### Extract bookmarks

Extracts the bookmark/table of contents structure from a memo packet PDF and saves it as JSON:

```
pip install pikepdf
python fast_bookmarks.py
```

Alternative using PyPDF2:

```
pip install PyPDF2
python pypdf_bookmarks.py
```

> Both scripts currently have the input PDF path hardcoded. Edit the `pdf_path` variable at the top of the script to point to your file.

### Split a memo packet

Splits a memo packet PDF into individual documents (memo, briefs, record items) based on the extracted bookmark data:

```
pip install PyPDF2
python fast_bookmarks.py       # generates bookmarks.json
python split_pdf.py            # splits PDF into split_output/
```

> The source PDF path is hardcoded in `split_pdf.py`. Edit the filename on the `PdfReader(...)` line to match your file.
