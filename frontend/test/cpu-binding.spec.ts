import {test,expect} from '@playwright/test';
const topology={cpuBindingProtocol:1,model:'AMD Ryzen 7 9700X',availableCpuIds:[0,6,8,14],cores:[{socketId:0,coreId:0,cpuIds:[0,8]},{socketId:0,coreId:6,cpuIds:[6,14]}],unboundContainerCount:2,assignments:[{serverId:null,containerId:'ptero',name:'Pterodactyl server',source:'external',state:'running',configuredCpuSet:[6,14],effectiveCpuSet:[6,14],pendingCpuSet:null}]};
const server={dockerImage:'rehlds',providerMetadata:{},ports:{tcp:[],udp:[]},env:{},mounts:[],healthcheck:null,resourceLimits:{cpu:1,memoryMb:1024,cpuSet:[0,8]}};
test('shared core selection, individual threads, deferred payload, explicit clear and mobile layout',async({page})=>{
 let payload:any;
 await page.addInitScript(()=>localStorage.setItem('theme','dark'));
 await page.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url());
  if(!url.pathname.startsWith('/api/')) return route.continue();
  if(url.pathname.endsWith('available-cpus'))return route.fulfill({json:topology});
  if(url.pathname.endsWith('available-ports'))return route.fulfill({json:{ports:[]}});
  if(req.method()==='PATCH'){payload=req.postDataJSON();return route.fulfill({json:{success:true}});}
  return route.fulfill({json:server});
 });
 await page.goto('/test/container-settings.fixture.html?running');
 const picker=page.locator('.gp-cpu-binding');
 await expect(picker.locator('.gp-cpu-trigger')).toContainText('CPU 0, 8');
 await picker.locator('.gp-cpu-trigger').click();
 await expect(picker.getByText('Pterodactyl server',{exact:true})).toBeVisible();
 await picker.getByRole('button',{name:'No binding',exact:true}).click();
 await picker.getByRole('button',{name:'Socket 0 core 6, CPU 6,14',exact:true}).click();
 await expect(picker.locator('.gp-cpu-trigger')).toContainText('CPU 6, 14');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('button',{name:'Save without restart',exact:true}).click();
 await expect.poll(()=>payload?.resourceLimits.cpuSet).toEqual([6,14]);
 expect(payload.resourceLimits.cpu).toBe(1);expect(payload.resourceLimits.memoryMb).toBe(1024);expect(payload.applyMode).toBe('defer');
 await picker.getByRole('button',{name:'Individual threads',exact:true}).click();
 await picker.getByRole('button',{name:'CPU 14',exact:true}).click();
 await expect(picker.getByRole('button',{name:'Socket 0 core 6, CPU 6,14',exact:true})).toHaveAttribute('aria-pressed','mixed');
 await picker.getByRole('button',{name:'No binding',exact:true}).click();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('button',{name:'Save without restart',exact:true}).click();
 await expect.poll(()=>payload?.resourceLimits.cpuSet).toEqual([]);
 await page.setViewportSize({width:390,height:844});
 await expect(picker.getByText('Pterodactyl server',{exact:true})).toBeVisible();
 expect(await picker.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:'test-results/cpu-binding-mobile.png',fullPage:true});
});
