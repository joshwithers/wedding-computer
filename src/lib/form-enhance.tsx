// Shared client-side enhancements for PUBLIC, unauthenticated forms (enquiry,
// booking, custom hosted forms) and the signup/onboarding flow — surfaces that
// can't use the auth-gated /api/places proxy.
//
// Two enhancements, both progressive (the form works without JS):
//   1. Google Places autocomplete on `.address-autocomplete` inputs so a
//      location is spelt and formatted correctly. AU-biased but global —
//      results near Australia rank first, yet destination/overseas weddings
//      still resolve. Add `data-region` for a service-area field (cities only).
//   2. Date inputs marked `data-future-date` (a wedding/enquiry date — never a
//      date of birth) get `min=today` plus a line below restating the date in
//      natural language and how far away it is (largest unit + remainder), so a
//      mistyped year/month is obvious before submitting.
//
// The script is emitted by <FormEnhancements/>, which also loads the Maps JS
// when a key is configured. i18n labels are resolved server-side from the
// request's locale and passed into the script; the numbers/units localise via
// Intl in the browser. "Today" is computed in the BROWSER's timezone (not the
// server's) so the min= and the countdown agree for international visitors.

import { getI18n, t } from '../i18n'

/** Maps loader (only when a key is set) + the inline enhancement script. */
export function FormEnhancements({ mapsKey }: { mapsKey?: string }) {
  return (
    <>
      {mapsKey && (
        <script
          src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsKey)}&libraries=places&loading=async`}
          async
          defer
        ></script>
      )}
      <script dangerouslySetInnerHTML={{ __html: formEnhanceScript() }} />
    </>
  )
}

function formEnhanceScript(): string {
  const { locale } = getI18n()
  // Resolve translatable templates here, in the request's language. The
  // {duration} slot is filled client-side with locale-formatted Intl units.
  const cfg = {
    locale,
    today: t('forms.date.today'),
    away: t('forms.date.away', { duration: '{duration}' }),
    ago: t('forms.date.ago', { duration: '{duration}' }),
  }

  return `(function(){
  var CFG = ${JSON.stringify(cfg)};
  var lang = (CFG.locale || 'en').toLowerCase().split('-')[0];

  // ----- Date inputs: future-only + natural-language + countdown -----
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function localToday(){ var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function isoOf(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function ord(n){ var s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
  function unit(n, u){
    try { return new Intl.NumberFormat(CFG.locale, {style:'unit', unit:u, unitDisplay:'long'}).format(n); }
    catch(e){ return n + ' ' + u + (n===1?'':'s'); }
  }
  function naturalDate(d){
    if (lang === 'en') {
      var wd='', mo='';
      try {
        new Intl.DateTimeFormat(CFG.locale, {weekday:'long', month:'long'}).formatToParts(d).forEach(function(p){
          if (p.type==='weekday') wd=p.value; if (p.type==='month') mo=p.value;
        });
      } catch(e){}
      if (wd && mo) return wd + ' the ' + ord(d.getDate()) + ' of ' + mo + ', ' + d.getFullYear();
    }
    try { return new Intl.DateTimeFormat(CFG.locale, {weekday:'long', year:'numeric', month:'long', day:'numeric'}).format(d); }
    catch(e){ return d.toDateString(); }
  }
  function countdown(days){
    if (days === 0) return CFG.today;
    var abs = Math.abs(days);
    var years = Math.floor(abs/365); var rem = abs - years*365;
    var weeks = Math.floor(rem/7); var rdays = rem % 7;
    // Largest unit + the next non-empty unit below it (two units max).
    var primary, secondary='';
    if (years > 0){ primary = unit(years,'year'); secondary = weeks>0 ? unit(weeks,'week') : (rdays>0 ? unit(rdays,'day') : ''); }
    else if (weeks > 0){ primary = unit(weeks,'week'); secondary = rdays>0 ? unit(rdays,'day') : ''; }
    else { primary = unit(rdays,'day'); }
    var dur = secondary ? (primary + ', ' + secondary) : primary;
    return (days < 0 ? CFG.ago : CFG.away).replace('{duration}', dur);
  }
  function enhanceDate(input){
    if (input.__wcDate) return; input.__wcDate = true;
    if (!input.min) input.min = isoOf(localToday());
    var msg = document.createElement('p');
    msg.className = 'text-xs mt-1.5 font-medium text-gray-500';
    msg.setAttribute('aria-live','polite');
    input.insertAdjacentElement('afterend', msg);
    function update(){
      var v = input.value;
      if (!v || !/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) { msg.textContent=''; return; }
      var p = v.split('-').map(Number);
      var d = new Date(p[0], p[1]-1, p[2]);
      if (isNaN(d.getTime())) { msg.textContent=''; return; }
      var diff = Math.round((d - localToday()) / 86400000);
      msg.textContent = naturalDate(d) + ' \\u00B7 ' + countdown(diff);
      msg.className = 'text-xs mt-1.5 font-medium ' + (diff < 0 ? 'text-grapefruit-700' : 'text-gray-500');
    }
    input.addEventListener('input', update);
    input.addEventListener('change', update);
    update();
  }
  document.querySelectorAll('input[type=date][data-future-date]').forEach(enhanceDate);

  // ----- Address autocomplete (AU-biased, global) -----
  function initPlaces(){
    if (!(window.google && google.maps && google.maps.places && google.maps.places.Autocomplete)) return false;
    var au = new google.maps.LatLngBounds(
      new google.maps.LatLng(-43.96, 112.92),
      new google.maps.LatLng(-9.14, 159.26)
    );
    document.querySelectorAll('.address-autocomplete').forEach(function(input){
      if (input.__wcPlaces) return; input.__wcPlaces = true;
      // (regions) is the legacy Autocomplete widget's type-collection name for
      // cities/regions — the parentheses are part of the documented syntax.
      var opts = { bounds: au, fields: ['formatted_address','name'] };
      if (input.hasAttribute('data-region')) opts.types = ['(regions)'];
      var ac = new google.maps.places.Autocomplete(input, opts);
      ac.addListener('place_changed', function(){
        var place = ac.getPlace();
        if (!place) return;
        var val = place.formatted_address || place.name;
        if (val) input.value = val;
      });
    });
    return true;
  }
  if (document.querySelector('.address-autocomplete')) {
    if (!initPlaces()) {
      var tries = 0;
      var iv = setInterval(function(){ tries++; if (initPlaces() || tries > 100) clearInterval(iv); }, 200);
    }
  }
})();`
}
