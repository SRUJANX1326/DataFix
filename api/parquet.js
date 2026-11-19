import fs from 'node:fs/promises';
import path from 'node:path';
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'POST only'});
 let tmp;
 try{
  const data=req.body?.data;if(!data)return res.status(400).json({error:'No Parquet file data received.'});
  const buffer=Buffer.from(data,'base64');if(buffer.length>30*1024*1024)return res.status(413).json({error:'Parquet file exceeds 30 MB.'});
  tmp=path.join('/tmp',`datafix-${Date.now()}.parquet`);await fs.writeFile(tmp,buffer);
  const mod=await import('parquetjs-lite');const parquet=mod.default||mod;const reader=await parquet.ParquetReader.openFile(tmp);const cursor=reader.getCursor();const rows=[];let row;const safe=(v)=>typeof v==='bigint'?v.toString():v instanceof Date?v.toISOString():Buffer.isBuffer(v)?v.toString('base64'):v&&typeof v==='object'?JSON.stringify(v):v;while((row=cursor.next())&&rows.length<100000)rows.push(Object.fromEntries(Object.entries(row).map(([k,v])=>[k,safe(v)]))); await reader.close();return res.status(200).json({rows});
 }catch(e){return res.status(500).json({error:`Parquet extraction failed: ${e.message}`});}
 finally{if(tmp)await fs.unlink(tmp).catch(()=>{});}
}
