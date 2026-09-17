import { fork } from 'node:child_process';
import { diagramSchema } from './diagram-schema.js';

let busy=false;
const MAX_IMAGE=5*1024*1024;
const MAX_LESSON=20*1024*1024;
const signature=Buffer.from('89504e470d0a1a0a','hex');
const defaultWorker=()=>fork(new URL('./diagram-worker.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[],serialization:'json'});

export function createDiagramService({logger,workerFactory=defaultWorker,now=()=>performance.now()}={}) {
  return {async renderMany(input) {
    if(busy) throw new Error('diagram_busy');
    if(!Array.isArray(input)||input.length<1||input.length>20) throw new Error('diagram_invalid_input');
    let diagrams;
    try {diagrams=input.map(d=>diagramSchema.parse(d));} catch {throw new Error('diagram_invalid_input');}
    const started=now();
    busy=true;
    let worker,diagramTimer,lessonTimer,onMessage,onError,onExit;
    const log=data=>{try {logger?.info?.(data);} catch { /* Logging cannot break cleanup. */ }};
    try {
      worker=workerFactory();
      return await new Promise((resolve,reject)=>{
        let id=0,total=0; const pngs=[];
        const fail=code=>reject(new Error(code));
        const send=()=>{
          clearTimeout(diagramTimer);
          diagramTimer=setTimeout(()=>fail('diagram_timeout'),2000);
          try {worker.send({id,diagram:diagrams[id]},error=>{if(error) fail('diagram_worker_failed');});} catch {fail('diagram_worker_failed');}
        };
        onMessage=message=>{
          if(!message||message.id!==id) return fail('diagram_worker_failed');
          if(message.errorCode) return fail('diagram_render_failed');
          const encoded=message.pngBase64;
          if(typeof encoded!=='string'||encoded.length>4*Math.ceil(MAX_IMAGE/3)||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return fail('diagram_invalid_png');
          const png=Buffer.from(encoded,'base64');
          if(png.length<33||png.length>MAX_IMAGE||!png.subarray(0,8).equals(signature)||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)!==1200||png.readUInt32BE(20)!==675) return fail('diagram_invalid_png');
          total+=png.length;
          if(total>MAX_LESSON) return fail('diagram_lesson_too_large');
          pngs.push(png); id++;
          if(id===diagrams.length) {log({visualMode:'diagram',kinds:diagrams.map(d=>d.kind),count:id,durationMs:now()-started,pngBytes:pngs.map(p=>p.length)});resolve(pngs);} else send();
        };
        onError=()=>fail('diagram_worker_failed'); onExit=()=>fail('diagram_worker_failed');
        worker.on('message',onMessage);worker.on('error',onError);worker.on('exit',onExit);
        lessonTimer=setTimeout(()=>fail('diagram_lesson_timeout'),10000);
        send();
      });
    } catch(error) {
      const code=/^diagram_[a-z_]+$/.test(error?.message)?error.message:'diagram_worker_failed';
      log({visualMode:'diagram',count:diagrams.length,durationMs:now()-started,errorCode:code});
      throw new Error(code);
    } finally {
      clearTimeout(diagramTimer);clearTimeout(lessonTimer);
      if(worker) {
        if(onMessage) worker.removeListener('message',onMessage);
        if(onError) worker.removeListener('error',onError);
        if(onExit) worker.removeListener('exit',onExit);
        worker.on('error',()=>{}); // A late IPC close error must not escape cleanup.
        try {if(worker.connected) worker.disconnect();} catch {}
        try {worker.kill('SIGKILL');} catch {}
      }
      busy=false;
    }
  }};
}
