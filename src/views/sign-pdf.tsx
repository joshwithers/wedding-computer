// Client-side PDF annotator + read-only status/handoff pages for collaborative
// signing. Loads self-hosted pdf.js (same-origin, CSP-safe), captures freehand
// strokes as normalized coords, and POSTs them to the routes in src/routes/signing.tsx
// (which burn them in via src/forms/signing/burn.ts). See SIGNING.md for the full picture.
import { SharedHead } from './head'
import { withDoctype } from './document'
import { getCspNonce, t } from '../i18n'
import { PDFJS_SCRIPT_SRC, PDFJS_WORKER_SRC } from '../lib/assets'

export type SignerMode = 'couple' | 'celebrant'

type AnnotatorProps = {
  title: string
  mode: SignerMode
  signerName: string
  pdfUrl: string
  saveUrl: string
  backUrl: string
  csrfToken: string
}

// Focused full-page PDF annotator. Self-contained (its own minimal chrome, not
// the app/couple nav) so the signing surface gets maximum screen space on phones
// and tablets. pdf.js is loaded from same-origin /assets (worker too), so it
// passes CSP without any directive changes.
export function SignPdfAnnotator(props: AnnotatorProps) {
  const nonce = getCspNonce()
  const config = JSON.stringify({
    pdfUrl: props.pdfUrl,
    saveUrl: props.saveUrl,
    backUrl: props.backUrl,
    csrf: props.csrfToken,
    workerSrc: PDFJS_WORKER_SRC,
    mode: props.mode,
    // Strings the client JS needs (server-rendered with the viewer's locale).
    strings: {
      page: t('signing.page'),
      loading: t('signing.loading'),
      viewerFail: t('signing.error.viewer'),
      loadFail: t('signing.error.load'),
      saving: props.mode === 'couple' ? t('signing.saving.couple') : t('signing.saving.celebrant'),
      saved: t('signing.saved'),
      empty: t('signing.error.empty'),
      saveError: t('signing.error.save'),
      network: t('signing.error.network'),
    },
  })
  const lead = props.mode === 'couple' ? t('signing.lead.couple') : t('signing.lead.celebrant')

  return withDoctype(
    <html lang="en">
      <head>
        <SharedHead title={`${t('signing.block.title')} — ${props.title}`} noindex={true} />
        <script src={PDFJS_SCRIPT_SRC} nonce={nonce}></script>
      </head>
      <body class="bg-gray-100 text-gray-900 antialiased font-sans min-h-screen flex flex-col">
        {/* Top bar */}
        <header class="bg-grapefruit-700 text-papaya-100 shrink-0">
          <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
            <a href={props.backUrl} class="inline-flex items-center gap-1.5 text-sm font-medium text-papaya-200 hover:text-papaya-100 transition-colors" style="min-height:40px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              <span class="hidden sm:inline">{t('common.back')}</span>
            </a>
            <h1 class="text-sm sm:text-base font-semibold truncate text-center flex-1" style="text-wrap:balance">{props.title}</h1>
            <button id="sign-save" type="button" class="inline-flex items-center justify-center rounded-lg bg-papaya-100 text-grapefruit-800 text-sm font-semibold px-4 h-10 shadow-sm hover:bg-white active:scale-[0.97] transition" style="transition-property:transform,background-color">
              {props.mode === 'couple' ? t('signing.save.couple') : t('signing.save.celebrant')}
            </button>
          </div>
        </header>

        {/* Toolbar */}
        <div class="bg-white border-b border-gray-200 shrink-0">
          <div class="max-w-5xl mx-auto px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-1">
              <button id="pg-prev" type="button" aria-label={t('signing.toolbar.prev')} class="sign-tool"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
              <span id="pg-label" class="text-sm tabular-nums text-gray-600 min-w-[5.5rem] text-center"></span>
              <button id="pg-next" type="button" aria-label={t('signing.toolbar.next')} class="sign-tool"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg></button>
            </div>
            <div class="flex items-center gap-1">
              <button id="zoom-out" type="button" aria-label={t('signing.toolbar.zoomOut')} class="sign-tool"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M21 21l-4.3-4.3" /></svg></button>
              <span id="zoom-label" class="text-sm tabular-nums text-gray-600 min-w-[3.5rem] text-center">100%</span>
              <button id="zoom-in" type="button" aria-label={t('signing.toolbar.zoomIn')} class="sign-tool"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="M11 8v6M8 11h6M21 21l-4.3-4.3" /></svg></button>
            </div>
            <div class="flex items-center gap-1">
              <button id="undo" type="button" aria-label={t('signing.toolbar.undoAria')} class="sign-tool-text">{t('signing.toolbar.undo')}</button>
              <button id="clear" type="button" aria-label={t('signing.toolbar.eraseAria')} class="sign-tool-text">{t('signing.toolbar.erase')}</button>
            </div>
          </div>
        </div>

        {/* Inline banner (replaces alert() for guards + errors) */}
        <div id="sign-banner" class="hidden max-w-5xl mx-auto w-full px-4 pt-3">
          <div id="sign-banner-box" class="rounded-lg px-4 py-2.5 text-sm font-medium" role="status" aria-live="polite"></div>
        </div>

        {/* Canvas stage */}
        <main class="flex-1 overflow-auto">
          <p class="max-w-5xl mx-auto px-4 pt-3 text-sm text-gray-500" style="text-wrap:pretty">{lead}</p>
          <div id="sign-stage" class="flex justify-center py-4 px-2">
            <div id="page-wrap" class="relative shadow-lg bg-white" style="touch-action:none">
              <canvas id="pdf-canvas" class="block"></canvas>
              <canvas id="ink-canvas" class="absolute inset-0 touch-none" style="touch-action:none"></canvas>
            </div>
          </div>
          <div id="sign-loading" class="text-center text-gray-500 text-sm py-10">{t('signing.loading')}</div>
        </main>

        {/* Saving / saved overlay */}
        <div id="sign-overlay" class="fixed inset-0 bg-gray-900/50 hidden items-center justify-center z-50">
          <div class="bg-white rounded-xl px-6 py-5 shadow-xl text-center flex items-center gap-2.5">
            <svg id="sign-overlay-tick" class="hidden w-5 h-5 text-horizon-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            <div class="text-sm font-medium text-gray-900" id="sign-overlay-msg"></div>
          </div>
        </div>

        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: `
          .sign-tool{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;color:#374151;background:transparent}
          .sign-tool:hover{background:#f3f4f6}
          .sign-tool:disabled{opacity:.35;cursor:default}
          .sign-tool-text{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 12px;border-radius:10px;font-size:14px;font-weight:500;color:#374151;background:transparent}
          .sign-tool-text:hover{background:#f3f4f6}
          #ink-canvas{cursor:crosshair}
        ` }} />

        <script id="sign-config" type="application/json" nonce={nonce} dangerouslySetInnerHTML={{ __html: config }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: ANNOTATOR_JS }} />
      </body>
    </html>
  )
}

const ANNOTATOR_JS = `
(function(){
  var cfg = JSON.parse(document.getElementById('sign-config').textContent);
  var S = cfg.strings;
  var pdfjsLib = window['pdfjsLib'];
  if (!pdfjsLib) { document.getElementById('sign-loading').textContent = S.viewerFail; return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = cfg.workerSrc;

  var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  var pdfCanvas = document.getElementById('pdf-canvas');
  var inkCanvas = document.getElementById('ink-canvas');
  var pctx = pdfCanvas.getContext('2d');
  var ictx = inkCanvas.getContext('2d');
  var pageWrap = document.getElementById('page-wrap');

  var doc = null, pageNum = 1, pageCount = 1, scale = 1, rendering = false, renderTask = null;
  var strokes = {};            // pageIndex(0-based) -> [{color,width,pts:[[nx,ny]...]}]
  var cur = null;              // active stroke
  var INK = '#16213e';
  var PEN_CSS = 2.4;           // pen width in CSS px

  function setOverlay(show, msg, done){ var o=document.getElementById('sign-overlay'); if(msg) document.getElementById('sign-overlay-msg').textContent=msg; document.getElementById('sign-overlay-tick').classList.toggle('hidden', !done); o.classList.toggle('hidden', !show); o.classList.toggle('flex', show); }
  var bannerTimer = null;
  function showBanner(msg, kind){
    var b = document.getElementById('sign-banner'), box = document.getElementById('sign-banner-box');
    box.textContent = msg;
    box.className = 'rounded-lg px-4 py-2.5 text-sm font-medium ' + (kind==='error' ? 'bg-grapefruit-50 text-grapefruit-800 border border-grapefruit-200' : 'bg-papaya-100 text-gray-700 border border-papaya-300');
    b.classList.remove('hidden');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function(){ b.classList.add('hidden'); }, 6000);
  }
  function clampUnit(v){ return v<0?0:(v>1?1:v); }

  function redrawInk(){
    ictx.clearRect(0,0,inkCanvas.width,inkCanvas.height);
    var list = strokes[pageNum-1] || [];
    for (var s=0;s<list.length;s++){ drawStroke(list[s]); }
  }
  function drawStroke(stroke){
    var pts = stroke.pts; if(!pts || pts.length<2) return;
    ictx.lineJoin='round'; ictx.lineCap='round';
    ictx.strokeStyle = stroke.color || INK;
    ictx.lineWidth = Math.max(1, (stroke.width || 0.003) * inkCanvas.width);
    ictx.beginPath();
    ictx.moveTo(pts[0][0]*inkCanvas.width, pts[0][1]*inkCanvas.height);
    for (var i=1;i<pts.length;i++){ ictx.lineTo(pts[i][0]*inkCanvas.width, pts[i][1]*inkCanvas.height); }
    ictx.stroke();
  }

  function renderPage(){
    if(!doc) return;
    rendering = true;
    doc.getPage(pageNum).then(function(page){
      var vp = page.getViewport({ scale: scale * dpr });
      pdfCanvas.width = Math.floor(vp.width); pdfCanvas.height = Math.floor(vp.height);
      inkCanvas.width = pdfCanvas.width; inkCanvas.height = pdfCanvas.height;
      var cssW = Math.floor(vp.width / dpr), cssH = Math.floor(vp.height / dpr);
      pdfCanvas.style.width = cssW+'px'; pdfCanvas.style.height = cssH+'px';
      inkCanvas.style.width = cssW+'px'; inkCanvas.style.height = cssH+'px';
      pageWrap.style.width = cssW+'px'; pageWrap.style.height = cssH+'px';
      if (renderTask) { try{ renderTask.cancel(); }catch(e){} }
      renderTask = page.render({ canvasContext: pctx, viewport: vp });
      renderTask.promise.then(function(){ rendering=false; redrawInk(); }).catch(function(){ rendering=false; });
      document.getElementById('pg-label').textContent = S.page.replace('{n}', pageNum).replace('{total}', pageCount);
      document.getElementById('zoom-label').textContent = Math.round(scale*100)+'%';
      document.getElementById('pg-prev').disabled = pageNum<=1;
      document.getElementById('pg-next').disabled = pageNum>=pageCount;
    });
  }

  // Pointer coords normalized to [0..1] against the VISIBLE (rendered, rotation-aware)
  // canvas, top-left origin, y-down. Normalization keeps strokes resolution-, zoom-, and
  // rotation-independent — burn.ts toUserSpace() expects exactly this space.
  function pos(e){
    var r = inkCanvas.getBoundingClientRect();
    return [ clampUnit((e.clientX - r.left)/r.width), clampUnit((e.clientY - r.top)/r.height) ];
  }
  inkCanvas.addEventListener('pointerdown', function(e){
    if (rendering) return;
    inkCanvas.setPointerCapture(e.pointerId);
    var widthNorm = PEN_CSS / inkCanvas.getBoundingClientRect().width;
    cur = { color: INK, width: widthNorm, pts: [ pos(e) ] };
    e.preventDefault();
  });
  inkCanvas.addEventListener('pointermove', function(e){
    if (!cur) return;
    var p = pos(e); cur.pts.push(p);
    // live draw last segment
    var n = cur.pts.length;
    if (n>=2){
      ictx.lineJoin='round'; ictx.lineCap='round'; ictx.strokeStyle=cur.color;
      ictx.lineWidth = Math.max(1, cur.width*inkCanvas.width);
      ictx.beginPath();
      ictx.moveTo(cur.pts[n-2][0]*inkCanvas.width, cur.pts[n-2][1]*inkCanvas.height);
      ictx.lineTo(cur.pts[n-1][0]*inkCanvas.width, cur.pts[n-1][1]*inkCanvas.height);
      ictx.stroke();
    }
    e.preventDefault();
  });
  function endStroke(){ if(!cur) return; if(cur.pts.length>=2){ (strokes[pageNum-1]=strokes[pageNum-1]||[]).push(cur); } cur=null; }
  inkCanvas.addEventListener('pointerup', endStroke);
  inkCanvas.addEventListener('pointercancel', endStroke);
  // Do NOT end the stroke on pointerleave for touch/pen — a finger/stylus can briefly leave
  // the canvas mid-signature. Only mouse ends a stroke here; touch/pen end on pointerup/cancel.
  inkCanvas.addEventListener('pointerleave', function(e){ if(cur && e.pointerType!=='mouse') return; });

  document.getElementById('pg-prev').addEventListener('click', function(){ if(pageNum>1){ pageNum--; renderPage(); } });
  document.getElementById('pg-next').addEventListener('click', function(){ if(pageNum<pageCount){ pageNum++; renderPage(); } });
  document.getElementById('zoom-in').addEventListener('click', function(){ scale=Math.min(4, Math.round((scale+0.25)*100)/100); renderPage(); });
  document.getElementById('zoom-out').addEventListener('click', function(){ scale=Math.max(0.5, Math.round((scale-0.25)*100)/100); renderPage(); });
  document.getElementById('undo').addEventListener('click', function(){ var l=strokes[pageNum-1]; if(l&&l.length){ l.pop(); redrawInk(); } });
  document.getElementById('clear').addEventListener('click', function(){ strokes[pageNum-1]=[]; redrawInk(); });

  function totalPoints(){ var n=0; for(var k in strokes){ var l=strokes[k]; for(var i=0;i<l.length;i++) n+=l[i].pts.length; } return n; }

  document.getElementById('sign-save').addEventListener('click', function(){
    endStroke();
    if (totalPoints() === 0){ showBanner(S.empty, 'warn'); return; }
    setOverlay(true, S.saving, false);
    fetch(cfg.saveUrl, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-csrf-token': cfg.csrf },
      body: JSON.stringify({ strokes: strokes })
    }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
      .then(function(res){
        if (res.ok && res.j && res.j.redirect){
          // Brief "Saved ✓" confirmation before moving on.
          setOverlay(true, S.saved, true);
          setTimeout(function(){ window.location = res.j.redirect; }, 700);
          return;
        }
        setOverlay(false);
        showBanner((res.j && res.j.error) || S.saveError, 'error');
      })
      .catch(function(){ setOverlay(false); showBanner(S.network, 'error'); });
  });

  // Fetch + open the PDF.
  pdfjsLib.getDocument({ url: cfg.pdfUrl, withCredentials: true }).promise.then(function(d){
    doc = d; pageCount = d.numPages; pageNum = 1;
    document.getElementById('sign-loading').style.display='none';
    // Fit width to the stage on first load.
    var stageW = document.getElementById('sign-stage').clientWidth - 24;
    d.getPage(1).then(function(p){
      var base = p.getViewport({ scale: 1 });
      scale = Math.max(0.5, Math.min(2, stageW / base.width));
      scale = Math.round(scale*100)/100;
      renderPage();
    });
  }).catch(function(){ document.getElementById('sign-loading').textContent = S.loadFail; });
})();
`

// ─── Read-only status / handoff pages (no annotator) ───

type StatusAction = { href: string; label: string; primary?: boolean; method?: 'get' | 'post'; csrf?: string }

function FocusedShell(props: { title: string; backUrl: string; children: unknown; autoRefreshSeconds?: number }) {
  return withDoctype(
    <html lang="en">
      <head>
        <SharedHead title={props.title} noindex={true} />
        {props.autoRefreshSeconds ? <meta http-equiv="refresh" content={String(props.autoRefreshSeconds)} /> : null}
      </head>
      <body class="bg-papaya-100 text-gray-900 antialiased font-sans min-h-screen flex flex-col">
        <header class="bg-grapefruit-700 text-papaya-100 shrink-0">
          <div class="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
            <a href={props.backUrl} class="inline-flex items-center gap-1.5 text-sm font-medium text-papaya-200 hover:text-papaya-100" style="min-height:40px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              <span>Back</span>
            </a>
          </div>
        </header>
        <main class="flex-1 flex items-start justify-center px-4 py-10">
          <div class="w-full max-w-lg">{props.children as any}</div>
        </main>
      </body>
    </html>
  )
}

export function SigningStatusPage(props: {
  title: string
  backUrl: string
  heading: string
  body: string
  actions?: StatusAction[]
  autoRefreshSeconds?: number
}) {
  return FocusedShell({
    title: props.title,
    backUrl: props.backUrl,
    autoRefreshSeconds: props.autoRefreshSeconds,
    children: (
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
        <h1 class="text-xl font-semibold text-gray-900" style="text-wrap:balance">{props.heading}</h1>
        <p class="mt-2 text-gray-600 leading-relaxed" style="text-wrap:pretty">{props.body}</p>
        {props.actions && props.actions.length > 0 && (
          <div class="mt-6 flex flex-col sm:flex-row gap-3">
            {props.actions.map((a) =>
              a.method === 'post' ? (
                <form method="post" action={a.href} class="contents">
                  {a.csrf && <input type="hidden" name="_csrf" value={a.csrf} />}
                  <button type="submit" class={btnClass(a.primary)}>{a.label}</button>
                </form>
              ) : (
                <a href={a.href} class={btnClass(a.primary)}>{a.label}</a>
              )
            )}
          </div>
        )}
      </div>
    ),
  })
}

function btnClass(primary?: boolean) {
  return primary
    ? 'inline-flex items-center justify-center rounded-lg bg-grapefruit-700 text-papaya-100 text-sm font-semibold px-5 h-11 shadow-sm hover:bg-grapefruit-800 active:scale-[0.97] transition'
    : 'inline-flex items-center justify-center rounded-lg bg-gray-100 text-gray-800 text-sm font-semibold px-5 h-11 hover:bg-gray-200 active:scale-[0.97] transition'
}
