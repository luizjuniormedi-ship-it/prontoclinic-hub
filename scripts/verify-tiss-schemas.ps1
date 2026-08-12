[CmdletBinding()]
param(
  [string]$SchemaDirectory = (Join-Path $PSScriptRoot '..\vendor\tiss\040300'),
  [string]$XmlPath
)

$ErrorActionPreference = 'Stop'
$schemaRoot = (Resolve-Path -LiteralPath $SchemaDirectory).Path
$expected = [ordered]@{
  'tissAssinaturaDigital_v1.01.xsd' = '8567690a0eb05b9681fdc575ca7c867f75bf5cb33573175b8d333617ef035221'
  'tissComplexTypesV4_03_00.xsd' = '83a24d606620cd3907c5cd574a71bf9c4411a2ec9e0510979f44293fe7c5956a'
  'tissGuiasV4_03_00.xsd' = '587f0b6bac24175c50635ede52356cab00ff1ae28b550adc42e3a7f03cf605c7'
  'tissSimpleTypesV4_03_00.xsd' = 'd854debf58ac2d96194f72db95315ef2d102de57aeaf0388512f242824fdc794'
  'tissV4_03_00.xsd' = 'd4c421c7e3cf936551b70d6bd794a419867b6daea554d557b4d928363c54044c'
  'tissWebServicesV4_03_00.xsd' = '3044f18d2e984910c7670e3357724c2f5798d64cc4ab5919094389a3f01bce02'
  'xmldsig-core-schema.xsd' = 'b6388292d746c6cc8f932ce3b6bf7c7fc0bf6cba58ec385b38988887bcf5fdbb'
}

foreach ($entry in $expected.GetEnumerator()) {
  $path = Join-Path $schemaRoot $entry.Key
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required TISS schema is missing: $($entry.Key)"
  }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $entry.Value) {
    throw "Checksum mismatch for TISS schema $($entry.Key): $actual"
  }
}

$schemas = [System.Xml.Schema.XmlSchemaSet]::new()
$schemas.XmlResolver = $null
$schemaSettings = [System.Xml.XmlReaderSettings]::new()
$schemaSettings.DtdProcessing = [System.Xml.DtdProcessing]::Parse
$schemaSettings.XmlResolver = $null
$schemaErrors = [System.Collections.Generic.List[string]]::new()
foreach ($name in $expected.Keys) {
  $reader = [System.Xml.XmlReader]::Create((Join-Path $schemaRoot $name), $schemaSettings)
  try {
    $schema = [System.Xml.Schema.XmlSchema]::Read($reader, {
      param($sender, $eventArgs)
      $schemaErrors.Add($eventArgs.Message)
    })
    $schemas.Add($schema) | Out-Null
  } finally {
    $reader.Dispose()
  }
}
if ($schemaErrors.Count -gt 0) {
  throw "TISS schema parsing failed:`n$($schemaErrors -join "`n")"
}
$schemas.Compile()

if ($XmlPath) {
  $validationErrors = [System.Collections.Generic.List[string]]::new()
  $settings = [System.Xml.XmlReaderSettings]::new()
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $settings.ValidationType = [System.Xml.ValidationType]::Schema
  $settings.Schemas = $schemas
  $settings.add_ValidationEventHandler({
    param($sender, $eventArgs)
    $validationErrors.Add($eventArgs.Message)
  })
  $reader = [System.Xml.XmlReader]::Create((Resolve-Path -LiteralPath $XmlPath).Path, $settings)
  try {
    while ($reader.Read()) { }
  } finally {
    $reader.Dispose()
  }
  if ($validationErrors.Count -gt 0) {
    throw "TISS XSD validation failed:`n$($validationErrors -join "`n")"
  }
}

Write-Output "TISS_SCHEMA_CONTRACT_PASS version=04.03.00 files=$($expected.Count)"
