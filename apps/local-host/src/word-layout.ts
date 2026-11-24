/** Fixed local adapter; never evaluates product-supplied commands. */
import {execFile,spawn} from "node:child_process";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

export interface LayoutOutput {docx:Buffer;pdf:Buffer;pages:number;engine:string}
export interface LayoutFields {projectName:string;documentName:string;documentNumber:string}
export async function wordLayout(docx:Uint8Array,template?:Buffer,fields?:LayoutFields):Promise<LayoutOutput>{
 if(process.platform!=="win32")throw Error("Word layout requires Microsoft Word on Windows; Markdown is still available");
 const dir=await mkdtemp(join(tmpdir(),"ruyin-layout-"));
 try{
  await writeFile(join(dir,"input.docx"),docx);if(template)await writeFile(join(dir,"template.docx"),template);
  if(fields)await writeFile(join(dir,"fields.json"),JSON.stringify({...fields,documentNumber:fields.documentNumber||"\u672a\u586b\u5199"}),"utf8");
  await writeFile(join(dir,"layout.ps1"),SCRIPT,"utf8");
  await writeFile(join(dir,"cleanup.ps1"),String.raw`param([string]$Root)
$p=Get-Content -LiteralPath (Join-Path $Root 'word.json') -ErrorAction SilentlyContinue|ConvertFrom-Json
if($p){$x=Get-Process -Id $p.id -ErrorAction SilentlyContinue;if($x -and $x.ProcessName -eq 'WINWORD' -and $x.StartTime.ToUniversalTime().Ticks.ToString() -eq $p.ticks){Stop-Process -Id $x.Id -Force}}`,"utf8");
  try{await new Promise<void>((resolve,reject)=>{const child=spawn("pwsh.exe",["-NoProfile","-NonInteractive","-File",join(dir,"layout.ps1"),"-Root",dir],{windowsHide:true,stdio:"ignore"});const timer=setTimeout(()=>{child.kill();reject(Error("Word layout timed out"));},180000);child.on("error",e=>{clearTimeout(timer);reject(e);});child.on("exit",code=>{clearTimeout(timer);code===0?resolve():reject(Error("Word layout failed"));});});}
  catch(e){const stage=await readFile(join(dir,"stage.txt"),"utf8").catch(()=>"initialization"),detail=await readFile(join(dir,"error.txt"),"utf8").catch(()=>"");if((e as NodeJS.ErrnoException).code==='ENOENT')throw Error("PowerShell 7 is required for local Word layout; Markdown remains available");throw Error((e as Error).message+" ("+stage+")"+(detail?": "+detail.slice(0,1200):""));}
  const [word,pdf,meta]=await Promise.all([readFile(join(dir,"output.docx")),readFile(join(dir,"output.pdf")),readFile(join(dir,"result.json"),"utf8")]);
  if(word.length>20*1024*1024||pdf.length>20*1024*1024||!pdf.subarray(0,5).equals(Buffer.from("%PDF-")))throw Error("Layout output exceeds limits or is invalid");
  const pages=JSON.parse(meta).pages;if(!Number.isSafeInteger(pages)||pages<1||pages>10000)throw Error("Invalid page count from layout engine");
  return{docx:word,pdf,pages,engine:"Microsoft Word"};
 }finally{
  // Kill only the private Word process created by this job, never user documents.
  await new Promise<void>(resolve=>execFile("powershell.exe",["-NoProfile","-NonInteractive","-File",join(dir,"cleanup.ps1"),"-Root",dir],{windowsHide:true,timeout:15000},()=>resolve()));
  await rm(dir,{recursive:true,force:true});
 }
}

const SCRIPT=String.raw`param([string]$Root)
$ErrorActionPreference='Stop'
trap{[IO.File]::WriteAllText((Join-Path $Root 'error.txt'),([string]$_+' '+$_.ScriptStackTrace));exit 1}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
function Stage($name){[IO.File]::WriteAllText((Join-Path $Root 'stage.txt'),$name)}
Stage 'template merge'
function Read-Xml($zip,$name){
 $entry=$zip.GetEntry($name);if(!$entry){return $null}
 $reader=[IO.StreamReader]::new($entry.Open())
 try{$text=$reader.ReadToEnd()}finally{$reader.Dispose()}
 $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing='Prohibit';$settings.XmlResolver=$null
 $xr=[Xml.XmlReader]::Create([IO.StringReader]::new($text),$settings)
 $xml=[Xml.XmlDocument]::new();$xml.PreserveWhitespace=$true
 try{$xml.Load($xr)}finally{$xr.Dispose()};return ,$xml
}
function Write-Xml($zip,$name,$xml){
 $old=$zip.GetEntry($name);if($old){$old.Delete()}
 $writer=[IO.StreamWriter]::new($zip.CreateEntry($name).Open(),[Text.UTF8Encoding]::new($false))
 try{$xml.Save($writer)}finally{$writer.Dispose()}
}
function Ns($xml){$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('w',$w);$ns.AddNamespace('r',$r);return ,$ns}
function Check-Template($zip){
 $total=0;$names=@{}
 foreach($entry in $zip.Entries){
  $total+=$entry.Length
  if($entry.Length -gt 20000000 -or $total -gt 80000000 -or $zip.Entries.Count -gt 2000){throw 'Template exceeds layout limits'}
  if($names.ContainsKey($entry.FullName)){throw 'Duplicate template part'};$names[$entry.FullName]=$true
  if($entry.FullName -match '(?i)vbaProject|activeX|embeddings/|\.bin$'){throw 'Active template content is not supported'}
  if($entry.FullName -match '\.(xml|rels)$'){
   $xml=Read-Xml $zip $entry.FullName
   if($xml.SelectNodes('//*[local-name()="altChunk" or local-name()="object"]').Count){throw 'Embedded template content is not supported'}
   foreach($field in $xml.SelectNodes('//*[local-name()="instrText"] | //@*[local-name()="instr"]')){
    if($field.InnerText -match '(?i)\b(DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE|DATABASE|LINK)\b'){throw 'External template fields are not supported'}
   }
   foreach($rel in $xml.SelectNodes('//*[local-name()="Relationship" and @TargetMode="External"]')){if($rel.Type -notmatch '/hyperlink$'){throw 'External template resources are not supported'}}
  }
 }
}
function Fill-HeaderFields($zip,$section,$values){
 $size=$section.SelectSingleNode('w:pgSz',(Ns $section.OwnerDocument));$margins=$section.SelectSingleNode('w:pgMar',(Ns $section.OwnerDocument))
 $width=9360;if($size -and $margins){$width=[int]$size.GetAttribute('w',$w)-[int]$margins.GetAttribute('left',$w)-[int]$margins.GetAttribute('right',$w)-[int]$margins.GetAttribute('gutter',$w)}
 foreach($name in @($zip.Entries|Where-Object {$_.FullName -match '^word/(header|footer)[^/]*\.xml$'}|ForEach-Object FullName)){
  $xml=Read-Xml $zip $name;$ns=Ns $xml
  foreach($p in $xml.SelectNodes('//w:p',$ns)){
   $nodes=@($p.SelectNodes('.//w:t',$ns));$text=($nodes|ForEach-Object InnerText)-join ''
   # The owner's legacy row pads its three cells with spaces. Replace that one
   # recognized row using real tabs; longer project names must not push its label.
   if($text -match '^XX\s*(?:\u5e02)?\s*\u9879\u76ee\s+\u6295\u6807\u6587\u4ef6\s+\u7f16\u53f7[:\uFF1A]\s*X{2,}(?:-X{2,})*\s*$'){
    $style=$p.SelectSingleNode('w:r/w:rPr',$ns);$pr=$p.SelectSingleNode('w:pPr',$ns)
    if(!$pr){$pr=$xml.CreateElement('w','pPr',$w);[void]$p.PrependChild($pr)}
    foreach($old in @($pr.SelectNodes('w:tabs | w:jc | w:ind',$ns))){[void]$pr.RemoveChild($old)}
    $tabs=$xml.CreateElement('w','tabs',$w)
    foreach($tab in @(@('center',[int]($width/2)),@('right',$width))){$n=$xml.CreateElement('w','tab',$w);$n.SetAttribute('val',$w,$tab[0]);$n.SetAttribute('pos',$w,[string]$tab[1]);[void]$tabs.AppendChild($n)}
    [void]$pr.AppendChild($tabs);$jc=$xml.CreateElement('w','jc',$w);$jc.SetAttribute('val',$w,'left');[void]$pr.AppendChild($jc)
    foreach($old in @($p.ChildNodes)){if($old -ne $pr){[void]$p.RemoveChild($old)}}
    $label=[string][char]0x7f16+[char]0x53f7+[char]0xff1a
    $parts=@($values.projectName,$values.documentName,($label+$values.documentNumber))
    for($i=0;$i -lt $parts.Count;$i++){
     $run=$xml.CreateElement('w','r',$w);if($style){[void]$run.AppendChild($style.CloneNode($true))}
     if($i){[void]$run.AppendChild($xml.CreateElement('w','tab',$w))}
     $t=$xml.CreateElement('w','t',$w);$t.InnerText=$parts[$i];[void]$run.AppendChild($t);[void]$p.AppendChild($run)
    }
    continue
   }
   # Join only for matching. Write each replacement back into the original runs,
   # preserving formatting, page-number fields, tabs and surrounding static text.
   $ranges=@();$offset=0;foreach($node in $nodes){$ranges+=@{node=$node;start=$offset;end=$offset+$node.InnerText.Length};$offset+=$node.InnerText.Length}
   $matches=[regex]::Matches($text,'\{\{(projectName|documentName|documentNumber)\}\}')
   for($i=$matches.Count-1;$i -ge 0;$i--){
    $match=$matches[$i];$start=$ranges|Where-Object {$_.start -le $match.Index -and $_.end -gt $match.Index}|Select-Object -First 1
    $last=$match.Index+$match.Length;$end=$ranges|Where-Object {$_.start -lt $last -and $_.end -ge $last}|Select-Object -First 1
    $prefix=$start.node.InnerText.Substring(0,$match.Index-$start.start);$suffix=$end.node.InnerText.Substring($last-$end.start)
    if($start.node -eq $end.node){$start.node.InnerText=$prefix+$values[$match.Groups[1].Value]+$suffix}else{
     $start.node.InnerText=$prefix+$values[$match.Groups[1].Value];$end.node.InnerText=$suffix
     foreach($range in $ranges){if($range.start -gt $start.start -and $range.start -lt $end.start){$range.node.InnerText=''}}
    }
    $start.node.SetAttribute('space','http://www.w3.org/XML/1998/namespace','preserve');$end.node.SetAttribute('space','http://www.w3.org/XML/1998/namespace','preserve')
   }
  }
  Write-Xml $zip $name $xml
 }
}
$input=Join-Path $Root 'input.docx';$output=Join-Path $Root 'output.docx';$template=Join-Path $Root 'template.docx'
$metaZip=[IO.Compression.ZipFile]::OpenRead($input)
try{$core=Read-Xml $metaZip 'docProps/core.xml';$documentTitle=$core.SelectSingleNode('//*[local-name()="title"]').InnerText}finally{$metaZip.Dispose()}
if(Test-Path -LiteralPath $template){
 Copy-Item -LiteralPath $template -Destination $output
 $base=[IO.Compression.ZipFile]::Open($output,'Update');$gen=[IO.Compression.ZipFile]::OpenRead($input)
 try{
  Check-Template $base
  $xml=Read-Xml $base 'word/document.xml';$source=Read-Xml $gen 'word/document.xml';$ns=Ns $xml;$gns=Ns $source
  foreach($attr in $source.DocumentElement.Attributes){if(!$xml.DocumentElement.HasAttribute($attr.Name)){[void]$xml.DocumentElement.Attributes.Append($xml.ImportNode($attr,$true))}}
  $body=$xml.SelectSingleNode('//w:body',$ns);$sections=$xml.SelectNodes('//w:sectPr',$ns);$section=$sections[$sections.Count-1].CloneNode($true)
  foreach($kind in @('headerReference','footerReference')){
   if(!$section.SelectSingleNode('w:'+$kind,$ns)){
    for($i=$sections.Count-2;$i -ge 0;$i--){$refs=$sections[$i].SelectNodes('w:'+$kind,$ns);if($refs.Count){foreach($ref in $refs){[void]$section.PrependChild($ref.CloneNode($true))};break}}
   }
  }
  $pg=$section.SelectSingleNode('w:pgNumType',$ns);if($pg){[void]$section.RemoveChild($pg)}
  $styles=Read-Xml $base 'word/styles.xml';$gstyles=Read-Xml $gen 'word/styles.xml';$sns=Ns $styles;$gsns=Ns $gstyles;$map=@{}
  foreach($style in $gstyles.SelectNodes('//w:style',$gsns)){
   $id=$style.GetAttribute('styleId',$w);$nameNode=$style.SelectSingleNode('w:name',$gsns);$name=if($nameNode){$nameNode.GetAttribute('val',$w)}else{''}
   $match=$null
   foreach($s in $styles.SelectNodes('//w:style',$sns)){$sn=$s.SelectSingleNode('w:name',$sns);if($s.GetAttribute('styleId',$w) -ceq $id -or ($name -and $sn -and $sn.GetAttribute('val',$w) -ieq $name)){$match=$s;break}}
   if($match){$map[$id]=$match.GetAttribute('styleId',$w)}else{$map[$id]=$id;[void]$styles.DocumentElement.AppendChild($styles.ImportNode($style,$true))}
  }
  # Markdown headings already contain their own numbering. Do not inherit the
  # template's unrelated multi-level list counters into manuscript headings.
  foreach($p in $source.SelectNodes('//w:p[w:pPr/w:pStyle]',$gns)){
   $styleId=$p.SelectSingleNode('w:pPr/w:pStyle',$gns).GetAttribute('val',$w)
   if($styleId -match '^Heading([1-6])$'){
    $level=[int]$Matches[1]-1;$pr=$p.SelectSingleNode('w:pPr',$gns)
    $num=$pr.SelectSingleNode('w:numPr',$gns);if($num){[void]$pr.RemoveChild($num)}
    $num=$source.CreateElement('w','numPr',$w);$zero=$source.CreateElement('w','numId',$w);$zero.SetAttribute('val',$w,'0');[void]$num.AppendChild($zero);[void]$pr.AppendChild($num)
    $outline=$pr.SelectSingleNode('w:outlineLvl',$gns);if(!$outline){$outline=$source.CreateElement('w','outlineLvl',$w);[void]$pr.AppendChild($outline)};$outline.SetAttribute('val',$w,[string]$level)
   }
  }
  foreach($ref in $source.SelectNodes('//w:pStyle | //w:rStyle | //w:tblStyle',$gns)){ $id=$ref.GetAttribute('val',$w);if($map.ContainsKey($id)){$ref.SetAttribute('val',$w,$map[$id])}}
  # Use generated list definitions with new IDs, preserving template header styles.
  $nums=Read-Xml $base 'word/numbering.xml';$gnums=Read-Xml $gen 'word/numbering.xml'
  if($gnums){
   if(!$nums){$nums=$gnums.CloneNode($true);$nums.DocumentElement.RemoveAll();[void]$nums.DocumentElement.SetAttribute('xmlns:w',$w)}
   $nns=Ns $nums;$gnns=Ns $gnums;$max=10000
   foreach($n in $nums.SelectNodes('//w:abstractNum | //w:num',$nns)){foreach($a in $n.Attributes){$v=0;if([int]::TryParse($a.Value,[ref]$v)){$max=[Math]::Max($max,$v+100)}}}
   foreach($n in $gnums.SelectNodes('//w:abstractNum/@w:abstractNumId | //w:num/@w:numId | //w:abstractNumId/@w:val',$gnns)){$n.Value=[string]([int]$n.Value+$max)}
   foreach($n in $source.SelectNodes('//w:numId/@w:val',$gns)){if($n.Value -ne '0'){$n.Value=[string]([int]$n.Value+$max)}}
   foreach($n in $gnums.DocumentElement.ChildNodes){[void]$nums.DocumentElement.AppendChild($nums.ImportNode($n,$true))}
   Write-Xml $base 'word/numbering.xml' $nums
  }
  $rels=Read-Xml $base 'word/_rels/document.xml.rels';$grels=Read-Xml $gen 'word/_rels/document.xml.rels'
  foreach($rel in $grels.DocumentElement.ChildNodes){if($rel.Type -match '/hyperlink$'){$old=$rel.Id;$new='ruyin'+[guid]::NewGuid().ToString('N');$rel.Id=$new;foreach($ref in $source.SelectNodes('//@r:id',$gns)){if($ref.Value -ceq $old){$ref.Value=$new}};[void]$rels.DocumentElement.AppendChild($rels.ImportNode($rel,$true))}}
  if(!$rels.DocumentElement.SelectSingleNode('*[contains(@Type,"/numbering")]')){$n=$rels.CreateElement('Relationship',$rels.DocumentElement.NamespaceURI);$n.SetAttribute('Id','ruyinNumbering');$n.SetAttribute('Type',$r+'/numbering');$n.SetAttribute('Target','numbering.xml');[void]$rels.DocumentElement.AppendChild($n)}
  $types=Read-Xml $base '[Content_Types].xml'
  if(!$types.DocumentElement.SelectSingleNode('*[@PartName="/word/numbering.xml"]')){$n=$types.CreateElement('Override',$types.DocumentElement.NamespaceURI);$n.SetAttribute('PartName','/word/numbering.xml');$n.SetAttribute('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml');[void]$types.DocumentElement.AppendChild($n)}
  $body.RemoveAll()
  foreach($node in $source.SelectSingleNode('//w:body',$gns).ChildNodes){if($node.LocalName -ne 'sectPr'){[void]$body.AppendChild($xml.ImportNode($node,$true))}}
  [void]$body.AppendChild($section)
  Write-Xml $base 'word/document.xml' $xml;Write-Xml $base 'word/styles.xml' $styles;Write-Xml $base 'word/_rels/document.xml.rels' $rels;Write-Xml $base '[Content_Types].xml' $types;Write-Xml $base 'docProps/core.xml' $core
  $fieldsFile=Join-Path $Root 'fields.json';if(Test-Path -LiteralPath $fieldsFile){Fill-HeaderFields $base $section (Get-Content -LiteralPath $fieldsFile -Raw|ConvertFrom-Json -AsHashtable)}
 }finally{$gen.Dispose();$base.Dispose()}
}else{Copy-Item -LiteralPath $input -Destination $output}
$word=$null;$doc=$null
try{
 Stage 'start Word'
 $before=@(Get-Process WINWORD -ErrorAction SilentlyContinue|ForEach-Object Id)
 $word=New-Object -ComObject Word.Application
 Stage 'identify Word'
 $spawned=@(Get-Process WINWORD -ErrorAction SilentlyContinue|Where-Object {$before -notcontains $_.Id})
 if($spawned.Count -ne 1){$word=$null;throw 'Could not identify a private Word process'}
 $owned=$spawned[0];[IO.File]::WriteAllText((Join-Path $Root 'word.json'),('{"id":'+$owned.Id+',"ticks":"'+$owned.StartTime.ToUniversalTime().Ticks+'"}'))
 Stage 'configure Word'
 $word.Visible=$false;$word.DisplayAlerts=0;$word.AutomationSecurity=3
 $word.Options.UpdateLinksAtOpen=$false;$word.Options.SaveNormalPrompt=$false
 Stage 'open merged document'
 $doc=$word.Documents.Open($output,$false,$false)
 if($documentTitle -and $doc.Paragraphs.Item(1).Range.Text.Trim() -ceq $documentTitle){$cover=$doc.Paragraphs.Item(1).Range;$cover.Style=-63;$cover.Font.Size=24;$cover.ParagraphFormat.Alignment=1;$cover.ParagraphFormat.SpaceBefore=150;$cover.ParagraphFormat.SpaceAfter=24}
 foreach($table in $doc.Tables){
  $table.AutoFitBehavior(2);$table.AllowAutoFit=$false;$table.Range.Font.Size=10.5
  $format=$table.Range.ParagraphFormat;$format.SpaceBefore=0;$format.SpaceAfter=3;$format.LineSpacingRule=0;$format.DisableLineHeightGrid=$true;$format.Alignment=0
  $weights=@();$total=0
  for($column=1;$column -le $table.Columns.Count;$column++){$longest=4;foreach($cell in $table.Columns.Item($column).Cells){$longest=[Math]::Max($longest,$cell.Range.Text.Trim().Length)};$weight=[Math]::Sqrt([Math]::Min(160,$longest));$weights+=$weight;$total+=$weight}
  $setup=$table.Range.Sections.Item(1).PageSetup;$width=$setup.PageWidth-$setup.LeftMargin-$setup.RightMargin-$setup.Gutter
  for($column=1;$column -le $table.Columns.Count;$column++){$table.Columns.Item($column).SetWidth(($width*$weights[$column-1]/$total),0)}
  $table.Rows.AllowBreakAcrossPages=$false
 }
 Stage 'paginate and update contents'
 $doc.Repaginate();foreach($toc in $doc.TablesOfContents){$toc.Update()};$doc.Repaginate();foreach($toc in $doc.TablesOfContents){$toc.UpdatePageNumbers()}
 foreach($section in $doc.Sections){for($i=1;$i -le 3;$i++){foreach($story in @($section.Headers.Item($i),$section.Footers.Item($i))){if($story.Exists){
  [void]$story.Range.Fields.Update()
  # Word recalculates page fields virtually without dirtying their saved story.
  # Refresh only their result text; the field instructions remain live.
  foreach($field in $story.Range.Fields){if(!$field.Locked -and ($field.Type -eq 26 -or $field.Type -eq 33)){$field.Result.Text=[string]$field.Result.Text}}
 }}}}
 $pages=$doc.ComputeStatistics(2)
 Stage 'export PDF'
 $pdf=Join-Path $Root 'output.pdf';$doc.ExportAsFixedFormat($pdf,17)
 # Pagination/printing can refresh field results without marking the document
 # dirty. Persist those caches after export while keeping the DOCX open as DOCX.
 Stage 'save Word'
 $doc.Saved=$false;$doc.Save()
 [IO.File]::WriteAllText((Join-Path $Root 'result.json'),('{"pages":'+$pages+'}'))
}finally{$no=[object]0;if($doc){try{$doc.Close([ref]$no)}catch{}};if($word){try{$word.Quit([ref]$no)}catch{}}}
`;
