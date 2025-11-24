const { NodeSSH } = require('node-ssh');

const ssh = new NodeSSH();

async function installCLITools() {
  try {
    console.log('Connecting to server...');
    await ssh.connect({
      host: '78.47.138.194',
      username: 'root',
      password: 'EubnUUAVJKVF',
    });
    console.log('Connected!\n');

    // Install Azure CLI
    console.log('=== Installing Azure CLI ===\n');
    console.log('Installing prerequisites...');
    const prereq = await ssh.execCommand('apt-get update && apt-get install -y ca-certificates curl apt-transport-https lsb-release gnupg');
    if (prereq.code !== 0) {
      console.log('Prereq output:', prereq.stderr);
    }

    console.log('Adding Microsoft repository...');
    const msKey = await ssh.execCommand('curl -sL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /usr/share/keyrings/microsoft-archive-keyring.gpg');

    const msRepo = await ssh.execCommand('echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-archive-keyring.gpg] https://packages.microsoft.com/repos/azure-cli/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/azure-cli.list');

    console.log('Installing Azure CLI...');
    const azInstall = await ssh.execCommand('apt-get update && apt-get install -y azure-cli', {
      onStdout: (chunk) => process.stdout.write(chunk.toString()),
      onStderr: (chunk) => process.stderr.write(chunk.toString()),
    });
    console.log('\nAzure CLI install exit code:', azInstall.code);

    // Verify Azure CLI
    const azVersion = await ssh.execCommand('az --version 2>&1 | head -5');
    console.log('Azure CLI version:\n', azVersion.stdout || azVersion.stderr);

    // Install Google Cloud CLI
    console.log('\n=== Installing Google Cloud CLI ===\n');

    console.log('Adding Google Cloud repository...');
    const gcpKey = await ssh.execCommand('curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg');

    const gcpRepo = await ssh.execCommand('echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list');

    console.log('Installing Google Cloud CLI...');
    const gcpInstall = await ssh.execCommand('apt-get update && apt-get install -y google-cloud-cli', {
      onStdout: (chunk) => process.stdout.write(chunk.toString()),
      onStderr: (chunk) => process.stderr.write(chunk.toString()),
    });
    console.log('\nGoogle Cloud CLI install exit code:', gcpInstall.code);

    // Verify Google Cloud CLI
    const gcloudVersion = await ssh.execCommand('gcloud --version 2>&1 | head -3');
    console.log('Google Cloud CLI version:\n', gcloudVersion.stdout || gcloudVersion.stderr);

    // Final verification
    console.log('\n=== Final Verification ===\n');
    const whichAz = await ssh.execCommand('which az');
    console.log('Azure CLI path:', whichAz.stdout || 'NOT FOUND');

    const whichGcloud = await ssh.execCommand('which gcloud');
    console.log('Google Cloud CLI path:', whichGcloud.stdout || 'NOT FOUND');

    ssh.dispose();
    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error.message);
    ssh.dispose();
  }
}

installCLITools();
