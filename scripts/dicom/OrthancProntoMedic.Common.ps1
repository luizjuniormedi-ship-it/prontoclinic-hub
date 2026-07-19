Set-StrictMode -Version Latest

$script:ManagedFirewallGroup = 'ProntoMedic DICOM'
$script:DicomRuleName = 'ProntoMedic-Orthanc-DICOM-4242'
$script:HttpRuleName = 'ProntoMedic-Orthanc-HTTP-8042'
$script:ServiceName = 'OrthancProntoMedic'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Execute este script em um PowerShell aberto como Administrador.'
    }
}

function Assert-ProntoMedicPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    if ($fullPath -match '(?i)\\dicom(?:\\|$)' -or $fullPath -match '(?i)DICOMDS') {
        throw "Caminho protegido por pertencer ao legado/DataSIGH: $fullPath"
    }

    return $fullPath
}

function Assert-AllowedDicomPort {
    param(
        [Parameter(Mandatory)]
        [int]$Port
    )

    if ($Port -eq 104) {
        throw 'A porta 104 pertence ao ambiente legado e nunca pode ser gerenciada por estes scripts.'
    }
    if ($Port -notin 4242, 8042) {
        throw "Porta fora do escopo ProntoMedic: $Port"
    }
}

function Assert-ExplicitRemoteAddresses {
    param(
        [Parameter(Mandatory)]
        [string[]]$Addresses,

        [Parameter(Mandatory)]
        [string]$Purpose
    )

    if (-not $Addresses -or $Addresses.Count -eq 0) {
        throw "$Purpose exige uma lista explicita de IPs ou redes CIDR."
    }

    foreach ($address in $Addresses) {
        if ([string]::IsNullOrWhiteSpace($address) -or $address -match '^(?i:any|localsubnet|internet|intranet|defaultgateway|dns|dhcp|wins)$') {
            throw "Endereco remoto amplo ou invalido nao permitido em ${Purpose}: '$address'"
        }

        $parts = $address.Split('/', 2)
        $parsed = [Net.IPAddress]::None
        if (-not [Net.IPAddress]::TryParse($parts[0], [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
            throw "Somente IPv4 ou IPv4/CIDR explicito e aceito em ${Purpose}: '$address'"
        }
        if ($parts.Count -eq 2) {
            $prefix = 0
            if (-not [int]::TryParse($parts[1], [ref]$prefix) -or $prefix -lt 0 -or $prefix -gt 32) {
                throw "Prefixo CIDR invalido em ${Purpose}: '$address'"
            }
        }
    }
}

function Get-ManagedFirewallSnapshot {
    $rules = Get-NetFirewallRule -Group $script:ManagedFirewallGroup -ErrorAction SilentlyContinue
    $result = foreach ($rule in $rules) {
        $port = $rule | Get-NetFirewallPortFilter
        $address = $rule | Get-NetFirewallAddressFilter
        [pscustomobject]@{
            Name          = $rule.Name
            DisplayName   = $rule.DisplayName
            Enabled       = $rule.Enabled.ToString()
            Direction     = $rule.Direction.ToString()
            Action        = $rule.Action.ToString()
            Profile       = $rule.Profile.ToString()
            Protocol      = $port.Protocol.ToString()
            LocalPort     = @($port.LocalPort)
            RemoteAddress = @($address.RemoteAddress)
        }
    }

    return @($result)
}

function Set-ManagedFirewallRule {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$DisplayName,

        [Parameter(Mandatory)]
        [int]$LocalPort,

        [Parameter(Mandatory)]
        [string[]]$RemoteAddress,

        [ValidateSet('Domain', 'Private', 'Public', 'Domain,Private', 'Domain,Private,Public')]
        [string]$Profile = 'Domain,Private'
    )

    Assert-AllowedDicomPort -Port $LocalPort
    Assert-ExplicitRemoteAddresses -Addresses $RemoteAddress -Purpose "firewall TCP $LocalPort"

    $rule = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -Name $Name -DisplayName $DisplayName -Group $script:ManagedFirewallGroup `
            -Direction Inbound -Action Allow -Enabled True -Profile $Profile -Protocol TCP `
            -LocalPort $LocalPort -RemoteAddress $RemoteAddress | Out-Null
        return
    }

    Set-NetFirewallRule -Name $Name -DisplayName $DisplayName -Group $script:ManagedFirewallGroup `
        -Direction Inbound -Action Allow -Enabled True -Profile $Profile | Out-Null
    $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $LocalPort | Out-Null
    $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress $RemoteAddress | Out-Null
}

function Test-UnmanagedPortExposure {
    param(
        [Parameter(Mandatory)]
        [int[]]$Ports
    )

    $findings = foreach ($rule in Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -ErrorAction SilentlyContinue) {
        if ($rule.Group -eq $script:ManagedFirewallGroup) {
            continue
        }
        $portFilter = $rule | Get-NetFirewallPortFilter
        foreach ($port in $Ports) {
            if ($portFilter.Protocol -eq 'TCP' -and (@($portFilter.LocalPort) -contains $port.ToString() -or @($portFilter.LocalPort) -contains 'Any')) {
                $address = $rule | Get-NetFirewallAddressFilter
                [pscustomobject]@{
                    Port          = $port
                    RuleName      = $rule.Name
                    DisplayName   = $rule.DisplayName
                    Profile       = $rule.Profile.ToString()
                    RemoteAddress = (@($address.RemoteAddress) -join ',')
                }
            }
        }
    }

    return @($findings)
}

function Get-OrthancServiceState {
    $service = Get-CimInstance Win32_Service -Filter "Name='$script:ServiceName'" -ErrorAction SilentlyContinue
    if (-not $service) {
        return [pscustomobject]@{
            Exists    = $false
            Name      = $script:ServiceName
            State     = 'NotInstalled'
            StartMode = $null
            PathName  = $null
            ProcessId = 0
        }
    }

    return [pscustomobject]@{
        Exists    = $true
        Name      = $service.Name
        State     = $service.State
        StartMode = $service.StartMode
        PathName  = $service.PathName
        ProcessId = $service.ProcessId
    }
}

function Grant-OrthancServiceAccess {
    param(
        [Parameter(Mandatory)][string]$ProgramRoot,
        [Parameter(Mandatory)][string]$StorageRoot,
        [Parameter(Mandatory)][string]$LogRoot
    )

    $account = 'NT AUTHORITY\LOCAL SERVICE'
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    $targets = @(
        @{ Path = $ProgramRoot; Rights = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute },
        @{ Path = $StorageRoot; Rights = [System.Security.AccessControl.FileSystemRights]::Modify },
        @{ Path = $LogRoot; Rights = [System.Security.AccessControl.FileSystemRights]::Modify }
    )

    foreach ($target in $targets) {
        New-Item -ItemType Directory -Path $target.Path -Force | Out-Null
        $acl = Get-Acl -LiteralPath $target.Path
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $account,
            $target.Rights,
            $inheritance,
            $propagation,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.SetAccessRule($rule)
        Set-Acl -LiteralPath $target.Path -AclObject $acl
    }
}

function Get-FileInventory {
    param(
        [Parameter(Mandatory)]
        [string]$Root
    )

    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        return @()
    }

    $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
    return @(Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File -Force | ForEach-Object {
        [pscustomobject]@{
            RelativePath = $_.FullName.Substring($resolvedRoot.Length).TrimStart('\\')
            Length       = $_.Length
            Sha256       = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    })
}

function ConvertTo-XmlEscapedText {
    param([Parameter(Mandatory)][string]$Value)
    return [Security.SecurityElement]::Escape($Value)
}
