# PowerShell script to install Azure CLI and gcloud on remote server
# Uses Posh-SSH for non-interactive password authentication

$serverIP = "78.47.138.194"
$username = "root"
$password = "EubnUUAVJKVF"

# Check if Posh-SSH is installed
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    Write-Host "Installing Posh-SSH module..."
    Install-Module -Name Posh-SSH -Force -Scope CurrentUser
}

Import-Module Posh-SSH

# Create credential
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($username, $securePassword)

Write-Host "Connecting to server..."

try {
    # Create SSH session
    $session = New-SSHSession -ComputerName $serverIP -Credential $credential -AcceptKey -Force

    if ($session.Connected) {
        Write-Host "Connected to server!"

        # Install Azure CLI
        Write-Host "`n=== Installing Azure CLI ==="

        Write-Host "Updating packages..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "apt-get update"

        Write-Host "Installing prerequisites..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "apt-get install -y ca-certificates curl apt-transport-https lsb-release gnupg"

        Write-Host "Adding Microsoft GPG key..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl -sL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /usr/share/keyrings/microsoft-archive-keyring.gpg 2>/dev/null"

        Write-Host "Adding Azure CLI repository..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-archive-keyring.gpg] https://packages.microsoft.com/repos/azure-cli/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/azure-cli.list'

        Write-Host "Installing Azure CLI (this may take a few minutes)..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "apt-get update && apt-get install -y azure-cli" -TimeOut 300
        Write-Host $result.Output

        Write-Host "Verifying Azure CLI installation..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "az --version 2>&1 | head -5"
        Write-Host $result.Output

        # Install Google Cloud CLI
        Write-Host "`n=== Installing Google Cloud CLI ==="

        Write-Host "Adding Google Cloud GPG key..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "curl https://packages.cloud.google.com/apt/doc/apt-key.gpg 2>/dev/null | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg 2>/dev/null"

        Write-Host "Adding Google Cloud repository..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command 'echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list'

        Write-Host "Installing Google Cloud CLI (this may take a few minutes)..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "apt-get update && apt-get install -y google-cloud-cli" -TimeOut 300
        Write-Host $result.Output

        Write-Host "Verifying Google Cloud CLI installation..."
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "gcloud --version 2>&1 | head -3"
        Write-Host $result.Output

        # Final verification
        Write-Host "`n=== Final Verification ==="
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command "which az; which gcloud; which claude"
        Write-Host "Installed CLI tools:"
        Write-Host $result.Output

        # Remove SSH session
        Remove-SSHSession -SessionId $session.SessionId

        Write-Host "`nDone!"
    } else {
        Write-Host "Failed to connect to server"
    }
} catch {
    Write-Host "Error: $_"
}
