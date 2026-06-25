// Couples community — views.
//
// One room per (country · season · year); the state/province is an in-room
// filter. Post bodies are raw markdown rendered CLIENT-SIDE (marked + DOMPurify,
// the same pipeline as the wedding docs) so there is never server-rendered user
// HTML. Lists/threads swap via htmx; the markdown renderer re-runs on
// htmx:afterSwap so freshly-swapped posts render too.

import type { FC, PropsWithChildren } from 'hono/jsx'
import type { User } from '../types'
import { SharedHead } from './head'
import { Logo } from './logo'
import { getCspNonce, t, tp } from '../i18n'
import { formatDateTime } from '../lib/date'
import { HTMX_SCRIPT_SRC } from '../lib/assets'
import { cohortLabel, seasonWord } from '../lib/season'
import { withDoctype } from './document'
import { COUNTRIES } from '../forms/countries'
import type { Season } from '../types'
import type { CommunityCohort, CommunityMember, CommunityThreadRow, CommunityPost } from '../db/community'

function labelFor(cohort: CommunityCohort): string {
  return cohortLabel({ countryName: cohort.country_name, season: cohort.season, year: cohort.year })
}

// ─── Layout ───

export const CommunityLayout: FC<PropsWithChildren<{ title?: string; user: User; csrfToken: string }>> = ({
  title,
  user,
  csrfToken,
  children,
}) => withDoctype(
  <html lang="en">
    <head>
      <SharedHead title={title ?? t('community.title')} />
      <script nonce={getCspNonce()} src={HTMX_SCRIPT_SRC} defer></script>
      <meta name="csrf-token" content={csrfToken} />
    </head>
    <body
      class="bg-papaya-50 text-gray-900 antialiased font-sans"
      hx-headers={`{"X-CSRF-Token": "${csrfToken}"}`}
    >
      <header class="bg-grapefruit-700 px-4 sm:px-8 py-4">
        <div class="max-w-3xl mx-auto flex items-center justify-between">
          <a
            href="/community"
            class="flex items-center gap-2 text-sm sm:text-base font-bold tracking-tight text-papaya whitespace-nowrap"
          >
            <Logo class="w-5 h-5 shrink-0" />
            {t('community.title')}
          </a>
          <div class="flex items-center gap-3">
            <a href="/account" class="text-sm font-medium text-papaya-200 hover:text-white transition-colors">
              {user.name}
            </a>
            <form method="post" action="/logout" class="flex items-center m-0">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button
                type="submit"
                class="text-sm font-medium text-papaya-200 hover:text-white transition-colors p-0 bg-transparent border-0 cursor-pointer"
              >
                {t('community.signOut')}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main class="px-4 py-6 sm:px-8 sm:py-8">
        <div class="max-w-3xl mx-auto">{children}</div>
      </main>
      <CommunityMarkdownScript />
    </body>
  </html>
)

/** Loads marked + DOMPurify once and renders every .community-md element,
 *  re-running after htmx swaps. Source markdown is the element's text content
 *  (escaped in the HTML source, so no server-side HTML is ever emitted). */
const CommunityMarkdownScript: FC = () => (
  <script
    nonce={getCspNonce()}
    dangerouslySetInnerHTML={{
      __html: `
(function(){
  function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
  function render(src){
    if(!src) return '';
    if(typeof marked==='undefined'||!marked.parse||!window.DOMPurify) return '<div class="whitespace-pre-wrap">'+esc(src)+'</div>';
    try{ return DOMPurify.sanitize(marked.parse(src)); }catch(e){ return '<div class="whitespace-pre-wrap">'+esc(src)+'</div>'; }
  }
  function renderAll(){
    var nodes=document.querySelectorAll('.community-md:not([data-rendered])');
    Array.prototype.forEach.call(nodes,function(el){ el.innerHTML=render(el.textContent); el.setAttribute('data-rendered','1'); });
  }
  function ensureLibs(cb){
    var need=[];
    if(typeof window.marked==='undefined') need.push('https://cdn.jsdelivr.net/npm/marked@15/marked.min.js');
    if(!window.DOMPurify) need.push('https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js');
    if(!need.length){ cb(); return; }
    var remaining=need.length, done=false;
    function fin(){ if(done) return; if(--remaining<=0){ done=true; cb(); } }
    need.forEach(function(u){ var s=document.createElement('script'); s.src=u; s.onload=fin; s.onerror=fin; document.head.appendChild(s); });
  }
  function go(){ ensureLibs(renderAll); }
  if(document.readyState!=='loading') go(); else document.addEventListener('DOMContentLoaded',go);
  document.body.addEventListener('htmx:afterSwap',go);
  // Clear the reply box after a reply is appended (the form isn't swapped).
  document.body.addEventListener('htmx:afterRequest',function(e){
    var f=e.detail&&e.detail.elt;
    if(f&&f.tagName==='FORM'&&/\\/replies$/.test(f.getAttribute('hx-post')||'')&&e.detail.successful){ try{f.reset();}catch(_){ } }
  });
})();
`,
    }}
  />
)

// ─── Join card (couple dashboard + hub) ───

export type JoinCardData =
  | { mode: 'member'; label: string; roomHref: string }
  | { mode: 'needsDate'; editHref: string }
  | {
      mode: 'join'
      label: string | null
      countryName: string
      subdivisionLabel: string | null
      defaultDisplayName: string
      weddingId?: string
    }

export function CommunityJoinCard({ data, csrfToken }: { data: JoinCardData; csrfToken: string }) {
  return (
    <div class="rounded-2xl bg-white border border-papaya-300/40 p-5">
      <h3 class="text-sm font-bold text-gray-500 mb-1">{t('community.join.title')}</h3>

      {data.mode === 'member' && (
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <p class="text-sm text-gray-700">{t('community.join.member', { label: data.label })}</p>
          <a
            href={data.roomHref}
            class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
          >
            {t('community.join.open')}
          </a>
        </div>
      )}

      {data.mode === 'needsDate' && (
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <p class="text-sm text-gray-600">{t('community.join.needsDate')}</p>
          <a
            href={data.editHref}
            class="bg-papaya-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold hover:bg-papaya-300 transition-colors whitespace-nowrap"
          >
            {t('community.join.needsDateCta')}
          </a>
        </div>
      )}

      {data.mode === 'join' && (
        <form method="post" action="/community/join" class="space-y-3">
          <input type="hidden" name="_csrf" value={csrfToken} />
          {data.weddingId && <input type="hidden" name="wedding_id" value={data.weddingId} />}
          <p class="text-sm text-gray-600">
            {data.label
              ? t('community.join.blurb', { label: data.label })
              : t('community.join.pickCountry')}
          </p>

          <div class="grid sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="block text-[11px] font-bold text-gray-500 mb-1">{t('community.join.country')}</span>
              <select
                name="country"
                required
                class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600"
              >
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option value={c} selected={c === data.countryName}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label class="block">
              <span class="block text-[11px] font-bold text-gray-500 mb-1">{t('community.join.state')}</span>
              <input
                type="text"
                name="state"
                value={data.subdivisionLabel ?? ''}
                class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600"
              />
            </label>
          </div>

          <label class="block">
            <span class="block text-[11px] font-bold text-gray-500 mb-1">{t('community.join.displayName')}</span>
            <input
              type="text"
              name="display_name"
              required
              maxlength={40}
              value={data.defaultDisplayName}
              class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600"
            />
            <span class="block text-[10px] text-gray-400 mt-1">{t('community.join.displayNameHint')}</span>
          </label>

          <button
            type="submit"
            class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors"
          >
            {t('community.join.confirm')}
          </button>
        </form>
      )}
    </div>
  )
}

// ─── Vendor join panel ───

const ALL_SEASONS: Season[] = ['summer', 'autumn', 'winter', 'spring']

/** Explicit country + season + year picker for vendors joining from the hub. */
function VendorJoinPanel({
  businessName,
  csrfToken,
  years,
  defaultYear,
}: {
  businessName: string | null
  csrfToken: string
  years: number[]
  defaultYear: number
}) {
  const inputClass =
    'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600'
  const labelClass = 'block text-[11px] font-bold text-gray-500 mb-1'
  return (
    <div class="rounded-2xl bg-white border border-papaya-300/40 p-5">
      <h3 class="text-sm font-bold text-gray-500 mb-1">{t('community.vendor.joinTitle')}</h3>
      <p class="text-sm text-gray-600 mb-3">{t('community.vendor.joinBlurb')}</p>
      <form method="post" action="/community/join" class="space-y-3">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="vendor_join" value="1" />
        <div class="grid sm:grid-cols-3 gap-3">
          <label class="block">
            <span class={labelClass}>{t('community.join.country')}</span>
            <select name="country" required class={inputClass}>
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label class="block">
            <span class={labelClass}>{t('community.join.season')}</span>
            <select name="season" required class={inputClass}>
              {ALL_SEASONS.map((s) => (
                <option value={s}>{seasonWord(s)}</option>
              ))}
            </select>
          </label>
          <label class="block">
            <span class={labelClass}>{t('community.join.year')}</span>
            <select name="year" required class={inputClass}>
              {years.map((y) => (
                <option value={y} selected={y === defaultYear}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label class="block">
          <span class={labelClass}>{t('community.join.displayName')}</span>
          <input
            type="text"
            name="display_name"
            required
            maxlength={40}
            value={businessName ?? ''}
            class={inputClass}
          />
          <span class="block text-[10px] text-gray-400 mt-1">{t('community.join.vendorDisplayNameHint')}</span>
        </label>
        <button
          type="submit"
          class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors"
        >
          {t('community.join.confirm')}
        </button>
      </form>
    </div>
  )
}

// ─── Hub ───

export type VendorJoinData = {
  businessName: string | null
  years: number[]
  defaultYear: number
}

export function CommunityHub({
  user,
  csrfToken,
  cohorts,
  joinCard,
  vendorJoin,
}: {
  user: User
  csrfToken: string
  cohorts: CommunityCohort[]
  joinCard: JoinCardData | null
  vendorJoin?: VendorJoinData | null
}) {
  return (
    <CommunityLayout title={t('community.title')} user={user} csrfToken={csrfToken}>
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold">{t('community.title')}</h1>
          <p class="text-gray-600 mt-1">{t('community.hub.subtitle')}</p>
        </div>

        {joinCard && <CommunityJoinCard data={joinCard} csrfToken={csrfToken} />}

        <div>
          <h2 class="text-sm font-bold text-gray-500 mb-2">{t('community.hub.yourRooms')}</h2>
          {cohorts.length === 0 ? (
            <p class="rounded-2xl bg-white border border-papaya-300/40 px-4 py-6 text-sm text-gray-400 text-center">
              {t('community.hub.empty')}
            </p>
          ) : (
            <ul class="space-y-2">
              {cohorts.map((co) => (
                <li>
                  <a
                    href={`/community/c/${co.cohort_key}`}
                    class="flex items-center justify-between gap-3 rounded-2xl bg-white border border-papaya-300/40 px-4 py-3 hover:border-horizon-300 transition-colors"
                  >
                    <span class="font-bold text-gray-800">{labelFor(co)}</span>
                    <span class="text-[11px] text-gray-400">{tp('community.room.members', co.member_count)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {vendorJoin && (
          <VendorJoinPanel
            businessName={vendorJoin.businessName}
            csrfToken={csrfToken}
            years={vendorJoin.years}
            defaultYear={vendorJoin.defaultYear}
          />
        )}
      </div>
    </CommunityLayout>
  )
}

// ─── Room ───

function StateChips({
  cohort,
  subdivisions,
  activeState,
}: {
  cohort: CommunityCohort
  subdivisions: { code: string; label: string }[]
  activeState: string | null
}) {
  if (subdivisions.length === 0) return null
  const base = `/community/c/${cohort.cohort_key}`
  const chip = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
      active ? 'bg-horizon-600 text-white border-horizon-600' : 'bg-white text-gray-600 border-gray-200 hover:border-horizon-300'
    }`
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-[11px] font-bold text-gray-400">{t('community.room.filterHint')}</span>
      <a href={base} class={chip(!activeState)}>
        {t('community.room.allAreas')}
      </a>
      {subdivisions.map((s) => (
        <a href={`${base}?state=${encodeURIComponent(s.code)}`} class={chip(activeState === s.code)}>
          {s.label}
        </a>
      ))}
    </div>
  )
}

function ThreadComposer({ cohort, error, draftTitle, draftBody }: { cohort: CommunityCohort; error?: string; draftTitle?: string; draftBody?: string }) {
  return (
    <form
      hx-post={`/community/c/${cohort.cohort_key}/threads`}
      hx-target="#community-room-body"
      hx-swap="innerHTML"
      hx-disabled-elt="find button"
      class="rounded-2xl bg-white border border-papaya-300/40 p-4 space-y-2"
    >
      <input
        type="text"
        name="title"
        required
        maxlength={140}
        value={draftTitle ?? ''}
        placeholder={t('community.thread.titlePlaceholder')}
        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600"
      />
      <textarea
        name="body"
        rows={3}
        placeholder={t('community.thread.bodyPlaceholder')}
        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 resize-y"
      >
        {draftBody ?? ''}
      </textarea>
      {error && <p class="text-xs text-red-600">{error}</p>}
      <div class="flex justify-end">
        <button
          type="submit"
          class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors"
        >
          {t('community.room.newThread')}
        </button>
      </div>
    </form>
  )
}

function JoinBanner({ cohort, csrfToken }: { cohort: CommunityCohort; csrfToken: string }) {
  return (
    <form method="post" action="/community/join" class="rounded-2xl bg-horizon-50 border border-horizon-200 p-4 flex items-center justify-between gap-3 flex-wrap">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="cohort_key" value={cohort.cohort_key} />
      <p class="text-sm text-gray-700">{t('community.room.joinPrompt')}</p>
      <button
        type="submit"
        class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
      >
        {t('community.join.confirm')}
      </button>
    </form>
  )
}

function ThreadRow({ thread, cohort }: { thread: CommunityThreadRow; cohort: CommunityCohort }) {
  return (
    <li>
      <a
        href={`/community/t/${thread.id}`}
        class="block rounded-2xl bg-white border border-papaya-300/40 px-4 py-3 hover:border-horizon-300 transition-colors"
      >
        <div class="flex items-start justify-between gap-3">
          <span class="font-bold text-gray-800">{thread.title}</span>
          {thread.subdivision_label && (
            <span class="shrink-0 text-[10px] font-bold text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              {thread.subdivision_label}
            </span>
          )}
        </div>
        <p class="text-[11px] text-gray-400 mt-1">
          {thread.author_display_name ?? '—'}
          {thread.author_role === 'vendor' && (
            <span class="ml-1 text-grapefruit-700 font-bold">· {t('community.badge.vendor')}</span>
          )}
          {' · '}
          {tp('community.thread.replies', thread.reply_count)}
          {thread.last_reply_at && ' · ' + formatDateTime(thread.last_reply_at)}
        </p>
      </a>
    </li>
  )
}

export function ThreadList({
  threads,
  cohort,
  activeState,
}: {
  threads: CommunityThreadRow[]
  cohort: CommunityCohort
  activeState: { label: string } | null
}) {
  if (threads.length === 0) {
    return (
      <p class="rounded-2xl bg-white border border-papaya-300/40 px-4 py-6 text-sm text-gray-400 text-center">
        {activeState ? t('community.room.emptyFiltered', { state: activeState.label }) : t('community.room.empty')}
      </p>
    )
  }
  return (
    <ul class="space-y-2">
      {threads.map((thread) => (
        <ThreadRow thread={thread} cohort={cohort} />
      ))}
    </ul>
  )
}

/** The htmx-swappable region inside the room: composer (members) + thread list. */
export function RoomBody({
  cohort,
  isMember,
  csrfToken,
  threads,
  activeState,
  error,
  draftTitle,
  draftBody,
}: {
  cohort: CommunityCohort
  isMember: boolean
  csrfToken: string
  threads: CommunityThreadRow[]
  activeState: { label: string } | null
  error?: string
  draftTitle?: string
  draftBody?: string
}) {
  return (
    <div class="space-y-3">
      {isMember ? (
        <ThreadComposer cohort={cohort} error={error} draftTitle={draftTitle} draftBody={draftBody} />
      ) : (
        <JoinBanner cohort={cohort} csrfToken={csrfToken} />
      )}
      <ThreadList threads={threads} cohort={cohort} activeState={activeState} />
    </div>
  )
}

export function CommunityRoom({
  user,
  csrfToken,
  cohort,
  member,
  threads,
  subdivisions,
  activeState,
}: {
  user: User
  csrfToken: string
  cohort: CommunityCohort
  member: CommunityMember | null
  threads: CommunityThreadRow[]
  subdivisions: { code: string; label: string }[]
  activeState: { code: string; label: string } | null
}) {
  const label = labelFor(cohort)
  return (
    <CommunityLayout title={label} user={user} csrfToken={csrfToken}>
      <div class="space-y-4">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <a href="/community" class="text-[11px] font-bold text-gray-400 hover:text-gray-600">
              ← {t('community.title')}
            </a>
            <h1 class="text-2xl font-bold">{label}</h1>
            <p class="text-[11px] text-gray-400">{tp('community.room.members', cohort.member_count)}</p>
          </div>
          {member && (
            <form
              method="post"
              action={`/community/leave/${cohort.id}`}
              onsubmit={`return confirm(${JSON.stringify(t('community.room.leaveConfirm'))})`}
              class="m-0"
            >
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button
                type="submit"
                class="text-xs font-bold text-gray-400 hover:text-red-600 bg-transparent border-0 cursor-pointer p-0"
              >
                {t('community.room.leave')}
              </button>
            </form>
          )}
        </div>

        <StateChips cohort={cohort} subdivisions={subdivisions} activeState={activeState?.code ?? null} />

        <div id="community-room-body">
          <RoomBody
            cohort={cohort}
            isMember={!!member}
            csrfToken={csrfToken}
            threads={threads}
            activeState={activeState}
          />
        </div>

        <p class="text-[10px] text-gray-400">{t('community.privacy.note')}</p>
      </div>
    </CommunityLayout>
  )
}

// ─── Thread + posts ───

function VendorBadge({ post }: { post: CommunityPost }) {
  if (post.author_role !== 'vendor' || !post.author_vendor_business_name) return null
  const inner = (
    <span class="inline-flex items-center gap-1 text-[10px] font-bold text-grapefruit-700 bg-papaya-100 rounded-full px-2 py-0.5">
      {t('community.badge.vendor')} · {post.author_vendor_business_name}
      {post.author_vendor_type_label ? ` · ${post.author_vendor_type_label}` : ''}
    </span>
  )
  return post.author_vendor_profile_id ? (
    <a href={`/directory?v=${post.author_vendor_profile_id}`} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    inner
  )
}

export function PostItem({
  post,
  canEdit,
  canReport,
  csrfToken,
}: {
  post: CommunityPost
  canEdit: boolean
  canReport: boolean
  csrfToken: string
}) {
  return (
    <article id={`post-${post.id}`} class="rounded-2xl bg-white border border-papaya-300/40 p-4">
      <div class="flex items-center justify-between gap-3 mb-2">
        <div class="flex items-center gap-2 flex-wrap min-w-0">
          <span class="text-sm font-bold text-gray-800 truncate">{post.author_display_name}</span>
          <VendorBadge post={post} />
          <span class="text-[10px] text-gray-400">{formatDateTime(post.created_at)}</span>
          {post.edited_at && <span class="text-[10px] text-gray-300">· {t('community.post.edited')}</span>}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {canEdit && (
            <button
              type="button"
              hx-get={`/community/p/${post.id}/edit`}
              hx-target={`#post-${post.id}`}
              hx-swap="outerHTML"
              class="text-[11px] font-bold text-gray-400 hover:text-horizon-700 bg-transparent border-0 cursor-pointer p-0"
            >
              {t('community.post.edit')}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              hx-post={`/community/p/${post.id}/delete`}
              hx-target={`#post-${post.id}`}
              hx-swap="outerHTML"
              hx-confirm={t('community.post.deleteConfirm')}
              class="text-[11px] font-bold text-gray-400 hover:text-red-600 bg-transparent border-0 cursor-pointer p-0"
            >
              {t('community.post.delete')}
            </button>
          )}
          {canReport && (
            <button
              type="button"
              hx-post={`/community/p/${post.id}/report`}
              hx-target={`#post-${post.id}-report`}
              hx-swap="outerHTML"
              class="text-[11px] font-bold text-gray-300 hover:text-gray-600 bg-transparent border-0 cursor-pointer p-0"
            >
              <span id={`post-${post.id}-report`}>{t('community.post.report')}</span>
            </button>
          )}
        </div>
      </div>
      <div class="community-md md-preview text-sm text-gray-700 leading-relaxed">{post.body}</div>
    </article>
  )
}

/** Inline editor returned by GET /community/p/:id/edit (swaps the PostItem). */
export function PostEditForm({ post, token, notice, csrfToken }: { post: CommunityPost; token: string; notice?: string; csrfToken: string }) {
  return (
    <article id={`post-${post.id}`} class="rounded-2xl bg-white border border-horizon-300 p-4">
      <form hx-post={`/community/p/${post.id}/edit`} hx-target={`#post-${post.id}`} hx-swap="outerHTML" class="space-y-2">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="token" value={token} />
        <textarea
          name="body"
          rows={4}
          class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 resize-y"
        >
          {post.body}
        </textarea>
        {notice && <p class="text-xs text-amber-600">{notice}</p>}
        <div class="flex justify-end gap-2">
          <button
            type="button"
            hx-get={`/community/p/${post.id}`}
            hx-target={`#post-${post.id}`}
            hx-swap="outerHTML"
            class="text-[11px] font-bold text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer px-2"
          >
            {t('community.post.cancel')}
          </button>
          <button
            type="submit"
            class="bg-horizon-600 text-white px-4 py-1.5 rounded-xl text-[11px] font-bold hover:bg-horizon-700 transition-colors"
          >
            {t('community.post.save')}
          </button>
        </div>
      </form>
    </article>
  )
}

export function CommunityThreadView({
  user,
  csrfToken,
  cohort,
  thread,
  posts,
  isMember,
  currentUserId,
}: {
  user: User
  csrfToken: string
  cohort: CommunityCohort
  thread: { id: string; title: string; is_locked: number }
  posts: CommunityPost[]
  isMember: boolean
  currentUserId: string
}) {
  const label = labelFor(cohort)
  return (
    <CommunityLayout title={thread.title} user={user} csrfToken={csrfToken}>
      <div class="space-y-4">
        <a href={`/community/c/${cohort.cohort_key}`} class="text-[11px] font-bold text-gray-400 hover:text-gray-600">
          ← {t('community.thread.back', { label })}
        </a>
        <h1 class="text-2xl font-bold">{thread.title}</h1>

        <div id="community-posts" class="space-y-3">
          {posts.map((post) => (
            <PostItem
              post={post}
              canEdit={isMember && post.author_user_id === currentUserId}
              canReport={isMember && post.author_user_id !== currentUserId}
              csrfToken={csrfToken}
            />
          ))}
        </div>

        {isMember && thread.is_locked !== 1 ? (
          <form
            hx-post={`/community/t/${thread.id}/replies`}
            hx-target="#community-posts"
            hx-swap="beforeend"
            class="rounded-2xl bg-white border border-papaya-300/40 p-4 space-y-2"
          >
            <textarea
              name="body"
              rows={3}
              required
              placeholder={t('community.reply.placeholder')}
              class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-horizon-600 resize-y"
            ></textarea>
            <div class="flex justify-end">
              <button
                type="submit"
                class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors"
              >
                {t('community.reply.send')}
              </button>
            </div>
          </form>
        ) : thread.is_locked === 1 ? (
          <p class="text-xs text-gray-400">{t('community.thread.locked')}</p>
        ) : (
          <p class="text-xs text-gray-400">{t('community.room.joinPrompt')}</p>
        )}
      </div>
    </CommunityLayout>
  )
}
