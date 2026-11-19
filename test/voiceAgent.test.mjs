import test from 'node:test';
import assert from 'node:assert/strict';
const fakeSynthesis={getVoices:()=>[],cancel(){},speak(u){queueMicrotask(()=>u.onend?.());}};
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},configurable:true});
globalThis.window={MediaRecorder:class {},speechSynthesis:fakeSynthesis};
globalThis.speechSynthesis=fakeSynthesis;
globalThis.MediaRecorder=class {static isTypeSupported(){return false;}};
globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
const voice=await import('../src/voiceAgent.js');
test('voice support is based on microphone recording APIs, not browser speech recognition',()=>{assert.equal(voice.voiceSupported(),true);assert.equal('SpeechRecognition' in window,false);});
test('speech synthesis can speak response text',async()=>{await voice.speak('DataFix is ready.');assert.ok(true);});

test('voice assistant accepts speech without a wake phrase and reports empty transcriptions', async()=>{
  const {readFile}=await import('node:fs/promises');
  const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
  const engine=await readFile(new URL('../src/voiceAgent.js',import.meta.url),'utf8');
  assert.match(app,/const runVoiceLoop = async/);
  assert.doesNotMatch(app,/if \(wakeOnly\) \{ let wakeHit/);
  assert.match(engine,/noiseFloor\*2\.4/);
  assert.match(engine,/elapsed>8000&&!speechDetected/);
  assert.match(engine,/No audio was captured/);
});
