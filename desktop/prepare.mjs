import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const stage = path.join(root, 'builds', 'desktop-release');
const appDir = path.join(stage, 'app');
const buildDir = path.join(stage, 'build');
const { version: localVersion } = JSON.parse(await fs.readFile(path.join(here, 'package.json'), 'utf8'));
const version = process.env.ROOYESH_VERSION ?? localVersion;

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error('ROOYESH_VERSION must have the form major.minor.patch, for example 1.0.1.');
}

await fs.mkdir(appDir, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });
const webFiles = ['index.html', 'app.js', 'core.js', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'sw.js'];
for (const file of webFiles) {
  await fs.copyFile(path.join(root, 'webapp', file), path.join(appDir, file));
}
await fs.cp(path.join(here, 'assets', 'fonts'), path.join(appDir, 'fonts'), { recursive: true });
await fs.copyFile(path.join(here, 'assets', 'fonts.css'), path.join(appDir, 'fonts.css'));
await fs.copyFile(path.join(here, 'assets', 'icon.png'), path.join(buildDir, 'icon.png'));
await fs.copyFile(path.join(here, 'main.js'), path.join(stage, 'main.js'));

const index = path.join(appDir, 'index.html');
const html = await fs.readFile(index, 'utf8');
await fs.writeFile(index, html.replace(
  '<link rel="stylesheet" href="styles.css">',
  '<link rel="stylesheet" href="fonts.css">\n  <link rel="stylesheet" href="styles.css">',
));

const pkg = {
  name: 'rooyesh-desktop',
  productName: 'Rooyesh',
  version,
  description: 'Rooyesh — calm personal tasks, focus and growth assistant',
  author: 'Rooyesh',
  license: 'MIT',
  main: 'main.js',
  private: true,
  build: {
    appId: 'ir.rooyesh.desktop',
    productName: 'Rooyesh',
    electronVersion: '45.2.3',
    directories: { output: '../windows-output', buildResources: 'build' },
    files: ['main.js', 'package.json', 'app/**/*', 'build/icon.png'],
    win: { target: 'nsis', icon: 'build/icon.png', signExecutable: false },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      shortcutName: 'Rooyesh',
      artifactName: 'Rooyesh-Setup-${version}.exe',
    },
  },
};

await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log(`Prepared Rooyesh ${version} desktop from the shared web app.`);
