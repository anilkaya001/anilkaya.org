import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises"; import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { FLOWS_PAGES } from "../shared/flows-pages.js";
const ROOT = path.resolve("..");
const D = await mkdtemp(path.join(os.tmpdir(), "d2-"));
execFileSync(process.execPath,[path.join(ROOT,"scripts/flows-pipeline.mjs"),"--dry-run","--emit",path.join(D,"d.json")],{cwd:ROOT,stdio:["ignore","ignore","pipe"]});
let src = fs.readFileSync(path.join(ROOT,"assets/js/flows-card.js"),"utf8");
const c = src.lastIndexOf("})();"); src = src.slice(0,c)+"  window.__paint = paint;\n"+src.slice(c);
const b = await chromium.launch();
const pg = await b.newPage({viewport:{width:320,height:900}});
await pg.setContent(FLOWS_PAGES.boardPage({username:"t"}).replace(/<script[^>]*><\/script>/g,""));
await pg.addStyleTag({path:path.join(ROOT,"assets/css/base.css")});
await pg.addStyleTag({path:path.join(ROOT,"assets/css/flows.css")});
await pg.addScriptTag({content:src});
for (const f of fs.readdirSync(D).filter(x=>x.startsWith("d-card-")).sort().slice(0,5)) {
  const card = JSON.parse(fs.readFileSync(path.join(D,f),"utf8"));
  const r = await pg.evaluate(({card})=>{
    const dlg=document.getElementById("flowsCard"); if(!dlg.open) dlg.showModal();
    window.__paint(card, Date.now());
    const out=[];
    for (const id of ["fcGamma","fcSurface","fcLevels","fcDisp","fcCal","fcMove","fcCtx","fcPath","fcCongress","fcWhy"]) {
      for (const svg of document.getElementById(id).querySelectorAll("svg")) {
        const box=svg.getBoundingClientRect();
        for (const t of svg.querySelectorAll("text")) {
          const rr=t.getBoundingClientRect(); if(rr.width===0) continue;
          const oL=box.left-rr.left, oR=rr.right-box.right;
          if(oL>1||oR>1) out.push({id,text:t.textContent.slice(0,20),cls:t.getAttribute("class"),anchor:t.getAttribute("text-anchor"),x:t.getAttribute("x"),oL:Math.round(oL),oR:Math.round(oR),w:Math.round(rr.width),boxW:Math.round(box.width)});
        }
      }
    }
    return {t:card.ticker,out};
  },{card});
  if(r.out.length) console.log(JSON.stringify(r,null,1));
}
await b.close(); await rm(D,{recursive:true,force:true});
