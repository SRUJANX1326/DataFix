export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'POST only'});
 try{
  const key=process.env.GROQ_API_KEY;if(!key)return res.status(503).json({error:'Audio transcription requires GROQ_API_KEY in your .env file.'});
  const {data,filename='recording',mime='audio/webm'}=req.body||{};if(!data)return res.status(400).json({error:'No audio data received.'});
  const buffer=Buffer.from(data,'base64');if(buffer.length>24*1024*1024)return res.status(413).json({error:'Audio exceeds 24 MB.'});
  const form=new FormData();form.append('file',new Blob([buffer],{type:mime}),filename);form.append('model','whisper-large-v3-turbo');form.append('response_format','json');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
  let response;try{response=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{authorization:`Bearer ${key}`},body:form,signal:controller.signal});}finally{clearTimeout(timeout);}
  const result=await response.json().catch(()=>({}));if(!response.ok)return res.status(response.status).json({error:result.error?.message||'Transcription provider failed.'});
  return res.status(200).json({text:result.text||'',model:'whisper-large-v3-turbo'});
 }catch(e){return res.status(500).json({error:e.name==='AbortError'?'Audio transcription timed out after 30 seconds. Try again.':e.message||'Transcription failed'});}
}
