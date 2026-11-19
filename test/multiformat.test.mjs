import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMultiFormat, MULTIFORMAT_ACCEPT } from '../src/engine/multiformat.js';

test('multi-format import supports the announced file extensions', () => {
  for (const ext of ['csv','xlsx','xls','json','jsonl','xml','parquet','txt','pdf','docx','pptx','odt','odp','ods','zip','png','jpg','mp3','wav','md','html','rtf']) assert.ok(MULTIFORMAT_ACCEPT.includes(`.${ext}`), `missing ${ext}`);
});
test('extracts tabular CSV into rows for the quality engine', async () => {
  const f=new File(['Name,Age\nA,12\nB,'], 'sample.csv',{type:'text/csv'});
  const d=await extractMultiFormat(f);
  assert.deepEqual(d.columns,['Name','Age']);assert.equal(d.rows.length,2);assert.equal(d.format,'CSV');
});
test('extracts text files into line records', async () => {
  const f=new File(['alpha\nbeta\n'], 'notes.txt',{type:'text/plain'});
  const d=await extractMultiFormat(f);
  assert.equal(d.format,'TEXT');assert.equal(d.rows.length,3);assert.equal(d.rows[1][1],'beta');
});
test('rejects unsupported extensions with a useful message', async () => {
  const f=new File(['x'], 'unknown.xyz');
  await assert.rejects(()=>extractMultiFormat(f),/Unsupported file type/);
});
