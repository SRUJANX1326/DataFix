// Reliable browser microphone capture + server-side Whisper transcription.
// This deliberately avoids SpeechRecognition, which depends on browser-specific
// remote recognition services and can fail silently even with microphone access.
const LANG = 'en-IN';
const state = { recorder: null, stream: null, listenResolve: null, cancelCurrent: null, partial: null, transcript: null, carry: null, error: null, utterance: null, stopRequested: false, inputDeviceId: '' };
const finishListen = (value) => { const resolve = state.listenResolve; state.listenResolve = null; resolve?.(value); };
export const voiceSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const setVoiceErrorHandler = (fn) => { state.error = fn; };
export const setVoiceTranscriptHandler = (fn) => { state.transcript = fn; };
export const getInputDeviceId = () => { try { return localStorage.getItem('datafixMicDevice') || ''; } catch { return state.inputDeviceId; } };
export const setInputDeviceId = (id) => { state.inputDeviceId = String(id || ''); try { localStorage.setItem('datafixMicDevice', state.inputDeviceId); } catch {} };
export function abortVoiceListen() { const cancel = state.cancelCurrent; state.cancelCurrent = null; if (cancel) cancel(); else { finishListen(null); try { if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop(); } catch {} cleanup(); } state.stopRequested = false; }
function cleanup(){ try { state.stream?.getTracks().forEach(t=>t.stop()); } catch {} state.stream=null; state.recorder=null; }
async function transcribeBlob(blob, mime){
  if (!blob || !blob.size) return null;
  const data = await new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||''); reader.onerror=()=>reject(new Error('Could not read microphone recording.')); reader.readAsDataURL(blob); });
  const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const res = await fetch('/api/transcribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data,filename:`datafix-voice.${ext}`,mime})});
  const payload = await res.json().catch(()=>({})); if(!res.ok) throw new Error(payload.error || `Transcription failed (${res.status})`);
  const text = String(payload.text||'').trim(); state.transcript?.(text); return text ? {text,alts:[text]} : null;
}
function listenRaw(){
 return new Promise(async resolve=>{
  if(!voiceSupported()){state.error?.('unsupported');resolve(null);return;}
  let stream, recorder, chunks=[], settled=false, audioCtx, analyser, source, raf=0, silenceMs=0, speechDetected=false, lastCheck=0, startAt=0, noiseSamples=[], noiseFloor=.004, speechFrames=0;
  let stopDone; const stopped=new Promise(r=>stopDone=r);
  const finish=async (transcribe=true)=>{if(settled)return;settled=true;cancelAnimationFrame(raf);try{if(recorder&&recorder.state!=='inactive'){recorder.stop();await stopped;}}catch{};try{audioCtx?.close();}catch{};const mime=recorder?.mimeType||chunks[0]?.type||'audio/webm';const blob=new Blob(chunks,{type:mime});cleanup();if(state.listenResolve===finish)state.listenResolve=null;if(state.cancelCurrent===cancel)state.cancelCurrent=null;if(!transcribe||state.stopRequested){state.stopRequested=false;resolve(null);return;}if(!blob.size){state.error?.('No audio was captured. Check the selected Windows input microphone.');resolve(null);return;}try{const result=await transcribeBlob(blob,mime);state.partial?.(result?.text||'');if(!result?.text)state.error?.('I captured audio, but could not detect words. Try speaking a little louder or closer to the microphone.');resolve(result);}catch(e){state.error?.(e.message||'transcription-failed');resolve(null);}};
  const cancel=()=>finish(false); state.listenResolve=finish; state.cancelCurrent=cancel;
  try{
   const selected=getInputDeviceId();stream=await navigator.mediaDevices.getUserMedia({audio:{...(selected?{deviceId:{exact:selected}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:true}});state.stream=stream;
   const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4'];const mime=preferred.find(m=>MediaRecorder.isTypeSupported?.(m))||'';
   recorder=mime?new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000}):new MediaRecorder(stream,{audioBitsPerSecond:64000});state.recorder=recorder;
   recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};recorder.onerror=e=>{state.error?.(e.error?.message||'Microphone recording failed.');finish(false);};recorder.onstop=()=>stopDone();
   recorder.start(250);startAt=performance.now();
   try{audioCtx=new (window.AudioContext||window.webkitAudioContext)();await audioCtx.resume?.();source=audioCtx.createMediaStreamSource(stream);analyser=audioCtx.createAnalyser();analyser.fftSize=1024;source.connect(analyser);}catch{}
   const poll=()=>{if(settled||state.stopRequested)return;const now=performance.now();const elapsed=now-startAt;if(analyser){const data=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);let sum=0;for(const v of data){const x=(v-128)/128;sum+=x*x;}const rms=Math.sqrt(sum/data.length);
     if(elapsed<650&&!speechDetected){noiseSamples.push(rms);noiseFloor=noiseSamples.reduce((a,b)=>a+b,0)/Math.max(1,noiseSamples.length);}
     const threshold=Math.max(.006,Math.min(.02,noiseFloor*2.4));
     if(rms>threshold){speechFrames++;silenceMs=0;if(speechFrames>=2)speechDetected=true;}else if(speechDetected&&lastCheck){silenceMs+=now-lastCheck;}lastCheck=now;
   }
   // Do not silently discard quiet speakers: after 8 seconds, send the recording
   // to Whisper even if local VAD did not confidently detect speech.
   if((speechDetected&&silenceMs>1250)||(elapsed>18000)||(elapsed>8000&&!speechDetected)){finish(true);return;}
   raf=requestAnimationFrame(poll);};raf=requestAnimationFrame(poll);
  }catch(e){state.error?.(e?.name==='NotAllowedError'?'not-allowed':e?.name==='NotFoundError'?'audio-capture':e.message||'microphone-error');cleanup();resolve(null);}
 });
}
export async function listen(){if(state.carry){const c=state.carry;state.carry=null;return c;}return listenRaw();}
export function interruptSpeech(){try{window.speechSynthesis?.cancel();}catch{}}
export function voices(){return window.speechSynthesis?speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang)):[];}
export const getVoiceId=()=>{try{return localStorage.getItem('datafixVoiceURI')||'';}catch{return '';}};
export const setVoiceId=id=>{try{localStorage.setItem('datafixVoiceURI',id);}catch{}};
function bestVoice(){const all=voices(),saved=all.find(v=>v.voiceURI===getVoiceId());if(saved)return saved;const score=v=>(/en[-_]IN/i.test(v.lang)?3:/en[-_](US|GB)/i.test(v.lang)?2:0)+(/natural|neural|online/i.test(v.name)?6:0)+(/google/i.test(v.name)?3:0)+(/microsoft/i.test(v.name)?2:0);return all.sort((a,b)=>score(b)-score(a))[0]||null;}
function speakRaw(text){return new Promise(resolve=>{const t=setTimeout(resolve,6000+String(text).length*110);const done=()=>{clearTimeout(t);resolve();};if(!window.speechSynthesis)return done();speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(text));state.utterance=u;const v=bestVoice();if(v){u.voice=v;u.lang=v.lang;}else u.lang=LANG;u.rate=.98;u.pitch=1;u.onend=done;u.onerror=done;speechSynthesis.speak(u);});}
const words=s=>String(s).toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
function isEcho(partial,spoken){const p=words(partial),sp=new Set(words(spoken));return !p.length||p.filter(w=>sp.has(w)).length/p.length>=.65;}
export async function speak(text,{bargeIn=false}={}){let interrupted=false,listening=null;const spoken=speakRaw(text);if(bargeIn){state.partial=p=>{if(!interrupted&&!isEcho(p,text)){interrupted=true;interruptSpeech();}};listening=listenRaw();}await spoken;state.partial=null;if(listening){if(interrupted)state.carry=await listening;else{abortVoiceListen();await listening;}}}
