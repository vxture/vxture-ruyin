param([Parameter(Mandatory)][string]$OutputDirectory, [string]$DiagramPath)
$ErrorActionPreference='Stop'
$out=[IO.Path]::GetFullPath($OutputDirectory)
[void][IO.Directory]::CreateDirectory($out)
$before=Join-Path $out 'technical-bid-before.docx'
$after=Join-Path $out 'technical-bid-revised.docx'
if ((Test-Path -LiteralPath $before) -or (Test-Path -LiteralPath $after)) { throw 'Use a fresh output directory.' }

function Add-Paragraph($doc,[string]$value,[int]$style=-1) {
    $p=$doc.Paragraphs.Last
    $p.Range.Style=$style
    $p.Range.InsertBefore($value)
    $p.Range.InsertParagraphAfter()
    $doc.Paragraphs.Last.Range.Style=-1
}
function Add-Chapter($doc,[string]$tag,[string]$title,[string]$body) {
    Add-Paragraph $doc $title -2
    $start=$doc.Content.End-1
    Add-Paragraph $doc $body
    $range=$doc.Range($start,$doc.Content.End-2)
    $control=$doc.ContentControls.Add(0,$range)
    $control.Tag=$tag
    $control.Title=$title
    $control.LockContentControl=$true
}
function Read-Chapter($doc,[string]$tag) {
    $matches=$doc.SelectContentControlsByTag($tag)
    if ($matches.Count -ne 1) { throw "Expected one chapter region for $tag" }
    return $matches.Item(1)
}
function Update-Layout($doc) {
    $doc.Repaginate()
    foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
    $doc.Repaginate()
    return $doc.ComputeStatistics(2)
}
$word=$null
$doc=$null
try {
    $word=New-Object -ComObject Word.Application
    $word.Visible=$false
    $word.DisplayAlerts=0
    $doc=$word.Documents.Add()
    $doc.PageSetup.PaperSize=7
    $doc.Styles.Item(-1).Font.NameFarEast='Microsoft YaHei'
    $doc.Styles.Item(-1).Font.Size=11
    Add-Paragraph $doc '园区运维服务技术标' -63
    Add-Paragraph $doc '排版与章节替换测试样稿  所有内容均为合成数据'
    Add-Paragraph $doc '目录'
    [void]$doc.TablesOfContents.Add($doc.Range($doc.Content.End-1,$doc.Content.End-1))
    [void]$doc.Range($doc.Content.End-1,$doc.Content.End-1).InsertBreak(7)
    Add-Chapter $doc 'technical.service' '服务响应方案' '建立统一服务台。重大事件由值班负责人登记并分派。'
    Add-Chapter $doc 'technical.delivery' '巡检与交付' '每月汇总巡检记录，并保留现场确认和复核记录。'
    $manual=Read-Chapter $doc 'technical.delivery'
    $manual.Range.Text='人工补充：月度报告在项目例会上逐项复核。'
    if ($DiagramPath) {
        $imagePath=(Resolve-Path -LiteralPath $DiagramPath).Path
        $image=$doc.InlineShapes.AddPicture($imagePath,$false,$true,$doc.Range($doc.Content.End-1,$doc.Content.End-1))
        $image.LockAspectRatio=-1
        $image.Width=410
        $image.Range.ParagraphFormat.KeepWithNext=$true
        $doc.Range($doc.Content.End-1,$doc.Content.End-1).InsertParagraphAfter()
        Add-Paragraph $doc '图 1  巡检与交付流程' -35
    }
    [void]$doc.Range($doc.Content.End-1,$doc.Content.End-1).InsertBreak(2)
    $doc.Sections.Last.PageSetup.Orientation=1
    Add-Paragraph $doc '运维跟踪表' -2
    $table=$doc.Tables.Add($doc.Range($doc.Content.End-1,$doc.Content.End-1),38,3)
    $table.Borders.Enable=1
    $table.Rows.Item(1).HeadingFormat=$true
    $table.Rows.AllowBreakAcrossPages=$false
    $table.Cell(1,1).Range.Text='编号'
    $table.Cell(1,2).Range.Text='工作项'
    $table.Cell(1,3).Range.Text='检查依据'
    for ($i=2;$i -le 38;$i++) {
        $table.Cell($i,1).Range.Text=('{0:D2}' -f ($i-1))
        $table.Cell($i,2).Range.Text='记录巡检发现及处理结果'
        $table.Cell($i,3).Range.Text='工单编号、处理记录与复核意见'
    }
    $pagesBefore=Update-Layout $doc
    $doc.SaveAs2($before,16)
    $doc.Close(0)
    $doc=$null
    $doc=$word.Documents.Open($before,$false,$true)
    $untouched=(Read-Chapter $doc 'technical.delivery').Range.Text
    if ($untouched -cne '人工补充：月度报告在项目例会上逐项复核。') { throw 'Manual edit was not saved in the baseline.' }
    $target=Read-Chapter $doc 'technical.service'
    $replacement='服务台统一接收报障。值班负责人按影响范围分级，记录处理进度并向项目联系人反馈。'
    $target.Range.Text=$replacement
    $pagesAfter=Update-Layout $doc
    $doc.SaveAs2($after,16)
    $doc.Close(0)
    $doc=$null
    $doc=$word.Documents.Open($after,$false,$true)
    if ((Read-Chapter $doc 'technical.service').Range.Text -cne $replacement) { throw 'Chapter rewrite was not saved.' }
    if ((Read-Chapter $doc 'technical.delivery').Range.Text -cne $untouched) { throw 'Adjacent chapter was modified.' }
    if ($doc.Sections.Last.PageSetup.Orientation -ne 1 -or $doc.Tables.Item(1).Rows.Count -ne 38 -or $doc.Tables.Item(1).Rows.Item(1).HeadingFormat -ne -1 -or $doc.TablesOfContents.Count -ne 1) { throw 'Document layout structures changed.' }
    if ($DiagramPath -and ($doc.InlineShapes.Count -ne 1 -or $doc.Content.Text -notmatch '图 1  巡检与交付流程')) { throw 'The diagram or caption was lost.' }
    [pscustomobject]@{WordVersion=$word.Version; PagesBefore=$pagesBefore; PagesAfter=$pagesAfter; Before=$before; Revised=$after}
}
finally {
    if ($null -ne $doc) { $doc.Close(0) }
    if ($null -ne $word) { $word.Quit(0) }
}
