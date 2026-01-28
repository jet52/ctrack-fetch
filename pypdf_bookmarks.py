from PyPDF2 import PdfReader
import json
import sys

print("Loading PDF with PyPDF2...")
sys.stdout.flush()

pdf_path = '20250364_Hughes-v-Waters_MemoPacket.pdf'
reader = PdfReader(pdf_path)
total_pages = len(reader.pages)
print(f"Total pages: {total_pages}")
sys.stdout.flush()

def get_bookmarks_with_pages(outline, reader, parent_name=""):
    results = []
    for item in outline:
        if isinstance(item, list):
            # This is a nested list of children
            if results:
                parent = results[-1]["name"]
                results.extend(get_bookmarks_with_pages(item, reader, parent))
        else:
            title = item.title
            page_num = None
            try:
                page_num = reader.get_destination_page_number(item) + 1  # 1-indexed
            except:
                pass

            if parent_name == "":
                results.append({"name": title, "page": page_num, "level": "top"})
            elif parent_name == "Record":
                results.append({"name": title, "page": page_num, "level": "record_item"})

    return results

print("Extracting bookmarks...")
sys.stdout.flush()

outlines = reader.outline
bookmarks = get_bookmarks_with_pages(outlines, reader)

print(f"\nTop-level documents:")
top_level = [b for b in bookmarks if b["level"] == "top"]
for b in top_level:
    print(f"  {b['name']} -> Page {b['page']}")

print(f"\nRecord items ({len([b for b in bookmarks if b['level'] == 'record_item'])}):")
record_items = [b for b in bookmarks if b["level"] == "record_item"]
for b in record_items[:10]:
    print(f"  {b['name']} -> Page {b['page']}")
print("  ...")
for b in record_items[-5:]:
    print(f"  {b['name']} -> Page {b['page']}")

# Save to JSON
output = {
    "total_pages": total_pages,
    "top_level": top_level,
    "record_items": record_items
}

with open("bookmarks.json", "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2)

print(f"\nBookmark data saved to bookmarks.json")
print("Done!")
