import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join, relative, resolve, extname, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Read-only inventory. No deletions or writes. Node standard library only.
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const skip=new Set(['.git','node_modules','.cache','coverage','dist']);
const files=[];
function visit(folder){
  for(const entry of readdirSync(folder,{withFileTypes:true})){
    if(skip.has(entry.name))continue;
    const path=join(folder,entry.name);
    if(entry.isDirectory())visit(path);
    else if(entry.isFile())files.push({path:relative(root,path).replaceAll('\\','/'),size:statSync(path).size});
  }
}
visit(root);
const byHash=new Map();
for(const x of files){
  if(x.size>2*1024*1024)continue;
  const hash=createHash('sha256').update(readFileSync(join(root,x.path))).digest('hex');
  const list=byHash.get(hash)||[];list.push(x.path);byHash.set(hash,list);
}
const duplicates=[...byHash.values()].filter(paths=>paths.length>1).map(paths=>paths.sort()).sort((a,b)=>a[0].localeCompare(b[0]));
const rootCode=files.filter(x=>!x.path.includes('/')&&['.js','.mjs'].includes(extname(x.path)));
const srcPaths=new Map(files.filter(x=>x.path.startsWith('src/')).map(x=>[basename(x.path),x.path]));
const rootShadows=rootCode.filter(x=>srcPaths.has(basename(x.path))).map(x=>{
  const counterpart=srcPaths.get(basename(x.path));
  return {root:x.path,activeCandidate:counterpart,identical:duplicates.some(group=>group.includes(x.path)&&group.includes(counterpart))};
});
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const start=pkg.scripts?.start||'';
const entry=(start.match(/(?:^|\s)node\s+([^\s]+)/)||[])[1];
if(!entry||!existsSync(join(root,entry))){
  process.stderr.write('ERROR: scripts.start no tiene un entrypoint existente.\n');
  process.exitCode=1;
}
const inventory={generatedAt:new Date().toISOString(),fileCount:files.length,start,duplicates,rootShadows,
  policy:'Inventario informativo: verificar referencias, despliegue y restauración antes de eliminar archivos'};
if(process.argv.includes('--json'))process.stdout.write(JSON.stringify(inventory,null,2)+'\n');
else {
  process.stdout.write('DLL One | inventario no destructivo\n');
  process.stdout.write('Entrypoint: '+start+' | archivos: '+files.length+'\n');
  process.stdout.write('\nDuplicados exactos: '+duplicates.length+' grupos\n');
  for(const group of duplicates)process.stdout.write('  = '+group.join('  |  ')+'\n');
  process.stdout.write('\nArchivos de raíz con homólogo en src/: '+rootShadows.length+'\n');
  for(const x of rootShadows)process.stdout.write('  '+x.root+' / '+x.activeCandidate+' ('+(x.identical?'idéntico':'DIFERENTE')+')\n');
  process.stdout.write('\nEste programa NO borra ni modifica archivos.\n');
}
