import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(here);
const stage=path.join(root,'builds','desktop-release');
await fs.mkdir(path.join(stage,'app'),{recursive:true});
await fs.mkdir(path.join(stage,'build'),{recursive:true});
for(const file of ['index.html','app.js','core.js','styles.css','icon.svg','manifest.webmanifest','sw.js'])
  await fs.copyFile(path.join(root,'webapp',file),path.join(stage,'app',file));
await fs.cp(path.join(here,'assets','fonts'),path.join(stage,'app','fonts'),{recursive:true});
await fs.copyFile(path.join(here,'assets','fonts.css'),path.join(stage,'app','fonts.css'));
await fs.copyFile(path.join(here,'assets','icon.png'),path.join(stage,'build','icon.png'));
await fs.copyFile(path.join(here,'main.js'),path.join(stage,'main.js'));
const index=path.join(stage,'app','index.html');
await fs.writeFile(index,(await fs.readFile(index,'utf8')).replace('<link rel="stylesheet" href="styles.css">','<link rel="stylesheet" href="fonts.css">\n  <link rel="stylesheet" href="styles.css">'));
const pkg={name:'rooyesh-desktop',productName:'Rooyesh',version:'1.0.0',description:'Rooyesh — calm personal tasks, focus and growth assistant',author:'Rooyesh',license:'MIT',main:'main.js',private:true,build:{appId:'ir.rooyesh.desktop',productName:'Rooyesh',electronVersion:'45.2.3',directories:{output:'../windows-output',buildResources:'build'},files:['main.js','package.json','app/**/*','build/icon.png'],win:{target:'nsis',icon:'build/icon.png',signExecutable:false},nsis:{oneClick:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,shortcutName:'Rooyesh',artifactName:'Rooyesh-Setup-${version}.exe'}}};
await fs.writeFile(path.join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n');
console.log('Prepared Rooyesh desktop from the shared web app.');
