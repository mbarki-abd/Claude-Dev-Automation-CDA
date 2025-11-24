const { NodeSSH } = require('node-ssh');

const ssh = new NodeSSH();

async function checkCLITools() {
  try {
    console.log('Connecting to server...');
    await ssh.connect({
      host: '78.47.138.194',
      username: 'root',
      password: 'EubnUUAVJKVF',
    });
    console.log('Connected!\n');

    // Check which CLI tools are installed
    console.log('=== Checking CLI Tools Installation ===\n');

    // Check Claude Code
    console.log('--- Claude Code ---');
    const claudeWhich = await ssh.execCommand('which claude 2>/dev/null || echo "NOT FOUND"');
    console.log('Path:', claudeWhich.stdout || 'NOT FOUND');
    if (claudeWhich.stdout && !claudeWhich.stdout.includes('NOT FOUND')) {
      const claudeVersion = await ssh.execCommand('claude --version 2>&1');
      console.log('Version:', claudeVersion.stdout || claudeVersion.stderr);
    }

    // Check Azure CLI
    console.log('\n--- Azure CLI ---');
    const azWhich = await ssh.execCommand('which az 2>/dev/null || echo "NOT FOUND"');
    console.log('Path:', azWhich.stdout || 'NOT FOUND');
    if (azWhich.stdout && !azWhich.stdout.includes('NOT FOUND')) {
      const azVersion = await ssh.execCommand('az --version 2>&1 | head -5');
      console.log('Version:', azVersion.stdout);

      // Check Azure auth
      console.log('\n--- Azure Auth Status ---');
      const azAccount = await ssh.execCommand('az account show 2>&1');
      if (azAccount.stdout && !azAccount.stderr.includes('not logged in')) {
        console.log('Authenticated:', azAccount.stdout);
      } else {
        console.log('Not authenticated:', azAccount.stderr || 'Need to run az login');
      }
    }

    // Check Google Cloud CLI
    console.log('\n--- Google Cloud CLI ---');
    const gcloudWhich = await ssh.execCommand('which gcloud 2>/dev/null || echo "NOT FOUND"');
    console.log('Path:', gcloudWhich.stdout || 'NOT FOUND');
    if (gcloudWhich.stdout && !gcloudWhich.stdout.includes('NOT FOUND')) {
      const gcloudVersion = await ssh.execCommand('gcloud --version 2>&1 | head -3');
      console.log('Version:', gcloudVersion.stdout);

      // Check gcloud auth
      console.log('\n--- GCloud Auth Status ---');
      const gcloudAuth = await ssh.execCommand('gcloud auth list 2>&1');
      console.log('Auth list:', gcloudAuth.stdout || gcloudAuth.stderr);
    }

    // Check Node.js
    console.log('\n--- Node.js ---');
    const nodeVersion = await ssh.execCommand('node --version 2>&1');
    console.log('Version:', nodeVersion.stdout || nodeVersion.stderr);

    // Check npm
    console.log('\n--- npm ---');
    const npmVersion = await ssh.execCommand('npm --version 2>&1');
    console.log('Version:', npmVersion.stdout || npmVersion.stderr);

    // Check Docker
    console.log('\n--- Docker ---');
    const dockerVersion = await ssh.execCommand('docker --version 2>&1');
    console.log('Version:', dockerVersion.stdout || dockerVersion.stderr);

    // Check running services
    console.log('\n=== Running Services ===\n');
    const services = await ssh.execCommand('docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1');
    console.log(services.stdout || services.stderr);

    ssh.dispose();
    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error.message);
    ssh.dispose();
  }
}

checkCLITools();
