import {test, expect} from '@playwright/test';
test('editing a Bash startup preserves the script as a single argument and keeps trailing game arguments', async ({page}) => {
 await page.goto('/test/native-arguments.fixture.html');
 const script = 'set -euo pipefail\ncd /data/serverfiles\nprintf \'hostname "%s"\\n\' "$SERVER_NAME"\nexec ./hlds_linux "$@"';
 await page.getByRole('textbox', {name:'Startup arguments argument 2',exact:true}).fill(script);
 const read = async () => JSON.parse(await page.getByTestId('args').innerText());
 expect(await read()).toEqual(['/bin/bash','-c',script,'hlds','+map','{{MAP}}']);
 await page.getByRole('textbox', {name:'Startup arguments argument 5',exact:true}).fill('de_dust2');
 expect((await read())[2]).toBe(script);
 await page.getByRole('button',{name:'Add argument',exact:true}).click();
 await page.getByRole('textbox',{name:'Startup arguments argument 6',exact:true}).fill('');
 expect((await read()).length).toBe(7);
 await page.getByRole('button',{name:'Remove startup arguments argument 4',exact:true}).click();
 expect(await read()).toEqual(['/bin/bash','-c',script,'hlds','de_dust2','']);
});
