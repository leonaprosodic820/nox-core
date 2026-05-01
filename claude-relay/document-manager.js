'use strict';
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DOCS_DIR = path.join(os.homedir(), 'claude-relay/knowledge/documents');
fs.mkdirSync(DOCS_DIR, { recursive: true });

function runPython(script) {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', script]);
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', () => {
      try { resolve(JSON.parse(out)); }
      catch(e) { resolve({ error: err.slice(0, 300) || 'Python parse error' }); }
    });
  });
}

async function readDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const safe = filePath.replace(/'/g, "\\'");
  switch(ext) {
    case '.pdf': return runPython(`
import json
try:
    import pdfplumber
    with pdfplumber.open('${safe}') as pdf:
        text = ""
        for i, page in enumerate(pdf.pages):
            t = page.extract_text() or ""
            text += f"[Page {i+1}]\\n{t}\\n\\n"
        print(json.dumps({"success":True,"text":text[:8000],"pages":len(pdf.pages)}))
except Exception as e:
    try:
        from pypdf import PdfReader
        r = PdfReader('${safe}')
        text = "\\n".join(p.extract_text() or '' for p in r.pages)
        print(json.dumps({"success":True,"text":text[:8000],"pages":len(r.pages)}))
    except Exception as e2:
        print(json.dumps({"error":str(e2)}))`);
    case '.docx': return runPython(`
import json
from docx import Document
doc = Document('${safe}')
text = "\\n".join(p.text for p in doc.paragraphs if p.text.strip())
print(json.dumps({"success":True,"text":text[:8000],"paragraphs":len(doc.paragraphs)}))`);
    case '.xlsx': return runPython(`
import json, openpyxl
wb = openpyxl.load_workbook('${safe}', read_only=True)
result = {}
for sheet in wb.sheetnames[:5]:
    ws = wb[sheet]
    rows = [[str(c.value or '') for c in row] for row in list(ws.rows)[:100]]
    result[sheet] = rows
wb.close()
print(json.dumps({"success":True,"sheets":result,"sheet_count":len(wb.sheetnames)}))`);
    case '.pptx': return runPython(`
import json
from pptx import Presentation
prs = Presentation('${safe}')
slides = []
for i, slide in enumerate(prs.slides):
    texts = [shape.text.strip() for shape in slide.shapes if hasattr(shape,'text') and shape.text.strip()]
    slides.append({"slide":i+1,"content":" | ".join(texts)})
print(json.dumps({"success":True,"slides":slides,"slide_count":len(prs.slides)}))`);
    case '.txt': case '.md': case '.js': case '.py': case '.json': case '.csv':
      return { success: true, text: fs.readFileSync(filePath, 'utf8').slice(0, 8000), type: ext };
    default:
      return { error: 'Format non supporté: ' + ext };
  }
}

async function analyzeDocument(filePath, question) {
  const content = await readDocument(filePath);
  if (content.error) return content;
  const bridge = require('./claude-api-bridge');
  const fname = path.basename(filePath);
  let ctx = '';
  if (content.text) ctx = content.text.slice(0, 6000);
  else if (content.sheets) {
    const first = Object.entries(content.sheets)[0];
    ctx = 'Feuille "' + first[0] + '":\n' + first[1].slice(0, 20).map(r => r.join(' | ')).join('\n');
  } else if (content.slides) {
    ctx = content.slides.map(s => 'Slide ' + s.slide + ': ' + s.content).join('\n');
  }
  const prompt = question
    ? 'Document: ' + fname + '\n\n' + ctx + '\n\nQuestion: ' + question
    : 'Analyse ce document "' + fname + '" et fournis: 1. Résumé 2. Points clés 3. Insights\n\nContenu:\n' + ctx;
  const resp = await bridge.call(prompt, { maxTokens: 2000 });
  const analysis = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
  return { success: true, file: fname, analysis, metadata: { pages: content.pages, slides: content.slide_count, sheets: content.sheet_count } };
}

async function createPDF(title, content, opts = {}) {
  const outPath = path.join(DOCS_DIR, (opts.filename || title.replace(/\s+/g, '-').toLowerCase()) + '.pdf');
  const safeTitle = title.replace(/'/g, "\\'");
  const safeContent = content.replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const r = await runPython(`
import json
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.enums import TA_CENTER
doc = SimpleDocTemplate('${outPath}', pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2.5*cm, bottomMargin=2*cm)
styles = getSampleStyleSheet()
styles.add(ParagraphStyle('CT', parent=styles['Title'], fontSize=24, spaceAfter=20, textColor=colors.HexColor('#1a1f4e'), alignment=TA_CENTER))
styles.add(ParagraphStyle('CH', parent=styles['Heading1'], fontSize=16, spaceAfter=12, spaceBefore=16, textColor=colors.HexColor('#4facfe')))
styles.add(ParagraphStyle('CB', parent=styles['Normal'], fontSize=11, leading=16, spaceAfter=10))
story = [Paragraph('${safeTitle}', styles['CT']), HRFlowable(width="100%", thickness=1, color=colors.HexColor('#4facfe')), Spacer(1, 20)]
for line in '${safeContent}'.split('\\\\n'):
    line = line.strip()
    if not line: story.append(Spacer(1, 6))
    elif line.startswith('# '): story.append(Paragraph(line[2:], styles['CH']))
    elif line.startswith('- '): story.append(Paragraph('\\u2022 ' + line[2:], styles['CB']))
    else: story.append(Paragraph(line, styles['CB']))
doc.build(story)
print(json.dumps({"success":True,"path":"${outPath}","filename":"${path.basename(outPath)}"}))
`);
  return r;
}

async function createDOCX(title, content, opts = {}) {
  const outPath = path.join(DOCS_DIR, (opts.filename || title.replace(/\s+/g, '-').toLowerCase()) + '.docx');
  const safeTitle = title.replace(/'/g, "\\'");
  const safeContent = content.replace(/'/g, "\\'").replace(/\n/g, '\\n');
  return runPython(`
import json
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
doc = Document()
doc.add_heading('${safeTitle}', 0).alignment = WD_ALIGN_PARAGRAPH.CENTER
for line in '${safeContent}'.split('\\\\n'):
    line = line.strip()
    if not line: doc.add_paragraph()
    elif line.startswith('# '): doc.add_heading(line[2:], 1)
    elif line.startswith('## '): doc.add_heading(line[3:], 2)
    elif line.startswith('- '): doc.add_paragraph(line[2:], style='List Bullet')
    else: doc.add_paragraph(line)
doc.save('${outPath}')
print(json.dumps({"success":True,"path":"${outPath}","filename":"${path.basename(outPath)}"}))
`);
}

async function createPPTX(title, slides, opts = {}) {
  const outPath = path.join(DOCS_DIR, (opts.filename || title.replace(/\s+/g, '-').toLowerCase()) + '.pptx');
  const slidesJson = JSON.stringify(slides).replace(/'/g, "\\'");
  return runPython(`
import json
from pptx import Presentation
from pptx.util import Inches
prs = Presentation()
prs.slide_width = Inches(13.33)
prs.slide_height = Inches(7.5)
for i, sd in enumerate(json.loads('${slidesJson}')):
    layout = prs.slide_layouts[0 if i==0 else 1]
    slide = prs.slides.add_slide(layout)
    if slide.shapes.title: slide.shapes.title.text = sd.get('title','')
    for ph in slide.placeholders:
        if ph.placeholder_format.idx == 1:
            c = sd.get('content','')
            if isinstance(c, list):
                ph.text_frame.paragraphs[0].text = c[0] if c else ''
                for item in c[1:]: ph.text_frame.add_paragraph().text = item
            else: ph.text_frame.paragraphs[0].text = str(c)
prs.save('${outPath}')
print(json.dumps({"success":True,"path":"${outPath}","filename":"${path.basename(outPath)}"}))
`);
}

async function createXLSX(title, data, opts = {}) {
  const outPath = path.join(DOCS_DIR, (opts.filename || title.replace(/\s+/g, '-').toLowerCase()) + '.xlsx');
  const dataJson = JSON.stringify(data).replace(/'/g, "\\'");
  return runPython(`
import json, openpyxl
wb = openpyxl.Workbook()
data = json.loads('${dataJson}')
if isinstance(data, dict):
    for name, rows in data.items():
        ws = wb.create_sheet(name[:31])
        for row in rows: ws.append(row)
    if 'Sheet' in wb.sheetnames: del wb['Sheet']
else:
    ws = wb.active
    ws.title = '${title.slice(0, 31).replace(/'/g, "\\'")}'
    for row in data: ws.append(row)
wb.save('${outPath}')
print(json.dumps({"success":True,"path":"${outPath}","filename":"${path.basename(outPath)}"}))
`);
}

async function generateDocument(request, format) {
  const bridge = require('./claude-api-bridge');
  const fmt = (format || 'pdf').toLowerCase();
  const instructions = fmt === 'pptx'
    ? '{"title":"...","slides":[{"title":"...","content":["point1","point2"]}]}'
    : fmt === 'xlsx'
    ? '{"title":"...","data":[["Col1","Col2"],["val1","val2"]]}'
    : '{"title":"...","content":"texte avec # H1, ## H2, - listes"}';
  const resp = await bridge.call(
    'Génère le contenu pour: "' + request + '"\nFormat JSON uniquement:\n' + instructions + '\nRéponds UNIQUEMENT avec le JSON.',
    { maxTokens: 2000 }
  );
  const raw = (typeof resp === 'string' ? resp : resp.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
  let structured;
  try { structured = JSON.parse(raw); } catch(e) { return { error: 'JSON invalide: ' + e.message }; }
  switch(fmt) {
    case 'pdf':  return createPDF(structured.title, structured.content);
    case 'docx': return createDOCX(structured.title, structured.content);
    case 'pptx': return createPPTX(structured.title, structured.slides);
    case 'xlsx': return createXLSX(structured.title, structured.data);
    default:     return { error: 'Format non supporté: ' + fmt };
  }
}

function listDocuments() {
  return fs.readdirSync(DOCS_DIR)
    .filter(f => /\.(pdf|docx|xlsx|pptx|txt|md)$/i.test(f))
    .map(f => { const s = fs.statSync(path.join(DOCS_DIR, f)); return { name: f, size: s.size, modified: s.mtime }; })
    .sort((a, b) => b.modified - a.modified);
}

module.exports = { readDocument, analyzeDocument, createPDF, createDOCX, createPPTX, createXLSX, generateDocument, listDocuments, DOCS_DIR };
