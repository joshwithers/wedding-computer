// The unified wedding timeline / run sheet UI.
//
// <WeddingTimeline> is the section; <TimelineBody id="timeline-body"> is the
// htmx-swappable region (flash + pending changes + add form + category lanes).
// Editing model: the timeline LEAD edits shared rows directly; everyone else
// proposes changes that surface as pending diff cards the lead approves (with
// edit-then-approve) or declines. Both layouts set hx-headers (CSRF), so htmx
// requests are authenticated on the vendor and couple pages alike.

import { t } from '../i18n'
import type { MessageKey } from '../i18n'
import { TIMELINE_CATEGORIES, type TimelineCategory, type TimelineVisibility } from '../types'
import type { TimelineItemView, AssigneeView, RosterEntry } from '../db/timeline'
import type { RowFields } from '../services/timeline-approval'
import {
  canEditOrPropose,
  canEditDirect,
  canManageAssignees,
  type TimelineViewer,
  type TimelineLead,
  type TimelineLeadSource,
} from '../services/timeline-permissions'

const CAT_COLOR: Record<TimelineCategory, string> = {
  getting_ready: '#a78bfa',
  ceremony: '#fb7185',
  portraits: '#fbbf24',
  reception: '#34d399',
  other: '#9ca3af',
}

const VIS_LABEL: Record<TimelineVisibility, MessageKey> = {
  couple: 'timeline.vis.couple',
  vendors: 'timeline.vis.vendors',
  private: 'timeline.vis.private',
}

const catLabel = (c: TimelineCategory): string => t(`timeline.cat.${c}` as MessageKey)

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
}

export type PendingView = {
  id: string
  op: 'create' | 'update' | 'delete'
  summary: string
  requester: string
  diff: { label: string; before: string; after: string }[]
  after: Partial<RowFields>
  isOwn: boolean
}

export type TimelineProps = {
  items: TimelineItemView[]
  roster: RosterEntry[]
  basePath: string
  viewer: TimelineViewer
  lead: TimelineLead
  leadLabel: string
  creatable: TimelineVisibility[]
  pending: PendingView[]
  canDecide: boolean
  editId?: string
  flash?: string
  // Sunrise / golden-hour / sunset for the wedding's date + location, already
  // localized to the wedding's timezone. Null when we lack coordinates or a date.
  sun?: { sunrise: string | null; sunset: string | null; goldenHourStart: string | null; timezone: string } | null
  // Ids of rows whose anchor couldn't be resolved (cycle / dangling reference).
  conflictIds?: Set<string>
  // Live mode (the day itself): projected times from actual starts, sections
  // whose projected end slips past sunset, and the running schedule drift (min;
  // + = behind). Present only once a section has been marked started.
  live?: {
    projected: Map<string, { start: string | null; end: string | null }>
    slipIds: Set<string>
    drift: number
  }
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) return <img src={url} alt="" referrerpolicy="no-referrer" class="w-5 h-5 rounded-full object-cover bg-gray-100" />
  return (
    <span class="w-5 h-5 rounded-full bg-papaya-200 text-grapefruit-700 text-[9px] font-bold flex items-center justify-center">
      {initials(name)}
    </span>
  )
}

function AssigneeChip({ a, basePath, itemId, editable, viewerUserId }: { a: AssigneeView; basePath: string; itemId: string; editable: boolean; viewerUserId: string }) {
  const isMe = a.userId != null && a.userId === viewerUserId
  return (
    <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 pl-1 pr-2 py-0.5 text-[11px] text-gray-700">
      <Avatar name={a.displayName} url={a.avatarUrl} />
      {a.displayName}
      {isMe && (
        <button
          type="button"
          hx-post={`${basePath}/timeline/${itemId}/assignees/${a.id}/calendar`}
          hx-target="#timeline-body"
          hx-swap="outerHTML"
          title={a.addedToCalendar ? t('timeline.inCalendar') : t('timeline.addToCalendar')}
          aria-label={a.addedToCalendar ? t('timeline.inCalendar') : t('timeline.addToCalendar')}
          class={`ml-0.5 ${a.addedToCalendar ? 'text-horizon-700' : 'text-gray-400 hover:text-horizon-700'}`}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill={a.addedToCalendar ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
        </button>
      )}
      {editable && (
        <button type="button" hx-post={`${basePath}/timeline/${itemId}/assignees/${a.id}/remove`} hx-target="#timeline-body" hx-swap="outerHTML" class="text-gray-400 hover:text-red-600 ml-0.5" aria-label={t('timeline.remove')}>×</button>
      )}
    </span>
  )
}

function AddPersonForm({ basePath, itemId, roster }: { basePath: string; itemId: string; roster: RosterEntry[] }) {
  const listId = `roster-${itemId}`
  return (
    <form hx-post={`${basePath}/timeline/${itemId}/assignees`} hx-target="#timeline-body" hx-swap="outerHTML" hx-on--after-request="this.reset()" class="inline-flex items-center gap-1">
      <input type="text" name="who" list={listId} placeholder={t('timeline.personPlaceholder')} class="w-32 border border-gray-200 rounded-full px-2 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-horizon-600 bg-white" />
      <datalist id={listId}>
        {roster.map((r) => <option value={r.name}>{r.subtitle ? `${r.name} — ${r.subtitle}` : r.name}</option>)}
      </datalist>
      <button type="submit" class="text-[11px] font-bold text-horizon-700 hover:underline">+</button>
    </form>
  )
}

type AnchorOption = { id: string; title: string }

function FormFields({
  values,
  creatable,
  anchorOptions = [],
  sunAvailable = false,
}: {
  values?: Partial<RowFields>
  creatable: TimelineVisibility[]
  anchorOptions?: AnchorOption[]
  sunAvailable?: boolean
}) {
  const fieldCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 bg-white'
  const at = values?.anchor_type
  const off = values?.anchor_offset_minutes ?? 0
  const hasAnchor = at === 'after' || at === 'before' || at === 'sun'
  // Reconstruct the encoded <select> value for an existing item.
  const cur =
    at === 'after' ? `after:${values?.anchor_ref ?? ''}`
    : at === 'before' ? `before:${values?.anchor_ref ?? ''}`
    : at === 'sun' ? `${off < 0 ? 'sunbefore' : 'sunafter'}:${values?.anchor_ref ?? ''}`
    : ''
  return (
    <div class="grid grid-cols-2 gap-2">
      <input type="text" name="title" required value={values?.title ?? ''} placeholder={t('timeline.field.titlePlaceholder')} class="col-span-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 bg-white" />
      <label class="text-[10px] text-gray-400 flex flex-col gap-0.5">
        {t('timeline.field.start')}
        <input type="time" name="start_time" value={values?.start_time ?? ''} class={fieldCls} />
      </label>
      <label class="text-[10px] text-gray-400 flex flex-col gap-0.5">
        {t('timeline.field.end')}
        <input type="time" name="end_time" value={values?.end_time ?? ''} class={fieldCls} />
      </label>
      <input type="text" name="location" value={values?.location ?? ''} placeholder={t('timeline.field.locationPlaceholder')} class="col-span-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 bg-white" />
      <label class="text-[10px] text-gray-400 flex flex-col gap-0.5">
        {t('timeline.field.category')}
        <select name="category" class={fieldCls}>
          {TIMELINE_CATEGORIES.map((c) => <option value={c} selected={values?.category === c}>{catLabel(c)}</option>)}
        </select>
      </label>
      <label class="text-[10px] text-gray-400 flex flex-col gap-0.5">
        {t('timeline.field.visibility')}
        <select name="visibility" class={fieldCls}>
          {creatable.map((v) => <option value={v} selected={(values?.visibility ?? 'couple') === v}>{t(VIS_LABEL[v])}</option>)}
        </select>
      </label>
      <textarea name="description" placeholder={t('timeline.field.details')} rows={2} class="col-span-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 bg-white resize-y">{values?.description ?? ''}</textarea>

      {/* Liquid timing: duration + relative anchoring (item or sun event). */}
      <details class="col-span-2" open={hasAnchor || values?.duration_minutes != null}>
        <summary class="text-[10px] text-gray-400 cursor-pointer select-none">{t('timeline.field.liquid')}</summary>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <label class="text-[10px] text-gray-400 flex flex-col gap-0.5">
            {t('timeline.field.duration')}
            <input type="number" name="duration_minutes" min="0" step="5" value={values?.duration_minutes ?? ''} placeholder="—" class={fieldCls} />
          </label>
          <label class="text-[10px] text-gray-400 flex flex-col gap-0.5">
            {t('timeline.field.offset')}
            <input type="number" name="anchor_offset" min="0" step="5" value={hasAnchor && off ? Math.abs(off) : ''} placeholder="0" class={fieldCls} />
          </label>
          <label class="text-[10px] text-gray-400 flex flex-col gap-0.5 col-span-2">
            {t('timeline.field.startRel')}
            <select name="anchor" class={fieldCls}>
              <option value="" selected={!hasAnchor}>{t('timeline.anchor.none')}</option>
              {anchorOptions.length > 0 && (
                <optgroup label={t('timeline.anchor.afterGroup')}>
                  {anchorOptions.map((o) => <option value={`after:${o.id}`} selected={cur === `after:${o.id}`}>{o.title}</option>)}
                </optgroup>
              )}
              {anchorOptions.length > 0 && (
                <optgroup label={t('timeline.anchor.beforeGroup')}>
                  {anchorOptions.map((o) => <option value={`before:${o.id}`} selected={cur === `before:${o.id}`}>{o.title}</option>)}
                </optgroup>
              )}
              {sunAvailable && (
                <optgroup label={t('timeline.anchor.sunGroup')}>
                  <option value="sunbefore:sunset" selected={cur === 'sunbefore:sunset'}>{t('timeline.anchor.beforeSunset')}</option>
                  <option value="sunafter:sunset" selected={cur === 'sunafter:sunset'}>{t('timeline.anchor.afterSunset')}</option>
                  <option value="sunbefore:golden_hour" selected={cur === 'sunbefore:golden_hour'}>{t('timeline.anchor.beforeGolden')}</option>
                  <option value="sunbefore:sunrise" selected={cur === 'sunbefore:sunrise'}>{t('timeline.anchor.beforeSunrise')}</option>
                  <option value="sunafter:sunrise" selected={cur === 'sunafter:sunrise'}>{t('timeline.anchor.afterSunrise')}</option>
                </optgroup>
              )}
            </select>
          </label>
        </div>
      </details>
    </div>
  )
}

function RowForm({ item, basePath, creatable, anchorOptions, sunAvailable }: { item: TimelineItemView; basePath: string; creatable: TimelineVisibility[]; anchorOptions: AnchorOption[]; sunAvailable: boolean }) {
  return (
    <li id={`trow-${item.id}`} class="px-4 py-3 bg-horizon-50/40">
      <form hx-post={`${basePath}/timeline/${item.id}`} hx-target="#timeline-body" hx-swap="outerHTML" class="space-y-2">
        <FormFields values={item} creatable={creatable.length ? creatable : [item.visibility]} anchorOptions={anchorOptions.filter((o) => o.id !== item.id)} sunAvailable={sunAvailable} />
        <div class="flex items-center gap-2">
          <button type="submit" class="bg-horizon-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-horizon-700">{t('timeline.save')}</button>
          <button type="button" hx-get={`${basePath}/timeline`} hx-target="#timeline-body" hx-swap="outerHTML" class="text-xs text-gray-400 hover:text-gray-600">{t('timeline.cancel')}</button>
        </div>
      </form>
    </li>
  )
}

function Row({ item, basePath, roster, canEdit, canAssign, viewerUserId, refTitle, conflicted, liveMode, projected, slipped, canStart }: { item: TimelineItemView; basePath: string; roster: RosterEntry[]; canEdit: boolean; canAssign: boolean; viewerUserId: string; refTitle?: string; conflicted?: boolean; liveMode?: boolean; projected?: { start: string | null; end: string | null }; slipped?: boolean; canStart?: boolean }) {
  const started = item.actual_start
  // In live mode, show the actual start once started, else the projected time.
  const useProj = !!(liveMode && projected && !started)
  const topTime = started || (useProj ? projected?.start ?? '' : item.start_time ?? '')
  const botTime = started ? '' : useProj ? projected?.end ?? '' : item.end_time ?? ''
  const shifted = useProj && !!projected?.start && projected.start !== item.start_time
  const relative = (item.anchor_type === 'after' || item.anchor_type === 'before') && refTitle
  const off = item.anchor_offset_minutes
  return (
    <li id={`trow-${item.id}`} class={`flex items-start gap-3 px-4 py-3 ${started ? 'bg-horizon-50/30' : ''}`}>
      <div class="w-14 flex-shrink-0 pt-0.5 text-xs tabular-nums leading-tight">
        <div class={`font-bold ${started ? 'text-horizon-700' : 'text-gray-500'}`}>{topTime || '—'}</div>
        {botTime && <div class="font-normal text-gray-400">{botTime}</div>}
        {shifted && <div class="text-[9px] font-normal text-gray-300 line-through">{item.start_time}</div>}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-bold text-gray-800">{item.title}</span>
          {item.slot && <span class="text-[9px] font-bold uppercase tracking-wide text-grapefruit-700 bg-papaya-100 rounded px-1 py-0.5">{t('timeline.keyMoment')}</span>}
          {started && <span class="text-[9px] text-horizon-700 bg-horizon-50 rounded px-1 py-0.5">✓ {t('timeline.started', { time: started })}</span>}
          {slipped && <span class="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5" title={t('timeline.pastSunset')}>🌇 {t('timeline.pastSunset')}</span>}
          {conflicted && <span class="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5" title={t('timeline.conflict')}>⚠️ {t('timeline.conflict')}</span>}
          {item.visibility !== 'couple' && <span class="text-[9px] text-gray-400 border border-gray-200 rounded px-1 py-0.5">{t(VIS_LABEL[item.visibility])}</span>}
        </div>
        {relative && (
          <p class="text-[10px] text-horizon-700">
            ↳ {t(`timeline.rel.${item.anchor_type}` as MessageKey, { name: refTitle! })}
            {off ? ` ${off > 0 ? '+' : '−'}${Math.abs(off)}m` : ''}
            {item.duration_minutes != null ? ` · ${item.duration_minutes}m` : ''}
          </p>
        )}
        {item.location && <p class="text-[11px] text-gray-400">{item.location}</p>}
        {item.description && <p class="text-[11px] text-gray-500 mt-0.5 whitespace-pre-wrap">{item.description}</p>}
        <div class="flex items-center gap-1.5 flex-wrap mt-1.5">
          {item.assignees.map((a) => <AssigneeChip a={a} basePath={basePath} itemId={item.id} editable={canAssign} viewerUserId={viewerUserId} />)}
          {canAssign && <AddPersonForm basePath={basePath} itemId={item.id} roster={roster} />}
        </div>
      </div>
      {canEdit && (
        <div class="flex items-center gap-1 flex-shrink-0">
          {canStart &&
            (started ? (
              <button type="button" hx-post={`${basePath}/timeline/${item.id}/unstart`} hx-target="#timeline-body" hx-swap="outerHTML" class="p-1.5 rounded-lg text-gray-300 hover:text-grapefruit-700 hover:bg-gray-100" aria-label={t('timeline.unstart')} title={t('timeline.unstart')}>↺</button>
            ) : (
              <button type="button" hx-post={`${basePath}/timeline/${item.id}/start`} hx-target="#timeline-body" hx-swap="outerHTML" class="text-[10px] font-bold text-horizon-700 border border-horizon-200 rounded px-1.5 py-1 hover:bg-horizon-50 whitespace-nowrap" title={t('timeline.startNow')}>{t('timeline.start')}</button>
            ))}
          <button type="button" hx-get={`${basePath}/timeline/${item.id}/edit`} hx-target="#timeline-body" hx-swap="outerHTML" class="p-1.5 rounded-lg text-gray-400 hover:text-horizon-700 hover:bg-gray-100" aria-label={t('timeline.edit')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L18 10l-4-4L4 16v4z" /><path d="M14 6l4 4" /></svg>
          </button>
          <button type="button" hx-post={`${basePath}/timeline/${item.id}/delete`} hx-target="#timeline-body" hx-swap="outerHTML" hx-confirm={t('timeline.confirmRemove')} class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-gray-100" aria-label={t('timeline.remove')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
    </li>
  )
}

function PendingCard({ p, basePath, canDecide, creatable, anchorOptions, sunAvailable }: { p: PendingView; basePath: string; canDecide: boolean; creatable: TimelineVisibility[]; anchorOptions: AnchorOption[]; sunAvailable: boolean }) {
  const opLabel = t(`timeline.op.${p.op}` as MessageKey)
  return (
    <div class="px-4 py-3 border-b border-amber-100 bg-amber-50/60">
      <div class="flex items-center gap-2 text-[11px]">
        <span class="font-bold uppercase tracking-wide text-amber-700">{opLabel}</span>
        <span class="font-bold text-gray-700">{p.summary}</span>
      </div>
      <p class="text-[10px] text-gray-400">{t('timeline.requestedBy', { name: p.requester })}</p>
      {p.op === 'update' && p.diff.length > 0 && (
        <ul class="mt-1 text-[11px] text-gray-600 space-y-0.5">
          {p.diff.map((d) => (
            <li><span class="text-gray-400">{d.label}:</span> <span class="line-through text-gray-400">{d.before}</span> → <span class="font-medium">{d.after}</span></li>
          ))}
        </ul>
      )}
      {canDecide ? (
        p.op === 'delete' ? (
          <div class="flex items-center gap-2 mt-2">
            <button type="button" hx-post={`${basePath}/timeline/requests/${p.id}/approve`} hx-target="#timeline-body" hx-swap="outerHTML" class="bg-horizon-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-horizon-700">{t('timeline.approve')}</button>
            <button type="button" hx-post={`${basePath}/timeline/requests/${p.id}/decline`} hx-target="#timeline-body" hx-swap="outerHTML" class="text-xs text-gray-500 hover:text-red-600">{t('timeline.decline')}</button>
          </div>
        ) : (
          <form hx-post={`${basePath}/timeline/requests/${p.id}/approve`} hx-target="#timeline-body" hx-swap="outerHTML" class="mt-2 space-y-2">
            <FormFields values={p.after} creatable={creatable.length ? creatable : ['couple', 'vendors', 'private']} anchorOptions={anchorOptions} sunAvailable={sunAvailable} />
            <div class="flex items-center gap-2">
              <button type="submit" class="bg-horizon-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-horizon-700">{t('timeline.approve')}</button>
              <button type="button" hx-post={`${basePath}/timeline/requests/${p.id}/decline`} hx-target="#timeline-body" hx-swap="outerHTML" class="text-xs text-gray-500 hover:text-red-600">{t('timeline.decline')}</button>
            </div>
          </form>
        )
      ) : (
        <p class="text-[10px] text-amber-700 mt-1">{t('timeline.awaiting')}</p>
      )}
    </div>
  )
}

export function TimelineBody(props: TimelineProps) {
  const { items, basePath, roster, viewer, lead, creatable, editId, pending, canDecide, flash } = props
  const anchorOptions: AnchorOption[] = items.map((i) => ({ id: i.id, title: i.title }))
  const titleById = new Map(items.map((i) => [i.id, i.title]))
  const sunAvailable = !!(props.sun && (props.sun.sunset || props.sun.sunrise || props.sun.goldenHourStart))
  return (
    <div id="timeline-body">
      {flash && <p class="px-4 py-2 text-xs text-horizon-700 bg-horizon-50 border-b border-horizon-100">{flash}</p>}

      {props.live && (
        <div class={`px-4 py-2 text-xs font-bold border-b flex items-center gap-2 ${props.live.drift > 0 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-horizon-50 text-horizon-700 border-horizon-100'}`}>
          <span class="inline-block w-2 h-2 rounded-full bg-grapefruit-600 animate-pulse"></span>
          {t('timeline.live')}
          <span class="font-normal">
            ·{' '}
            {props.live.drift > 0
              ? t('timeline.behind', { n: props.live.drift })
              : props.live.drift < 0
                ? t('timeline.ahead', { n: -props.live.drift })
                : t('timeline.onSchedule')}
          </span>
          {canDecide && (
            <button type="button" hx-post={`${basePath}/timeline/end-live`} hx-target="#timeline-body" hx-swap="outerHTML" hx-confirm={t('timeline.endLiveConfirm')} class="ml-auto text-[10px] font-bold text-gray-400 hover:text-grapefruit-700 underline">{t('timeline.endLive')}</button>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div class="border-b border-amber-200">
          <div class="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">{t('timeline.pendingHeading')}</div>
          {pending.map((p) => <PendingCard p={p} basePath={basePath} canDecide={canDecide} creatable={creatable} anchorOptions={anchorOptions} sunAvailable={sunAvailable} />)}
        </div>
      )}

      <form hx-post={`${basePath}/timeline`} hx-target="#timeline-body" hx-swap="outerHTML" hx-on--after-request="this.reset()" class="px-4 py-3 border-b border-gray-100 space-y-2 bg-gray-50/50">
        <FormFields creatable={creatable} anchorOptions={anchorOptions} sunAvailable={sunAvailable} />
        <button type="submit" class="bg-horizon-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-horizon-700">{t('timeline.add')}</button>
      </form>

      {items.length === 0 ? (
        <p class="px-4 py-6 text-sm text-gray-400 text-center">{t('timeline.empty')}</p>
      ) : (
        <div>
          {TIMELINE_CATEGORIES.map((cat) => {
            const rows = items.filter((i) => i.category === cat)
            if (rows.length === 0) return null
            return (
              <div>
                <div class="flex items-center gap-2 px-4 pt-3 pb-1">
                  <span class="w-2 h-2 rounded-full" style={`background:${CAT_COLOR[cat]}`}></span>
                  <span class="text-[10px] font-bold uppercase tracking-wide text-gray-400">{catLabel(cat)}</span>
                </div>
                <ul class="divide-y divide-gray-50">
                  {rows.map((item) =>
                    item.id === editId ? (
                      <RowForm item={item} basePath={basePath} creatable={creatable} anchorOptions={anchorOptions} sunAvailable={sunAvailable} />
                    ) : (
                      <Row item={item} basePath={basePath} roster={roster} canEdit={canEditOrPropose(item, viewer, lead)} canAssign={canManageAssignees(item, viewer, lead)} viewerUserId={viewer.userId} refTitle={item.anchor_ref ? titleById.get(item.anchor_ref) : undefined} conflicted={props.conflictIds?.has(item.id)} liveMode={!!props.live} projected={props.live?.projected.get(item.id)} slipped={props.live?.slipIds.has(item.id)} canStart={canEditDirect(item, viewer, lead)} />
                    )
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const LEAD_HINT: Record<TimelineLeadSource, MessageKey | null> = {
  planner_venue: null,
  couple: 'timeline.managedByCoupleHint',
  vendor_fallback: 'timeline.managedByVendorHint',
}

function DaylightStrip({ sun }: { sun: NonNullable<TimelineProps['sun']> }) {
  const parts: any[] = []
  if (sun.sunrise) parts.push(<span>🌅 {t('timeline.sun.sunrise')} <strong class="text-gray-600 tabular-nums">{sun.sunrise}</strong></span>)
  if (sun.goldenHourStart) parts.push(<span>✨ {t('timeline.sun.goldenHour')} <strong class="text-gray-600 tabular-nums">{sun.goldenHourStart}</strong></span>)
  if (sun.sunset) parts.push(<span>🌇 {t('timeline.sun.sunset')} <strong class="text-gray-600 tabular-nums">{sun.sunset}</strong></span>)
  if (parts.length === 0) return null
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 bg-papaya-50 border-b border-papaya-300/30 text-[11px] text-gray-500">
      {parts}
    </div>
  )
}

export function WeddingTimeline(props: TimelineProps) {
  const hintKey = LEAD_HINT[props.lead.source]
  return (
    <div class="mt-6" id="timeline">
      <div class="rounded-2xl overflow-hidden bg-white border border-papaya-300/30">
        <div class="px-5 py-3 border-b border-papaya-300/30">
          <h3 class="text-sm font-bold text-gray-500">{t('timeline.heading')}</h3>
          <p class="text-[10px] text-gray-400">{t('timeline.subhead')}</p>
          <p class="text-[10px] text-grapefruit-700 mt-1">
            {t('timeline.managedBy', { name: props.leadLabel })}
            {hintKey && <span class="text-gray-400"> · {t(hintKey, { name: props.leadLabel })}</span>}
          </p>
        </div>
        {props.sun && <DaylightStrip sun={props.sun} />}
        <TimelineBody {...props} />
      </div>
    </div>
  )
}
