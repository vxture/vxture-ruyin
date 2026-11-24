import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, relative, extname, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseDocument } from '../../packages/document/dist/index.js';

// Development probe: only local assets below the Markdown directory are permitted.
const file = realpathSync(process.argv[2]);
if(statSync(file).size>1024*1024)throw Error('Chapter exceeds 1 MiB');
const root = parseDocument(readFileSync(file, 'utf8')).root;
const lines=[], tables=[], images=[];
const token=()=> 'RY_'+randomBytes(16).toString('hex');
function inline(nodes) {
  return nodes.map(n=> {
    if(n.type==='text') return n.value.replace(/\r?\n/g,' ');
    if(n.type==='strong'||n.type==='emphasis'||n.type==='delete') throw Error('Inline formatting is not supported by the template probe yet');
    throw Error('Unsupported inline content: '+n.type);
  }).join('');
}
for(const node of root.children) {
  if(node.type==='paragraph' && node.children.length===1 && node.children[0].type==='image') {
    const image=node.children[0];
    if(/^[a-z]+:/i.test(image.url)||image.url.startsWith('//'))throw Error('Only project-local images are allowed');
    const path=realpathSync(resolve(dirname(file),decodeURIComponent(image.url)));
    const rel=relative(realpathSync(dirname(file)),path);
    if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw Error('Image escapes Markdown directory');
    if(!['.png','.jpg','.jpeg'].includes(extname(path).toLowerCase())||statSync(path).size>8*1024*1024)throw Error('Use PNG/JPEG images up to 8 MiB');
    const signature=readFileSync(path).subarray(0,8);
    if(!(signature.equals(Buffer.from([137,80,78,71,13,10,26,10])) || (signature[0]===255 && signature[1]===216 && signature[2]===255)))throw Error('Image format does not match PNG/JPEG');
    const marker=token(); images.push({marker,path,alt:image.alt??''}); lines.push(marker);
  } else if(node.type==='paragraph') lines.push(inline(node.children));
  else if(node.type==='table') {
    const rows=node.children.map(row=>row.children.map(cell=>inline(cell.children)));
    if(!rows.length || rows.length>200 || rows[0].length>12 || rows.some(row=>row.length!==rows[0].length))throw Error('Table exceeds probe limits');
    if(rows.flat().some(cell=>/[\t\r\n]/.test(cell)))throw Error('Table cell contains control separators');
    const marker=token();tables.push({marker,rows});lines.push(marker);
  } else if(node.type==='list') {
    node.children.forEach((item,i)=> {
      if(item.checked!=null||item.children.length!==1||item.children[0].type!=='paragraph')throw Error('Only flat lists supported');
      lines.push((node.ordered?((node.start??1)+i)+'. ':'• ')+inline(item.children[0].children));
    });
  } else throw Error('Unsupported Markdown block: '+node.type);
}
if(!lines.length)throw Error('Chapter is empty');
process.stdout.write(JSON.stringify({text:lines.join('\r'),tables,images}));
