// Opt-in Windows/Word integration check with synthetic data only.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {wordLayout} from '../../apps/local-host/dist/word-layout.js';
import {readPackage} from '../../apps/local-host/dist/pkg.js';
import {parseDocument,renderDocx} from '../../packages/document/dist/index.js';
const require=createRequire(new URL('../../packages/document/package.json',import.meta.url));
const {Document,Packer,Header,Footer,Paragraph,TextRun,PageNumber}=require('docx');
const template=await Packer.toBuffer(new Document({sections:[{
 headers:{default:new Header({children:[new Paragraph({children:[new TextRun('{{pro'),new TextRun({text:'jectName}}',bold:true}),new TextRun(' | {{documentName}} | {{documentNumber}} | {{projectName}}')]})]})},
 footers:{default:new Footer({children:[new Paragraph({children:[new TextRun('Reference {{documentNumber}} / '),new TextRun({children:[PageNumber.CURRENT]}),new TextRun(' of '),new TextRun({children:[PageNumber.TOTAL_PAGES]})]})]})},
 children:[new Paragraph('Synthetic template sample')],
}]}));
const fields={projectName:'A&B <Place> {{documentName}}',documentName:'Technical bid',documentNumber:''};
const manuscript='# Synthetic manuscript\n\n'+Array.from({length:100},(_,i)=>`Saved paragraph ${i+1}. This synthetic content verifies saved page-count fields without modifying any user document.`).join('\n\n');
const out=await wordLayout(await renderDocx(parseDocument(manuscript)) ,template,fields);
const parts=readPackage(out.docx),header=[...parts].filter(([name])=>/^word\/header.*\.xml$/.test(name)).map(([,b])=>b.toString()).join(''),footer=[...parts].filter(([name])=>/^word\/footer.*\.xml$/.test(name)).map(([,b])=>b.toString()).join('');
const text=xml=>(xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)||[]).map(s=>s.replace(/^<w:t(?:\s[^>]*)?>|<\/w:t>$/g,'')).join('');
assert.equal(text(header),'A&amp;B &lt;Place&gt; {{documentName}} | Technical bid | \u672a\u586b\u5199 | A&amp;B &lt;Place&gt; {{documentName}}');
assert.match(footer,/PAGE/);assert.match(footer,/NUMPAGES/);assert.match(text(footer),new RegExp(`Reference \u672a\u586b\u5199 / \\d+ of ${out.pages}$`));assert.doesNotMatch(header,/\{\{projectName\}\}/);assert.ok(out.pages>1);
console.log(`PASS: split-run and repeated header tokens, literal XML-like values, empty number, live PAGE field and saved NUMPAGES (${out.pages}) survive Word/PDF layout`);
