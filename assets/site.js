(() => {
  'use strict';

  const TAG_ID = 'AW-18126210838';
  const CONSENT_KEY = 'nickrae_analytics_consent_v1';
  let analyticsReady = false;

  function currentConsent() {
    try { return window.localStorage.getItem(CONSENT_KEY); }
    catch (_) { return null; }
  }

  function setConsent(value) {
    try { window.localStorage.setItem(CONSENT_KEY, value); }
    catch (_) {}
  }

  function loadAnalytics() {
    if (analyticsReady || currentConsent() !== 'allow') return;
    analyticsReady = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(){ window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      ad_storage: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    window.gtag('config', TAG_ID, {allow_ad_personalization_signals: false});
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(TAG_ID)}`;
    document.head.appendChild(script);
    window.dispatchEvent(new CustomEvent('nickrae:analytics-ready'));
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
    const wasLoaded = analyticsReady || Boolean(document.querySelector('script[src*="googletagmanager.com/gtag/js"]'));
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

  function eventNameFor(link, url) {
    if (link.dataset.event) return link.dataset.event;
    if (link.dataset.track) return `openclaw_${link.dataset.track}_click`;
    const host = url.hostname.replace(/^www\./, '');
    if (host.includes('amazon.com') || host === 'a.co') return 'amazon_click';
    if (host.includes('gumroad.com')) return 'gumroad_click';
    if (host.includes('apps.apple.com')) return 'app_store_click';
    if (url.origin !== window.location.origin) return 'outbound_cta_click';
    return null;
  }

  function attachGlobalTracking() {
    const hasLegacyClickTracking = [...document.scripts].some((script) => {
      const text = script.textContent || '';
      return text.includes("addEventListener('click'") && text.includes('gtag(');
    });
    if (hasLegacyClickTracking) return;
    document.addEventListener('click', (event) => {
      const link = event.target.closest && event.target.closest('a[href],button[data-event]');
      if (!link || !analyticsReady || typeof window.gtag !== 'function') return;
      try {
        const url = link.href ? new URL(link.href, window.location.href) : new URL(window.location.href);
        const eventName = eventNameFor(link, url);
        if (!eventName) return;
        window.gtag('event', eventName, {
          send_to: eventName.startsWith('openclaw_') ? TAG_ID : undefined,
          event_category: link.dataset.category || 'site_cta',
          product: link.dataset.product || undefined,
          placement: link.dataset.placement || document.body.dataset.page || window.location.pathname,
          link_url: link.href || undefined,
          link_text: (link.textContent || '').trim().slice(0, 120) || undefined
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
    document.getElementById('privacy-consent')?.remove();
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
    message.textContent = 'This site uses optional Google analytics and advertising measurement only if you allow it. Necessary site features work without tracking.';
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
      #privacy-consent{position:fixed;z-index:2147483647;left:1rem;right:1rem;bottom:1rem;max-width:920px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.1rem;background:#07111f;color:#f8fafc;border:2px solid #60a5fa;border-radius:.8rem;box-shadow:0 18px 55px rgba(0,0,0,.55);font:500 14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      .privacy-consent-copy{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap}.privacy-consent-copy strong{font-size:1rem}.privacy-consent-copy span{color:#dbeafe}.privacy-consent-copy a{color:#bfdbfe;text-decoration:underline;text-underline-offset:2px}
      .privacy-consent-actions{display:flex;gap:.6rem;flex:none}.privacy-consent-actions button{min-height:44px;border:2px solid #94a3b8;border-radius:.55rem;padding:.55rem .85rem;background:#111827;color:#fff;font:800 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer}.privacy-consent-actions button.allow{background:#1d4ed8;border-color:#93c5fd}.privacy-consent-actions button:focus-visible,.privacy-consent-copy a:focus-visible{outline:3px solid #fbbf24;outline-offset:3px}
      @media(max-width:700px){#privacy-consent{align-items:stretch;flex-direction:column}.privacy-consent-actions{display:grid;grid-template-columns:1fr 1fr}.privacy-consent-actions button{width:100%}}
    `;
    banner.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-consent]');
      if (!button) return;
      setConsent(button.dataset.consent);
      removeBanner();
      if (button.dataset.consent === 'allow') loadAnalytics();
      else disableAnalytics();
    });
    document.head.appendChild(style);
    document.body.appendChild(banner);
  }

  function init() {
    addPrivacyLink();
    preserveCheckoutAttribution();
    attachGlobalTracking();
    if (currentConsent() === 'allow') loadAnalytics();
    else if (!currentConsent()) showBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();

  window.NickRaePrivacy = {
    consent: currentConsent,
    allow(){ setConsent('allow'); removeBanner(); loadAnalytics(); },
    deny(){ setConsent('deny'); removeBanner(); disableAnalytics(); },
    reset(){ try { localStorage.removeItem(CONSENT_KEY); } catch (_) {} location.reload(); }
  };
})();
