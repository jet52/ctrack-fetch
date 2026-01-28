from PyPDF2 import PdfReader, PdfWriter
import json
import os
import re
import sys

def sanitize_filename(name):
    """Remove or replace invalid filename characters."""
    # Replace invalid chars with underscore
    invalid_chars = r'[<>:"/\\|?*]'
    name = re.sub(invalid_chars, '_', name)
    # Remove leading/trailing spaces and dots
    name = name.strip(' .')
    # Truncate to reasonable length
    if len(name) > 200:
        name = name[:200]
    return name

def split_pdf():
    print("Loading bookmark data...")
    sys.stdout.flush()

    with open("bookmarks.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    total_pages = data["total_pages"]
    top_level = data["top_level"]
    record_items = data["record_items"]

    print(f"Total pages: {total_pages}")
    print(f"Top-level items: {len(top_level)}")
    print(f"Record items: {len(record_items)}")
    sys.stdout.flush()

    # Create output directory
    output_dir = "split_output"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    print(f"Output directory: {output_dir}")
    sys.stdout.flush()

    # Load the source PDF
    print("\nLoading source PDF...")
    sys.stdout.flush()
    reader = PdfReader("20250364_Hughes-v-Waters_MemoPacket.pdf")

    # Build the list of documents to extract
    documents = []

    # Process top-level items (Memo, Briefs, ROA)
    # Skip "Record" as it's just a parent container
    top_items_to_extract = [item for item in top_level if item["name"] != "Record"]

    for i, item in enumerate(top_items_to_extract):
        start_page = item["page"]

        # Find end page (next item's start page - 1, or use record start)
        if i + 1 < len(top_items_to_extract):
            end_page = top_items_to_extract[i + 1]["page"] - 1
        else:
            # Last top-level item before Record, ends at page before first record item
            if record_items:
                end_page = record_items[0]["page"] - 1
            else:
                end_page = total_pages

        filename = sanitize_filename(item["name"]) + ".pdf"
        documents.append({
            "name": item["name"],
            "filename": filename,
            "start": start_page,
            "end": end_page
        })

    # Process record items
    for i, item in enumerate(record_items):
        start_page = item["page"]

        # Find end page
        if i + 1 < len(record_items):
            end_page = record_items[i + 1]["page"] - 1
        else:
            end_page = total_pages

        # Format filename: extract Rxx prefix and clean up the name
        name = item["name"]
        filename = sanitize_filename(name) + ".pdf"

        documents.append({
            "name": name,
            "filename": filename,
            "start": start_page,
            "end": end_page
        })

    print(f"\nTotal documents to extract: {len(documents)}")
    sys.stdout.flush()

    # Extract each document
    for i, doc in enumerate(documents):
        print(f"[{i+1}/{len(documents)}] Extracting: {doc['name']} (pages {doc['start']}-{doc['end']})")
        sys.stdout.flush()

        writer = PdfWriter()

        # Pages are 0-indexed in PyPDF2
        for page_num in range(doc["start"] - 1, doc["end"]):
            writer.add_page(reader.pages[page_num])

        output_path = os.path.join(output_dir, doc["filename"])
        with open(output_path, "wb") as output_file:
            writer.write(output_file)

    print(f"\n{'='*50}")
    print(f"COMPLETE! Extracted {len(documents)} documents to '{output_dir}/'")
    print(f"{'='*50}")

    # Summary
    briefs = [d for d in documents if "Brief" in d["name"]]
    records = [d for d in documents if d["name"].startswith("R") and d["name"][1].isdigit()]
    memo = [d for d in documents if "Memo" in d["name"]]
    roa = [d for d in documents if "ROA" in d["name"]]

    print(f"\nSummary:")
    print(f"  - Memo: {len(memo)}")
    print(f"  - Briefs: {len(briefs)}")
    print(f"  - ROA: {len(roa)}")
    print(f"  - Record items: {len(records)}")
    print(f"  - Total: {len(documents)}")

if __name__ == "__main__":
    split_pdf()
