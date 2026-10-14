(() => {
  'use strict';

  const TAG_ID = 'AW-18126210838';
  // Set only after the production web stream and its Measurement ID are verified.
  const GA4_ID = 'G-VLXK9FKZ0R';
  const ga4Configured = typeof GA4_ID === 'string' && /^G-[A-Z0-9]+$/.test(GA4_ID);
  const CONSENT_KEY = 'nickrae_analytics_consent_v1';
  let analyticsReady = false;
  let analyticsInitialized = false;
  let analyticsConfigured = false;
  let analyticsLoaded = false;
  let analyticsScript;
  let pageViewSent = false;
  let consentResizeObserver;
  let consentRevision = 0;
  let consentOverride;
  let withdrawalReloadRequested = false;
  if (ga4Configured) window[`ga-disable-${GA4_ID}`] = true;
  const WORKBOOK_PRODUCTS = {
    'private-pilot': 'ppl_workbook',
    'instrument-rating': 'instrument_workbook',
    'commercial-pilot': 'commercial_workbook',
    'multi-engine': 'multi_engine_workbook',
    'vfr-radio': 'vfr_radio_calls_workbook'
  };

  function currentConsent() {
    // A failed storage write must never undo a withdrawal on this page.
    if (consentOverride !== undefined) return consentOverride;
    try { return window.localStorage.getItem(CONSENT_KEY); }
    catch (_) { return null; }
  }

  function setConsent(value) {
    if (value !== currentConsent()) consentRevision += 1;
    consentOverride = value === 'allow' ? undefined : value;
    try {
      if (value === null) window.localStorage.removeItem(CONSENT_KEY);
      else window.localStorage.setItem(CONSENT_KEY, value);
    }
    catch (_) {}
  }

  // Never include query strings, fragments, mail addresses or input values in
  // our measurement payloads. Retailer links themselves are left unchanged.
  function measurementUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : '';
    } catch (_) { return ''; }
  }

  function trackEvent(name, parameters = {}) {
    if (!ga4Configured || !analyticsReady || currentConsent() !== 'allow' || typeof window.gtag !== 'function') return false;
    const details = {};
    ['event_category', 'product', 'placement', 'form_id', 'destination_host'].forEach((key) => {
      if (typeof parameters[key] === 'string') details[key] = parameters[key];
    });
    if (parameters.link_url) details.link_url = measurementUrl(parameters.link_url);
    window.gtag('event', name, {
      ...details,
      page_path: window.location.pathname,
      page_location: measurementUrl(window.location.href),
      page_referrer: document.referrer ? measurementUrl(document.referrer) : '',
      measurement_version: '2026-10-14',
      send_to: GA4_ID
    });
    return true;
  }

  function activateMeasurement() {
    if (!analyticsLoaded || analyticsReady || currentConsent() !== 'allow') return;
    window.gtag('consent', 'update', {
      ad_storage: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'denied'
    });
    if (ga4Configured) window[`ga-disable-${GA4_ID}`] = false;
    if (!analyticsConfigured) {
      analyticsConfigured = true;
      // A connected Ads destination may already share the GA4 tag. Disable all
      // automatic config pageviews, then emit exactly one explicitly to GA4.
      const config = {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_location: measurementUrl(window.location.href),
        page_referrer: document.referrer ? measurementUrl(document.referrer) : ''
      };
      window.gtag('set', config);
      window.gtag('config', TAG_ID, config);
      if (ga4Configured) window.gtag('config', GA4_ID, config);
    }
    analyticsReady = true;
    if (!pageViewSent) pageViewSent = trackEvent('page_view');
    window.dispatchEvent(new CustomEvent('nickrae:analytics-ready'));
  }

  function loadAnalytics() {
    // Local previews and staging hosts must never pollute production reports.
    if (window.location.protocol !== 'https:' || !['nickrae.net', 'www.nickrae.net'].includes(window.location.hostname)) return;
    if (analyticsReady || currentConsent() !== 'allow') return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(){ window.dataLayer.push(arguments); };
    if (!analyticsInitialized) {
      analyticsInitialized = true;
      // Recheck permission on load before configuring either destination. A
      // withdrawal during the request must not leave a queued granted config.
      window.gtag('consent', 'default', {
        ad_storage: 'denied',
        analytics_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied'
      });
      window.gtag('js', new Date());
    }

    if (!analyticsScript) {
      analyticsScript = document.createElement('script');
      analyticsScript.async = true;
      analyticsScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(TAG_ID)}`;
      analyticsScript.onload = () => {
        analyticsLoaded = true;
        activateMeasurement();
      };
      analyticsScript.onerror = () => {
        analyticsScript?.remove();
        analyticsScript = null;
        analyticsLoaded = false;
        analyticsReady = false;
      };
    }
    // Reuse the same already-started script after withdrawal. Re-creating it
    // could initialize automatic listeners twice or replay dataLayer history.
    if (!analyticsScript.isConnected) document.head.appendChild(analyticsScript);
    activateMeasurement();
  }

  function clearGoogleCookies() {
    const names = ['_ga', '_gid', '_gat', '_gcl_au'];
    try {
      document.cookie.split(';').forEach((part) => {
        const name = part.split('=')[0].trim();
        if (name.startsWith('_ga') || name.startsWith('_gcl')) names.push(name);
      });
      [...new Set(names)].forEach((name) => {
        ['', `; domain=${window.location.hostname}`, '; domain=.nickrae.net'].forEach((domain) => {
          document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax${domain}`;
        });
      });
    } catch (_) {}
  }

  function disableAnalytics() {
    if (ga4Configured) window[`ga-disable-${GA4_ID}`] = true;
    const wasLoaded = analyticsInitialized;
    if (wasLoaded && typeof window.gtag === 'function') {
      try {
        window.gtag('consent', 'update', {
          ad_storage: 'denied',
          analytics_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied'
        });
      } catch (_) {}
    }
    analyticsReady = false;
    document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').forEach((script) => script.remove());
    clearGoogleCookies();
    if (wasLoaded) window.gtag = function gtagDisabled() {};
    else {
      try { delete window.gtag; } catch (_) {}
      try { delete window.dataLayer; } catch (_) {}
    }
  }

  function reloadWithoutMeasurement(force = false) {
    if (withdrawalReloadRequested || (!force && !analyticsInitialized)) return;
    try {
      // Read durable storage, not the page override: never reload into an old
      // saved allowance if the browser rejected the withdrawal/reset write.
      if (window.localStorage.getItem(CONSENT_KEY) === 'allow') return;
    } catch (_) { return; }
    withdrawalReloadRequested = true;
    window.location.reload();
  }

  function workbookProduct(url) {
    if (url.origin !== window.location.origin) return undefined;
    const match = url.pathname.match(/^\/aviation-workbooks\/([^/]+)\/(?:index\.html)?$/);
    return match ? WORKBOOK_PRODUCTS[match[1]] : undefined;
  }

  function eventNameFor(link, url) {
    if (!/^https?:$/.test(url.protocol)) return null;
    if (workbookProduct(url) && !url.hash) return 'product_detail_click';
    if (link.dataset.event === 'product_view') return 'product_detail_click';
    if (link.dataset.event === 'workbook_sample_view') return 'workbook_preview_click';
    if (link.dataset.event) return link.dataset.event;
    if (link.dataset.track) return `openclaw_${link.dataset.track}_click`;
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'amazon.com' || host.endsWith('.amazon.com') || host === 'a.co') return 'amazon_click';
    if (host === 'gumroad.com' || host.endsWith('.gumroad.com')) return 'gumroad_click';
    if (host === 'apps.apple.com') return 'app_store_click';
    if (host === 'nick-rae.kit.com' && url.pathname.replace(/\/$/, '') === '/899d974875') return 'ppl_signup_fallback_click';
    if (url.origin !== window.location.origin) return 'outbound_cta_click';
    if (url.pathname.startsWith('/assets/workbooks/previews/') || url.pathname.startsWith('/assets/workbook-previews/')) {
      return url.pathname.endsWith('.pdf') ? 'workbook_sample_download' : 'workbook_preview_open';
    }
    if (url.pathname.startsWith('/assets/workbooks/') && url.pathname.endsWith('.pdf')) return 'workbook_sample_download';
    if (['#preview', '#instrument-sample'].includes(url.hash)) return 'workbook_preview_click';
    if (url.hash === '#free-ppl-cards') return 'ppl_signup_click';
    if (link.dataset.product) return 'site_cta_click';
    return null;
  }

  function attachGlobalTracking() {
    document.addEventListener('click', (event) => {
      const link = event.target.closest && event.target.closest('a[href],button[data-event]');
      if (!link) return;
      try {
        const url = link.href ? new URL(link.href, window.location.href) : new URL(window.location.href);
        const eventName = eventNameFor(link, url);
        if (!eventName) return;
        trackEvent(eventName, {
          event_category: link.dataset.category || 'site_cta',
          product: workbookProduct(url) || link.dataset.product || workbookProduct(new URL(window.location.href)),
          placement: link.dataset.placement || document.body.dataset.page || window.location.pathname,
          link_url: link.href ? measurementUrl(link.href) : undefined,
          destination_host: url.hostname
        });
      } catch (_) {}
    });
  }

  function addPrivacyLink() {
    const footer = document.querySelector('footer');
    if (!footer || footer.querySelector('a[href$="/privacy/"],a[href$="/privacy"]')) return;
    const separator = document.createTextNode(' · ');
    const link = document.createElement('a');
    link.href = '/privacy/';
    link.textContent = 'Privacy';
    footer.append(separator, link);
  }

  function preserveCheckoutAttribution() {
    const inbound = new URLSearchParams(window.location.search);
    const preserveKeys = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','msclkid'];
    document.querySelectorAll('a[data-track="checkout"]').forEach((link) => {
      try {
        const url = new URL(link.href, window.location.href);
        preserveKeys.forEach((key) => {
          const value = inbound.get(key);
          if (value) url.searchParams.set(`landing_${key}`, value);
        });
        url.searchParams.set('cta_placement', link.dataset.placement || url.searchParams.get('utm_content') || 'unknown');
        link.href = url.toString();
      } catch (_) {}
    });
  }

  function removeBanner() {
    consentResizeObserver?.disconnect();
    document.getElementById('privacy-consent')?.remove();
    document.getElementById('privacy-consent-spacer')?.remove();
    document.documentElement.style.removeProperty('--privacy-banner-space');
  }

  function showBanner() {
    if (currentConsent() || document.getElementById('privacy-consent')) return;
    const banner = document.createElement('section');
    banner.id = 'privacy-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Analytics choice');
    const copy = document.createElement('div');
    copy.className = 'privacy-consent-copy';
    const heading = document.createElement('strong');
    heading.textContent = 'Privacy choice';
    const message = document.createElement('span');
    message.id = 'privacy-consent-description';
    message.textContent = 'Optional Google analytics and ad measurement. Off unless allowed; read and download either way.';
    banner.setAttribute('aria-describedby', message.id);
    const details = document.createElement('a');
    details.href = '/privacy/';
    details.textContent = 'Privacy details';
    copy.append(heading, message, details);

    const actions = document.createElement('div');
    actions.className = 'privacy-consent-actions';
    const deny = document.createElement('button');
    deny.type = 'button';
    deny.dataset.consent = 'deny';
    deny.textContent = 'Necessary only';
    const allow = document.createElement('button');
    allow.type = 'button';
    allow.className = 'allow';
    allow.dataset.consent = 'allow';
    allow.textContent = 'Allow measurement';
    actions.append(deny, allow);
    banner.append(copy, actions);
    const style = document.createElement('style');
    style.id = 'privacy-consent-style';
    style.textContent = `
      #privacy-consent{position:fixed;z-index:2147483647;left:1rem;right:1rem;bottom:1rem;max-width:920px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:.65rem;padding:.65rem .8rem;background:#07111f;color:#f8fafc;border:1px solid #94a3b8;border-radius:.65rem;box-shadow:0 18px 55px rgba(0,0,0,.55);font:500 14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      .privacy-consent-copy{display:flex;align-items:baseline;gap:.25rem .6rem;flex-wrap:wrap}.privacy-consent-copy strong{font-size:1rem}.privacy-consent-copy span{color:#dbeafe}.privacy-consent-copy a{color:#bfdbfe;text-decoration:underline;text-underline-offset:2px}
      .privacy-consent-actions{display:flex;gap:.6rem;flex:none}.privacy-consent-actions button{min-height:44px;border:2px solid #94a3b8;border-radius:.55rem;padding:.55rem .85rem;background:#111827;color:#fff;font:800 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer}.privacy-consent-actions button.allow{background:#111827;border-color:#94a3b8}.privacy-consent-actions button:focus-visible,.privacy-consent-copy a:focus-visible{outline:3px solid #fbbf24;outline-offset:3px}
      html{scroll-padding-bottom:var(--privacy-banner-space,0px)}
      @media(max-width:700px){#privacy-consent{align-items:stretch;flex-direction:column;left:.5rem;right:.5rem;bottom:.5rem;max-height:40dvh;overflow-y:auto}.privacy-consent-actions{display:grid;grid-template-columns:1fr 1fr}.privacy-consent-actions button{width:100%}}
    `;
    banner.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-consent]');
      if (!button) return;
      if (button.dataset.consent === 'allow') window.NickRaePrivacy.allow();
      else window.NickRaePrivacy.deny();
    });
    if (!document.getElementById(style.id)) document.head.appendChild(style);
    document.body.appendChild(banner);
    // Reserve actual overlay height so bottom-of-page content remains reachable
    // without accepting tracking. Keep the allowance correct on zoom/rotation.
    const spacer = document.createElement('div');
    spacer.id = 'privacy-consent-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(spacer);
    const reserveSpace = () => {
      const space = `${Math.ceil(banner.getBoundingClientRect().height) + 32}px`; // includes bottom inset and focus-outline clearance
      spacer.style.height = space;
      document.documentElement.style.setProperty('--privacy-banner-space', space);
    };
    reserveSpace();
    if (typeof ResizeObserver === 'function') {
      consentResizeObserver = new ResizeObserver(reserveSpace);
      consentResizeObserver.observe(banner);
    }
  }

  function enhanceNavigation() {
    document.querySelectorAll('body > nav:not(.sticky-cta), body > header > nav:not(.sticky-cta)').forEach((nav, index) => {
      const original = nav.querySelector('.menu-toggle');
      const links = nav.querySelector('.links, .nav-links');
      if (!original || !links) return;
      // Retire legacy inline and attached toggle listeners (some pages had both).
      const button = original.cloneNode(true);
      button.removeAttribute('onclick');
      button.type = 'button';
      button.setAttribute('aria-label', 'Navigation menu');
      if (!links.id) links.id = `site-navigation-${index}`;
      button.setAttribute('aria-controls', links.id);
      original.replaceWith(button);
      const setOpen = (open) => {
        links.classList.toggle('open', open);
        button.setAttribute('aria-expanded', String(open));
      };
      setOpen(false);
      button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
      links.addEventListener('click', (event) => {
        if (event.target.closest('a')) setOpen(false);
      });
      nav.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
          setOpen(false);
          button.focus();
        }
      });
      const mobile = window.matchMedia('(max-width:860px)');
      mobile.addEventListener('change', () => setOpen(false));
      nav.classList.add('navigation-enhanced');
    });
  }

  function enhanceArticleTables() {
    if (!document.body.classList.contains('article-page')) return;
    document.querySelectorAll('main table').forEach((table, index) => {
      // Existing accessible scroll regions already provide their own names/hints.
      if (table.closest('[role="region"][tabindex], .article-table-scroll')) return;
      const existing = table.parentElement;
      const reuse = existing?.matches('.summary-table, .table-wrap, .table-scroll');
      const region = reuse ? existing : document.createElement('div');
      if (!reuse) {
        table.before(region);
        region.appendChild(table);
      }
      region.classList.add('article-table-scroll');
      region.tabIndex = 0;
      region.setAttribute('role', 'region');
      const headings = [...document.querySelectorAll('main h2, main h3')];
      const heading = headings.filter((item) => item.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
      const label = table.caption?.textContent.trim() || heading?.textContent.trim() || `Article comparison ${index + 1}`;
      if (!region.hasAttribute('aria-label') && !region.hasAttribute('aria-labelledby')) {
        region.setAttribute('aria-label', `${label} table`);
      }
      const hint = document.createElement('p');
      hint.className = 'article-table-hint';
      hint.id = `article-table-hint-${index + 1}`;
      hint.textContent = 'Scroll sideways to read the full table. Keyboard: focus the table, then use the arrow keys.';
      region.after(hint);
      const describedBy = region.getAttribute('aria-describedby');
      region.setAttribute('aria-describedby', [describedBy, hint.id].filter(Boolean).join(' '));
      const updateHint = () => { hint.hidden = region.scrollWidth <= region.clientWidth + 1; };
      updateHint();
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(updateHint);
        observer.observe(region);
        observer.observe(table);
      } else window.addEventListener('resize', updateHint, {passive: true});
    });
  }

  function measurePplSignup(signup, index) {
    const uid = '899d974875';
    const formSelector = `form[data-uid="${uid}"]`;
    const successSelector = `.formkit-alert-success[data-element="success"][id="${uid}"]`;
    const parameters = {
      event_category: 'ppl_signup',
      form_id: uid,
      product: 'free_ppl_cards',
      placement: `${window.location.pathname}:ppl-${index + 1}`
    };
    let form;
    let viewed = false;
    let accepted = false;
    let pendingRevision = null;
    let completionSeen = false;
    let previousSuccess = new Set(signup.querySelectorAll(successSelector));

    const visible = (element) => {
      if (!element || !element.isConnected || element.hidden || !element.getClientRects().length) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const recordView = () => {
      if (viewed || !visible(form)) return;
      const rect = form.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      // One measured impression per rendered placement, at least 25% visible.
      if (width * height >= rect.width * rect.height * 0.25 && rect.width * rect.height > 0) {
        viewed = trackEvent('ppl_form_view', parameters);
      }
    };
    const visibilityObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(recordView, {threshold: [0, 0.25]}) : null;

    signup.addEventListener('submit', (event) => {
      if (!event.target.matches(formSelector)) return;
      recordView();
      completionSeen = false;
      previousSuccess = new Set(signup.querySelectorAll(successSelector));
      pendingRevision = trackEvent('ppl_form_submit', parameters) ? consentRevision : null;
    }, true);
    // Kit emits this only after its accepted-response flow. Its detail includes
    // the entered email, so never inspect, copy or forward event.detail.
    signup.addEventListener('ckjs:submission:complete', (event) => {
      if (event.target.matches(formSelector) && pendingRevision !== null) completionSeen = true;
    });

    const inspect = () => {
      const currentForm = signup.querySelector(formSelector);
      if (currentForm !== form) {
        if (form) visibilityObserver?.unobserve(form);
        form = currentForm;
        if (form) visibilityObserver?.observe(form);
      }
      recordView();
      if (accepted || !completionSeen || pendingRevision === null || pendingRevision !== consentRevision) return;
      const success = signup.querySelector(successSelector);
      if (!previousSuccess.has(success) && visible(success)) {
        // This means Kit displayed its accepted message. It is not evidence of
        // email confirmation, a new unique subscriber, PDF delivery or a sale.
        accepted = trackEvent('ppl_form_accepted', parameters);
        pendingRevision = null;
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(signup, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden']});
    window.addEventListener('nickrae:analytics-ready', inspect);
    if (!visibilityObserver) {
      window.addEventListener('scroll', recordView, {passive: true});
      window.addEventListener('resize', recordView, {passive: true});
    }
    inspect();
  }

  function enhancePplSignup() {
    const uid = '899d974875';
    document.querySelectorAll('.ppl-signup').forEach((signup, index) => {
      measurePplSignup(signup, index);
      const enhance = () => {
        const form = signup.querySelector(`form[data-uid="${uid}"]`);
        if (form) {
          signup.dataset.kitUid = uid;
          const email = form.querySelector('input[name="email_address"]');
          if (email) {
            if (!email.id) email.id = `ppl-email-${uid}-${index + 1}`;
            email.autocomplete = 'email';
            email.spellcheck = false;
            if (![...form.querySelectorAll('label')].some((label) => label.htmlFor === email.id)) {
              const label = document.createElement('label');
              label.className = 'ppl-email-label';
              label.htmlFor = email.id;
              label.textContent = 'Email address';
              email.before(label);
            }
          }
        }
        if (signup.dataset.kitUid !== uid) return;
        signup.querySelectorAll('.formkit-alert-error, [data-element="errors"]').forEach((alert) => {
          // Kit renders its errors as a list. Keep its native list semantics;
          // aria-live announces updates without an incompatible alert role.
          if (alert.matches('ul, ol')) alert.removeAttribute('role');
          else alert.setAttribute('role', 'alert');
          alert.setAttribute('aria-live', 'assertive');
          alert.setAttribute('aria-atomic', 'true');
        });
        signup.querySelectorAll('.formkit-alert-success').forEach((status) => {
          status.setAttribute('role', 'status');
          status.setAttribute('aria-live', 'polite');
          status.setAttribute('aria-atomic', 'true');
        });
      };
      enhance();
      const observer = new MutationObserver(enhance);
      observer.observe(signup, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
    });
  }

  function init() {
    enhanceNavigation();
    enhanceArticleTables();
    enhancePplSignup();
    addPrivacyLink();
    preserveCheckoutAttribution();
    attachGlobalTracking();
    if (currentConsent() === 'allow') loadAnalytics();
    else if (!currentConsent()) showBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();

  window.addEventListener('storage', (event) => {
    if (event.key !== CONSENT_KEY && event.key !== null) return;
    // Another tab can revoke consent while this tab still has Google's SDK.
    consentRevision += 1;
    if (currentConsent() === 'allow') loadAnalytics();
    else {
      disableAnalytics();
      reloadWithoutMeasurement();
    }
  });

  window.NickRaePrivacy = {
    consent: currentConsent,
    allow(){ setConsent('allow'); removeBanner(); loadAnalytics(); },
    deny(){
      setConsent('deny');
      removeBanner();
      disableAnalytics();
      reloadWithoutMeasurement();
    },
    reset(){
      setConsent(null);
      // Revoke active measurement before navigation can trigger unload events.
      disableAnalytics();
      reloadWithoutMeasurement(true);
    }
  };
  // Shared entry point for the calculator; it uses the same consent, host,
  // destination and URL protections as clicks and signup measurement.
  window.NickRaeMeasurement = Object.freeze({track: trackEvent});
})();
