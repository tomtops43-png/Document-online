// Run: node tests/document-control.cjs (set PLAYWRIGHT_MODULE if not installed locally).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const doc = { doc_id:'WI-1', doctype_id:'wi', doc_name:'WI ประกอบ Busbar', doc_no:'WI-001', line_id:'Line 4', family_id:'CU', status:'ACTIVE' };
const master = {
  M_DocType:[{doctype_id:'wi', doctype_name:'WI', display_name_th:'วิธีปฏิบัติงาน WI', behavior:'file'}, {doctype_id:'drawing', display_name_th:'Drawing', behavior:'file'}],
  M_Document:[doc, {...doc,doc_id:'DR-1',doctype_id:'drawing',doc_name:'Drawing 1'}, {...doc,doc_id:'WI-2',doc_name:'WI shared',line_id:'*',family_id:'LC'}],
  M_Revision:[{doc_id:'WI-1',rev_id:'WI-1:Rev02',rev_no:'Rev02',status:'CURRENT',content_ref:'new_pdf_id',effective_date:'2026-10-21'}, {doc_id:'WI-1',rev_id:'WI-1:Rev01',rev_no:'Rev01',status:'OBSOLETE',content_ref:'old_pdf_id'}],
  M_Line:[{line_id:'L4',line_name:'Line4',display_name:'Line 4'}],
  M_Station:[{station_id:'ST1',line_id:'L4',station_no:1,station_name:'Assembly'},{station_id:'ST2',line_id:'L4',station_no:2,station_name:'Packing'}],
  M_DocAssign:[{doc_id:'WI-1',station_id:'ST1'},{doc_id:'WI-1',station_id:'ST2',status:'INACTIVE'}],M_ProductFamily:[{family_id:'CU',display_name:'CU'},{family_id:'LC',display_name:'LC'}],M_Model:[{model_id:'CU-A',family_id:'CU',model_name:'CU Model A'}],M_Shift:[],M_Employee:[],M_Role:[],M_Permission:[]
};
// Frontend-only release: deployed backend remains the original version 36.

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
    let writes = [], failMaster = false, failUsers = false, failMasterGetOnly = false, masterPostFallbacks = 0, masterCalls = 0, pdfRequests = 0;
    await page.route('https://**/*', async route => {
      const req = route.request();
      if (!req.url().includes('script.google.com')) return route.abort();
      const payload = req.method()==='POST'?JSON.parse(req.postData()):Object.fromEntries(new URL(req.url()).searchParams);
      if (payload.action === 'master.getAll') masterCalls++;
      if (payload.action === 'doc.getPdf') pdfRequests++;
      if (failMasterGetOnly && payload.action === 'master.getAll') {
        if (req.method() === 'GET') return route.abort();
        masterPostFallbacks++;
      }
      if (failMaster && payload.action === 'master.getAll') return route.abort();
      if (failUsers && payload.action === 'user.list') return route.abort();
      if (payload.action === 'doc.addRevision') writes.push(payload);
      await route.fulfill({json:payload.action==='master.getAll'?{success:true,master,master_version:'1'}:payload.action==='user.list'?{success:true,users:[{employee_id:'test',name:'Test Admin',role:'Admin',active:true,line:'L4'}]}:payload.action==='doc.getPdf'?{success:true,base64:Buffer.from('%PDF-1.4\ntest').toString('base64')}:{success:true,records:[],notifications:[],unread:0}});
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
    assert.equal(await page.locator('#doc-station').isEnabled(),true);
    assert.equal(await page.locator('#doc-category').isVisible(),false);
    assert.equal(await page.locator('#doc-station option[value="ST2"]').count(),0);
    assert.equal(await page.locator('#document-groups a:has-text("ระบุ Station")').count(),0);
    await page.selectOption('#doc-model','model:CU-A');
    assert.equal(await page.locator('#document-groups tbody tr').count(),1);
    assert.match(await page.locator('.station-summary').innerText(),/1 Station/);
    assert.match(await page.locator('#document-groups tbody tr td').first().innerText(),/Station 1/);
    await page.selectOption('#doc-model','');
    await page.selectOption('#doc-station','ST1');
    assert.equal(await page.locator('#document-groups tbody tr').count(),2);
    await page.selectOption('#doc-station','');
    assert.equal(await page.locator('#document-groups a:has-text("ดาวน์โหลด")').count(),0);
    assert.equal(await page.locator('#document-groups a:has-text("เปิด PDF")').count(),0);
    await page.locator('#document-groups .document-name-link').filter({hasText:'WI ประกอบ Busbar'}).click();
    await page.waitForFunction(()=>document.querySelector('.document-preview iframe').src.includes('new_pdf_id/preview'));
    assert.equal(await page.locator('.document-preview').isVisible(),true);
    assert.equal(await page.locator('.preview-print').innerText(),'Print');
    await page.waitForFunction(()=>!document.querySelector('.preview-print').disabled);
    assert.equal(await page.evaluate(()=>Math.abs(document.querySelector('.document-preview').getBoundingClientRect().width-innerWidth)<2),true);
    await page.evaluate(()=>{window.open = url=>{window.__printUrl=url;};});
    await page.click('.preview-print');
    assert.equal(await page.evaluate(()=>window.__printUrl),'https://drive.google.com/file/d/new_pdf_id/view');
    assert.equal(pdfRequests,0);
    assert.equal(browser.contexts()[0].pages().length,1);
    await page.click('.preview-close');
    await page.goto(base+'/admin.html?tab=assign&doc_id=WI-1');
    await page.waitForFunction(()=>document.querySelector('#a-doc').value==='WI-1' && document.querySelector('#a-line').value==='L4');
    assert.equal(await page.locator('#a-stations input[value="ST1"]').isChecked(),true);
    assert.equal(await page.locator('#a-stations input[value="ST2"]').isChecked(),false);
    await page.goto(base+'/documents.html');await page.waitForSelector('#document-groups table');
    await page.selectOption('#doc-line','L4');await page.selectOption('#doc-model','family:LC');
    assert.equal(await page.locator('#doc-station').isEnabled(),false);
    assert.equal(await page.locator('#document-groups tbody tr').count(),1); // shared WI only
    await page.goto(base+'/documents.html?mode=control');
    await page.waitForSelector('#document-groups table');
    assert.equal(await page.locator('#document-groups h2').count(),2);
    assert.equal(await page.locator('#document-groups a:has-text("ดาวน์โหลด")').count(),0);
    assert.equal(await page.locator('#document-groups a:has-text("เปิด PDF")').count(),0);
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
    master.M_Revision.push({doc_id:'DR-1',rev_id:'DR-1:Rev01',rev_no:'Rev01',status:'CURRENT',content_ref:'drawing_pdf'});
    await page.goto(base+'/documents.html?mode=quality');
    await page.waitForSelector('#document-groups table');
    assert.equal(await page.locator('#document-groups tbody tr').count(),2);
    assert.equal(await page.locator('#document-groups a:has-text("ดาวน์โหลด")').count(),0);
    assert.match(await page.locator('#document-groups .document-name-link').filter({hasText:'Drawing 1'}).getAttribute('href'),/doc_id=DR-1/);
    assert.doesNotMatch(await page.locator('#document-groups').innerText(),/WI ประกอบ|WI shared/);
    assert.equal(await page.locator('#library-title').innerText(),'เอกสารควบคุมคุณภาพ');
    assert.match(await page.locator('#document-groups .document-name-link').filter({hasText:'First Piece quality'}).getAttribute('href'),/rev_id=FP-1%3ARev01/);
    failMaster = true;
    await page.goto(base+'/documents.html');
    await page.waitForSelector('#document-groups table');
    await page.locator('#library-error').waitFor({state:'visible',timeout:20000});
    assert.match(await page.locator('#library-error').innerText(),/ข้อมูลที่เคยโหลดไว้/);
    assert.equal(await page.locator('#document-groups tbody tr').count(),2);
    failMaster = false;
    failMasterGetOnly = true;
    await page.evaluate(()=>Master._fetch());
    assert.equal(masterPostFallbacks,1);
    failMasterGetOnly = false;
    failUsers = true;
    await page.goto(base+'/users.html');
    await page.waitForFunction(()=>document.querySelector('#btn-reload-users').disabled === false);
    assert.match(await page.locator('#users-load-status').innerText(),/ยังเชื่อมต่อระบบไม่ได้/);
    assert.equal(await page.locator('.toast').count(),0);
    failUsers = false;
    await page.click('#btn-reload-users');
    await page.waitForFunction(()=>document.querySelector('#btn-reload-users').disabled === false);
    assert.match(await page.locator('#user-rows').innerText(),/Test Admin/);
    assert.equal(await page.locator('#users-load-status').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if (process.env.USER_LAYOUT_SCREENSHOT) {
      await page.setViewportSize({width:1280,height:900});
      await page.screenshot({path:process.env.USER_LAYOUT_SCREENSHOT});
    }
    assert.equal(await page.locator('#loading-overlay').isVisible(),false);
    assert.equal(await page.locator('#btn-reload-users').isEnabled(),true);
    const previousCalls = masterCalls;
    await page.evaluate(()=>Promise.all([Master._fetch(),Master._fetch(),Master._fetch()]));
    assert.equal(masterCalls - previousCalls,1);
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>localStorage.setItem('fp_user',JSON.stringify({name:'Operator',role:'Operator'})));
    await page.goto(base+'/documents.html?mode=control');await page.waitForURL(base+'/documents.html');
    assert.equal(await page.locator('.sidebar-link').filter({hasText:'ควบคุมเอกสาร'}).count(),0);
    await page.evaluate(()=>localStorage.setItem('fp_user',JSON.stringify({name:'Document Controller',role:'DocControl'})));
    await page.goto(base+'/documents.html?mode=control');await page.waitForURL(base+'/documents.html');
    assert.equal(await page.locator('.sidebar-link').filter({hasText:'ควบคุมเอกสาร'}).count(),0);
    console.log('PASS: frontend WI/quality menus, filters, document preview, revision links, users reload and role visibility with mocked APIs.');
  } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
