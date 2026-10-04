import {test,expect} from '@playwright/test';

test('funding Desk intake enforces admin authentication before its disabled feature gate',async({request})=>{
 const anonymous=await request.post('/api/desk/funding',{data:{mode:'preview',pack:{}}});
 expect(anonymous.status()).toBe(401);
 const owner=await request.post('/api/desk/funding',{headers:{'x-admin-token':process.env.ADMIN_TOKEN || 'grants-watch-browser-test-token'},data:{mode:'preview',pack:{}}});
 expect(owner.status()).toBe(503);
 expect(await owner.json()).toEqual({error:'funding_desk_disabled'});
 expect(owner.headers()['cache-control']).toBe('no-store');
 expect((await request.get('/api/v1')).status()).toBe(200);
});
