import {test,expect,type Page} from '@playwright/test';
const key='roomshift-project-v1';
async function room(page:Page){await page.goto('/');await expect(page.locator('canvas')).toBeVisible();await expect(page.locator('.stage-loading')).toHaveCount(0,{timeout:30000});await expect.poll(()=>page.evaluate(k=>localStorage.getItem(k),key)).not.toBeNull();}
async function saved(page:Page){return page.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);}
async function pose(page:Page,id='bed'){return page.evaluate(id=>(window as any).__roomshiftScene.items[id],id);}
const panel=(page:Page)=>page.getByRole('region',{name:/Original → Open & airy/});
async function scrub(page:Page,value:number){const range=page.getByRole('slider',{name:'Walkthrough progress',exact:true});await range.evaluate((el,value)=>{const input=el as HTMLInputElement;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);}

test('saved layouts prepare immediately and animate real meshes without changing presets until completion',async({page})=>{
 let generationCalls=0;page.on('request',r=>{if(r.method()==='POST'&&/\/api\/(pipeline\/jobs|generations)$/.test(new URL(r.url()).pathname))generationCalls++;});
 await room(page);const before=await saved(page),start=await pose(page);const resources=await page.evaluate(()=>(window as any).__roomshiftScene.resources.geometries);
 await page.getByRole('button',{name:'Switch to Open & airy',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Original → Open & airy',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Pause layout walkthrough',exact:true}).click();await scrub(page,400);
 const halfway=await pose(page);expect(halfway.x).toBeLessThan(start.x);expect(halfway.x).toBeGreaterThan(-1.4);expect(halfway.z).toBeLessThan(start.z);expect((await saved(page)).activeLayoutId).toBe('original');
 expect(await page.evaluate(()=>(window as any).__roomshiftScene.resources.geometries)).toBeLessThanOrEqual(resources+4);
 await expect(page.getByRole('region',{name:'Original → Open & airy'})).toContainText('0.9 m left');
 await page.getByRole('button',{name:'Skip to layout',exact:true}).click();await expect(page.getByRole('heading',{name:'Layout ready',exact:true})).toBeVisible();
 await expect.poll(async()=>(await saved(page)).activeLayoutId).toBe('open-airy');expect((await saved(page)).layouts).toEqual(before.layouts);
 expect(await pose(page)).toEqual({x:-1.4,z:-.45});expect(generationCalls).toBe(0);
 await page.keyboard.press('Control+z');await expect.poll(async()=>(await saved(page)).activeLayoutId).toBe('original');expect((await saved(page)).layouts).toEqual(before.layouts);
});

test('pause, step navigation and cancellation restore the starting view without saving a partial layout',async({page})=>{
 await room(page);const before=await saved(page);await page.getByRole('button',{name:'Switch to Work & rest',exact:true}).click();
 await page.getByRole('button',{name:'Pause layout walkthrough',exact:true}).click();await scrub(page,450);const paused=await pose(page);await page.waitForTimeout(250);expect(await pose(page)).toEqual(paused);
 await page.getByRole('button',{name:'Next walkthrough step',exact:true}).click();await expect(page.locator('.le-step-tag')).toContainText('Step 2');await page.getByRole('button',{name:'Previous walkthrough step',exact:true}).click();
 await page.getByRole('button',{name:'Cancel layout walkthrough',exact:true}).click();await expect(page.locator('.layout-explainer')).toHaveCount(0);expect(await saved(page)).toEqual(before);expect(await pose(page)).toEqual({x:-.5,z:.05});
});

test('automatic completion is one undoable switch and replay does not create an extra history entry',async({page})=>{
 test.setTimeout(120000); // SwiftShader draws about one frame a second; the Metal run takes 7 s at 1×.
 await room(page);const before=await saved(page);await page.getByRole('button',{name:'Switch to Open & airy',exact:true}).click();await page.getByRole('combobox',{name:'Walkthrough playback speed',exact:true}).selectOption('2');
 await expect(page.getByRole('heading',{name:'Layout ready',exact:true})).toBeVisible({timeout:90000});await expect.poll(async()=>(await saved(page)).activeLayoutId).toBe('open-airy');
 await page.getByRole('button',{name:'Replay layout walkthrough',exact:true}).click();await page.getByRole('button',{name:'Skip to layout',exact:true}).click();await page.keyboard.press('Control+z');await expect.poll(async()=>(await saved(page)).activeLayoutId).toBe('original');await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();expect((await saved(page)).layouts).toEqual(before.layouts);
});

test('mobile playback leaves the room visible and reduced motion switches without animation',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await room(page);await page.getByRole('button',{name:'Switch to Open & airy',exact:true}).click();await expect(page.getByRole('heading',{name:'Layout ready',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const player=await page.locator('.properties-panel.walkthrough-panel').boundingBox();expect(player!.height).toBeLessThan(844*.55);expect(player!.y).toBeGreaterThan(844*.4);await expect(page.getByRole('button',{name:'Replay layout walkthrough',exact:true})).toBeVisible();
 await expect.poll(async()=>(await saved(page)).activeLayoutId).toBe('open-airy');await page.getByRole('button',{name:'Close layout walkthrough',exact:true}).first().click();await page.reload();await expect(page.getByRole('button',{name:'Switch to Open & airy',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('a typed request runs the measured walkthrough without any generation call, and unmatched requests change nothing',async({page})=>{
 let generationCalls=0;page.on('request',r=>{if(r.method()==='POST'&&/\/api\//.test(new URL(r.url()).pathname))generationCalls++;}); // One unavailable agent call per prompt, then rules.
 await page.route('**/api/layout-agent',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"LAYOUT_AGENT_UNAVAILABLE","message":"Local only."}}'}));
 await room(page);const prompt=page.getByRole('textbox',{name:'Describe what you want from this room',exact:true}),send=page.getByRole('button',{name:'Rearrange the room',exact:true});
 await prompt.fill('paint it purple');await send.click();await expect(page.locator('.layout-prompt p')).toContainText('I can only switch');await expect(page.locator('.layout-explainer')).toHaveCount(0);
 await prompt.fill('My room looks a little cluttered, and I need more space');await send.click();await expect(page.getByText('“My room looks a little cluttered, and I need more space”')).toBeVisible();await expect(page.locator('.le-why')).toContainText('Why');await expect(page.locator('.le-floor')).toContainText('m²');
 await page.getByRole('button',{name:'Skip to layout',exact:true}).click();await expect.poll(async()=>(await saved(page)).activeLayoutId).not.toBe('original');expect(generationCalls).toBe(2);
});

test('an agent arrangement shows its reasons, saves as one undoable layout, and is discarded on cancel',async({page})=>{
 await room(page);const before=await saved(page),active=before.layouts[0];
 const layout={...active,id:'agent-test',name:'Stool tucked',description:'Checked by the room',items:active.items.map((i:any)=>i.id==='stool'?{...i,position:{x:.2,z:-2.1}}:i)};
 await page.route('**/api/layout-agent',r=>r.fulfill({json:{action:'rearrange',layout,reasons:{stool:'Out of the walkway.'},reply:'Moved the stool.',provider:'LLM Foundry',model:'test',attempts:1,elapsedMs:1200}}));
 const prompt=page.getByRole('textbox',{name:'Describe what you want from this room',exact:true}),send=page.getByRole('button',{name:'Rearrange the room',exact:true});
 await prompt.fill('tuck the stool away');await send.click();await page.getByRole('button',{name:'Pause layout walkthrough',exact:true}).click();await expect(page.locator('.le-why').first()).toContainText('Out of the walkway.');
 await page.getByRole('button',{name:'Cancel layout walkthrough',exact:true}).click();expect((await saved(page)).layouts.length).toBe(before.layouts.length);
 await send.click();await page.getByRole('button',{name:'Skip to layout',exact:true}).click();await expect.poll(async()=>(await saved(page)).activeLayoutId).toBe('agent-test');await page.getByRole('button',{name:'Close layout walkthrough',exact:true}).first().click();
 await page.keyboard.press('Control+z');await expect.poll(async()=>(await saved(page)).activeLayoutId).toBe('original');expect((await saved(page)).layouts).toEqual(before.layouts);
});
