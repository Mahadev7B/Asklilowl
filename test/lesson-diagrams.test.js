import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { renderDiagramSvg } from '../diagram-svg.js';
import { createDiagramService } from '../lesson-diagrams.js';

const flow = {kind:'flow', title:'Learn & practice', steps:['Read the question','Choose an answer']};
const geometry = {kind:'geometry', title:'An octagon', sides:8, triangulate:true, sideLabel:'Side s', apothemLabel:'Apothem a'};
const comparison = {kind:'comparison',title:'Compare approaches',groups:[{label:'Before',items:['A broad question','Extra context']},{label:'After',items:['A focused question','Relevant context']}]};

test('trusted templates escape text and preserve fixed geometry', () => {
  const svg = renderDiagramSvg(geometry);
  assert.match(svg,/viewBox="0 0 1200 675"/);
  assert.match(svg,/not to scale/i);
  assert.equal(svg.match(/<polygon[^>]+points="([^"]+)"/)[1].split(' ').length,8);
  for (const diagram of [flow,comparison,geometry]) assert.doesNotMatch(renderDiagramSvg(diagram),/<image|foreignObject|<script|href=/i);
  assert.match(renderDiagramSvg(flow),/Learn &amp; practice/);
  assert.throws(()=>renderDiagramSvg({...flow,title:'<script>'}));
});

test('rejects measured overflow rather than hiding content', () => {
  assert.throws(()=>renderDiagramSvg({...comparison,groups:Array.from({length:3},()=>({label:'Wide',items:Array(4).fill('WWWWWWWWWWWWWWWWWWWWWWWW WWWWWWWWWWWWWWWWWWWWWWWW')}))}),/overflow/);
});

test('rejects unsupported glyphs instead of silently rendering missing text',()=>{
  assert.throws(()=>renderDiagramSvg({...flow,title:'Learn 🦉'}),/unsupported_glyph/);
});

test('lesson deadline bounds a sequence of individually timely renders', async t=>{
  const png=(await createDiagramService().renderMany([flow]))[0];
  t.mock.timers.enable({apis:['setTimeout']});
  const worker=controlled(({id},w)=>setTimeout(()=>w.emit('message',{id,pngBase64:png.toString('base64')}),1500));
  const pending=createDiagramService({workerFactory:()=>worker}).renderMany(Array(10).fill(flow));
  const rejection=assert.rejects(pending,/diagram_lesson_timeout/);
  for(let i=0;i<7;i++) {t.mock.timers.tick(1500);await Promise.resolve();}
  await rejection;
  assert.equal(worker.killed,true);
});

test('real isolated worker renders all templates to 1200 by 675 PNGs', async () => {
  const pngs = await createDiagramService().renderMany([flow,comparison,geometry]);
  assert.equal(pngs.length,3);
  for (const png of pngs) {
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),1200);
    assert.equal(png.readUInt32BE(20),675);
  }
});

function controlled(onSend=()=>{}) {
  const worker = new EventEmitter();
  worker.connected=true; worker.killed=false;
  worker.send=message=>onSend(message,worker);
  worker.disconnect=()=>{worker.connected=false;};
  worker.kill=()=>{worker.killed=true;};
  return worker;
}

test('busy is process wide; worker failure cleans up and permits another job', async () => {
  const worker=controlled();
  const pending=createDiagramService({workerFactory:()=>worker}).renderMany([flow]);
  await assert.rejects(createDiagramService().renderMany([flow]),/diagram_busy/);
  worker.emit('error',new Error('PRIVATE LABEL'));
  await assert.rejects(pending,/diagram_worker_failed/);
  assert.equal(worker.killed,true); assert.equal(worker.connected,false);
  assert.equal(worker.listenerCount('message'),0);
  await createDiagramService().renderMany([flow]);
});

test('hard diagram timeout kills a nonresponding worker', async () => {
  const worker=controlled();
  await assert.rejects(createDiagramService({workerFactory:()=>worker}).renderMany([flow]),/diagram_timeout/);
  assert.equal(worker.killed,true);
});

test('partial failure returns no images and does not expose worker errors', async () => {
  const png=(await createDiagramService().renderMany([flow]))[0];
  const worker=controlled(({id},w)=>queueMicrotask(()=>w.emit('message',id===0?{id,pngBase64:png.toString('base64')}:{id,errorCode:'PRIVATE LABEL'})));
  await assert.rejects(createDiagramService({workerFactory:()=>worker}).renderMany([flow,flow]),/^Error: diagram_render_failed$/);
  assert.equal(worker.killed,true);
});

test('rejects oversized base64 and invalid PNG data', async () => {
  for (const pngBase64 of ['A'.repeat(4*Math.ceil(5*1024*1024/3)+4),'eA==']) {
    const worker=controlled(({id},w)=>queueMicrotask(()=>w.emit('message',{id,pngBase64})));
    await assert.rejects(createDiagramService({workerFactory:()=>worker}).renderMany([flow]),/diagram_invalid_png/);
    assert.equal(worker.killed,true);
  }
});

test('rejects wrong dimensions and cumulative lesson bytes before returning a batch',async()=>{
  const png=(await createDiagramService().renderMany([flow]))[0];
  const wrong=Buffer.from(png);wrong.writeUInt32BE(1,16);
  const badWorker=controlled(({id},w)=>queueMicrotask(()=>w.emit('message',{id,pngBase64:wrong.toString('base64')})));
  await assert.rejects(createDiagramService({workerFactory:()=>badWorker}).renderMany([flow]),/diagram_invalid_png/);
  const large=Buffer.alloc(5*1024*1024);png.copy(large);
  const worker=controlled(({id},w)=>queueMicrotask(()=>w.emit('message',{id,pngBase64:large.toString('base64')})));
  await assert.rejects(createDiagramService({workerFactory:()=>worker}).renderMany(Array(5).fill(flow)),/diagram_lesson_too_large/);
  assert.equal(worker.killed,true);
});

test('startup errors and logging errors cannot retain the global lock or leak input',async()=>{
  const logs=[];
  await assert.rejects(createDiagramService({logger:{info:value=>logs.push(value)},workerFactory:()=>{throw new Error('secret label');}}).renderMany([flow]),/^Error: diagram_worker_failed$/);
  assert.doesNotMatch(JSON.stringify(logs),/secret|Learn|practice/);
  const pngs=await createDiagramService({logger:{info:()=>{throw new Error('logging failure');}}}).renderMany([flow]);
  assert.equal(pngs.length,1);
});
