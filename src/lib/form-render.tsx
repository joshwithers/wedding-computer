import type { FormConfig, FormField } from './form-schema'
import { configHasAddressField, configHasFileField } from './form-schema'
import { COUNTRIES } from '../forms/countries'
import { FormEnhancements } from './form-enhance'
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from './upload'
import { t, getCspNonce } from '../i18n'

// The single public-form renderer shared by /enquire, /form, /book-form and the
// booking page. Lifted from the old form.tsx superset (multi-step, conditional
// fields, every BUILDER_FIELD_TYPE, file uploads, NOIM checklist) so every
// public surface renders identically. Routes pass the POST `action` and an
// optional `formType` (the form.type discriminator — 'noim' keys the doc
// checklist step). Strings go through t() so the renderer is translatable.

const FILE_ACCEPT = [...ALLOWED_UPLOAD_TYPES].join(',')

const INPUT_CLASS =
  'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-horizon-600 focus:border-transparent'

export type PublicFormBodyProps = {
  config: FormConfig
  action: string
  siteKey: string
  formType?: string
  mapsKey?: string
  error?: string
  values?: Record<string, string>
}

// The <form> itself: honeypot, fields (flat or multi-step), Turnstile, submit,
// plus the inline logic + enhancement scripts. Callers render their own header
// and page chrome around this.
export function PublicFormBody({ config, action, siteKey, formType, mapsKey, error, values }: PublicFormBodyProps) {
  const isMultiStep = !!(config.steps && config.steps.length > 0)
  const hasFile = configHasFileField(config)

  return (
    <div>
      {error && (
        <div class="bg-grapefruit-50 border border-grapefruit-200 text-grapefruit-700 text-sm font-medium rounded-xl p-3 mb-4">{error}</div>
      )}

      <form method="post" action={action} id="main-form" enctype={hasFile ? 'multipart/form-data' : undefined}>
        {/* Honeypot — hidden from humans; bots fill it and are silently accepted. */}
        <div style="position:absolute;left:-9999px" aria-hidden="true">
          <input type="text" name="website_url" tabindex={-1} autocomplete="off" />
        </div>

        {isMultiStep ? (
          <div id="form-steps">
            {config.steps!.map((step, i) => (
              <div class="form-step" data-step={i} style={i === 0 ? {} : { display: 'none' }}>
                <div class="mb-4">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-xs bg-[var(--form-accent-tint)] text-[var(--form-accent)] px-2 py-0.5 rounded-full">
                      {t('forms.public.step', { n: String(i + 1), total: String(config.steps!.length) })}
                    </span>
                  </div>
                  <h2 class="text-lg font-bold text-[var(--form-ink)]">{step.title}</h2>
                  {step.description && <p class="text-sm text-gray-600">{step.description}</p>}
                </div>
                <div class="space-y-4">
                  {step.fields.map((field) => (
                    <RenderField field={field} value={values?.[field.id]} />
                  ))}
                  {step.id === 'documents' && (
                    <ul id="noim-doc-checklist" class="space-y-2 text-sm text-gray-800 list-none">
                      <li class="text-gray-400">Complete the earlier steps to see your document list.</li>
                    </ul>
                  )}
                </div>
                <div class="flex justify-between mt-6">
                  {i > 0 && (
                    <button type="button" class="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 border border-gray-200 rounded-lg step-prev">{t('forms.public.back')}</button>
                  )}
                  {i < config.steps!.length - 1 ? (
                    <button type="button" class="ml-auto text-sm text-[var(--form-accent-ink)] bg-[var(--form-accent)] hover:bg-[var(--form-accent-hover)] px-4 py-2 rounded-lg font-bold step-next">{t('forms.public.continue')}</button>
                  ) : (
                    <div class="ml-auto flex flex-col items-end gap-3">
                      <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
                      <button type="submit" class="text-sm text-[var(--form-accent-ink)] bg-[var(--form-accent)] hover:bg-[var(--form-accent-hover)] px-6 py-2 rounded-lg font-bold">{config.submitLabel}</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div class="space-y-4">
            {config.fields.map((field) => (
              <RenderField field={field} value={values?.[field.id]} />
            ))}
            <div class="mt-4 flex flex-col items-start gap-3">
              <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
              <button type="submit" class="w-full sm:w-auto text-sm text-[var(--form-accent-ink)] bg-[var(--form-accent)] hover:bg-[var(--form-accent-hover)] px-6 py-3 rounded-xl font-bold transition-colors">{config.submitLabel}</button>
            </div>
          </div>
        )}
      </form>

      {/* Turnstile */}
      <script nonce={getCspNonce()} src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
      {/* Multi-step + conditional logic */}
      <script nonce={getCspNonce()} dangerouslySetInnerHTML={{ __html: formLogicScript() }} />
      {/* Location autocomplete + future-date/countdown helpers */}
      <FormEnhancements mapsKey={configHasAddressField(config) ? mapsKey : undefined} />
    </div>
  )
}

export function RenderField({ field, value }: { field: FormField; value?: string }) {
  if (field.type === 'heading') {
    return <h3 class="text-base font-bold text-gray-900 pt-4 pb-1 border-b border-gray-100">{field.label}</h3>
  }

  const wrapClass = field.width === 'half' ? 'inline-block w-[calc(50%-0.5rem)] align-top' : ''
  const conditions = field.conditions ? JSON.stringify(field.conditions) : undefined

  const labelEl = (
    <label class="block text-sm font-bold text-gray-700 mb-1.5" for={field.id}>
      {field.label}
      {field.required && <span class="text-grapefruit-700 ml-0.5">*</span>}
    </label>
  )

  return (
    <div class={wrapClass} data-field-id={field.id} data-conditions={conditions}>
      {field.type !== 'checkbox' && labelEl}
      {field.helpText && <p class="text-xs text-gray-500 mb-1 -mt-1">{field.helpText}</p>}

      {field.type === 'textarea' ? (
        <textarea
          id={field.id}
          name={field.id}
          placeholder={field.placeholder}
          required={field.required}
          maxlength={2000}
          class={INPUT_CLASS}
          rows={4}
          data-title-case={field.titleCase ? 'true' : undefined}
        >{value ?? ''}</textarea>
      ) : field.type === 'select' ? (
        <select id={field.id} name={field.id} required={field.required} class={`${INPUT_CLASS} bg-white`}>
          <option value="">{field.placeholder ?? t('forms.public.select')}</option>
          {field.options?.map((opt) => {
            const optValue = typeof opt === 'string' ? opt : opt.value
            const optLabel = typeof opt === 'string' ? opt : opt.label
            return <option value={optValue} selected={value === optValue}>{optLabel}</option>
          })}
        </select>
      ) : field.type === 'radio' ? (
        <div class="space-y-2 mt-1">
          {field.options?.map((opt) => {
            const optValue = typeof opt === 'string' ? opt : opt.value
            const optLabel = typeof opt === 'string' ? opt : opt.label
            return (
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name={field.id} value={optValue} checked={value === optValue} required={field.required} class="accent-grapefruit-700" />
                {optLabel}
              </label>
            )
          })}
        </div>
      ) : field.type === 'checkbox' ? (
        <label class="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" name={field.id} value="yes" checked={value === 'yes'} required={field.required} class="accent-grapefruit-700 mt-0.5" />
          <span class="text-gray-700">{field.label}{field.required && <span class="text-grapefruit-700 ml-0.5">*</span>}</span>
        </label>
      ) : field.type === 'country' ? (
        <div class="relative">
          <input
            type="text"
            id={field.id}
            name={field.id}
            value={value ?? ''}
            placeholder={t('forms.public.country')}
            required={field.required}
            class={INPUT_CLASS}
            list={`${field.id}_list`}
            autocomplete="off"
          />
          <datalist id={`${field.id}_list`}>
            {COUNTRIES.map((country) => <option value={country} />)}
          </datalist>
        </div>
      ) : field.type === 'address' ? (
        <input
          type="text"
          id={field.id}
          name={field.id}
          value={value ?? ''}
          placeholder={field.placeholder || t('forms.address.placeholder')}
          required={field.required}
          autocomplete="off"
          class={`${INPUT_CLASS} address-autocomplete`}
          data-title-case={field.titleCase ? 'true' : undefined}
        />
      ) : field.type === 'multiselect' ? (
        <div class="space-y-2">
          {field.options?.map((opt) => {
            const optValue = typeof opt === 'string' ? opt : opt.value
            const optLabel = typeof opt === 'string' ? opt : opt.label
            const selected = (value ?? '').split(', ').includes(optValue)
            return (
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" name={field.id} value={optValue} checked={selected} class="accent-grapefruit-700" />
                {optLabel}
              </label>
            )
          })}
        </div>
      ) : field.type === 'file' ? (
        <>
          <input
            type="file"
            id={field.id}
            name={field.id}
            required={field.required}
            accept={FILE_ACCEPT}
            data-max-size={String(MAX_UPLOAD_BYTES)}
            class="form-file w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-[var(--form-accent-tint)] file:text-[var(--form-accent)] cursor-pointer"
          />
          <p class="text-xs text-gray-400 mt-1">{field.accept ? `${field.accept} · ` : ''}{t('forms.public.maxFileSize')}</p>
        </>
      ) : field.type === 'rating' ? (
        <div class="rating flex items-center gap-1" data-rating={field.id} data-max={String(field.max ?? 5)}>
          <input type="hidden" name={field.id} value={value ?? ''} />
          {Array.from({ length: field.max ?? 5 }).map((_, i) => (
            <button type="button" data-val={String(i + 1)} aria-label={`${i + 1}`} class="star w-8 h-8 text-gray-300 hover:text-[var(--form-accent)] transition-colors">
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full"><path d="M11.48 3.5l2.36 4.78 5.28.77-3.82 3.72.9 5.26-4.72-2.48-4.72 2.48.9-5.26L3.84 9.05l5.28-.77z" /></svg>
            </button>
          ))}
        </div>
      ) : field.type === 'scale' ? (
        <div>
          <div class="scale flex flex-wrap gap-2" data-scale={field.id}>
            <input type="hidden" name={field.id} value={value ?? ''} />
            {Array.from({ length: (field.max ?? 10) - (field.min ?? 1) + 1 }).map((_, i) => {
              const n = (field.min ?? 1) + i
              return (
                <button type="button" data-val={String(n)} class="scale-opt w-10 h-10 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:border-[var(--form-accent)]">{n}</button>
              )
            })}
          </div>
          {(field.minLabel || field.maxLabel) && (
            <div class="flex justify-between text-xs text-gray-400 mt-1">
              <span>{field.minLabel ?? ''}</span>
              <span>{field.maxLabel ?? ''}</span>
            </div>
          )}
        </div>
      ) : (
        <input
          type={field.type}
          id={field.id}
          name={field.id}
          value={value ?? ''}
          placeholder={field.placeholder}
          required={field.required}
          class={INPUT_CLASS}
          data-title-case={field.titleCase ? 'true' : undefined}
          data-future-date={field.type === 'date' && field.mapTo === 'wedding_date' ? 'true' : undefined}
        />
      )}
    </div>
  )
}

// Generic thank-you. Booking / NOIM pass extra context; the default copy suits
// information and custom forms.
export function ThankYou({ title, vendorName, message, showPdfLink, pdfAction, submissionId }: {
  title?: string
  vendorName?: string | null
  message?: string
  showPdfLink?: boolean
  pdfAction?: string
  submissionId?: string
}) {
  return (
    <div class="text-center py-8">
      <div class="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg class="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 class="text-xl font-bold text-[var(--form-ink)] mb-2">{title ?? t('forms.public.submitted')}</h2>
      <p class="text-sm text-gray-600">{message ?? t('forms.public.thankYou')}</p>
      {showPdfLink && pdfAction && submissionId && (
        <div class="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg text-left">
          <p class="text-sm text-purple-800 mb-2 font-medium">{t('forms.public.noimReady')}</p>
          <p class="text-xs text-purple-600 mb-3">{t('forms.public.noimDesc')}</p>
          <form method="post" action={pdfAction}>
            <input type="hidden" name="submission_id" value={submissionId} />
            <button type="submit" class="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-purple-700">{t('forms.public.downloadNoim')}</button>
          </form>
        </div>
      )}
      {vendorName && <p class="text-xs text-gray-400 mt-6">{vendorName}</p>}
    </div>
  )
}

export function formLogicScript(): string {
  return `
(function() {
  // File fields: reject an over-size pick immediately rather than on submit.
  document.querySelectorAll('.form-file').forEach(function(inp){
    inp.addEventListener('change', function(){
      var max = parseInt(inp.getAttribute('data-max-size')||'0',10);
      var f = inp.files && inp.files[0];
      if (f && max && f.size > max){ alert('That file is too large (max 10MB). Please choose a smaller file.'); inp.value=''; }
    });
  });

  // Star-rating widgets.
  document.querySelectorAll('.rating').forEach(function(box){
    var hidden = box.querySelector('input[type=hidden]');
    var stars = box.querySelectorAll('.star');
    function paint(n){ stars.forEach(function(s,i){ s.style.color = (i < n) ? 'var(--form-accent)' : ''; }); }
    function cur(){ return parseInt(hidden.value||'0',10)||0; }
    stars.forEach(function(s){
      s.addEventListener('click', function(){ hidden.value = s.getAttribute('data-val'); paint(cur()); });
      s.addEventListener('mouseenter', function(){ paint(parseInt(s.getAttribute('data-val'),10)); });
    });
    box.addEventListener('mouseleave', function(){ paint(cur()); });
    paint(cur());
  });

  // Linear-scale widgets.
  document.querySelectorAll('.scale').forEach(function(box){
    var hidden = box.querySelector('input[type=hidden]');
    var opts = box.querySelectorAll('.scale-opt');
    function paint(){ var v = hidden.value; opts.forEach(function(o){ var on = o.getAttribute('data-val') === v; o.style.background = on ? 'var(--form-accent)' : ''; o.style.color = on ? 'var(--form-accent-ink)' : ''; o.style.borderColor = on ? 'var(--form-accent)' : ''; }); }
    opts.forEach(function(o){ o.addEventListener('click', function(){ hidden.value = o.getAttribute('data-val'); paint(); }); });
    paint();
  });

  // Build the NOIM document checklist client-side from the current answers.
  function populateDocChecklist(stepEl) {
    var ul = stepEl && stepEl.querySelector('#noim-doc-checklist');
    if (!ul) return;
    function gv(name) { var el = document.querySelector('[name="'+name+'"]'); return el ? (el.value || '').trim() : ''; }
    var p1c = gv('p1_conjugal_status'), p2c = gv('p2_conjugal_status');
    var p1co = gv('p1_birth_country'), p2co = gv('p2_birth_country');
    var docs = [];
    docs.push(p1co === 'Australia' ? 'Official birth certificate (Party 1) — Australian' : 'Official birth certificate (Party 1) — from ' + (p1co || 'country of birth'));
    docs.push(p2co === 'Australia' ? 'Official birth certificate (Party 2) — Australian' : 'Official birth certificate (Party 2) — from ' + (p2co || 'country of birth'));
    docs.push('Government-issued photo ID for each party (passport, driver licence)');
    if (p1c === 'divorced') docs.push('Divorce order/decree absolute (Party 1)');
    if (p2c === 'divorced') docs.push('Divorce order/decree absolute (Party 2)');
    if (p1c === 'widowed') docs.push('Death certificate of former spouse (Party 1)');
    if (p2c === 'widowed') docs.push('Death certificate of former spouse (Party 2)');
    if (p1co && p1co !== 'Australia') docs.push('Certified translation of any non-English documents (Party 1)');
    if (p2co && p2co !== 'Australia') docs.push('Certified translation of any non-English documents (Party 2)');
    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    ul.innerHTML = docs.map(function(d) {
      return '<li style="display:flex;gap:8px;align-items:flex-start"><span style="color:#16a34a;font-weight:700">✓</span><span>' + esc(d) + '</span></li>';
    }).join('');
  }

  // Multi-step navigation
  var steps = document.querySelectorAll('.form-step');
  if (steps.length > 1) {
    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('step-next')) {
        var current = e.target.closest('.form-step');
        var idx = parseInt(current.getAttribute('data-step'));
        var invalid = false;
        current.querySelectorAll('[required]').forEach(function(el) {
          var wrapper = el.closest('[data-field-id]');
          if (wrapper && wrapper.style.display === 'none') return;
          if (el.type === 'radio') {
            var name = el.name;
            if (!current.querySelector('input[name="'+name+'"]:checked')) { el.closest('.flex')?.classList.add('text-red-600'); invalid = true; }
          } else if (!el.value.trim()) {
            el.classList.add('border-red-500'); invalid = true;
          }
        });
        if (invalid) return;
        current.style.display = 'none';
        var next = document.querySelector('[data-step="'+(idx+1)+'"]');
        if (next) { next.style.display = ''; populateDocChecklist(next); }
        window.scrollTo(0,0);
      }
      if (e.target.classList.contains('step-prev')) {
        var current = e.target.closest('.form-step');
        var idx = parseInt(current.getAttribute('data-step'));
        current.style.display = 'none';
        var prev = document.querySelector('[data-step="'+(idx-1)+'"]');
        if (prev) prev.style.display = '';
        window.scrollTo(0,0);
      }
    });
  }

  // Conditional fields
  function updateConditionals() {
    document.querySelectorAll('[data-conditions]').forEach(function(el) {
      var conditions = JSON.parse(el.getAttribute('data-conditions'));
      var visible = conditions.every(function(c) {
        var target = document.querySelector('[name="'+c.field+'"]');
        if (!target) {
          var radios = document.querySelectorAll('[name="'+c.field+'"]');
          var checked = '';
          radios.forEach(function(r) { if (r.checked) checked = r.value; });
          target = { value: checked };
        }
        var val = target.value || '';
        if (target.tagName === 'INPUT' && target.type === 'radio') {
          val = '';
          document.querySelectorAll('[name="'+c.field+'"]').forEach(function(r) { if (r.checked) val = r.value; });
        }
        if (c.operator === 'eq') return val === c.value;
        if (c.operator === 'neq') return val !== c.value;
        if (c.operator === 'in') return c.value.indexOf(val) !== -1;
        return true;
      });
      el.style.display = visible ? '' : 'none';
      if (!visible) {
        el.querySelectorAll('input,select,textarea').forEach(function(inp) { inp.removeAttribute('required'); });
      }
    });
  }

  document.addEventListener('change', updateConditionals);
  document.addEventListener('input', function(e) { setTimeout(updateConditionals, 50); });
  updateConditionals();

  // Title case on blur
  document.addEventListener('blur', function(e) {
    if (e.target.getAttribute && e.target.getAttribute('data-title-case') === 'true') {
      var val = e.target.value;
      if (val) { e.target.value = val.replace(/\\b\\w/g, function(c) { return c.toUpperCase(); }); }
    }
  }, true);
})();
`
}
