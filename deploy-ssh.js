const { NodeSSH } = require('node-ssh');
const path = require('path');
const fs = require('fs');

const ssh = new NodeSSH();

const SERVER_IP = '78.47.138.194';
const SERVER_USER = 'root';
const SERVER_PASSWORD = 'EubnUUAVJKVF';
const REMOTE_DIR = '/opt/cda';

async function deploy() {
  try {
    console.log('Connecting to server...');
    await ssh.connect({
      host: SERVER_IP,
      username: SERVER_USER,
      password: SERVER_PASSWORD,
    });
    console.log('Connected!');

    // Create remote directory
    console.log('Creating remote directory...');
    await ssh.execCommand(`mkdir -p ${REMOTE_DIR}`);

    // Upload files
    const localDir = __dirname;
    const filesToUpload = [
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'tsconfig.json',
    ];

    const dirsToUpload = [
      'apps',
      'packages',
    ];

    // Upload package files
    for (const file of filesToUpload) {
      const localPath = path.join(localDir, file);
      if (fs.existsSync(localPath)) {
        console.log(`Uploading ${file}...`);
        await ssh.putFile(localPath, `${REMOTE_DIR}/${file}`);
      }
    }

    // Upload directories
    for (const dir of dirsToUpload) {
      const localPath = path.join(localDir, dir);
      if (fs.existsSync(localPath)) {
        console.log(`Uploading ${dir}...`);
        await ssh.putDirectory(localPath, `${REMOTE_DIR}/${dir}`, {
          recursive: true,
          concurrency: 10,
          validate: (itemPath) => {
            const basename = path.basename(itemPath);
            return basename !== 'node_modules' && basename !== '.git';
          }
        });
      }
    }

    // Install dependencies
    console.log('Installing dependencies...');
    const installResult = await ssh.execCommand('cd /opt/cda && npm install -g pnpm && pnpm install', {
      onStdout: (chunk) => process.stdout.write(chunk.toString()),
      onStderr: (chunk) => process.stderr.write(chunk.toString()),
    });
    console.log('Install exit code:', installResult.code);

    // Build
    console.log('Building application...');
    const buildResult = await ssh.execCommand('cd /opt/cda && pnpm run build', {
      onStdout: (chunk) => process.stdout.write(chunk.toString()),
      onStderr: (chunk) => process.stderr.write(chunk.toString()),
    });
    console.log('Build exit code:', buildResult.code);

    // Create and start systemd service
    console.log('Setting up systemd service...');
    const serviceContent = `[Unit]
Description=CDA API Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cda/apps/api
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
`;

    await ssh.execCommand(`cat > /etc/systemd/system/cda-api.service << 'EOF'
${serviceContent}
EOF`);

    await ssh.execCommand('systemctl daemon-reload');
    await ssh.execCommand('systemctl enable cda-api');
    await ssh.execCommand('systemctl restart cda-api');

    // Check status
    const statusResult = await ssh.execCommand('systemctl status cda-api');
    console.log('Service status:', statusResult.stdout);

    console.log('Deployment complete!');
    ssh.dispose();
  } catch (error) {
    console.error('Deployment failed:', error);
    ssh.dispose();
    process.exit(1);
  }
}

deploy();
