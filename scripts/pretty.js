// Читаемая сборка: шапка как есть, тело форматируется prettier (отступы, переносы, комментарии сохраняются)
const fs=require('fs'),prettier=require('prettier');
const src=fs.readFileSync(process.argv[2],'utf8'),mk='// ==/UserScript==',i=src.indexOf(mk)+mk.length;
prettier.format(src.slice(i),{parser:'babel',printWidth:110,tabWidth:2}).then(code=>{
  const out=src.slice(0,i)+'\n\n'+code; fs.writeFileSync(process.argv[3],out);
  console.log('pretty',Buffer.byteLength(out),'bytes',out.split('\n').length,'lines');
}).catch(e=>{console.error(e);process.exit(1)});
