import { Resvg } from '@resvg/resvg-js';
import { renderDiagramSvg, diagramRenderOptions } from './diagram-svg.js';

process.on('message', ({id,diagram}) => {
  try {
    const png=new Resvg(renderDiagramSvg(diagram),diagramRenderOptions).render().asPng();
    if(png.length>5*1024*1024) throw new Error('size');
    process.send?.({id,pngBase64:png.toString('base64')});
  } catch {
    process.send?.({id,errorCode:'diagram_render_failed'});
  }
});
process.on('disconnect',()=>process.exit(0));
