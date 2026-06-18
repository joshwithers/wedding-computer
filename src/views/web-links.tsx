// Web links on a wedding — galleries, Pinterest boards, playlists, etc.
//
// <WebLinks> is the section (heading + the swappable region). <WebLinkList> is
// the htmx-swappable region: the add form plus the rows. Every add/pin/remove
// returns a fresh <WebLinkList>, so the input clears itself naturally. Both the
// vendor (AppLayout) and couple (CoupleLayout) pages set hx-headers with the
// CSRF token on <body>, so htmx requests are authenticated.

import { t } from '../i18n'
import type { WebLink } from '../types'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M16 3l5 5-3 1-3 3-1 5-2-2-4 4-1-1 4-4-2-2 5-1 3-3z" />
    </svg>
  )
}

function LinkRow({
  link,
  basePath,
  canDelete,
}: {
  link: WebLink
  basePath: string
  canDelete: boolean
}) {
  const pinned = link.pinned === 1
  const target = '#weblinks-list'
  return (
    <li class={`flex items-start gap-3 px-4 py-3 ${pinned ? 'bg-horizon-50/60' : ''}`}>
      {link.image_url ? (
        <img
          src={link.image_url}
          alt=""
          referrerpolicy="no-referrer"
          class="w-12 h-12 rounded-lg object-cover bg-gray-100 flex-shrink-0"
        />
      ) : (
        <div class="w-12 h-12 rounded-lg bg-papaya-100 text-grapefruit-700 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" />
            <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
          </svg>
        </div>
      )}

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          {pinned && (
            <span class="inline-flex items-center gap-1 text-[10px] font-bold text-horizon-700">
              <PinIcon />
              {t('links.pinned')}
            </span>
          )}
        </div>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          class="block text-sm font-bold text-gray-800 hover:text-horizon-700 truncate"
        >
          {link.title}
        </a>
        <p class="text-[11px] text-gray-400 truncate">
          {(link.site_name || hostOf(link.url)) + ' · ' + t('links.addedBy', { name: link.added_by_name })}
        </p>
      </div>

      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          hx-post={`${basePath}/links/${link.id}/pin`}
          hx-target={target}
          hx-swap="outerHTML"
          title={pinned ? t('links.unpin') : t('links.pin')}
          aria-label={pinned ? t('links.unpin') : t('links.pin')}
          class={`p-1.5 rounded-lg ${pinned ? 'text-horizon-700 bg-horizon-100' : 'text-gray-400 hover:text-horizon-700 hover:bg-gray-100'}`}
        >
          <PinIcon />
        </button>
        {canDelete && (
          <button
            type="button"
            hx-post={`${basePath}/links/${link.id}/delete`}
            hx-target={target}
            hx-swap="outerHTML"
            hx-confirm={t('links.confirmRemove')}
            title={t('links.remove')}
            aria-label={t('links.remove')}
            class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-gray-100"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
    </li>
  )
}

export function WebLinkList({
  links,
  basePath,
  currentUserId,
  canManage,
  error,
  draftUrl,
}: {
  links: WebLink[]
  basePath: string
  currentUserId: string
  canManage: boolean
  error?: string
  draftUrl?: string
}) {
  return (
    <div id="weblinks-list">
      <form
        hx-post={`${basePath}/links`}
        hx-target="#weblinks-list"
        hx-swap="outerHTML"
        hx-disabled-elt="find button"
        class="flex gap-2 px-4 py-3 border-b border-gray-100"
      >
        <input
          type="url"
          name="url"
          required
          inputmode="url"
          value={draftUrl ?? ''}
          placeholder={t('links.placeholder')}
          class="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent bg-white"
        />
        <button
          type="submit"
          class="bg-horizon-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
        >
          {t('links.add')}
        </button>
      </form>

      {error && (
        <p class="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{error}</p>
      )}

      {links.length === 0 ? (
        <p class="px-4 py-6 text-sm text-gray-400 text-center">{t('links.empty')}</p>
      ) : (
        <ul class="divide-y divide-gray-100">
          {links.map((link) => (
            <LinkRow
              link={link}
              basePath={basePath}
              canDelete={canManage || link.added_by_user_id === currentUserId}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export function WebLinks(props: {
  links: WebLink[]
  basePath: string
  currentUserId: string
  canManage: boolean
}) {
  return (
    <div class="mt-6" id="weblinks">
      <div class="mb-3">
        <h3 class="text-sm font-bold text-gray-500">{t('links.heading')}</h3>
        <p class="text-[10px] text-gray-400">{t('links.hint')}</p>
      </div>
      <div class="rounded-2xl overflow-hidden bg-white border border-papaya-300/30">
        <WebLinkList
          links={props.links}
          basePath={props.basePath}
          currentUserId={props.currentUserId}
          canManage={props.canManage}
        />
      </div>
    </div>
  )
}
