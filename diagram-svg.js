import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { diagramSchema } from './diagram-schema.js';

export const diagramRenderOptions = Object.freeze({
  font: {fontFiles:[fileURLToPath(new URL('./assets/fonts/NotoSans-Regular.ttf',import.meta.url))],loadSystemFonts:false,defaultFontFamily:'Noto Sans'},
  logLevel:'off',
});
// Read the bundled font's Unicode BMP cmap (format 4). Unsupported codepoints
// fail closed; no platform fallback fonts or silent missing-glyph boxes.
const font=readFileSync(diagramRenderOptions.font.fontFiles[0]);
let cmap;
for(let i=0;i<font.readUInt16BE(4);i++) {
  const table=12+i*16;
  if(font.toString('ascii',table,table+4)==='cmap') {
    const base=font.readUInt32BE(table+8);
    for(let j=0;j<font.readUInt16BE(base+2);j++) {
      const record=base+4+j*8, platform=font.readUInt16BE(record), encoding=font.readUInt16BE(record+2);
      const offset=base+font.readUInt32BE(record+4);
      if((platform===0||(platform===3&&encoding===1))&&font.readUInt16BE(offset)===4) cmap=offset;
    }
  }
}
if(cmap===undefined) throw new Error('diagram_font_unavailable');
function hasGlyph(code) {
  if(code>0xffff) return false;
  const count=font.readUInt16BE(cmap+6)/2, ends=cmap+14, starts=ends+count*2+2, deltas=starts+count*2, ranges=deltas+count*2;
  for(let i=0;i<count;i++) {
    if(code>font.readUInt16BE(ends+i*2)) continue;
    const start=font.readUInt16BE(starts+i*2);
    if(code<start) return false;
    const delta=font.readInt16BE(deltas+i*2), range=font.readUInt16BE(ranges+i*2);
    let glyph=range?font.readUInt16BE(ranges+i*2+range+2*(code-start)):(code+delta)&0xffff;
    if(range&&glyph) glyph=(glyph+delta)&0xffff;
    return glyph!==0;
  }
  return false;
}
const escape = value => value.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const line = (x1,y1,x2,y2,extra='') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra.includes('stroke=')?'':'stroke="#46677c"'} stroke-width="3" ${extra}/>`;

export function renderDiagramSvg(input) {
  const d=diagramSchema.parse(input);
  const widths=new Map();
  function width(text,size) {
    const key=`${size}:${text}`;
    if (!widths.has(key)) {
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="200"><text x="0" y="100" font-family="Noto Sans" font-size="${size}">${escape(text)}</text></svg>`;
      const box=new Resvg(svg,diagramRenderOptions).innerBBox();
      widths.set(key,box ? Math.max(0,box.x)+box.width+8 : 0);
    }
    return widths.get(key);
  }
  function text(value,x,y,maxWidth,maxLines=1,size=30,anchor='start') {
    if([...value].some(c=>!hasGlyph(c.codePointAt(0)))) throw new Error('diagram_unsupported_glyph');
    const lines=[]; let current='';
    for (const word of value.split(/\s+/)) {
      if (width(word,size)>maxWidth) throw new Error('diagram_text_overflow');
      const next=current?`${current} ${word}`:word;
      if (width(next,size)>maxWidth) {lines.push(current);current=word;} else current=next;
    }
    if(current) lines.push(current);
    if(lines.length>maxLines) throw new Error('diagram_text_overflow');
    return lines.map((value,i)=>`<text x="${x}" y="${y+i*(size+8)}" font-size="${size}" text-anchor="${anchor}">${escape(value)}</text>`).join('');
  }
  let body=text(d.title,60,70,1080,1,40);
  if(d.kind==='flow') {
    const count=d.steps.length, cols=Math.min(3,count), gap=60, w=(1080-gap*(cols-1))/cols;
    const positions=d.steps.map((_,i)=>({x:60+(i<3?i:5-i)*(w+gap),y:count<=3?240:(i<3?140:380)}));
    for(let i=0;i<count-1;i++) {
      const a=positions[i],b=positions[i+1];
      body+=a.y===b.y ? line(a.x+(b.x>a.x?w:0),a.y+80,b.x+(b.x>a.x?0:w),b.y+80,'marker-end="url(#arrow)"') : line(a.x+w/2,a.y+160,b.x+w/2,b.y,'marker-end="url(#arrow)"');
    }
    d.steps.forEach((label,i)=>{
      const p=positions[i];
      body+=`<rect x="${p.x}" y="${p.y}" width="${w}" height="160" rx="18" fill="#e8f1f7" stroke="#46677c" stroke-width="2"/>`;
      body+=text(label,p.x+22,p.y+46,w-44,3);
    });
  } else if(d.kind==='comparison') {
    const w=(1080-24*(d.groups.length-1))/d.groups.length;
    d.groups.forEach((group,i)=>{
      const x=60+i*(w+24);
      body+=`<rect x="${x}" y="120" width="${w}" height="440" rx="18" fill="#e8f1f7"/>`;
      body+=text(group.label,x+22,160,w-44,2);
      group.items.forEach((item,j)=>{body+=text(`• ${item}`,x+22,244+j*78,w-44,2);});
    });
  } else {
    const points=Array.from({length:d.sides},(_,i)=>{const a=(2*i-1)*Math.PI/d.sides;return [600+210*Math.cos(a),335+210*Math.sin(a)];});
    body+=`<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="#e8f1f7" stroke="#46677c" stroke-width="4"/>`;
    if(d.triangulate) for(const [x,y] of points) body+=line(600,335,x,y,'stroke-dasharray="7 7"');
    const midpoint=[(points[0][0]+points[1][0])/2,335];
    if(d.sideLabel) {
      body+=line(midpoint[0],335,845,230);
      body+=text(d.sideLabel,855,220,275,2);
    }
    if(d.apothemLabel) {
      body+=line(600,335,...midpoint,'stroke="#167c80"');
      body+=`<path d="M ${midpoint[0]-14} 335 v -14 h 14" fill="none" stroke="#167c80" stroke-width="2"/>`;
      body+=line(340,430,600+(midpoint[0]-600)/2,335,'stroke-dasharray="4 5"');
      body+=text(d.apothemLabel,70,430,275,2);
    }
    body+=text('Illustration — not to scale',600,650,1080,1,24,'middle');
  }
  if(d.caption) body+=text(d.caption,600,600,1080, d.kind==='geometry'?1:2,24,'middle');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#46677c"/></marker></defs><rect width="1200" height="675" fill="#ffffff"/><g font-family="Noto Sans" fill="#173447">${body}</g></svg>`;
}
