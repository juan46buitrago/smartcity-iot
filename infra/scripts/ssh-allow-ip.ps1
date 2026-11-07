# SmartCityBGA — autoriza SSH (22) en el NSG solo para su IP pública actual.
# Úselo si su IP cambia y SSH deja de responder. Requiere Azure CLI con sesión iniciada (az login).
#   powershell -ExecutionPolicy Bypass -File infra\scripts\ssh-allow-ip.ps1
#   powershell -ExecutionPolicy Bypass -File infra\scripts\ssh-allow-ip.ps1 -Ip 203.0.113.10
# No abre SSH a todo Internet: siempre una única IP (/32).
param(
  [string]$Ip = '',
  [string]$ResourceGroup = 'rg-smartcity-iot',
  [string]$Nsg = 'vm-smartcity-iot-nsg',
  [string]$Rule = 'SSH'
)
$ErrorActionPreference = 'Stop'
if (-not $Ip) { $Ip = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 10).Trim() }
if ($Ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "IP no válida: $Ip" }
Write-Host "Autorizando SSH solo desde $Ip/32 en $Nsg/$Rule ..."
az network nsg rule update -g $ResourceGroup --nsg-name $Nsg -n $Rule --source-address-prefixes "$Ip/32" -o none
if ($LASTEXITCODE -ne 0) { throw 'No se pudo actualizar la regla' }
az network nsg rule show -g $ResourceGroup --nsg-name $Nsg -n $Rule --query "{origen:sourceAddressPrefix, puerto:destinationPortRange, acceso:access}" -o table
Write-Host 'Listo. Si aun asi no hay acceso, use la consola de Azure: az vm run-command invoke (no depende de SSH).'
