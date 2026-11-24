[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Library,
    [Parameter(Mandatory)][ValidateSet('Import','List','Preview')][string]$Action,
    [string]$Template,
    [string]$Name,
    [string]$Heading,
    [string]$Bookmark,
    [string]$Version,
    [string]$Markdown,
    [string]$OutputDirectory
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($Library)

function Get-Digest([string]$value) {
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($value))).ToLowerInvariant()
}
function Read-Version([string]$id) {
    if ($id -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid template version.' }
    $dir=Join-Path $root $id
    $record=Get-Content -LiteralPath (Join-Path $dir 'version.json') -Raw | ConvertFrom-Json
    $file=Join-Path $dir 'template.docx'
    $digest=(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()
    $canonical=[ordered]@{name=$record.name; kind=$record.kind; target=$record.target; sha256=$digest} | ConvertTo-Json -Compress
    if ($record.version -cne $id -or $record.sha256 -cne $digest -or (Get-Digest $canonical) -cne $id) {
        throw 'Saved template or mapping no longer matches its version.'
    }
    $record
}
switch ($Action) {
    'Import' {
        if ([string]::IsNullOrWhiteSpace($Name) -or [string]::IsNullOrWhiteSpace($Template)) {
            throw 'Supply a template and a display name.'
        }
        if ([string]::IsNullOrWhiteSpace($Heading) -eq [string]::IsNullOrWhiteSpace($Bookmark)) {
            throw 'Supply exactly one heading or bookmark.'
        }
        $source=(Resolve-Path -LiteralPath $Template).Path
        if ([IO.Path]::GetExtension($source) -ine '.docx') { throw 'This prototype supports DOCX templates.' }
        [void][IO.Directory]::CreateDirectory($root)
        $stage=Join-Path $root ('.import-'+[guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($stage)
        try {
            $copy=Join-Path $stage 'template.docx'
            Copy-Item -LiteralPath $source -Destination $copy
            $zip=[IO.Compression.ZipFile]::OpenRead($copy)
            try {
                if (!$zip.GetEntry('word/document.xml') -or !$zip.GetEntry('[Content_Types].xml')) {
                    throw 'The selected file is not a Word document.'
                }
            } finally { $zip.Dispose() }
            $useHeading=![string]::IsNullOrWhiteSpace($Heading)
            $kind=if ($useHeading) {'heading'} else {'bookmark'}
            $target=if ($useHeading) {$Heading.Trim()} else {$Bookmark.Trim()}
            $record=[ordered]@{name=$Name.Trim(); kind=$kind; target=$target; sha256=(Get-FileHash -LiteralPath $copy).Hash.ToLowerInvariant()}
            $id=Get-Digest ($record | ConvertTo-Json -Compress)
            $record.version=$id
            $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'version.json') -Encoding utf8
            $destination=Join-Path $root $id
            if (!(Test-Path -LiteralPath $destination)) {
                try { [IO.Directory]::Move($stage,$destination) }
                catch [IO.IOException] { if (!(Test-Path -LiteralPath $destination)) { throw } }
            }
            Read-Version $id
        } finally {
            if ([IO.Directory]::Exists($stage)) {
                foreach ($name in @('template.docx','version.json')) { [IO.File]::Delete((Join-Path $stage $name)) }
                [IO.Directory]::Delete($stage)
            }
        }
    }
    'List' {
        if (Test-Path -LiteralPath $root) {
            Get-ChildItem -LiteralPath $root -Directory | Where-Object Name -CMatch '^[a-f0-9]{64}$' | ForEach-Object { Read-Version $_.Name }
        }
    }
    'Preview' {
        if (!$Version -or !$Markdown -or !$OutputDirectory) { throw 'Supply a version, Markdown, and an output directory.' }
        $record=Read-Version $Version
        $mapping=if ($record.kind -ceq 'heading') { @{ Heading=$record.target } } else { @{ Bookmark=$record.target } }
        & (Join-Path $PSScriptRoot 'bid-markdown-preview.ps1') -Template (Join-Path $root "$Version/template.docx") -Markdown $Markdown -OutputDirectory $OutputDirectory @mapping
    }
}
