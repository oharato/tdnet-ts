import camelot
import sys
import os
import pypdf

def pdf_to_markdown(pdf_path):
    # Lattice mode extraction
    # lattice=True for lattice mode (works well with table borders)
    tables = camelot.read_pdf(pdf_path, pages='all', flavor='lattice')
    
    # Text extraction using pypdf
    reader = pypdf.PdfReader(pdf_path)
    
    md_output = []
    
    # Organize tables by page
    tables_by_page = {}
    for table in tables:
        page_num = table.page
        if page_num not in tables_by_page:
            tables_by_page[page_num] = []
        tables_by_page[page_num].append(table)
    
    for i, page in enumerate(reader.pages):
        page_num = i + 1
        
        # Add Page Header
        md_output.append(f"## Page {page_num}\n")
        
        # Add text (note: this might duplicate table content depending on extraction, 
        # but Camelot specifically targets lattice tables which regular extraction often mangles)
        text = page.extract_text()
        if text:
            md_output.append(text.strip())
            md_output.append("\n")
            
        # Add tables for this page
        if page_num in tables_by_page:
            for j, table in enumerate(tables_by_page[page_num]):
                md_output.append(f"### Table {j+1} (Page {page_num})")
                try:
                    md_output.append(table.df.to_markdown(index=False))
                except Exception as e:
                    md_output.append(f"Error rendering table: {e}")
                md_output.append("\n")
                
    return "\n".join(md_output)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pdf_to_md.py <pdf_path>")
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(f"File not found: {pdf_path}")
        sys.exit(1)
        
    try:
        # We need to supress potential Opencv warnings to stderr if they mess up
        print(pdf_to_markdown(pdf_path))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
