import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('theme','dark')); });
test('mobile notification settings mask saved webhook, save categories and queue an explicit test',async({page})=>{
    let value={revision:1,enabled:false,webhookConfigured:false,categories:['game','node','backup','schedule','recovery'],recent:[]};let saved:any;let sends=0;
    await page.route('**/api/system/notifications',r=>{if(r.request().method()==='PUT'){saved=r.request().postDataJSON();value={...value,revision:2,enabled:saved.enabled,categories:saved.categories,webhookConfigured:true};}return r.fulfill({json:value});});
    await page.route('**/api/system/notifications/test',r=>{sends++;return r.fulfill({status:202,json:{id:'test'}});});
    await page.setViewportSize({width:390,height:844});await page.goto('/test/notifications.fixture.html');
    await expect(page.getByRole('button',{name:'Send test'})).toBeDisabled();
    await page.getByLabel('Discord webhook URL').fill('https://discord.com/api/webhooks/123456789012345678/'+'a'.repeat(64));
    await page.getByRole('switch',{name:'Enable Discord notifications'}).click();
    await page.getByLabel('Backup and restore failures').uncheck();
    await page.getByRole('button',{name:'Save notifications'}).click();
    await expect(page.getByRole('status')).toHaveText('Notification settings saved.');
    expect(saved.categories).not.toContain('backup');await expect(page.getByLabel('Discord webhook URL')).toHaveValue('');
    await page.getByRole('button',{name:'Send test'}).click();await expect(page.getByRole('status')).toContainText('Test queued');expect(sends).toBe(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'/tmp/gamepanel-notifications-mobile.png',fullPage:true});
});
test('settings conflict remains visible without claiming success',async({page})=>{
    await page.route('**/api/system/notifications',r=>r.fulfill(r.request().method()==='PUT'?{status:409,json:{error:'Notification settings changed; reload before saving'}}:{json:{revision:1,enabled:false,webhookConfigured:true,categories:['game'],recent:[]}}));
    await page.goto('/test/notifications.fixture.html');await page.getByRole('switch',{name:'Enable Discord notifications'}).click();await page.getByRole('button',{name:'Save notifications'}).click();
    await expect(page.getByRole('alert')).toContainText('changed');await expect(page.getByRole('button',{name:'Send test'})).toBeDisabled();
});
