// Run: node tests/document-control.cjs (set PLAYWRIGHT_MODULE if not installed locally).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const doc = { doc_id:'WI-1', doctype_id:'wi', doc_name:'WI ประกอบ Busbar', doc_no:'WI-001', line_id:'L4', status:'ACTIVE' };
const master = {
  M_DocType:[{doctype_id:'wi', doctype_name:'WI', display_name_th:'วิธีปฏิบัติงาน WI', behavior:'file'}, {doctype_id:'drawing', display_name_th:'Drawing', behavior:'file'}],
  M_Document:[doc, {...doc,doc_id:'DR-1',doctype_id:'drawing',doc_name:'Drawing 1'}, {...doc,doc_id:'WI-2',doc_name:'WI shared',line_id:'*'}],
  M_Revision:[{doc_id:'WI-1',rev_id:'WI-1:Rev02',rev_no:'Rev02',status:'CURRENT',content_ref:'new_pdf_id',effective_date:'2026-10-21'}, {doc_id:'WI-1',rev_id:'WI-1:Rev01',rev_no:'Rev01',status:'OBSOLETE',content_ref:'old_pdf_id'}],
  M_Line:[{line_id:'L4',line_name:'Line4',display_name:'Line 4'}],
  M_Station:[{station_id:'ST1',line_id:'L4',station_no:1,station_name:'Assembly'},{station_id:'ST2',line_id:'L4',station_no:2,station_name:'Packing'}],
  M_DocAssign:[{doc_id:'WI-1',station_id:'ST1'}],M_ProductFamily:[],M_Model:[],M_Shift:[],M_Employee:[],M_Role:[],M_Permission:[]
};
// Backend guards must reject duplicates before uploading or changing CURRENT.
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'gas/Code.gs'),'utf8'), context);
context.can = () => true;
context.LockService = {getScriptLock:()=>({waitLock(){},releaseLock(){}})};
context.readMaster = name => name === 'M_Document' ? [doc] : master.M_Revision;
assert.equal(context.actionDocAddRevision({doc_id:'WI-1',rev_no:'rev02',reason:'update'},{}).success,false);
assert.equal(context.actionDocAddRevision({doc_id:'WI-1',rev_no:'Rev03',reason:''},{}).success,false);

(async () => {
  const server = http.createServer((req,res) => {
    const file = path.resolve(root, '.' + new URL(req.url,'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) {res.writeHead(403);return res.end();}
    try {res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));}
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser = await chromium.launch({channel:'msedge',headless:true});
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    let writes = [];
    await page.route('https://**/*', async route => {
      const req = route.request();
      if (!req.url().includes('script.google.com')) return route.abort();
      const payload = req.method()==='POST'?JSON.parse(req.postData()):Object.fromEntries(new URL(req.url()).searchParams);
      if (payload.action === 'doc.addRevision') writes.push(payload);
      await route.fulfill({json:payload.action==='master.getAll'?{success:true,master,master_version:'1'}:{success:true,records:[],notifications:[],unread:0}});
    });
    await page.addInitScript(()=>{
      if (location.hostname !== '127.0.0.1') return;
      localStorage.setItem('fp_token','test');
      if (!localStorage.getItem('fp_user')) localStorage.setItem('fp_user',JSON.stringify({employee_id:'test',name:'Tester',role:'Admin'}));
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base+'/documents.html');
    await page.waitForSelector('#document-groups table');
    assert.equal(await page.locator('#document-groups tbody tr').count(),2);
    assert.equal(await page.locator('a:has-text("ดาวน์โหลด")').first().getAttribute('href'),'https://drive.google.com/uc?export=download&id=new_pdf_id');
    await page.selectOption('#doc-line','L4');await page.selectOption('#doc-station','ST2');
    assert.equal(await page.locator('#document-groups tbody tr').count(),1); // shared WI only
    await page.goto(base+'/documents.html?mode=control');
    await page.waitForSelector('#document-groups table');
    assert.equal(await page.locator('#document-groups h2').count(),2);
    await page.selectOption('#doc-category','wi');
    assert.equal(await page.locator('#document-groups tbody tr').count(),2);
    await page.fill('#doc-query','WI-001');
    await page.locator('#document-groups a:has-text("อัปเดต Rev")').first().click();
    await page.waitForFunction(()=>document.querySelector('#r-doc').value==='WI-1' && document.querySelector('#r-current').textContent.includes('Rev02'));
    assert.equal(await page.locator('#pane-rev').isVisible(),true);
    await page.fill('#r-rev','Rev03');await page.fill('#r-reason','ปรับวิธีประกอบ');
    await page.setInputFiles('#r-file',{name:'WI.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\ntest')});
    await page.click('#btn-add-rev');await page.waitForFunction(()=>!document.querySelector('#btn-add-rev').disabled);
    assert.equal(writes.length,1);assert.equal(writes[0].doc_id,'WI-1');assert.equal(writes[0].mime_type,'application/pdf');
    await page.goto(base+'/viewer.html?doc_id=WI-1');
    await page.waitForSelector('#rev-rows button');
    await page.locator('#rev-rows tr').filter({hasText:'Rev01'}).locator('button').click();
    assert.match(await page.locator('#preview-frame').getAttribute('src'),/old_pdf_id/);
    assert.match(await page.locator('#doc-actions').innerText(),/ไม่ใช่ฉบับปัจจุบัน/);
    await page.locator('#rev-rows tr').filter({hasText:'Rev02'}).locator('button').click();
    assert.doesNotMatch(await page.locator('#doc-actions').innerText(),/ไม่ใช่ฉบับปัจจุบัน/);
    await page.goto(base+'/documents.html');await page.waitForSelector('#document-groups table');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    master.M_DocType.push({doctype_id:'first-piece',display_name_th:'First Piece',behavior:'form'});
    master.M_Document.push({...doc,doc_id:'FP-1',doctype_id:'first-piece',doc_name:'First Piece quality'});
    master.M_Revision.push({doc_id:'FP-1',rev_id:'FP-1:Rev01',rev_no:'Rev01',status:'CURRENT',content_ref:'templates/nms-first-piece-rev1.json'});
    await page.goto(base+'/documents.html?mode=quality');
    await page.waitForSelector('#document-groups table');
    assert.equal(await page.locator('#document-groups tbody tr').count(),1);
    assert.equal(await page.locator('#library-title').innerText(),'เอกสารควบคุมคุณภาพ');
    assert.match(await page.locator('#document-groups a:has-text("พิมพ์ฟอร์ม")').getAttribute('href'),/rev_id=FP-1%3ARev01/);
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>localStorage.setItem('fp_user',JSON.stringify({name:'Operator',role:'Operator'})));
    await page.goto(base+'/documents.html?mode=control');await page.waitForURL(base+'/documents.html');
    assert.equal(await page.locator('.sidebar-link').filter({hasText:'ควบคุมเอกสาร'}).count(),0);
    console.log('PASS: WI/current links, category/search/station filters, revision upload/deep link, history, mobile, role guard, backend duplicate/reason guards.');
  } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
