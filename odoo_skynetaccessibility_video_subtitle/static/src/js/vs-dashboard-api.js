/* ==========================================================================
   vs-dashboard-api.js — Odoo 17 port of the Skynet Video Subtitle Phase 2
   dashboard's api.js (see the django_skynetaccessibility_videosubtitle
   reference package). Logic is unchanged from the reference: every request
   still goes straight from the browser to the Skynet Video Subtitle API,
   because Import Module installs cannot ship a Python controller for this
   to proxy through.

   Base: https://ada.skynettechnologies.us/api/website-video

   Every request is sent as multipart/form-data with no custom headers, which
   keeps it a CORS "simple request" (the server only allows `content-type` in
   Access-Control-Allow-Headers, so adding an Authorization header would fail
   preflight — these endpoints do not require one).
   ========================================================================== */

(function (global) {
  "use strict";

  /* ======================================================================
     SITE_ORIGIN / PLATFORM.

     The reference Django build hardcodes these. Here they are instead read
     from window.SkynetVideoSubtitleConfig, which the dashboard page (see
     website/dashboard_page.xml) populates from this module's own
     ir.config_parameter rows (skynet_video_subtitle.api_base /
     skynet_video_subtitle.platform) — the same settings already used by
     Settings > SkynetAccessibility Video Subtitle > Configuration for the
     Phase 1 widget, and editable there without a code change. Falls back to
     the reference's hardcoded production values if that global is missing
     (e.g. the JS file is loaded standalone).
     ====================================================================== */
  var BOOT_CONFIG = (global.SkynetVideoSubtitleConfig && typeof global.SkynetVideoSubtitleConfig === "object")
    ? global.SkynetVideoSubtitleConfig
    : {};

  var SITE_ORIGIN = String(BOOT_CONFIG.siteOrigin || "https://ada.skynettechnologies.us").replace(/\/+$/, "");

  /* ---- Derived endpoint bases — do not edit ---- */
  var VIDEO_BASE = SITE_ORIGIN + "/api/website-video";
  var PACKAGES_URL = SITE_ORIGIN + "/api/video-subtitle/packages";
  var GET_START_URL = SITE_ORIGIN + "/api/video-subtitle/get-start";

  /* Sent as `platform` on registration, identifying where the install came
     from. */
  var PLATFORM = String(BOOT_CONFIG.platform || "Odoo");

  /* ----------------------------------------------------------------------
     Which site is this?

     DEFAULT: window.location.hostname — the domain the page is served
     from. Deploy it on any domain and it reports on that domain with no
     configuration at all. There is no hostname table and no site id to
     maintain.

     ?website_url=<domain> overrides it for local testing only (e.g.
     ?website_url=heygen.com while developing on localhost). Nothing in the
     deployed page ever sets it.
     ---------------------------------------------------------------------- */
  function resolveWebsiteUrl() {
    var override = new URLSearchParams(window.location.search).get("website_url");
    if (override) {
      console.warn(
        '[video-subtitle] TESTING: using website_url="' + override +
        '" from the URL instead of the real hostname "' + window.location.hostname + '".'
      );
      return override;
    }
    return window.location.hostname;
  }

  /* ----------------------------------------------------------------------
     Domain validation — mirrors isInvalidDomain() in the SkynetAccessibility
     Scanner plugin (skynet_scanner.js), so both plugins refuse the same set
     of hosts for the same reason: the service cannot scan/remediate
     localhost or a private/loopback IP, since those addresses are only
     reachable from the machine the browser itself is running on.

     Note this is checked against CONFIG.websiteUrl (i.e. AFTER the
     ?website_url= override above has been applied), not against the raw
     window.location.hostname — so local development against a real domain
     via the override still works exactly as documented above; only an
     un-overridden localhost/IP page is blocked.
     ---------------------------------------------------------------------- */
  var INVALID_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];

  function isInvalidDomain(hostname) {
    if (!hostname) return true;
    var h = String(hostname).toLowerCase();
    if (INVALID_HOSTS.indexOf(h) !== -1) return true;

    var ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      var a = Number(ipv4[1]);
      var b = Number(ipv4[2]);
      if (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 127
      ) {
        return true;
      }
    }

    /* IPv6 addresses (contain ':') are treated as local/unsupported too,
       same as the scanner plugin. */
    if (h.indexOf(":") !== -1) return true;

    return false;
  }

  function getInvalidDomainMessage(hostname) {
    return (
      "This dashboard only works on a live domain. Please open it from your " +
      "published site instead of \"" + hostname + "\"."
    );
  }

  var CONFIG = {
    siteOrigin: SITE_ORIGIN,
    baseURL: VIDEO_BASE,

    /* The site being reported on. `subtitle-list` and `packages` accept
       website_url; the write endpoints also want the numeric website_id,
       which is NOT configured here — it is read from the first list
       response (website_details.id) so no id is ever hardcoded. */
    websiteUrl: resolveWebsiteUrl(),
    websiteId: null,

    /* Computed once at load: true when websiteUrl resolves to localhost or
       a private/loopback IP. app.js checks this before doing anything else
       and, if true, shows a "Domain Not Valid" message instead of booting
       the dashboard — see isInvalidDomain() above. */
    isLocalDomain: false,
    invalidDomainMessage: "",

    /* The tier the site is on, filled in by getPlans() from the service's
       `currentPackage`. It gates the "Add a Video by URL" card — see
       renderTopCards() in app.js — and supplies the real header price. */
    currentPackage: null,

    /* Header billing fallbacks, used ONLY until getPlans() reports the real
       tier. planPrice is deliberately empty: showing an invented figure
       would be worse than showing none, so the header hides the price and
       status until the service supplies them.
       planStatus: "Active" | "Inactive" | "Expired" */
    planPrice: "",
    planInterval: "Month",
    planStatus: "Active"
  };

  if (isInvalidDomain(CONFIG.websiteUrl)) {
    CONFIG.isLocalDomain = true;
    CONFIG.invalidDomainMessage = getInvalidDomainMessage(CONFIG.websiteUrl);
  }

  /* ---- Status codes ----
     0 = Pending | 1, 2, 5 = Processing | 3 = Remediated | 4 = Failed        */

  /* Posts to a full URL. The video endpoints share one base, but the plan
     price list lives under /api/video-subtitle/, so the URL is passed whole. */
  function postTo(url, fields) {
    var body = new FormData();
    Object.keys(fields).forEach(function (key) {
      var value = fields[key];
      if (value === undefined || value === null || value === "") return;
      body.append(key, String(value));
    });

    return fetch(url, { method: "POST", body: body })
      .then(function (response) {
        return response.text().then(function (text) {
          var json;
          try {
            json = JSON.parse(text);
          } catch (e) {
            throw new Error(
              "The server returned a non-JSON response (HTTP " + response.status + ")."
            );
          }
          if (!response.ok && !json.error) {
            throw new Error(json.msg || "Request failed with HTTP " + response.status);
          }
          return json;
        });
      });
  }

  /* Posts to one of the video endpoints, which share a base URL. */
  function post(path, fields) {
    return postTo(CONFIG.baseURL + "/" + path, fields);
  }

  /* Posts a JSON body. Only `get-start` needs this — every other endpoint
     takes FormData. `content-type: application/json` is not a CORS "simple"
     value, so this one call is preflighted; the server allows it
     (Access-Control-Allow-Headers: content-type). */
  function postJson(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.text().then(function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new Error(
            "The server returned a non-JSON response (HTTP " + response.status + ")."
          );
        }
        if (!response.ok && !json.error) {
          throw new Error(json.msg || "Request failed with HTTP " + response.status);
        }
        return json;
      });
    });
  }

  /* ----------------------------------------------------------------------
     Registration state.

     `registrationPromise` is the once-only latch: it is created by the first
     getStart() call and returned to every later caller, so no matter how many
     times getStart() is invoked — re-render, retry, background poll — the
     network request happens exactly once per page load.
     ---------------------------------------------------------------------- */
  var registrationPromise = null;

  var REGISTRATION = {
    token: "",   // adon_token — held in memory only, never sent as an auth header
    link: "",    // adon_link — autologin URL for "Manage Account"
    message: ""
  };

  /* Laravel validation errors come back as {error: {field: [msg]}, status: 400} */
  function validationMessage(response) {
    if (!response || !response.error) return null;
    var messages = [];
    Object.keys(response.error).forEach(function (field) {
      var list = response.error[field];
      messages.push(Array.isArray(list) ? list[0] : String(list));
    });
    return messages.join(" ");
  }

  var Api = {
    config: CONFIG,
    validationMessage: validationMessage,
    registration: REGISTRATION,
    isInvalidDomain: isInvalidDomain,
    getInvalidDomainMessage: getInvalidDomainMessage,

    /* --------------------------------------------------------------------
       POST /api/video-subtitle/get-start   — registration / installation

       Registers this domain with the service and returns:
         adon_token — the install token
         adon_link  — an autologin URL for the full dashboard
         message    — human-readable status

       CALLED EXACTLY ONCE. The first call starts the request and stores the
       promise; every later call returns that same promise without touching
       the network. So the boot sequence, a retry, or the 40s background poll
       can all call it freely and only one registration is ever sent.

       Sent as JSON (this endpoint does not take FormData):
         website_url        the domain being registered
         platform           where the install came from
         name               display name
         email              contact address
         comapany_name      NOTE: the misspelling is the server's field name,
                            not a typo here — renaming it breaks registration
         manage_by_platform 1 when the platform manages billing, else 0

       A failure is deliberately non-fatal: `details`, `packages` and the
       video endpoints all key off website_url and work without a token, so
       the dashboard still loads if registration fails.
       -------------------------------------------------------------------- */
    getStart: function (options) {
      if (registrationPromise) return registrationPromise;   // ← once-only latch

      var opts = options || {};
      var site = CONFIG.websiteUrl;

      if (!site) {
        registrationPromise = Promise.reject(new Error("Website URL is required."));
        return registrationPromise;
      }

      /* SAFETY NOTE — read before calling this from anywhere new.

         get-start is an account-creating write, and calling it for a site
         that is ALREADY registered was observed to reset that site to the
         Free tier. So it must only ever run for a domain the service has
         no record of.

         That check does not live here; it lives at the only call site, in
         loadPlanContext() in app.js, which calls this exclusively when the
         packages response comes back with `currentPackage: null`. A
         registered site therefore never reaches this function at all —
         which protects real production domains, not just test ones.

         The check below is a second, unconditional guard: even if some
         future/other code path calls getStart() directly, a localhost or
         private-IP domain is refused before any network request is made.

         Do not call getStart() unconditionally. */

      if (CONFIG.isLocalDomain) {
        registrationPromise = Promise.reject(
          new Error("Registration is not available on a local domain.")
        );
        return registrationPromise;
      }

      registrationPromise = postJson(GET_START_URL, {
        website_url: site,
        platform: opts.platform || PLATFORM,
        /* Odoo already knows who is opening this dashboard (the logged-in
           Settings user - see website/dashboard_page.xml), so prefer that
           over the site-name fallback the reference build uses when no
           caller supplies one. */
        name: opts.name || BOOT_CONFIG.userName || site,
        email: opts.email || BOOT_CONFIG.userEmail || "no-reply@" + site,
        comapany_name: opts.companyName || site,
        /* Always 0: billing is handled by the service, not by a host
           platform. (Framer-style embeds that manage billing themselves
           would send 1 — this build never does.) */
        manage_by_platform: 0,
        /* Marks this install as the Phase 2 build. Always 1 here — the
           service uses it to tell Phase 2 registrations apart from the
           original ones. */
        is_phase_two: 1
      }).then(function (data) {
        REGISTRATION.token = data.adon_token ? String(data.adon_token) : "";
        REGISTRATION.link = data.adon_link ? String(data.adon_link) : "";
        REGISTRATION.message = String(data.message || data.msg || "");

        /* A repeat install can answer without a token or link. Neither is
           required by the other endpoints, so that is not an error. */
        return REGISTRATION;
      });

      return registrationPromise;
    },

    /* True once getStart() has been called, whatever the outcome. */
    hasRegistered: function () {
      return registrationPromise !== null;
    },

    /* --------------------------------------------------------------------
       POST /subtitle-list
       website_url | website_id, offset, limit, filter_value, short_by,
       is_decorative
       -------------------------------------------------------------------- */
    getVideoList: function (params) {
      var fields = {
        website_url: CONFIG.websiteUrl,
        offset: params.offset,
        limit: params.limit
      };

      /* filter_value must always be sent, "all" included: the API treats
         "all" as the Website Scan tab (pending only). Omitting the field
         returns every status instead, which is not what the tab shows.
         This mirrors `filter && data.append("filter_value", …)` in
         getVideoListApi, where `filter` defaults to the string "all". */
      if (params.filter) fields.filter_value = params.filter;
      if (params.sortBy) fields.short_by = params.sortBy;
      if (params.decorativeFilter && params.decorativeFilter !== "all") {
        fields.is_decorative = params.decorativeFilter;
      }

      return post("subtitle-list", fields).then(function (response) {
        var data = response.Data || [];

        /* The service reports the site itself alongside the videos, so the
           id is available even when the list is empty. The write endpoints
           need it, and a site with no videos yet is exactly when the
           add-a-page form is offered. */
        if (response.website_details && response.website_details.id) {
          CONFIG.websiteId = response.website_details.id;
        } else if (data.length && data[0].website_id) {
          CONFIG.websiteId = data[0].website_id;
        }

        return {
          Data: data,
          total_record: response.total_record || 0,
          total_remediated_videos: response.total_remediated_videos || 0,
          total_failed_videos: response.total_failed_videos || 0,
          total_minutes: response.total_minutes || 0,
          total_used_minutes: response.total_used_minutes || 0,
          total_remain_minutes: response.total_remain_minutes || 0,
          total_pages: response.total_pages || 0,
          total_scanned_pages: response.total_scanned_pages || 0,
          scannning_process: response.scannning_process,
          is_url_scan: response.is_url_scan,
          /* Not returned by this endpoint — kept so the pre-purchase warning
             in the selection footer stays inert rather than throwing. */
          total_pre_purchased_pages: response.total_pre_purchased_pages || 0,
          total_pre_purchased_remaining_pages:
            response.total_pre_purchased_remaining_pages || 0,
          website_details: response.website_details || null,
          msg: response.msg
        };
      });
    },

    /* --------------------------------------------------------------------
       POST /pages   — video_id
       -------------------------------------------------------------------- */
    getVideoPages: function (videoId) {
      return post("pages", { video_id: videoId });
    },

    /* --------------------------------------------------------------------
       POST /make-decorative   — video_id, is_decorative
       -------------------------------------------------------------------- */
    setDecorative: function (videoId, isDecorative) {
      return post("make-decorative", {
        video_id: videoId,
        is_decorative: isDecorative
      }).then(function (response) {
        var invalid = validationMessage(response);
        if (invalid) throw new Error(invalid);
        return response;
      });
    },

    /* --------------------------------------------------------------------
       POST /add-page   — website_id, page_url
       -------------------------------------------------------------------- */
    addVideoManually: function (pageUrl) {
      return post("add-page", {
        /* website_id comes from the list response; website_url is sent
           alongside it so the call still resolves the site if the id has
           not arrived yet (postTo drops null/empty fields). */
        website_id: CONFIG.websiteId,
        website_url: CONFIG.websiteUrl,
        page_url: pageUrl
      }).then(function (response) {
        var invalid = validationMessage(response);
        if (invalid) throw new Error(invalid);
        return response;
      });
    },

    /* --------------------------------------------------------------------
       POST /update-status
       website_id, website_video_ids (comma separated), status, is_multi_lang
       -------------------------------------------------------------------- */
    requestRemediation: function (videoIds, isMultiLang) {
      return post("update-status", {
        website_id: CONFIG.websiteId,
        website_url: CONFIG.websiteUrl,
        website_video_ids: videoIds.join(","),
        status: 1,
        is_multi_lang: isMultiLang ? 1 : 0
      }).then(function (response) {
        var invalid = validationMessage(response);
        if (invalid) throw new Error(invalid);
        return response;
      });
    },

    /* --------------------------------------------------------------------
       POST /next-scan-request   — website_id, is_all_page_scan_video
       is_all_page_scan_video: 0 = next batch of 50, 1 = full scan
       -------------------------------------------------------------------- */
    startScan: function (scanAll) {
      return post("next-scan-request", {
        website_id: CONFIG.websiteId,
        website_url: CONFIG.websiteUrl,
        is_all_page_scan_video: scanAll
      }).then(function (response) {
        var invalid = validationMessage(response);
        if (invalid) throw new Error(invalid);
        if (response && response.Data === null && response.msg) {
          throw new Error(response.msg);
        }
        return response;
      });
    },

    /* --------------------------------------------------------------------
       POST /api/video-subtitle/packages   — website_url

       The website URL has to be sent. Without it the service returns the bare
       price list: no current package and no checkout links.

       `pages` is the plan's allowance in minutes, and billing is monthly only
       — this add-on has no yearly option.
       -------------------------------------------------------------------- */
    getPlans: function () {
      /* Unconditional guard, same reasoning as getStart(): a localhost or
         private-IP domain must never reach the service, no matter which
         UI element (Upgrade Plan button, plan modal, etc.) calls this. */
      if (CONFIG.isLocalDomain) {
        return Promise.reject(
          new Error("Plans are not available on a local domain.")
        );
      }

      return postTo(PACKAGES_URL, { website_url: CONFIG.websiteUrl })
        .then(function (response) {
          var plans = (response.Data || []).map(function (plan) {
            return {
              id: plan.id,
              name: plan.name,
              minutes: Number(plan.pages) || 0,
              price: Number(plan.monthly_price) || 0,
              paymentLink: plan.payment_link || ""
            };
          }).sort(function (a, b) {
            return a.minutes - b.minutes;
          });

          CONFIG.currentPackage = response.currentPackage || null;

          return { plans: plans, currentPackage: CONFIG.currentPackage };
        });
    },

    /* --------------------------------------------------------------------
       Whether the site is on the free tier.

       The service names the tier in currentPackage; the free one costs
       nothing and is the only one carrying "free" in its name.
       -------------------------------------------------------------------- */
    isFreePlan: function () {
      var current = CONFIG.currentPackage;

      return !!current && String(current.name || "").toLowerCase().indexOf("free") !== -1;
    }
  };

  global.VideoApi = Api;
})(window);
