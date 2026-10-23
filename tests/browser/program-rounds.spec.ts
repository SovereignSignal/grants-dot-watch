import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProgramRoundPreview } from '../program-round-preview.mjs';

let fixture: ReturnType<typeof createProgramRoundPreview>;
let child: ChildProcess | undefined;
let preview = '';
let output = '';

test.beforeAll(async ({ playwright }) => {
  fixture = createProgramRoundPreview();
  symlinkSync(resolve('.next'),join(fixture.dir,'.next'),'dir');
  symlinkSync(resolve('public'),join(fixture.dir,'public'),'dir');
  const reservation = createServer();
  await new Promise<void>((done,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',done);});
  const address=reservation.address(); if(!address||typeof address==='string')throw new Error('Missing preview port');
  const port=address.port;
  await new Promise<void>((done,reject)=>reservation.close(error=>error?reject(error):done()));
  preview=`http://127.0.0.1:${port}`;
  // Serve the preview as of its review date; the PHP call it maps closed on 2026-10-20.
  child=spawn(process.execPath,['--import',pathToFileURL(resolve('tests/fixtures/review-clock.mjs')).href,resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
    cwd:fixture.dir,env:{...process.env,DATABASE_URL:'',WIRE_DATABASE_URL:'',INGEST_ENABLED:'0',GRANTS_WATCH_API_V2:'1',GRANTS_WATCH_ALLOW_LOCAL_STORE:'1',ADMIN_TOKEN:'preview-only'},stdio:['ignore','pipe','pipe'],
  });
  child.stdout?.on('data',chunk=>{output=(output+chunk).slice(-16000);});
  child.stderr?.on('data',chunk=>{output=(output+chunk).slice(-16000);});
  const request=await playwright.request.newContext();
  try{await expect.poll(async()=>{if(child?.exitCode!=null)throw new Error(output);try{return(await request.get(`${preview}/api/v2`,{timeout:2000})).status();}catch{return 0;}},{timeout:25000}).toBe(200);}
  finally{await request.dispose();}
});
test.afterAll(async()=>{
  if(child&&child.exitCode==null)await new Promise<void>(done=>{const timeout=setTimeout(()=>{child?.kill('SIGKILL');done();},5000);child?.once('exit',()=>{clearTimeout(timeout);done();});child?.kill('SIGTERM');});
  fixture?.cleanup();
});

for(const [id,parent,name]of [
  ['php-foundation-2027-core-development-contractors','php-foundation-core-development-contractors','2027 contractor intake'],
  ['numfocus-sdg-2026-round-2-cfp-open-due-oct-17','numfocus-small-development-grants','2025 Round 2'],
])test(`${id}: original page and API resolve to preserved history and the parent round`,async({page,request},testInfo)=>{
  await page.goto(`${preview}/programs/${id}`);
  await expect(page.getByRole('heading',{name:'Preserved call page',exact:true})).toBeVisible();
  const link=page.getByRole('link',{name:new RegExp(`View ${name} under`)});
  const href=await link.getAttribute('href');expect(href).toMatch(new RegExp(`^/programs/${parent}#round-`));
  await link.click();await expect(page).toHaveURL(`${preview}${href}`);
  await expect(page.locator(`tr[id="${href!.split('#')[1]}"]`)).toContainText(name);
  await expect(page.getByRole('link',{name:`${name}: preserved call page`})).toHaveAttribute('href',`/programs/${id}`);
  if(id.startsWith('php')){
    await expect(page.locator('.dossier-classification')).toContainText('Contract');
    await expect(page.locator('.dossier-classification')).toContainText(name);
    await expect(page.locator('.dossier-facts:not(.dossier-classification)')).toContainText('C and systems programming');
  }
  await page.setViewportSize({width:375,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`${parent}.png`),fullPage:true});
  const v1=await(await request.get(`${preview}/api/v1/programs/${id}`)).json();
  expect(v1.data.id).toBe(id);expect(v1.data.parent).toBe(parent);expect(v1.data.parent_round).toBe(name);
  const v2=await(await request.get(`${preview}/api/v2/rounds?program=${id}`)).json();
  const legacy=v2.data[0];expect(legacy.canonical_program).toBe(parent);
  const canonical=await(await request.get(`${preview}/api/v2/rounds/${legacy.canonical_round_id}`)).json();
  expect(canonical.data.program).toBe(parent);expect(canonical.data.name).toBe(name);
});

test('directory and current API expose one PHP program and no duplicate call',async({page,request})=>{
  await page.goto(`${preview}/programs?org=php-foundation`);
  await expect(page.getByRole('link',{name:'PHP Foundation Core Development Contractors',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'PHP Foundation 2027 Core Development Contractors',exact:true})).toHaveCount(0);
  const body=await(await request.get(`${preview}/api/v2/opportunities?org=php-foundation`)).json();
  expect(body.data).toHaveLength(1);expect(body.data[0].program).toBe('php-foundation-core-development-contractors');
});
