import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { startRuntime, php } from './lib/runtime.mjs';
import { resolve } from 'node:path';
import { root, snapshotDir } from './lib/config.mjs';
const checkpoint=JSON.parse(await readFile(resolve(snapshotDir,'site.json'),'utf8'));
const archive=process.env.TEST_SNAPSHOT || resolve(snapshotDir,'site.zip');
const reports=resolve(root,'reports/site-editor');
// All edits and temporary login sessions stay in this disposable runtime.
const runtime=await startRuntime(checkpoint,archive);
let browser;
let page;
const errors=[];
try {
  const cookies=JSON.parse(await php(runtime,`
    $users=get_users(array('role'=>'administrator','number'=>1));
    if (!$users) throw new Exception('No test administrator.');
    $expires=time()+3600;
    $token=WP_Session_Tokens::get_instance($users[0]->ID)->create($expires);
    echo wp_json_encode(array(
      array('name'=>AUTH_COOKIE,'value'=>wp_generate_auth_cookie($users[0]->ID,$expires,'auth',$token)),
      array('name'=>LOGGED_IN_COOKIE,'value'=>wp_generate_auth_cookie($users[0]->ID,$expires,'logged_in',$token))
    ));
  `));
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies(cookies.map(cookie=>({...cookie,url:runtime.serverUrl,httpOnly:true,sameSite:'Lax'})));
  page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(runtime.serverUrl+'/wp-admin/site-editor.php?p=%2Fwp_template%2Fsouthbound%2F%2Ffront-page&canvas=edit');
  const welcome=page.getByRole('button',{name:'Get started',exact:true});
  const canvas=page.frameLocator('iframe[name="editor-canvas"]');
  const text=canvas.locator('.hero > .eyebrow[contenteditable="true"]');
  await Promise.race([welcome.waitFor({state:'visible',timeout:60000}),text.waitFor({state:'visible',timeout:60000})]);
  if(await welcome.isVisible()) await welcome.click();
  await expect(text).toBeVisible({timeout:60000});
  await expect(canvas.locator('.block-editor-warning')).toHaveCount(0);
  await expect(canvas.locator('[data-type="core/html"]')).toHaveCount(0);
  const frame=page.frames().find(frame=>frame.name()==='editor-canvas');
  const overlay=await frame.evaluate(()=>{
    const photo=document.querySelector('.hero-photo').getBoundingClientRect();
    const badge=document.querySelector('.hero-photo .stamp').getBoundingClientRect();
    const caption=document.querySelector('.hero-photo .photo-caption').getBoundingClientRect();
    return {badge:badge.top>=photo.top && badge.bottom<=photo.bottom,caption:caption.top>=photo.top && caption.bottom<=photo.bottom};
  });
  expect(overlay).toEqual({badge:true,caption:true});
  const original=await text.innerText();
  await text.fill(original+' · Editor check');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save',exact:true}).first()).toBeDisabled({timeout:30000});
  const publicPage=await context.newPage();await publicPage.goto(runtime.serverUrl);
  await expect(publicPage.locator('.hero > .eyebrow')).toContainText('Editor check');
  await page.reload();
  await expect(text).toContainText('Editor check',{timeout:60000});
  await expect(canvas.locator('.block-editor-warning')).toHaveCount(0);
  await text.fill(original);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save',exact:true}).first()).toBeDisabled({timeout:30000});
  await mkdir(reports,{recursive:true});
  await page.screenshot({path:resolve(reports,'editor-desktop.png'),fullPage:true});
  await publicPage.reload();
  await expect(publicPage.locator('.hero > .eyebrow')).not.toContainText('Editor check');
  await publicPage.screenshot({path:resolve(reports,'frontend-desktop.png'),fullPage:true});
  await publicPage.evaluate(()=>window.scrollTo(0,400));
  await expect.poll(()=>publicPage.locator('.hero-photo').evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--hero-inset')))).toBeGreaterThan(0);
  await publicPage.goto(runtime.serverUrl+'/sample-page/');
  await expect(publicPage.getByRole('heading',{name:'Sample Page',exact:true})).toBeVisible();
  await publicPage.goto(runtime.serverUrl);
  await publicPage.setViewportSize({width:390,height:844});await publicPage.reload();
  const widths=await publicPage.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
  expect(widths.page).toBe(widths.viewport);
  await publicPage.screenshot({path:resolve(reports,'frontend-mobile.png'),fullPage:true});
  await publicPage.emulateMedia({reducedMotion:'reduce'});
  await publicPage.reload();
  await expect.poll(()=>publicPage.locator('.hero-photo').evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--hero-inset')))).toBeGreaterThan(0);
  const initialInset=await publicPage.locator('.hero-photo').evaluate(el=>getComputedStyle(el).getPropertyValue('--hero-inset'));
  await publicPage.evaluate(()=>window.scrollTo(0,200));
  await expect(publicPage.locator('.hero-photo')).toHaveCSS('--hero-inset',initialInset);
  const serious=errors.filter(error=>/validation failed|Block validation|TypeError|ReferenceError/i.test(error));
  expect(serious).toEqual([]);
  await writeFile(resolve(reports,'checks.json'),JSON.stringify({saveReload:true,frontendEdit:true,nativeBlocks:true,mobileOverflow:false,heroScroll:true,reducedMotion:true,errors},null,2));
  console.log('Site Editor native blocks, save/reload, frontend edit, and mobile overflow checks passed.');
} catch(error) {
  console.log('Browser errors:',JSON.stringify(errors));
  if(page) {await mkdir(reports,{recursive:true});await page.screenshot({path:resolve(reports,'failure.png'),fullPage:true}); console.log((await page.locator('body').innerText()).slice(-3500));}
  throw error;
} finally {await browser?.close();await runtime[Symbol.asyncDispose]();}
