// <WeddingDoc> — the collaborative, visibility-scoped "Notes" panel.
//
// One rich editor with a tab per scope the viewer may see (shared / vendors /
// couple). Editing uses EasyMDE (a CDN markdown editor with a formatting
// toolbar + live preview — no bundler), autosaving to D1 (debounced) with an
// optimistic content-token guard. Read-only tabs render the markdown with the
// marked + DOMPurify pipeline already used elsewhere. Live presence + a soft
// editing-lock (Rung 2) are driven by polling the heartbeat endpoint. Degrades
// to a plain textarea if the editor CDN fails. All static strings are
// server-translated and passed to the client so the controller stays
// language-agnostic.

import { t } from '../i18n'
import type { MessageKey } from '../i18n'
import { scopeLabelKey, type DocScope } from '../services/doc-permissions'
import type { DocTabState } from '../db/wedding-docs'

const HINT_KEY: Record<DocScope, MessageKey> = {
  shared: 'docs.hint.shared',
  vendors: 'docs.hint.vendors',
  couple: 'docs.hint.couple',
  private: 'docs.hint.private',
}

/** JSON safe to embed inside a <script> (defuses `</script>` in user content). */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function WeddingDoc({
  tabs,
  baseUrl,
  csrfToken,
}: {
  tabs: DocTabState[]
  /** e.g. /app/weddings/:id/docs  or  /wedding/:id/docs */
  baseUrl: string
  csrfToken: string
}) {
  if (tabs.length === 0) return null

  const data = tabs.map((tab) => ({
    scope: tab.scope,
    label: t(scopeLabelKey(tab.scope) as MessageKey),
    hint: t(HINT_KEY[tab.scope]),
    content: tab.content,
    token: tab.token,
    canWrite: tab.canWrite,
    solo: tab.solo,
  }))

  const i18n = {
    empty: t('docs.empty'),
    editing: t('docs.status.editing'),
    saving: t('docs.status.saving'),
    saved: t('docs.status.saved'),
    saveFailed: t('docs.status.saveFailed'),
    conflict: t('docs.conflict.reloaded'),
    takeover: t('docs.takeover'),
    readonlyLocked: t('docs.readonly.locked', { name: '{name}' }),
    viewersOne: t('docs.viewers.one', { count: '{count}' }),
    viewersOther: t('docs.viewers.other', { count: '{count}' }),
  }

  return (
    <div class="mt-6" id="wdoc">
      <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div class="flex items-center gap-3">
            <h3 class="text-sm font-bold text-gray-500">{t('docs.heading')}</h3>
            <div class="flex rounded-lg border border-gray-200 overflow-hidden text-xs" role="tablist">
              {data.map((tab, i) => (
                <button
                  type="button"
                  id={`wdoc-tab-${tab.scope}`}
                  data-scope={tab.scope}
                  class={`wdoc-tab px-3 py-1 font-bold ${i === 0 ? 'bg-horizon-50 text-horizon-700' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span id="wdoc-presence" class="text-[10px] text-gray-400"></span>
            <span id="wdoc-status" class="text-xs text-gray-400 transition-opacity"></span>
          </div>
      </div>

      <div class="rounded-2xl overflow-hidden bg-white border border-papaya-300/30">
        <p id="wdoc-hint" class="px-5 pt-3 text-[10px] text-gray-400"></p>

        <div
          id="wdoc-lockbar"
          class="hidden items-center justify-between gap-3 px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800"
        ></div>

        <div class="px-3 py-3">
          <div id="wdoc-editor"></div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        #wdoc .md-preview h1 { font-size: 1.5em; font-weight: 700; margin: 1em 0 0.5em; }
        #wdoc .md-preview h2 { font-size: 1.25em; font-weight: 700; margin: 1em 0 0.5em; }
        #wdoc .md-preview h3 { font-size: 1.1em; font-weight: 700; margin: 0.75em 0 0.4em; }
        #wdoc .md-preview p { margin: 0.5em 0; }
        #wdoc .md-preview ul, #wdoc .md-preview ol { margin: 0.5em 0; padding-left: 1.5em; }
        #wdoc .md-preview ul { list-style: disc; }
        #wdoc .md-preview ol { list-style: decimal; }
        #wdoc .md-preview li { margin: 0.25em 0; }
        #wdoc .md-preview a { color: #0066E6; text-decoration: underline; }
        #wdoc .md-preview strong { font-weight: 700; }
        #wdoc .md-preview em { font-style: italic; }
        #wdoc .md-preview blockquote { border-left: 3px solid #d1d5db; padding-left: 1em; color: #6b7280; margin: 0.75em 0; }
        #wdoc .md-preview table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
        #wdoc .md-preview th, #wdoc .md-preview td { border: 1px solid #e5e7eb; padding: 0.4em 0.75em; text-align: left; }
        #wdoc .EasyMDEContainer .CodeMirror { border-radius: 12px; border-color: #e5e7eb; }
        #wdoc .editor-toolbar { border-radius: 12px 12px 0 0; border-color: #e5e7eb; }
      `,
        }}
      />

      <script
        dangerouslySetInnerHTML={{
          __html: `
(function(){
  var BASE=${safeJson(baseUrl)};
  var CSRF=${safeJson(csrfToken)};
  var DATA=${safeJson(data)};
  var I=${safeJson(i18n)};

  var state={};
  DATA.forEach(function(t){ state[t.scope]={content:t.content,token:t.token,canWrite:t.canWrite,hint:t.hint,solo:t.solo,holds:false,dirty:false}; });
  var active=DATA.length?DATA[0].scope:null;
  var mde=null, editor=null, editable=false, mounting=false, fallback=false, saveTimer=null, pollTimer=null;

  var elEditor=document.getElementById('wdoc-editor');
  var elStatus=document.getElementById('wdoc-status');
  var elHint=document.getElementById('wdoc-hint');
  var elPres=document.getElementById('wdoc-presence');
  var elLock=document.getElementById('wdoc-lockbar');

  function setStatus(txt,color){ elStatus.textContent=txt||''; elStatus.style.color=color||'#9ca3af'; }
  function fmt(tpl,k,v){ return tpl.split('{'+k+'}').join(v); }
  function headers(json){ var h={'X-CSRF-Token':CSRF}; if(json)h['Content-Type']='application/json'; return h; }
  function escapeHtml(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
  function renderMd(src){
    if(!src) return '<p class="text-gray-400 italic">'+escapeHtml(I.empty)+'</p>';
    if(typeof marked==='undefined'||!marked.parse||!window.DOMPurify) return '<div class="whitespace-pre-wrap">'+escapeHtml(src)+'</div>';
    try{ return DOMPurify.sanitize(marked.parse(src)); }catch(e){ return '<div class="whitespace-pre-wrap">'+escapeHtml(src)+'</div>'; }
  }

  function destroyEditor(){
    try{ if(mde){ mde.toTextArea(); mde=null; } }catch(e){ mde=null; }
    editor=null; elEditor.innerHTML='';
  }

  function getContent(){
    if(mde) return mde.value();
    if(fallback&&editor&&editor.value!=null) return editor.value;
    return state[active].content;
  }

  function mount(scope,canEdit){
    mounting=true; destroyEditor(); editable=canEdit; fallback=false;
    var content=state[scope].content;
    if(canEdit&&window.EasyMDE){
      var ta=document.createElement('textarea'); elEditor.appendChild(ta);
      mde=new EasyMDE({element:ta,initialValue:content,autofocus:false,spellChecker:false,status:false,autoDownloadFontAwesome:true,minHeight:'220px',
        toolbar:['bold','italic','heading','|','quote','unordered-list','ordered-list','|','link','table','|','preview','side-by-side','guide']});
      mde.codemirror.on('change',onChange);
      editor=mde;
    } else if(canEdit){
      fallback=true;
      var ta2=document.createElement('textarea');
      ta2.className='w-full px-3 py-3 text-sm font-mono leading-relaxed resize-y focus:outline-none min-h-[220px] bg-transparent border border-gray-200 rounded-xl';
      ta2.value=content; ta2.addEventListener('input',onChange); elEditor.appendChild(ta2); editor=ta2;
    } else {
      var d=document.createElement('div'); d.className='px-3 py-3 md-preview text-sm text-gray-700 min-h-[120px]';
      d.innerHTML=renderMd(content); elEditor.appendChild(d); editor=null;
    }
    mounting=false;
  }

  function onChange(){
    if(mounting) return;
    state[active].dirty=true;
    setStatus(I.editing);
    clearTimeout(saveTimer); saveTimer=setTimeout(save,1500);
  }

  function save(){
    var scope=active; var s=state[scope]; if(!s||!s.canWrite) return;
    var val=getContent(); if(val===s.content){ s.dirty=false; return; }
    setStatus(I.saving,'#6b7280');
    fetch(BASE+'/'+scope,{method:'POST',headers:headers(true),body:JSON.stringify({content:val,token:s.token})})
      .then(function(r){ return r.json().then(function(d){ return {st:r.status,d:d}; }); })
      .then(function(x){
        if(x.st===200&&x.d.saved){ s.content=val; s.token=x.d.token; s.dirty=false; setStatus(I.saved,'#16a34a'); setTimeout(function(){ if(elStatus.textContent===I.saved&&active===scope) setStatus(''); },3000); }
        else if(x.st===409&&x.d.conflict){ s.content=x.d.content; s.token=x.d.token; s.dirty=false; if(active===scope) mount(scope,editable); setStatus(I.conflict,'#ca8a04'); }
        else setStatus(I.saveFailed,'#dc2626');
      })
      .catch(function(){ setStatus(I.saveFailed,'#dc2626'); });
  }

  function renderPresence(sum){
    var n=sum.viewers?sum.viewers.length:0;
    elPres.textContent=n>0?fmt(n===1?I.viewersOne:I.viewersOther,'count',String(n)):'';
  }

  function renderLock(scope,sum){
    var s=state[scope];
    if(!s.canWrite||sum.youHoldLock||!sum.lockedBy){ elLock.classList.add('hidden'); elLock.classList.remove('flex'); return; }
    elLock.classList.remove('hidden'); elLock.classList.add('flex'); elLock.innerHTML='';
    var span=document.createElement('span'); span.textContent=fmt(I.readonlyLocked,'name',sum.lockedBy.name);
    var btn=document.createElement('button'); btn.type='button'; btn.textContent=I.takeover; btn.className='font-bold underline whitespace-nowrap';
    btn.addEventListener('click',function(){ takeover(scope); });
    elLock.appendChild(span); elLock.appendChild(btn);
  }

  function applyLockState(scope,sum){
    var s=state[scope]; s.holds=!!sum.youHoldLock;
    if(s.canWrite){
      if(sum.youHoldLock){ if(!editable) mount(scope,true); }
      else if(!sum.lockedBy){ takeover(scope); return; }
      else { if(editable){ if(s.dirty) save(); mount(scope,false); } }
    }
    renderLock(scope,sum);
  }

  function poll(){
    var scope=active; if(!scope||state[scope].solo) return;
    fetch(BASE+'/'+scope+'/heartbeat',{method:'POST',headers:headers(false)})
      .then(function(r){ return r.json(); })
      .then(function(sum){ if(active!==scope) return; renderPresence(sum); applyLockState(scope,sum); })
      .catch(function(){});
  }

  function takeover(scope){
    fetch(BASE+'/'+scope+'/claim',{method:'POST',headers:headers(false)})
      .then(function(r){ return r.json(); })
      .then(function(sum){ if(active!==scope) return; state[scope].holds=!!sum.youHoldLock; if(state[scope].canWrite&&sum.youHoldLock&&!editable) mount(scope,true); renderPresence(sum); renderLock(scope,sum); })
      .catch(function(){});
  }

  function releaseActive(){
    var scope=active; if(!scope||!state[scope].holds) return;
    try{ fetch(BASE+'/'+scope+'/release',{method:'POST',headers:headers(false),keepalive:true}); }catch(e){}
    state[scope].holds=false;
  }

  function enter(scope){
    elHint.textContent=state[scope].hint||'';
    elLock.classList.add('hidden'); elLock.classList.remove('flex');
    if(state[scope].solo){
      // Private/solo: only you, so no presence or lock — just edit.
      elPres.textContent='';
      mount(scope,state[scope].canWrite);
    } else {
      mount(scope,false);
      poll();
    }
  }

  function openTab(scope){
    if(active===scope) return;
    if(active){ if(state[active].dirty) save(); releaseActive(); }
    active=scope;
    DATA.forEach(function(t){ var b=document.getElementById('wdoc-tab-'+t.scope); if(!b) return; b.className=(t.scope===scope)?'wdoc-tab px-3 py-1 font-bold bg-horizon-50 text-horizon-700':'wdoc-tab px-3 py-1 font-bold text-gray-400 hover:text-gray-600'; });
    setStatus('');
    enter(scope);
  }

  DATA.forEach(function(t){ var b=document.getElementById('wdoc-tab-'+t.scope); if(b) b.addEventListener('click',function(){ openTab(t.scope); }); });

  function start(){
    if(!active) return;
    enter(active);
    pollTimer=setInterval(poll,5000);
  }

  function ensureLibs(cb){
    var need=[];
    if(!window.EasyMDE) need.push({css:'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css',js:'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js'});
    if(typeof window.marked==='undefined') need.push({js:'https://cdn.jsdelivr.net/npm/marked@15/marked.min.js'});
    if(!window.DOMPurify) need.push({js:'https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js'});
    if(!need.length){ cb(); return; }
    var remaining=need.length, done=false;
    function finish(){ if(done) return; if(--remaining<=0){ done=true; cb(); } }
    need.forEach(function(n){
      if(n.css){ var l=document.createElement('link'); l.rel='stylesheet'; l.href=n.css; document.head.appendChild(l); }
      var s=document.createElement('script'); s.src=n.js; s.onload=finish; s.onerror=finish; document.head.appendChild(s);
    });
  }

  ensureLibs(start);
  window.addEventListener('beforeunload',function(){ if(active&&state[active].dirty) save(); releaseActive(); });
})();
`,
        }}
      />
    </div>
  )
}
