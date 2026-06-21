// Demo / sample data: lets a vendor load a realistic "week ahead" — a few
// weddings (couple, fake vendor team, full run-sheet, notes in every scope) plus
// a handful of fresh enquiries — so an empty account doesn't look empty, then
// remove it cleanly in one click. Everything is tagged is_demo and scoped to the
// vendor, so teardown is exact (D1 rows AND the R2/GitHub markdown).
//
// This calls the low-level db/storage creators directly (never the route flows),
// so it fires NO emails, analytics, geocode, or couple invites.

import type { Bindings, User, VendorProfile } from '../types'
import { createWedding, addWeddingMember } from '../db/weddings'
import { findOrCreateUser } from './auth'
import { createCoupleVendor } from '../db/couple-vendors'
import { applyWeddingUpdate, createItem, resolveAndMaterialize, weddingSunMinutes } from '../db/timeline'
import { addSunMarkers } from '../routes/timeline-handlers'
import { appendToDoc } from '../db/wedding-docs'
import { createEvent } from '../db/calendar'
import { createContact, deleteContact } from '../storage/contacts'
import { deleteWeddingFile } from '../storage/weddings'
import { getStorageWithSecrets } from '../storage'
import { pushAllWeddingFiles } from './storage-push'
import { todayString } from '../lib/date'

// ─────────────────────────── content ───────────────────────────

type DemoVendor = { name: string; category: string; status: string; notes: string }
type DemoWedding = {
  key: string
  title: string
  couple: { first: string; last: string }
  partner: { first: string; last: string }
  location: string
  city: string
  state: string
  country: string
  lat: number
  lng: number
  ceremonyTime: string
  duration: number
  sharedNote: string
  vendorsNote: string
  coupleNote: string
  privateNote: string
  vendors: DemoVendor[]
}

// Dated today+7 / +14 / +21 so all three are upcoming/active.
const DEMO_WEDDINGS: DemoWedding[] = [
  {
    key: 'mercer-nguyen',
    title: 'Ada & Bao',
    couple: { first: 'Ada', last: 'Mercer' },
    partner: { first: 'Bao', last: 'Nguyen' },
    location: 'Byron Bay, NSW',
    city: 'Byron Bay',
    state: 'NSW',
    country: 'Australia',
    lat: -28.6474,
    lng: 153.602,
    ceremonyTime: '15:00',
    duration: 6,
    sharedNote:
      'Coastal ceremony on the headland at 3pm, reception under the marquee on the lawn. Relaxed, barefoot-on-the-grass feel — think long tables, candles and natives. Rain plan is the boathouse.',
    vendorsNote:
      'Load-in from 12pm via the service road (gate code 4821). Power is at the marquee’s north-east corner. Please confirm your slot on the run-sheet below — we’re tight between portraits and dinner.',
    coupleNote:
      'Still to lock in: the first-dance song (Bao is lobbying hard for the cheesy one 💃), and whether Grandma sits at table 1 or 2. Don’t forget the vows are in the blue notebook!',
    privateNote:
      'Deposit paid 12 May. Lovely, easy couple. Follow up for the final headcount two weeks out and chase the celebrant for the running order.',
    vendors: [
      { name: 'Wildflower & Fern', category: 'Florist', status: 'booked', notes: 'Loose native arrangements, no roses. Arch + 8 table runners.' },
      { name: 'Goldlight Photography', category: 'Photographer', status: 'booked', notes: 'Two shooters. Wants 30 min of golden-hour portraits.' },
      { name: 'The Long Table', category: 'Catering', status: 'considering', notes: 'Shared-plate menu quote sent — awaiting final numbers.' },
    ],
  },
  {
    key: 'okafor-reilly',
    title: 'Mia & Jonah',
    couple: { first: 'Mia', last: 'Okafor' },
    partner: { first: 'Jonah', last: 'Reilly' },
    location: 'Pokolbin, Hunter Valley NSW',
    city: 'Pokolbin',
    state: 'NSW',
    country: 'Australia',
    lat: -32.7796,
    lng: 151.2985,
    ceremonyTime: '16:00',
    duration: 7,
    sharedNote:
      'Vineyard wedding — ceremony in the rose garden at 4pm, then dinner in the barrel room. Warm, golden, lots of wine. 90 guests. Black-tie optional.',
    vendorsNote:
      'Bump-in from 1pm. Cellar door stays open to the public until 3pm, so keep the garden clear until then. Cake fridge is in the prep kitchen behind the barrel room.',
    coupleNote:
      'Reminders to ourselves: confirm the shuttle bus times with the accommodation, and pick the three wines for the tables. Mum wants a photo with the whole Okafor side after the ceremony.',
    privateNote:
      'Booked at the bridal expo in March. Bigger budget, very organised. Final invoice due 7 days out. Note: Jonah’s brother is MC — brief him on timings.',
    vendors: [
      { name: 'Vine & Vow Events', category: 'Venue', status: 'booked', notes: 'Barrel room + rose garden. Coordinator is Steph.' },
      { name: 'Sapphire Sound DJs', category: 'Music', status: 'booked', notes: 'Ceremony PA + reception DJ. No outdoor amplified music after 10pm.' },
      { name: 'Sweet Tier Co.', category: 'Cake', status: 'booked', notes: 'Three tiers, semi-naked, fig + honey.' },
    ],
  },
  {
    key: 'castellano-park',
    title: 'Priya & Tom',
    couple: { first: 'Priya', last: 'Castellano' },
    partner: { first: 'Tom', last: 'Park' },
    location: 'Collingwood, Melbourne VIC',
    city: 'Melbourne',
    state: 'VIC',
    country: 'Australia',
    lat: -37.8136,
    lng: 144.9631,
    ceremonyTime: '17:00',
    duration: 6,
    sharedNote:
      'City warehouse wedding — exposed brick, festoon lights, a long share-table down the middle. Ceremony at 5pm in the same room (quick flip to reception). Intimate, 60 guests, lots of personality.',
    vendorsNote:
      'Street parking only — load-in via the rear roller door on the laneside, bays free after 4pm. Room flip happens during canapés; please clear ceremony chairs fast.',
    coupleNote:
      'To do: finalise the playlist veto list (no line dancing!), and confirm Tom’s suit fitting. Ask the bar about a non-alcoholic signature drink for the toast.',
    privateNote:
      'Instagram enquiry, booked fast. Design-led couple — they care about the look. Keep the styling mood-board handy. Balance due on the day, EFT.',
    vendors: [
      { name: 'Bloom Theory', category: 'Florist', status: 'booked', notes: 'Moody, architectural. Installed over the share-table.' },
      { name: 'Reel & Frame Films', category: 'Videographer', status: 'considering', notes: 'Highlight reel quote sent — couple deciding.' },
      { name: 'Spirit & Stem Mobile Bar', category: 'Bar', status: 'booked', notes: 'Negroni cart + one NA signature. RSA covered.' },
    ],
  },
]

type DemoEnquiry = {
  first: string
  last: string
  partnerFirst: string
  partnerLast: string
  email: string
  location: string
  daysOut: number
  notes: string
}

const DEMO_ENQUIRIES: DemoEnquiry[] = [
  {
    first: 'Hannah',
    last: 'Whitlock',
    partnerFirst: 'Will',
    partnerLast: 'Hargreave',
    email: 'hannah.demo@example.invalid',
    location: 'Noosa, QLD',
    daysOut: 280,
    notes: 'Hi! We’re planning a relaxed beach wedding next autumn for about 70 guests and love your style. Are you available, and could you send through pricing? — Hannah & Will',
  },
  {
    first: 'Sofia',
    last: 'Almeida',
    partnerFirst: 'Daniel',
    partnerLast: 'Cho',
    email: 'sofia.demo@example.invalid',
    location: 'Yarra Valley, VIC',
    daysOut: 200,
    notes: 'We got engaged over the weekend 🎉 Looking at a vineyard wedding, probably a Saturday in spring. Do you do full-day coverage? Would love to chat.',
  },
  {
    first: 'Grace',
    last: 'Donnelly',
    partnerFirst: 'Oliver',
    partnerLast: 'Quinn',
    email: 'grace.demo@example.invalid',
    location: 'Sydney CBD, NSW',
    daysOut: 120,
    notes: 'Planning a small city elopement — just the two of us plus a handful of guests. Is that something you’d take on? Fairly short notice, hoping for early next year.',
  },
]

// ─────────────────────────── helpers ───────────────────────────

const DEMO_USER_DOMAIN = '@example.invalid'

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

// ─────────────────────────── seed ───────────────────────────

export async function seedDemoData(env: Bindings, vendor: VendorProfile, user: User): Promise<void> {
  const db = env.DB
  const storage = await getStorageWithSecrets(env, vendor)
  const today = todayString()

  for (let i = 0; i < DEMO_WEDDINGS.length; i++) {
    const w = DEMO_WEDDINGS[i]
    const date = addDays(today, 7 * (i + 1))

    const wedding = await createWedding(db, {
      title: w.title,
      date,
      time: w.ceremonyTime,
      duration_hours: w.duration,
      location: w.location,
      notes: w.sharedNote, // the 'shared' note scope → weddings.notes
      ceremony_type: 'wedding',
      created_by_user_id: user.id,
    })
    // Flag + geo (so the demo also shows weather + sun without a geocode round-trip).
    await db
      .prepare("UPDATE weddings SET is_demo = 1, location_city = ?, location_state = ?, location_country = ?, location_lat = ?, location_lng = ? WHERE id = ?")
      .bind(w.city, w.state, w.country, w.lat, w.lng, wedding.id)
      .run()

    // This vendor joins as the managing vendor (can_manage = lead → timeline writes apply directly).
    await addWeddingMember(db, {
      wedding_id: wedding.id,
      user_id: user.id,
      role: 'vendor',
      vendor_profile_id: vendor.id,
      vendor_role: vendor.category,
      can_manage: true,
    })

    // The couple — a synthetic, can't-log-in @example.invalid user, unique per wedding.
    const couple = await findOrCreateUser(db, `demo+${w.key}-${wedding.id}${DEMO_USER_DOMAIN}`, w.title)
    await addWeddingMember(db, { wedding_id: wedding.id, user_id: couple.id, role: 'couple' })

    // The rest of the team — name-only "fake vendors" (no accounts to clean up).
    for (const v of w.vendors) {
      await createCoupleVendor(db, wedding.id, { name: v.name, category: v.category, status: v.status, notes: v.notes })
    }

    await seedTimeline(db, wedding.id, vendor.id, user.id, w.ceremonyTime)

    // Notes in every scope: shared is set above via createWedding.notes.
    await appendToDoc(db, wedding.id, 'vendors', user.id, w.vendorsNote)
    await appendToDoc(db, wedding.id, 'couple', user.id, w.coupleNote)
    await appendToDoc(db, wedding.id, 'private', user.id, w.privateNote)

    // Mirror the real create flow's calendar booking.
    await createEvent(db, vendor.id, {
      title: w.title,
      date,
      start_time: w.ceremonyTime,
      type: 'booking',
      wedding_id: wedding.id,
      notes: w.location,
    })

    // Materialise the markdown (folder + companion files). AWAIT — we're in a service.
    await pushAllWeddingFiles(env, vendor, wedding.id)
  }

  // A few fresh leads in the pipeline.
  for (const e of DEMO_ENQUIRIES) {
    const contact = await createContact(storage, db, vendor.id, {
      first_name: e.first,
      last_name: e.last,
      partner_first_name: e.partnerFirst,
      partner_last_name: e.partnerLast,
      email: e.email,
      source: 'demo',
      status: 'new',
      wedding_date: addDays(today, e.daysOut),
      wedding_location: e.location,
      notes: e.notes,
    })
    await db.prepare('UPDATE contacts SET is_demo = 1 WHERE id = ?').bind(contact.id).run()
  }
}

// A run-sheet that exercises the features: vendors-only visibility, absolute
// times, sun markers, a sun-relative row and an item-relative row.
async function seedTimeline(db: D1Database, weddingId: string, vendorId: string, userId: string, ceremonyTime: string): Promise<void> {
  // Headline ceremony time → seeds the ceremony slot row.
  await applyWeddingUpdate(db, weddingId, { time: ceremonyTime }, userId)

  const mk = (data: Parameters<typeof createItem>[1]) => createItem(db, data)

  await mk({ wedding_id: weddingId, title: 'Vendor load-in & setup', start_time: '12:00', category: 'other', location: 'On site', owner_vendor_id: vendorId, created_by_user_id: userId, visibility: 'vendors' })
  await mk({ wedding_id: weddingId, title: 'Hair & makeup', start_time: '11:00', category: 'getting_ready', location: 'Bridal suite', owner_vendor_id: vendorId, created_by_user_id: userId, visibility: 'couple' })
  await mk({ wedding_id: weddingId, title: 'First look & couple portraits', start_time: '14:15', category: 'portraits', owner_vendor_id: vendorId, created_by_user_id: userId, visibility: 'couple' })
  await mk({ wedding_id: weddingId, title: 'Canapés & lawn games', start_time: '16:30', category: 'reception', owner_vendor_id: vendorId, created_by_user_id: userId, visibility: 'couple' })
  const dinner = await mk({ wedding_id: weddingId, title: 'Reception dinner', start_time: '18:30', category: 'reception', owner_vendor_id: vendorId, created_by_user_id: userId, visibility: 'couple' })

  // Sun markers (point-in-time facts) — needs the geo we set on the wedding.
  await addSunMarkers(db, weddingId, vendorId, userId)

  // Golden-hour portraits: 30 min before sunset (liquid, sun-anchored).
  await mk({ wedding_id: weddingId, title: 'Golden-hour portraits', category: 'portraits', owner_vendor_id: vendorId, created_by_user_id: userId, visibility: 'couple', anchor_type: 'sun', anchor_ref: 'sunset', anchor_offset_minutes: -30 })
  // Speeches: 20 min after dinner (liquid, item-anchored).
  await mk({ wedding_id: weddingId, title: 'Speeches & first dance', category: 'reception', owner_vendor_id: vendorId, created_by_user_id: userId, visibility: 'couple', anchor_type: 'after', anchor_ref: dinner.id, anchor_offset_minutes: 20 })

  // Compute concrete start times for the anchored rows.
  await resolveAndMaterialize(db, weddingId, await weddingSunMinutes(db, weddingId))
}

// ─────────────────────────── teardown ───────────────────────────

export async function teardownDemoData(env: Bindings, vendor: VendorProfile, user: User): Promise<void> {
  const db = env.DB
  const storage = await getStorageWithSecrets(env, vendor)

  // A. Discover the demo set — strictly scoped (weddings has no vendor_id, so
  // scope via created_by_user_id; an unscoped is_demo delete would hit other vendors).
  const weddingIds = (await db.prepare('SELECT id FROM weddings WHERE created_by_user_id = ? AND is_demo = 1').bind(user.id).all<{ id: string }>()).results.map((r) => r.id)
  const contactIds = (await db.prepare('SELECT id FROM contacts WHERE vendor_id = ? AND is_demo = 1').bind(vendor.id).all<{ id: string }>()).results.map((r) => r.id)

  // Collect synthetic couple users now (the memberships cascade away with the wedding).
  let coupleUserIds: string[] = []
  if (weddingIds.length) {
    const ph = weddingIds.map(() => '?').join(',')
    coupleUserIds = (
      await db
        .prepare(`SELECT DISTINCT wm.user_id FROM wedding_members wm JOIN users u ON u.id = wm.user_id WHERE wm.wedding_id IN (${ph}) AND wm.role = 'couple' AND u.email LIKE 'demo+%${DEMO_USER_DOMAIN}'`)
        .bind(...weddingIds)
        .all<{ user_id: string }>()
    ).results.map((r) => r.user_id)
  }

  // B. Storage + file_index cleanup FIRST, while the index rows still exist
  // (a raw row delete would strand the markdown — file_index FKs the vendor, not the wedding).
  for (const id of contactIds) {
    try { await deleteContact(storage, db, vendor.id, id) } catch (err) { console.error('[demo] deleteContact failed', id, err) }
  }
  for (const id of weddingIds) {
    try { await deleteWeddingFile(storage, db, vendor.id, id) } catch (err) { console.error('[demo] deleteWeddingFile failed', id, err) }
  }

  // C. D1 row deletes. The four bare REFERENCES weddings(id) (NO ACTION) would
  // block the wedding delete, so clear them first.
  if (weddingIds.length) {
    const ph = weddingIds.map(() => '?').join(',')
    // Demo bookings: delete outright (seeder created one per wedding).
    await db.prepare(`DELETE FROM calendar_events WHERE vendor_id = ? AND wedding_id IN (${ph})`).bind(vendor.id, ...weddingIds).run()
    // Safety net for the other RESTRICT refs (seeder creates none).
    await db.prepare(`UPDATE invoices SET wedding_id = NULL WHERE wedding_id IN (${ph})`).bind(...weddingIds).run()
    await db.prepare(`UPDATE service_contracts SET wedding_id = NULL WHERE wedding_id IN (${ph})`).bind(...weddingIds).run()
    // Cascades members, docs, web_links, timeline (+assignees), couple_vendors, todos, log, …
    await db.prepare(`DELETE FROM weddings WHERE id IN (${ph})`).bind(...weddingIds).run()
  }

  // D. Synthetic users — only the @example.invalid ones with no memberships left.
  for (const uid of coupleUserIds) {
    const remaining = await db.prepare('SELECT COUNT(*) AS c FROM wedding_members WHERE user_id = ?').bind(uid).first<{ c: number }>()
    if ((remaining?.c ?? 0) === 0) {
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run()
      await db.prepare('DELETE FROM users WHERE id = ?').bind(uid).run()
    }
  }
}

// ─────────────────────────── status ───────────────────────────

export async function hasDemoData(db: D1Database, vendorId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT (SELECT COUNT(*) FROM weddings WHERE created_by_user_id = ? AND is_demo = 1) + (SELECT COUNT(*) FROM contacts WHERE vendor_id = ? AND is_demo = 1) AS c')
    .bind(userId, vendorId)
    .first<{ c: number }>()
  return (row?.c ?? 0) > 0
}

// "New/empty" = no REAL (non-demo) weddings AND no REAL contacts. Gates the
// first-run "Load sample data" invite — an experienced vendor never sees it.
export async function isNewVendor(db: D1Database, vendorId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM wedding_members wm JOIN weddings w ON w.id = wm.wedding_id
                WHERE wm.user_id = ? AND wm.status = 'active' AND w.is_demo = 0)
            + (SELECT COUNT(*) FROM contacts WHERE vendor_id = ? AND is_demo = 0) AS c`
    )
    .bind(userId, vendorId)
    .first<{ c: number }>()
  return (row?.c ?? 0) === 0
}
