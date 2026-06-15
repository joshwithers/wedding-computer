// Shared handlers for web links, used by both the vendor route
// (/app/weddings/:id/links*) and the couple route (/wedding/:id/links*).
// Each returns the htmx-swappable <WebLinkList> partial. Permissions: any
// active member adds + pins; delete is the adder or a managing vendor.

import type { Context } from 'hono'
import type { Env, User, WeddingMember } from '../types'
import { WebLinkList } from '../views/web-links'
import { listWebLinks, addWebLink, getWebLink, setWebLinkPinned, deleteWebLink } from '../db/web-links'
import { fetchLinkMetadata } from '../services/link-metadata'
import { consumeRateLimit } from '../middleware/rate-limit'
import { t } from '../i18n'

type Ctx = Context<Env>

function partial(
  c: Ctx,
  links: Awaited<ReturnType<typeof listWebLinks>>,
  basePath: string,
  member: WeddingMember,
  user: User,
  extra?: { error?: string; draftUrl?: string }
) {
  return c.html(
    <WebLinkList
      links={links}
      basePath={basePath}
      currentUserId={user.id}
      canManage={member.can_manage === 1}
      error={extra?.error}
      draftUrl={extra?.draftUrl}
    />
  )
}

export async function renderLinks(
  c: Ctx,
  weddingId: string,
  member: WeddingMember,
  user: User,
  basePath: string
): Promise<Response> {
  const links = await listWebLinks(c.env.DB, weddingId)
  return partial(c, links, basePath, member, user)
}

export async function addLink(
  c: Ctx,
  weddingId: string,
  member: WeddingMember,
  user: User,
  basePath: string
): Promise<Response> {
  const body = await c.req.parseBody()
  const rawUrl = String(body.url ?? '').trim()

  if (!(await consumeRateLimit(c.env.KV, `weblink:${user.id}`, 30, 60))) {
    const links = await listWebLinks(c.env.DB, weddingId)
    return partial(c, links, basePath, member, user, { error: t('links.invalid'), draftUrl: rawUrl })
  }

  const meta = await fetchLinkMetadata(rawUrl)
  if (!meta) {
    const links = await listWebLinks(c.env.DB, weddingId)
    return partial(c, links, basePath, member, user, { error: t('links.invalid'), draftUrl: rawUrl })
  }

  await addWebLink(c.env.DB, {
    wedding_id: weddingId,
    url: meta.url,
    title: meta.title,
    site_name: meta.siteName,
    image_url: meta.imageUrl,
    added_by_user_id: user.id,
    added_by_name: user.name,
    added_by_role: member.role,
  })

  const links = await listWebLinks(c.env.DB, weddingId)
  return partial(c, links, basePath, member, user)
}

export async function togglePin(
  c: Ctx,
  weddingId: string,
  member: WeddingMember,
  user: User,
  basePath: string,
  linkId: string
): Promise<Response> {
  const link = await getWebLink(c.env.DB, weddingId, linkId)
  if (link) {
    await setWebLinkPinned(c.env.DB, weddingId, linkId, link.pinned !== 1)
  }
  const links = await listWebLinks(c.env.DB, weddingId)
  return partial(c, links, basePath, member, user)
}

export async function removeLink(
  c: Ctx,
  weddingId: string,
  member: WeddingMember,
  user: User,
  basePath: string,
  linkId: string
): Promise<Response> {
  const link = await getWebLink(c.env.DB, weddingId, linkId)
  const canDelete = link && (member.can_manage === 1 || link.added_by_user_id === user.id)
  if (link && canDelete) {
    await deleteWebLink(c.env.DB, weddingId, linkId)
  }
  const links = await listWebLinks(c.env.DB, weddingId)
  return partial(c, links, basePath, member, user)
}
