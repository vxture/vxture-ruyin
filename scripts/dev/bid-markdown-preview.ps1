[CmdletBinding(DefaultParameterSetName='Heading')]
param(
    [Parameter(Mandatory)][string]$Template,
    [Parameter(Mandatory)][string]$Markdown,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory,ParameterSetName='Heading')][ValidateNotNullOrEmpty()][string]$Heading,
    [Parameter(Mandatory,ParameterSetName='Bookmark')][ValidateNotNullOrEmpty()][string]$Bookmark
)
$ErrorActionPreference='Stop'
$templatePath=(Resolve-Path -LiteralPath $Template).Path
$markdownPath=(Resolve-Path -LiteralPath $Markdown).Path
$out=[IO.Path]::GetFullPath($OutputDirectory)
$docx=Join-Path $out 'preview.docx'
$pdf=Join-Path $out 'preview.pdf'
if ((Test-Path -LiteralPath $docx) -or (Test-Path -LiteralPath $pdf)) { throw 'Use a fresh output directory.' }
$lines=& node (Join-Path $PSScriptRoot 'bid-markdown-blocks.mjs') $markdownPath
if ($LASTEXITCODE -ne 0) { throw 'Markdown could not be mapped to the template.' }
$plan=$lines | ConvertFrom-Json
$body=$plan.text
[void][IO.Directory]::CreateDirectory($out)
$sourceHash=(Get-FileHash -LiteralPath $templatePath).Hash
$working=Join-Path $out 'layout-input.docx'
Copy-Item -LiteralPath $templatePath -Destination $working
if ($PSCmdlet.ParameterSetName -eq 'Heading') {
    $zip=[IO.Compression.ZipFile]::Open($working,[IO.Compression.ZipArchiveMode]::Update)
    try {
        $reader=[IO.StreamReader]::new($zip.GetEntry('word/document.xml').Open())
        try { [xml]$xml=$reader.ReadToEnd() } finally { $reader.Dispose() }
        $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable)
        $ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
        $matches=@($xml.SelectNodes('//w:body/w:p',$ns) | Where-Object {
            (($_.SelectNodes('.//w:t',$ns) | ForEach-Object InnerText) -join '').Trim() -ceq $Heading
        })
        if ($matches.Count -ne 1) { throw 'Expected exactly one chapter heading.' }
        $next=$matches[0].NextSibling
        if (!$next -or $next.LocalName -ne 'p' -or $next.SelectNodes('.//w:t',$ns).Count) { throw 'Expected empty body paragraph.' }
        $id=1000000
        while($xml.SelectSingleNode("//w:bookmarkStart[@w:id='$id']",$ns)){$id++}
        $anchor='RuyinPreview'+[guid]::NewGuid().ToString('N').Substring(0,16)
        $start=$xml.CreateElement('w','bookmarkStart',$ns.LookupNamespace('w'))
        [void]$start.SetAttribute('id',$ns.LookupNamespace('w'),[string]$id)
        [void]$start.SetAttribute('name',$ns.LookupNamespace('w'),$anchor)
        $end=$xml.CreateElement('w','bookmarkEnd',$ns.LookupNamespace('w'))
        [void]$end.SetAttribute('id',$ns.LookupNamespace('w'),[string]$id)
        [void]$next.AppendChild($start);[void]$next.AppendChild($end)
        $zip.GetEntry('word/document.xml').Delete()
        $writer=[IO.StreamWriter]::new($zip.CreateEntry('word/document.xml').Open(),[Text.UTF8Encoding]::new($false))
        try{$xml.Save($writer)}finally{$writer.Dispose()}
    } finally { $zip.Dispose() }
}
$word=$null
$doc=$null
function Trace-Stage([string]$stage) {
    Add-Content -LiteralPath (Join-Path $out 'render.log') -Value "$([DateTime]::UtcNow.ToString('o')) $stage"
}
try {
    Trace-Stage 'Word activation'
    $word=New-Object -ComObject Word.Application
    $word.DisplayAlerts=0
    $word.AutomationSecurity=3
    Trace-Stage 'Document open'
    $doc=$word.Documents.Open($working,$false,$true)
    Trace-Stage 'Locate heading'
    if ($PSCmdlet.ParameterSetName -eq 'Bookmark') {
        if (!$doc.Bookmarks.Exists($Bookmark)) { throw "Missing Word bookmark: $Bookmark" }
        $target=$doc.Bookmarks.Item($Bookmark).Range
        if ($target.StoryType -ne 1 -or $target.Start -ne $target.End) {
            throw 'Use an empty bookmark in the document body.'
        }
        $slot=$target.Paragraphs.Item(1).Range
        if ($slot.Text -cne "`r" -or $target.Start -ne $slot.Start) {
            throw 'Place the bookmark at the start of an empty body paragraph.'
        }
    } else {
        $target=$doc.Bookmarks.Item($anchor).Range
        $slot=$target.Paragraphs.Item(1).Range
        if ($slot.Text -cne "`r") { throw 'The target body slot is not empty.' }
        $target=$doc.Range($slot.Start,$slot.End-1)
    }
    if ($slot.ParagraphFormat.OutlineLevel -ne 10 -or $slot.Information(12)) {
        throw 'The target must be a body paragraph outside a table.'
    }
    $target.Text=$body
    # Replace unique placeholders only; no document-wide COM paragraph traversal.
    foreach ($item in $plan.tables) {
        $range=$doc.Content.Duplicate
        $find=$range.Find
        $find.ClearFormatting()
        $find.Text=$item.marker
        $find.Forward=$true
        $find.Wrap=0
        if (!$find.Execute()) { throw 'Table placeholder missing.' }
        $range.Text=($item.rows | ForEach-Object { $_ -join "`t" }) -join "`r"
        $table=$range.ConvertToTable(1,$item.rows.Count,$item.rows[0].Count)
        $table.Borders.Enable=1
        $table.Rows.Item(1).HeadingFormat=-1
        $table.AutoFitBehavior(2)
    }
    foreach ($item in $plan.images) {
        $range=$doc.Content.Duplicate
        $find=$range.Find
        $find.ClearFormatting()
        $find.Text=$item.marker
        $find.Forward=$true
        $find.Wrap=0
        if (!$find.Execute()) { throw 'Image placeholder missing.' }
        $range.Text=''
        $picture=$doc.InlineShapes.AddPicture($item.path,$false,$true,$range)
        $picture.AlternativeText=$item.alt
        $picture.LockAspectRatio=-1
        $section=$range.Sections.Item(1).PageSetup
        $maxWidth=$section.PageWidth-$section.LeftMargin-$section.RightMargin
        $maxHeight=$section.PageHeight-$section.TopMargin-$section.BottomMargin
        if ($picture.Width -gt $maxWidth) { $picture.Width=$maxWidth }
        if ($picture.Height -gt $maxHeight) { $picture.Height=$maxHeight }
    }
    Trace-Stage 'Paginate'
    $doc.Repaginate()
    Trace-Stage 'Update TOC'
    foreach ($toc in $doc.TablesOfContents) { $toc.UpdatePageNumbers() }
    $doc.Repaginate()
    $page=$doc.Range($target.Start,$target.Start).Information(3)
    $pages=$doc.ComputeStatistics(2)
    Trace-Stage 'Save DOCX'
    $doc.SaveAs2($docx,16)
    Trace-Stage 'Export PDF'
    $doc.ExportAsFixedFormat($pdf,17)
    Trace-Stage 'Completed'
    if ((Get-FileHash -LiteralPath $templatePath).Hash -ne $sourceHash) { throw 'Source template changed.' }
    [pscustomobject]@{ ChapterPage=$page; Pages=$pages; Sections=$doc.Sections.Count; Tables=$doc.Tables.Count; Docx=$docx; Pdf=$pdf }
} finally {
    if ($null -ne $doc) { try { $doc.Close(0) } catch { Write-Warning $_ } }
    if ($null -ne $word) { try { $word.Quit(0) } catch { Write-Warning $_ } }
    Remove-Item -LiteralPath $working -Force -ErrorAction SilentlyContinue
}
