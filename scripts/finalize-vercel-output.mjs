import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'

if (process.env.VERCEL) {
  const root=process.cwd()
  const source=JSON.parse(readFileSync(resolve(root,'vercel.json'),'utf8'))
  const outputPath=resolve(root,'.vercel/output/config.json')
  const output=JSON.parse(readFileSync(outputPath,'utf8'))
  const crons=source.crons

  if (!Array.isArray(crons)||crons.length===0||crons.some(({path,schedule})=>
    typeof path!=='string'||!path.startsWith('/')||typeof schedule!=='string'||!schedule.trim()
  )) {
    throw new Error('vercel.json must declare valid cron paths and schedules')
  }
  if (output.version!==3||!Array.isArray(output.routes)) {
    throw new Error('Nitro did not produce a Vercel Build Output API v3 config')
  }
  for (const {path} of crons) {
    if (!output.routes.some(route=>route.src===path&&route.dest===path)) {
      throw new Error(`Cron path is missing from the Vercel build output: ${path}`)
    }
  }
  if (output.crons&&JSON.stringify(output.crons)!==JSON.stringify(crons)) {
    throw new Error('Nitro and vercel.json declare conflicting cron jobs')
  }

  output.crons=crons
  writeFileSync(outputPath,`${JSON.stringify(output,null,2)}\n`)
  console.log(`Registered ${crons.length} cron job(s) in Vercel build output`)
}
