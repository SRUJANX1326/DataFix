import { parseDataset, fromObjects } from './parse.js';

const extOf = (name='') => name.split('.').pop().toLowerCase();
const base64FromBytes = (bytes) => { let out=''; const chunk=0x8000; for(let i=0;i<bytes.length;i+=chunk) out+=String.fromCharCode(...bytes.subarray(i,i+chunk)); return btoa(out); };
const rowsFromText = (text, label='Text') => {
  const lines = String(text||'').replace(/\r/g,'').split('\n');
  return { columns:['Line','Text','Characters'], rows:lines.map((line,i)=>[i+1,line,line.length]), format:label, filename:'' };
};
const paragraphsFromText = (text, label='Document') => {
  const parts = String(text||'').split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/).map(s=>s.trim()).filter(Boolean);
  return { columns:['Segment','Content','Characters','Words'], rows:parts.map((s,i)=>[i+1,s,s.length,s.split(/\s+/).filter(Boolean).length]), format:label, filename:'' };
};
const xmlText = (xml) => new DOMParser().parseFromString(xml,'text/xml').documentElement?.textContent || '';
async function extractOfficeZip(file, type) {
  const JSZip=(await import('jszip')).default; const zip=await JSZip.loadAsync(file); const textParts=[];
  if(type==='pptx') {
    const slideFiles=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)?.[1])-Number(b.match(/slide(\d+)/)?.[1]));
    for(let i=0;i<slideFiles.length;i++){ const xml=await zip.files[slideFiles[i]].async('text'); textParts.push({section:`Slide ${i+1}`,text:xmlText(xml)}); }
  } else if(type==='odt') {
    const xml=await zip.files['content.xml']?.async('text')||''; const extracted=xmlText(xml).replace(/\s+/g,' ').trim(); return paragraphsFromText(extracted,'ODT');
  } else if(type==='odp') {
    const xml=await zip.files['content.xml']?.async('text')||''; const extracted=xmlText(xml).replace(/\s+/g,' ').trim(); return paragraphsFromText(extracted,'ODP');
  } else if(type==='docx') {
    const docx=(await import('mammoth')).default; const result=await docx.extractRawText({arrayBuffer:await file.arrayBuffer()}); return paragraphsFromText(result.value,'DOCX');
  }
  return {columns:['Section','Text','Characters','Words'],rows:textParts.map(x=>[x.section,x.text,x.text.length,x.text.split(/\s+/).filter(Boolean).length]),format:'PPTX',filename:file.name};
}
export async function extractMultiFormat(file) {
  const ext=extOf(file.name); const bytes=await file.arrayBuffer();
  const structured=['csv','tsv','json','jsonl','ndjson','xml'];
  if(structured.includes(ext)) return {...parseDataset(await file.text(),file.name), filename:file.name};
  if(['xls','xlsx','ods'].includes(ext)) {
    const XLSX=(await import('xlsx')).default; const wb=XLSX.read(bytes,{type:'array',cellDates:false});
    const columns=[], rows=[];
    for(const sheetName of wb.SheetNames){ const data=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:null,raw:true}); if(!data.length)continue; const headers=data[0].map((v,i)=>String(v??`column_${i+1}`)); headers.forEach(h=>{if(!columns.includes(h))columns.push(h);}); for(const row of data.slice(1)) { const record=Object.fromEntries(headers.map((h,i)=>[h,row[i]??null])); rows.push(wb.SheetNames.length>1?{Sheet:sheetName,...record}:record); } }
    if(!rows.length)throw new Error('No data rows were found in the workbook.'); const ds=fromObjects(rows); return {...ds,format:ext.toUpperCase(),filename:file.name,sheetCount:wb.SheetNames.length};
  }
  if(ext==='zip') { if(file.size>50*1024*1024)throw new Error('ZIP exceeds 50 MB.'); const JSZip=(await import('jszip')).default; const zip=await JSZip.loadAsync(file); const candidates=Object.values(zip.files).filter(f=>!f.dir&&!f.name.includes('__MACOSX')&&!f.name.toLowerCase().endsWith('.zip')).slice(0,30); const extracted=[]; for(const child of candidates){const blob=await child.async('blob');const nested=new File([blob],child.name.split('/').pop(),{type:blob.type});try{const d=await extractMultiFormat(nested);for(const row of d.rows){const record=Object.fromEntries(d.columns.map((col,i)=>[col,row[i]??null]));extracted.push({Source_File:child.name,...record});}}catch{}} if(!extracted.length)throw new Error('No supported files were found inside this ZIP.'); return {...fromObjects(extracted),format:'ZIP ARCHIVE',filename:file.name}; }
  if(ext==='parquet') { const b64=base64FromBytes(new Uint8Array(bytes)); const resp=await fetch('/api/parquet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:b64,filename:file.name})}); const result=await resp.json(); if(!resp.ok)throw new Error(result.error||'Parquet conversion failed'); return {...fromObjects(result.rows),format:'PARQUET',filename:file.name}; }
  if(ext==='pdf') { const pdfjs=(await import('pdfjs-dist/legacy/build/pdf.mjs')); const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes),disableWorker:true}).promise; const rows=[]; const Tesseract=(await import('tesseract.js')).default; for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p);const content=await page.getTextContent();let text=content.items.map(x=>x.str).join(' ').trim(), confidence=null; if(!text&&p<=20){const viewport=page.getViewport({scale:1.35});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport}).promise;const ocr=await Tesseract.recognize(canvas,'eng');text=String(ocr.data.text||'').trim();confidence=Number(ocr.data.confidence||0);canvas.width=canvas.height=0;} rows.push([p,text,text.length,text.split(/\s+/).filter(Boolean).length,!text,confidence]);} return {columns:['Page','Text','Characters','Words','Blank page','OCR confidence %'],rows,format:'PDF',filename:file.name,pages:pdf.numPages}; }
  if(ext==='docx') return {...await extractOfficeZip(file,'docx'),filename:file.name};
  if(ext==='odt') return {...await extractOfficeZip(file,'odt'),filename:file.name};
  if(ext==='odp') return {...await extractOfficeZip(file,'odp'),filename:file.name};
  if(ext==='pptx') return {...await extractOfficeZip(file,'pptx'),filename:file.name};
  if(['txt','md','markdown','yaml','yml','log','sql','ini','cfg','eml'].includes(ext)) { let content=await file.text(); if(ext==='eml') content=content.replace(/\r/g,''); return {...rowsFromText(content,ext==='md'||ext==='markdown'?'MARKDOWN':ext==='txt'?'TEXT':ext.toUpperCase()),filename:file.name}; }
  if(ext==='rtf') { const text=(await file.text()).replace(/\\par[d]?/gi,'\n').replace(/\\'[0-9a-f]{2}/gi,'').replace(/\\[a-z]+-?\d* ?/gi,'').replace(/[{}]/g,''); return {...rowsFromText(text,'RTF'),filename:file.name}; }
  if(['html','htm'].includes(ext)) { const doc=new DOMParser().parseFromString(await file.text(),'text/html'); return {...paragraphsFromText(doc.body?.innerText||doc.body?.textContent||'','HTML'),filename:file.name}; }
  if(['png','jpg','jpeg','webp','bmp','tif','tiff','gif'].includes(ext)) { const Tesseract=(await import('tesseract.js')).default; const result=await Tesseract.recognize(file,'eng'); return {...paragraphsFromText(result.data.text,'IMAGE OCR'),filename:file.name,ocrConfidence:result.data.confidence}; }
  if(['mp3','wav','m4a','ogg','webm','flac','aac'].includes(ext)) { if(file.size>3*1024*1024)throw new Error('Audio file exceeds 3 MB for web upload. Please trim or compress it before retrying.'); const b64=base64FromBytes(new Uint8Array(bytes)); const resp=await fetch('/api/transcribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:b64,filename:file.name,mime:file.type})}); const result=await resp.json(); if(!resp.ok)throw new Error(result.error||'Audio transcription failed'); return {...paragraphsFromText(result.text||'','AUDIO TRANSCRIPT'),filename:file.name,transcriptionModel:result.model}; }
  throw new Error(`Unsupported file type: .${ext}. Supported formats are listed in the DataFix file support panel.`);
}
export const MULTIFORMAT_ACCEPT='.csv,.tsv,.xls,.xlsx,.ods,.json,.jsonl,.ndjson,.xml,.parquet,.txt,.md,.markdown,.rtf,.html,.htm,.pdf,.docx,.pptx,.odt,.odp,.zip,.yaml,.yml,.log,.sql,.ini,.cfg,.eml,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.gif,.mp3,.wav,.m4a,.ogg,.webm,.flac,.aac';
