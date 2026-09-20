import JSZip from 'jszip';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function safeBuildPath(name){return !!name&&!name.startsWith('/')&&!/[\\:\x00-\x1f]/.test(name)&&!name.split('/').some(p=>!p||p==='.'||p==='..')&&!/(^|\/)(node_modules|\.git)(\/|$)/.test(name);}
export async function executeBuild({archiveBase64,testCase}){
 const started=Date.now();const base={testCaseId:String(testCase?.id??'build'),latencyMs:0,cost:0,trace:[],verificationStatus:'unverified'};
 if(!process.env.BUILD_IMAGE)return {...base,output:'工程构建执行器未配置 BUILD_IMAGE；请部署预装依赖的 Docker 镜像。不会在宿主机执行上传代码。'};
 const bytes=Buffer.from(archiveBase64??'','base64');
 if(!bytes.length||bytes.length>30*1024*1024)throw new Error('源码压缩包必须为 1–30MB');
 const hash=createHash('sha256').update(bytes).digest('hex');
 const zip=await JSZip.loadAsync(bytes);
 const entries=Object.values(zip.files).filter(e=>!e.dir);
 if(entries.length>1500)throw new Error('最多构建 1500 个源码文件');
 const root=await mkdtemp(path.join(tmpdir(),'evolve-build-'));
 let size=0;
 try{
  for(const entry of entries){
   if(!safeBuildPath(entry.unsafeOriginalName??entry.name)||!safeBuildPath(entry.name)||((Number(entry.unixPermissions??0)&0o170000)===0o120000))throw new Error('压缩包含不支持的路径、依赖目录或符号链接');
   if((entry._data?.uncompressedSize??0)>50*1024*1024-size)throw new Error('源码解压总量超过 50MB');
   const data=await entry.async('nodebuffer');size+=data.length;if(size>50*1024*1024)throw new Error('源码解压总量超过 50MB');
   const target=path.resolve(root,entry.name);if(!target.startsWith(root+path.sep))throw new Error('非法路径');
   await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);
  }
  // Image and command are operator configuration, never accepted from a model/request.
  const command=process.env.BUILD_COMMAND||'npm run build && npm test';
  const name=`evolve-build-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
  const args=['run','--rm','--name',name,'--network','none','--memory','1g','--cpus','2','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--tmpfs','/work:rw,exec,size=512m','--mount',`type=bind,source=${root},target=/candidate,readonly`,'--workdir','/work',process.env.BUILD_IMAGE,'sh','-lc',`cp -a /candidate/. /work/ && ln -s /opt/deps/node_modules /work/node_modules && ${command}`];
  const execution=await new Promise(resolve=>{
   const child=spawn('docker',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';let timedOut=false;
   const collect=chunk=>{output=(output+chunk.toString()).slice(-32000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
   const timer=setTimeout(()=>{timedOut=true;child.kill();const cleanup=spawn('docker',['rm','-f',name],{windowsHide:true,stdio:'ignore'});cleanup.on('error',()=>{});},120000);
   child.on('error',error=>{clearTimeout(timer);resolve({unavailable:true,output:String(error)});});
   child.on('close',code=>{clearTimeout(timer);resolve({code,timedOut,output});});
  });
  const unavailable=execution.unavailable||execution.timedOut||[125,126,127].includes(execution.code);
  return {...base,artifactHash:hash,latencyMs:Date.now()-started,verificationStatus:unavailable?'unverified':execution.code===0?'partial':'failed',output:JSON.stringify({scope:'configured-build-and-tests',exitCode:execution.code,log:execution.output,limitations:['只证明配置的构建与测试结果；未自动执行当前题目的浏览器步骤或线上切流。']}),trace:[{id:'docker-build',stage:'build',status:unavailable?'warning':execution.code===0?'pass':'fail',summary:unavailable?'构建环境不可用':`实际源码构建/测试退出码 ${execution.code}`,detail:`sha256:${hash}`}],...(execution.code!==0&&!unavailable?{error:'配置的构建或测试失败'}:{})};
 }finally{const resolved=path.resolve(root);if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('evolve-build-'))await rm(resolved,{recursive:true,force:true});}
}
