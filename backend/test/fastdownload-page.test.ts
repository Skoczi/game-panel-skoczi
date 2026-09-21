import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderFastDownloadPage} from '../src/services/fastDownloadPage.js';
test('FastDownload browser escapes names, encodes links and renders pagination', () => {
 const html = renderFastDownloadPage({serverId:8,path:'cstrike/maps',page:2,pages:3,total:402,entries:[{name:'<unsafe&".bsp',path:'cstrike/maps/<unsafe&".bsp',directory:false,size:2048}]});
 assert.ok(html.includes('&lt;unsafe&amp;&quot;.bsp'));
 assert.ok(!html.includes('<unsafe&".bsp'));
 assert.ok(html.includes('/fdl/srv8/cstrike/maps/%3Cunsafe%26%22.bsp'));
 assert.ok(html.includes('2.0 KiB'));
 assert.ok(html.includes('?page=1') && html.includes('?page=3'));
 assert.ok(html.includes('aria-label="Breadcrumb"'));
});
test('FastDownload error and empty states contain useful visible content', () => {
 assert.ok(renderFastDownloadPage(null,8).includes('This path is not available'));
 assert.ok(renderFastDownloadPage(null,8).includes('href="/fdl/srv8/"'));
 assert.ok(renderFastDownloadPage({serverId:8,path:'cstrike/maps',page:1,pages:1,total:0,entries:[]}).includes('No published files yet'));
});
