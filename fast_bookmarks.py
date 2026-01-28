import pikepdf
import sys
import json

print("Extracting bookmark structure (fast method)...")
sys.stdout.flush()

pdf_path = '20250364_Hughes-v-Waters_MemoPacket.pdf'
pdf = pikepdf.open(pdf_path)
total_pages = len(pdf.pages)
print(f"Total pages: {total_pages}")
sys.stdout.flush()

# Build a page reference lookup dictionary first
print("Building page reference lookup...")
sys.stdout.flush()
page_lookup = {}
for i, page in enumerate(pdf.pages):
    page_lookup[id(page.obj)] = i + 1
print(f"Page lookup built with {len(page_lookup)} pages")
sys.stdout.flush()

def resolve_page_fast(dest, page_lookup):
    try:
        if dest is None:
            return None
        if isinstance(dest, pikepdf.Array):
            page_ref = dest[0]
        else:
            page_ref = dest
        return page_lookup.get(id(page_ref), None)
    except:
        return None

def get_bookmarks_flat(outline_item, page_lookup, parent_name=""):
    results = []
    for item in outline_item:
        title = str(item.title)
        page = None

        try:
            if item.destination is not None:
                page = resolve_page_fast(item.destination, page_lookup)
        except:
            pass

        # Collect top-level items and Record children
        if parent_name == "":
            results.append({"name": title, "page": page, "level": "top"})
        elif parent_name == "Record":
            results.append({"name": title, "page": page, "level": "record_item"})

        if item.children:
            results.extend(get_bookmarks_flat(item.children, page_lookup, title))

    return results

print("Extracting bookmarks...")
sys.stdout.flush()

outline = pdf.open_outline()
bookmarks = get_bookmarks_flat(outline.root, page_lookup)

print(f"\nTop-level documents:")
top_level = [b for b in bookmarks if b["level"] == "top"]
for b in top_level:
    print(f"  {b['name']} -> Page {b['page']}")

print(f"\nRecord items ({len([b for b in bookmarks if b['level'] == 'record_item'])}):")
record_items = [b for b in bookmarks if b["level"] == "record_item"]
for b in record_items:
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
pdf.close()
print("Done!")
