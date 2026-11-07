// Runs inside the self-contained HTML after its selection controls are wired.
export const diagramExportScript = String.raw`
const exportPngButton=document.getElementById('export-png');
const exportSvgButton=document.getElementById('export-svg');
const exportStatus=document.getElementById('export-status');
function exportSlug(value,fallback){
 return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||fallback;
}
function captureDiagramExport(){
 const bounds=root.viewBox.baseVal;
 const width=Math.ceil(bounds.width),height=Math.ceil(bounds.height);
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('The diagram has no valid export dimensions.');
 const clone=root.cloneNode(true);
 // CSS zoom and scrolling affect the view only, never the exported diagram.
 clone.removeAttribute('style');
 clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
 clone.setAttribute('width',String(width));clone.setAttribute('height',String(height));
 clone.setAttribute('viewBox',[bounds.x,bounds.y,bounds.width,bounds.height].join(' '));
 const selectedNode=root.querySelector('.node.selected')?.getAttribute('data-node-id');
 const scope=selectedNode?'node-'+exportSlug(selectedNode,'component'):locked?.kind==='edge'?'edge-'+exportSlug(locked.id,'relationship'):'all';
 const filename=exportSlug(document.title,'c4-diagram').toLowerCase()+'-'+scope;
 return {width,height,filename,source:new XMLSerializer().serializeToString(clone)};
}
function downloadDiagramBlob(blob,filename){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=filename;link.hidden=true;document.body.append(link);
 try{link.click();}finally{
  link.remove();
  // Keep the URL alive long enough for browsers to begin reading the download.
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
}
async function rasterizeDiagram(snapshot){
 await document.fonts.ready;
 const scale=2,width=snapshot.width*scale,height=snapshot.height*scale;
 if(width>32767||height>32767||width*height>64000000)throw new Error('This diagram is too large for PNG. Use Export SVG for the full diagram.');
 const url=URL.createObjectURL(new Blob([snapshot.source],{type:'image/svg+xml;charset=utf-8'}));
 try{
  const image=new Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('The diagram image could not be loaded for PNG export.'));image.src=url;});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('PNG export is unavailable in this browser. Use Export SVG instead.');
  context.fillStyle='#ffffff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PNG export failed. Use Export SVG instead.')),'image/png'));
  return {blob,width,height};
 }finally{URL.revokeObjectURL(url);}
}
async function exportDiagram(format){
 if(exportPngButton.disabled||exportSvgButton.disabled)return;
 exportPngButton.disabled=true;exportSvgButton.disabled=true;exportStatus.textContent='Preparing '+format.toUpperCase()+'…';
 try{
  // Capture the selection and filename before any await. Later UI changes must
  // not change an export that is already in progress.
  const snapshot=captureDiagramExport();
  if(format==='svg'){
   downloadDiagramBlob(new Blob([snapshot.source],{type:'image/svg+xml;charset=utf-8'}),snapshot.filename+'.svg');
   exportStatus.textContent='SVG download started ('+snapshot.width+' × '+snapshot.height+').';
  }else{
   const result=await rasterizeDiagram(snapshot);
   downloadDiagramBlob(result.blob,snapshot.filename+'.png');
   exportStatus.textContent='PNG download started ('+result.width+' × '+result.height+').';
  }
 }catch(error){exportStatus.textContent='Export failed: '+(error instanceof Error?error.message:'Please try again.');}
 finally{exportPngButton.disabled=false;exportSvgButton.disabled=false;}
}
exportPngButton.addEventListener('click',()=>exportDiagram('png'));
exportSvgButton.addEventListener('click',()=>exportDiagram('svg'));
`;
