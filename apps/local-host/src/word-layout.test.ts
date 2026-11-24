import test from 'node:test';
import assert from 'node:assert/strict';
import {wordLayout} from './word-layout.js';
import {makeTestZip} from './pkg-testkit.js';
import {parseDocument,renderDocx} from '@vxture/ruyin-document';
test('active parts, external resources and DTDs fail before starting Word',{skip:process.platform!=='win32'},async()=>{
 const docx=await renderDocx(parseDocument('Synthetic safety probe'));
 for(const [name,data,expected]of [
  ['word/vbaProject.bin','active','Active template'],
  ['word/_rels/document.xml.rels','<Relationships><Relationship Type="image" TargetMode="External" Target="https://example.com/private"/></Relationships>','External template resources'],
  ['word/document.xml','<!DOCTYPE x [<!ENTITY e SYSTEM "file:///C:/private">]><x>&e;</x>','DTD'],
  ['word/header.xml','<x><instrText>DDEAUTO something</instrText></x>','External template fields'],
 ] as const){const template=makeTestZip([{name,data:Buffer.from(data)}]);await assert.rejects(wordLayout(docx,template),new RegExp(expected,'i'));}
});
