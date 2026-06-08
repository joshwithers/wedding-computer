import { Hono } from 'hono'
import type { Env } from '../../types'
import { AppLayout } from '../../views/layouts/app'
import { requireAuth } from '../../middleware/auth'
import { requireVendor } from '../../middleware/tenant'
import { csrf } from '../../middleware/csrf'
import { getReferralStats, listReferrals, FREE_MONTHS_CAP } from '../../db/referrals'

const refer = new Hono<Env>()

refer.use('/app/refer*', requireAuth, csrf, requireVendor)

refer.get('/app/refer', async (c) => {
  const user = c.get('user')
  const vendor = c.get('vendor')!
  const csrfToken = c.get('csrfToken')

  const stats = await getReferralStats(c.env.DB, vendor.id)
  const referrals = await listReferrals(c.env.DB, vendor.id)
  const link = `${c.env.APP_URL}/?ref=${vendor.referral_code ?? ''}`

  return c.html(
    <AppLayout title="Refer & earn" user={user} vendor={vendor} csrfToken={csrfToken}>
      <div class="max-w-2xl space-y-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Refer &amp; earn</h1>
          <p class="text-sm text-gray-600 mt-1">
            Share your link. When someone you refer subscribes to Pro, you <strong>both</strong> get a
            free month — applied automatically to your next Pro invoices. You can bank up to {FREE_MONTHS_CAP} months
            at a time.
          </p>
        </div>

        {/* Stats */}
        <div class="grid grid-cols-3 gap-4">
          <StatCard label="Free months banked" value={String(stats.freeMonths)} />
          <StatCard label="Subscribed" value={String(stats.converted)} />
          <StatCard label="Pending" value={String(stats.pending)} />
        </div>

        {/* Referral link */}
        <div class="bg-white rounded-2xl p-5 sm:p-6 border border-papaya-300/30">
          <label class="block text-sm font-bold text-gray-900 mb-2">Your referral link</label>
          <div class="flex gap-2">
            <input
              id="refer-link"
              type="text"
              readonly
              value={link}
              class="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-gray-700"
            />
            <button
              type="button"
              id="refer-copy"
              class="bg-horizon-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-horizon-700 transition-colors whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-2">
            Anyone who signs up through this link and subscribes to Pro earns you a free month.
          </p>
        </div>

        {/* Referral list */}
        <div class="bg-white rounded-2xl p-5 sm:p-6 border border-papaya-300/30">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Your referrals</h2>
          {referrals.length === 0 ? (
            <p class="text-sm text-gray-400">No referrals yet — share your link to get started.</p>
          ) : (
            <div class="divide-y divide-gray-100">
              {referrals.map((r) => (
                <div class="py-2.5 flex items-center justify-between gap-4 text-sm">
                  <span class="font-medium text-gray-900 truncate">{r.business_name}</span>
                  {r.status === 'converted' ? (
                    <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">
                      Subscribed
                    </span>
                  ) : (
                    <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
                      Signed up
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
        document.getElementById('refer-copy')?.addEventListener('click', function() {
          var input = document.getElementById('refer-link');
          input.select();
          navigator.clipboard.writeText(input.value).then(function() {
            var btn = document.getElementById('refer-copy');
            var prev = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(function(){ btn.textContent = prev; }, 1500);
          });
        });
      `,
        }}
      />
    </AppLayout>
  )
})

export default refer

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div class="bg-white rounded-2xl p-4 border border-papaya-300/30 text-center">
      <p class="text-2xl font-bold text-gray-900">{value}</p>
      <p class="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  )
}
