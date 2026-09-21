import { test, expect } from '@playwright/test';
const first = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
test('user permissions list every node and save by fleet identity, never by runtime ID', async ({ page }) => {
 const writes: Array<{ path: string; body: any }> = [];
 await page.route('**/api/users**', route => route.fulfill({ json: { users: [{ id: 2, username: 'Player', isRoot: false, isEnabled: true, globalPermissions: [] }] } }));
 await page.route('**/api/fleet', route => route.fulfill({ json: { servers: [
  { id: first, name: 'Arena', provider: 'native', node: { name: 'WAW1' } },
  { id: second, name: 'Arena', provider: 'native', node: { name: 'WAW2' } },
 ] } }));
 await page.route('**/api/fleet/*/members**', async route => {
  if (route.request().method() === 'PUT') { writes.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() }); return route.fulfill({ json: { ok: true } }); }
  return route.fulfill({ json: { members: [] } });
 });
 await page.route('**/api/servers/**', () => { throw new Error('User grants must use fleet identity'); });
 await page.goto('/test/user-fleet.fixture.html');
 await page.getByRole('button', { name: 'Edit', exact: true }).click();
 const choose = page.getByRole('combobox', { name: 'Select server', exact: true });
 await choose.click();
 await expect(page.getByRole('option', { name: 'Arena · WAW1' })).toBeVisible();
 await page.getByRole('option', { name: 'Arena · WAW2' }).click();
 await expect(page.getByText('Loading permissions…')).toHaveCount(0);
 await page.getByRole('button', { name: 'Operator', exact: true }).click();
 await page.getByRole('button', { name: 'Save changes', exact: true }).click();
 await expect.poll(() => writes.length).toBe(1);
 expect(writes[0].path).toBe(`/api/fleet/${second}/members/2`);
 expect(writes[0].body.permissions).toContain('server.power');
});

test('failed permission reads cannot overwrite grants with an empty selection', async ({ page }) => {
 let writes = 0;
 await page.route('**/api/users**', route => { if (route.request().method() !== 'GET') writes++; return route.fulfill({ json: { users: [{ id: 2, username: 'Player', isRoot: false, isEnabled: true, globalPermissions: [] }] } }); });
 await page.route('**/api/fleet', route => route.fulfill({ json: { servers: [{ id: first, name: 'Arena', provider: 'native', node: { name: 'WAW1' } }] } }));
 await page.route('**/api/fleet/*/members', route => route.fulfill({ status: 503, json: { error: 'Grant storage unavailable' } }));
 await page.goto('/test/user-fleet.fixture.html');
 await page.getByRole('button', { name: 'Edit', exact: true }).click();
 await expect(page.getByRole('alert')).toContainText('Grant storage unavailable');
 await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
 expect(writes).toBe(0);
});
