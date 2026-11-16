import { expect, test, mock } from "bun:test";
import { itemMenuEntries, type SavedEntry } from "../src/item-menus";
import { pathMenuEntries, textMenuEntries, type ContextMenuEntry } from "../src/path-actions";
import type { SearchItem } from "../src/sdk";
const base = { plugin:"launcher", title:"旧名称", subtitle:"旧路径",kind:"saved",score:0 } as const;
const labels = (entries: ContextMenuEntry[]) => entries.flatMap((entry) => "text" in entry ? [entry.text] : []);
const saved: SavedEntry = {id:"stable",name:"新名称",path:"/Users/me/新文件.conf",kind:"file",openWithApp:"/Applications/TextEdit.app"};
const context = {saved:[saved],webApps:[],settingsPlugins:[],open:()=>{},run:()=>{}};
test("各入口的收藏菜单按稳定 ID 使用最新路径和打开设置", () => {
  const menu = itemMenuEntries({...base,action:{type:"openSaved",id:saved.id}}, context);
  expect(labels(menu)).toEqual(["打开","打开方式…","打开文件位置","复制路径","编辑收藏…"]);
  expect(labels(itemMenuEntries({...base,action:{type:"openSaved",id:"removed"}},context))).toEqual(["收藏已移除"]);
  expect(itemMenuEntries({...base,action:{type:"openSaved",id:"removed"}},context)[0]).toMatchObject({disabled:true});
});
test("网址收藏只给适用的浏览器和网址操作",()=> {
  const url = {...saved,path:"https://example.com",kind:"link" as const};
  expect(labels(itemMenuEntries({...base,action:{type:"openSaved",id:saved.id}},{...context,saved:[url]}))).toEqual(["在默认浏览器中打开","复制网址","编辑收藏…"]);
});
test("功能快捷键菜单带入精确插件和功能，独立设置按需出现",async()=> {
  let target:unknown;
  const feature:SearchItem={...base,plugin:"qrcode",kind:"feature",action:{type:"feature",feature:"scan"}};
  const menu=itemMenuEntries(feature,{...context,settingsPlugins:["qrcode"],open:(next)=>{target=next;}});
  expect(labels(menu)).toContain("插件设置…");
  const hotkey=menu.find((entry)=>"id" in entry&&entry.id==="hotkey"); if(hotkey&&"action" in hotkey) await hotkey.action();
  expect(target).toMatchObject({input:"plugins/qrcode/keywords/scan"});
  expect(labels(itemMenuEntries(feature,context))).not.toContain("插件设置…");
});
test("文件范围去重并排除网址，文字菜单保存传入选区",()=> {
  expect(labels(pathMenuEntries(["/one","/two","/one","https://example.com"]))).toEqual(["打开 2 个文件的位置","复制 2 个文件的路径"]);
  expect(labels(textMenuEntries("全部内容","所选内容"))).toEqual(["复制所选文字","复制全部"]);
  expect(textMenuEntries("")[0]).toMatchObject({disabled:true});
});

test("多文件菜单区分整条记录和当前文件，固定与删除始终针对历史",async()=> {
  mock.module("../src/feature-icons",()=>({featureIcons:{},featureIconKey:()=>""})); // Vite-only SVG loading is irrelevant to menu semantics.
  const {historyMenu}=await import("../plugins/clipboard/menus");
  const entry={id:"files",kind:"files" as const,text:"",paths:["/one.png","/two.jpg","/three.txt"],image:null,app:"访达",at:1,pinned:false,truncated:false};
  const callbacks={use:()=>{},pin:()=>{},remove:()=>{}};
  expect(labels(historyMenu(entry,callbacks))).toEqual(["粘贴 3 个文件","复制 3 个文件","打开 3 个文件的位置","复制 3 个文件的路径","固定这条历史","删除这条历史"]);
  const single=labels(historyMenu(entry,callbacks,"/two.jpg"));
  expect(single).toContain("复制 3 个文件"); expect(single).toContain("复制当前图片"); expect(single).toContain("打开原文件"); expect(single).toContain("复制路径"); expect(single).not.toContain("打开 3 个文件的位置");
});
