import {chromium,expect} from '@playwright/test';
import {existsSync}from'node:fs';import{homedir}from'node:os';import{join,resolve}from'node:path';
const chrome=join(homedir(),'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{}),args:['--use-angle=metal']});
const base=process.env.ROOMSHIFT_BASE_URL??'http://127.0.0.1:5176',output=resolve('experiments/snuzspace-recliner/output');
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await expect(page.locator('canvas')).toBeVisible({timeout:30000});await expect(page.locator('.stage-loading')).toHaveCount(0,{timeout:30000});
 await page.getByRole('button',{name:/Add furniture/}).click();await page.getByRole('button',{name:/Try a product link/}).click();await page.getByLabel('Amazon or Flipkart product link',{exact:true}).fill('https://www.flipkart.com/snuzspace-fabric-manual-recliner/p/itmcbf4f034af5ba?pid=RECHK8KJZEVZWK37');
 await page.getByRole('button',{name:'Read product',exact:true}).click();await expect(page.getByRole('textbox',{name:'Product name',exact:true})).toHaveValue('SNUZSPACE Fabric Manual Recliner',{timeout:20000});
 for(const [axis,value]of Object.entries({width:'83.56',depth:'82.55',height:'109'}))await expect(page.getByRole('spinbutton',{name:`Product ${axis}`,exact:true})).toHaveValue(value);
 await expect(page.getByLabel('Product category',{exact:true})).toHaveValue('chair');await expect(page.getByRole('button',{name:/Use product photo \d/})).toHaveCount(5);await expect(page.getByText('Detailed model generation is paused',{exact:true})).toBeVisible();
 await page.screenshot({path:join(output,'listing-in-editor.png')});
 const model=process.argv[2];if(model){const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Import 3D model',exact:true}).click();await(await chooser).setFiles(resolve(model));await expect(page.getByText('3D model imported. Check the dimensions to place it at the right size.',{exact:true})).toBeVisible({timeout:15000});}
 await page.getByRole('checkbox',{name:/I checked all three/}).check();await page.getByRole('button',{name:'Try in room',exact:true}).click();await expect(page.getByRole('heading',{name:'SNUZSPACE Fabric Manual Recliner',exact:true})).toBeVisible();
 if(model){await expect.poll(()=>page.evaluate(()=>Object.values(window.__roomshiftScene.itemAssets).some(a=>a.source==='local')),{timeout:20000}).toBe(true);await expect(page.getByText('Imported 3D model',{exact:true})).toBeVisible();}
 await page.getByRole('button',{name:'Focus on this piece',exact:true}).click();await page.screenshot({path:join(output,model?'generated-model-in-editor.png':'size-preview-in-editor.png')});
 await page.getByRole('button',{name:'Add to room',exact:true}).click();await expect(page.getByRole('button',{name:'Select SNUZSPACE Fabric Manual Recliner',exact:true})).toBeVisible();await page.keyboard.press('Control+z');await expect(page.getByRole('button',{name:'Select SNUZSPACE Fabric Manual Recliner',exact:true})).toHaveCount(0);expect(errors).toEqual([]);console.log('Actual listing → five images + dimensions → '+(model?'generated GLB':'size preview')+' → confirm/undo passed');
}catch(e){console.log('UI failure',await browser.contexts()[0]?.pages()[0]?.locator('[role=alert],.pw-message').allTextContents());throw e}finally{await browser.close()}
