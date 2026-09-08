/* ==========================================================================
   app.js — vanilla-JS port of Pages/VideoSubtitleReport/VideoList.tsx
            (+ Components/Pagination and Components/VideoSubtitleReport/
               UpgradeVideoPlan)

   The React state hooks map onto the `state` object below; every `render*`
   function is the equivalent of one JSX block in the original component.
   ========================================================================== */

(function () {
  "use strict";

  /* ======================================================================
     1. STATE  (useState hooks from VideoList.tsx)
     ====================================================================== */
  var state = {
    tabStep: 0,              // 0 = Website Scan | 1 = Remediated | 2 = Failed
    filter: "all",           // status filter
    decorativeFilter: "all", // "all" | "1" | "0"
    sortBy: "1",

    currentPage: 1,
    limit: 10,
    offset: 0,

    videoList: [],
    selectVideo: [],         // full objects, mirroring the React array

    totalRecord: 0,
    filteredRecord: 0,
    totalRemediatedVideos: 0,
    totalFailedVideos: 0,
    totalVideosMin: 0,
    totalUsedVideosMin: 0,
    totalRemaingVideosMin: 0,
    totalPages: 0,
    totalScannedPages: 0,
    prePurchaseVideoTotalCount: 0,
    prePurchaseVideoRemainingCount: 0,
    isScanned: 1,
    isScanblock: 1,

    isCheckAll: false,
    filterMultiLang: false,
    scanMode: 0,
    scanning: false,
    addingVideo: false,
    paymentBtnLoading: false,
    manualUrlError: "",
    updatingDecorative: {},

    pendingDecorative: { videoId: null, newValue: null },
    plans: [],
    currentPackage: null,
    packagesLoaded: false,
    selectedPlanId: null,

    isAddon: false,

    lastError: null
  };

  var midpoint = 0;          // Pagination component's midpoint state
  var scanTimer = null;
  var pollTimer = null;

  var el = {};
  var modals = {};
  var statusLegendPopover = null;

  /* ======================================================================
     2. HELPERS
     ====================================================================== */

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* formatDuration() from VideoList.tsx */
  function formatDuration(durationInSeconds) {
    if (!durationInSeconds || durationInSeconds <= 0) return "N/A";
    var minutes = Math.floor(durationInSeconds / 60);
    var seconds = Math.floor(durationInSeconds % 60);
    var parts = [];
    if (minutes > 0) parts.push(minutes + "m");
    parts.push(seconds + " sec");
    return parts.join(" ");
  }

  /* formatMinutesAsTime() from VideoList.tsx */
  function formatMinutesAsTime(totalMinutes) {
    var totalSeconds = Math.round(totalMinutes * 60);
    var mins = Math.floor(totalSeconds / 60);
    var secs = totalSeconds % 60;
    return mins + ":" + String(secs).padStart(2, "0");
  }

  /* The component displays minutes as `12.35` -> `12:35`. */
  function minutesAsClock(minutes) {
    return (minutes || 0).toFixed(2).replace(".", ":");
  }

  /* Budget maths from HandleCheckAll / individualCheck: the remaining figure
     is read as mm:ss, i.e. 12.35 means 12 minutes 35 seconds.              */
  function remainingBudgetSeconds() {
    var parts = String(state.totalRemaingVideosMin).split(".");
    var seconds = parseInt(parts[0] || "0", 10) * 60;
    if (parts.length > 1) {
      seconds += parseInt(String(parts[1] + "00").slice(0, 2), 10) || 0;
    }
    return seconds;
  }

  function selectedSeconds() {
    return state.selectVideo.reduce(function (acc, v) {
      return acc + (v.duration || 0);
    }, 0);
  }

  /* isSelectable() from VideoList.tsx */
  function isSelectable(item) {
    return item.is_decorative !== 1 &&
      item.status !== 3 &&
      item.status !== 1 &&
      item.status !== 4;
  }

  /* The row checkbox additionally disables status 2 (queued). */
  function isRowDisabled(item) {
    return item.is_decorative === 1 ||
      item.status === 3 ||
      item.status === 1 ||
      item.status === 2 ||
      item.status === 4;
  }

  /* The tier the site is on, as the service reports it. Replaces the
     `isFreePlanVideoSubtitle` prop the React component received. */
  function isFreePlan() {
    return VideoApi.isFreePlan();
  }

  /* Whether a scan is actually running.

     scannning_process is 0 both while a scan runs and before one has ever
     run, so a free tier with no pages counted has simply never been scanned
     and reporting progress there would be untrue. This mirrors
     showVideoScrapingProgress in VideoList.tsx. */
  function isScanning() {
    return state.isScanblock !== 3 && state.isScanned === 0 &&
      (!isFreePlan() || state.totalPages > 0);
  }

  function isSelected(item) {
    return state.selectVideo.some(function (s) { return s.id === item.id; });
  }

  function showToast(message, type) {
    var variants = {
      success: "text-bg-success",
      danger: "text-bg-danger",
      warning: "text-bg-warning",
      info: "text-bg-info"
    };
    var wrapper = document.createElement("div");
    wrapper.className = "toast align-items-center border-0 " + (variants[type] || variants.info);
    wrapper.setAttribute("role", "alert");
    wrapper.setAttribute("aria-live", "assertive");
    wrapper.setAttribute("aria-atomic", "true");
    wrapper.innerHTML =
      '<div class="d-flex">' +
        '<div class="toast-body">' + escapeHtml(message) + "</div>" +
        '<button type="button" class="btn-close btn-close-white me-2 m-auto" ' +
        'data-bs-dismiss="toast" aria-label="Close"></button>' +
      "</div>";
    el.toastContainer.appendChild(wrapper);
    var toast = new bootstrap.Toast(wrapper, { delay: 4000 });
    toast.show();
    wrapper.addEventListener("hidden.bs.toast", function () { wrapper.remove(); });
  }

  /* ======================================================================
     3. DATA LOADING  (getVideoListService)
     ====================================================================== */

  function loadVideoList(options) {
    /* Domain guard, defense in depth: even if something re-triggers a
       load (tab click, retry button, background poll) on a localhost/
       private-IP page, never actually call the API for it. */
    if (VideoApi.config.isLocalDomain) {
      el.tableBody.innerHTML = renderDomainInvalidState();
      return Promise.resolve();
    }

    var silent = options && options.silent;
    if (!silent) setTableLoading(true);

    return VideoApi.getVideoList({
      offset: state.offset,
      limit: state.limit,
      filter: state.filter,
      sortBy: state.sortBy,
      decorativeFilter: state.decorativeFilter
    }).then(function (response) {
      state.lastError = null;
      state.videoList = response.Data;
      state.totalRecord = response.total_record;
      state.totalRemediatedVideos = response.total_remediated_videos;
      state.totalFailedVideos = response.total_failed_videos;
      state.totalVideosMin = response.total_minutes;
      state.totalUsedVideosMin = response.total_used_minutes;
      state.totalRemaingVideosMin = response.total_remain_minutes;
      state.totalPages = response.total_pages;
      state.totalScannedPages = response.total_scanned_pages;
      state.isScanned = response.scannning_process;
      state.isScanblock = response.is_url_scan;
      state.prePurchaseVideoTotalCount = response.total_pre_purchased_pages;
      state.prePurchaseVideoRemainingCount = response.total_pre_purchased_remaining_pages;
      renderAll();
    }).catch(function (error) {
      state.lastError = error.message || "Unable to reach the API.";
      renderAll();
      if (!silent) showToast(state.lastError, "danger");
    });
  }

  function setTableLoading(loading) {
    if (!loading) return;
    el.tableBody.innerHTML =
      '<div class="d-flex align-items-center justify-content-center py-5 gap-2">' +
        '<span class="spinner-border text-primary" role="status" aria-hidden="true"></span>' +
        '<span class="ms-2">Loading videos&hellip;</span>' +
      "</div>";
  }

  /* Effect: offset follows currentPage / limit */
  function syncOffset() {
    state.offset = state.currentPage * state.limit - state.limit;
  }

  /* ======================================================================
     4. RENDER
     ====================================================================== */

  function renderAll() {
    renderAddonHeader();
    renderStats();
    renderScanBanner();
    renderTopCards();
    renderTabs();
    renderFilters();
    renderTable();
    renderSelectionFooter();
    renderPagination();
    renderShowRecord();
  }

  /* ---- Stat cards + quota alert ---- */
  function renderStats() {
    var isQuotaReached = state.totalVideosMin > 0 &&
      state.totalUsedVideosMin >= state.totalVideosMin;
    var isLowRemaining = state.totalVideosMin > 0 && state.totalRemaingVideosMin <= 0.05;

    el.statRemediated.textContent = state.totalRemediatedVideos;
    el.statTotalMin.textContent = state.totalVideosMin;
    el.statUsedMin.textContent = minutesAsClock(state.totalUsedVideosMin);
    el.statRemainMin.textContent = minutesAsClock(state.totalRemaingVideosMin);

    el.quotaAlertRow.classList.toggle("d-none", !isQuotaReached);
    el.lowQuotaHint.classList.toggle("d-none", !(isLowRemaining && !isQuotaReached));
  }

  /* ---- Add-on header: price and plan status ---- */
  function renderAddonHeader() {
    var config = VideoApi.config;
    var current = state.currentPackage;

    /* Show what the tier the site is on actually costs, when the service has
       told us. The matching entry in the price list carries the real figure;
       currentPackage.price is not reliable. */
    var tier = current && state.plans.length
      ? state.plans.find(function (plan) { return plan.id === current.package_price_id; })
      : null;

    /* Only ever show a price the service actually reported. If the tier is
       not known yet (first paint, or a domain the service has no record
       of), the price and interval stay hidden rather than displaying an
       invented figure — a wrong price on screen is worse than none. */
    /* A zero-cost tier reads as "Free Plan" rather than "$0/Month" — an
       amount and a billing period are meaningless when nothing is charged.
       Same rule as the Framer plugin: monthlyPrice > 0 ? "$n" : "Free Plan". */
    var isFree = !!tier && Number(tier.price) === 0;
    var label = tier ? (isFree ? "Free Plan" : "$" + tier.price) : config.planPrice;
    var known = !!label;

    el.planPrice.textContent = label;
    el.planPrice.classList.toggle("d-none", !known);

    /* The "/Month" suffix only belongs beside an actual charge, so it is
       hidden for a free tier as well as for an unknown one. Hide the
       wrapper, not just the inner span — it carries the "/" separator,
       which would otherwise be left floating on its own. */
    el.planInterval.textContent = config.planInterval;
    var intervalWrap = el.planInterval.closest(".addon-price-interval") || el.planInterval;
    intervalWrap.classList.toggle("d-none", !known || isFree);

    el.planStatus.textContent = config.planStatus;
    el.planStatus.classList.toggle("d-none", !known);
    el.planStatus.classList.toggle("is-inactive", config.planStatus === "Inactive");
    el.planStatus.classList.toggle("is-expired", config.planStatus === "Expired");
  }

  /* ---- Scan progress / blocked banner ---- */
  function renderScanBanner() {
    var blocked = state.isScanblock === 3;
    el.scanBlockedBox.classList.toggle("d-none", !blocked);

    var showProgress = isScanning();
    el.scanProgressBox.classList.toggle("d-none", !showProgress);

    if (!showProgress) return;

    var scanPercent = state.totalPages > 0
      ? Math.min(100, Math.round((state.totalScannedPages / state.totalPages) * 100))
      : 0;

    el.scanPercentLabel.textContent = scanPercent + "%";
    el.scanProgressBar.style.width = scanPercent + "%";
    el.scanProgressBar.setAttribute("aria-valuenow", scanPercent);
    el.scanProgressText.innerHTML = state.totalPages > 0
      ? escapeHtml(state.totalScannedPages) + " of " + escapeHtml(state.totalPages) + " pages scanned"
      : "Preparing scan&hellip;";
  }

  /* ---- Manual-URL and scan-more cards ---- */
  function renderTopCards() {
    var listTab = state.filter !== "3" && state.filter !== "4";

    /* Free tier only, and only while the service has found nothing. Adding a
       page URL is how a free site gets its first video, so the card has done
       its job once one appears. It also stays out of the way while a scan is
       running, so the scan and the URL field never show together, and while
       the site is unreachable, when queuing a page would fail anyway. */
    var foundVideos = (state.totalRecord || 0) + (state.totalRemediatedVideos || 0) +
      (state.totalFailedVideos || 0);
    var showAddVideoUrl = listTab && state.packagesLoaded && isFreePlan() &&
      foundVideos === 0 && !isScanning() && state.isScanblock !== 3;

    var showScanMore = listTab && state.isScanned === 1 &&
      !isFreePlan() &&
      state.totalPages !== state.totalScannedPages;

    el.manualUrlCol.classList.toggle("d-none", !showAddVideoUrl);
    el.scanMoreCol.classList.toggle("d-none", !showScanMore);
    el.topCardsWrapper.classList.toggle("d-none", !(showAddVideoUrl || showScanMore));

    el.scanMoreBtnLabel.textContent = "Find Video for " + VideoApi.config.websiteUrl;
    el.manualUrlInput.placeholder = "e.g. https://" + VideoApi.config.websiteUrl + "/videos/intro";
    el.remainingUrlCount.textContent =
      Math.max(0, state.totalPages - state.totalScannedPages).toLocaleString();
  }

  /* ---- Tabs ---- */
  function renderTabs() {
    el.tabCount0.textContent = state.totalRecord || 0;
    el.tabCount1.textContent = state.totalRemediatedVideos || 0;
    el.tabCount2.textContent = state.totalFailedVideos || 0;

    Array.prototype.forEach.call(el.tabButtons, function (btn) {
      var active = parseInt(btn.dataset.tab, 10) === state.tabStep;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    el.listCaption.textContent = state.tabStep === 1
      ? "Following are list of remediated Video"
      : state.tabStep === 2
        ? "Following are list of failed Video"
        : "Select Video URL to Request Remediation services";
  }

  /* ---- Filter controls ---- */
  function renderFilters() {
    var listTab = state.filter !== "3" && state.filter !== "4";
    el.decorativeFilterBlock.classList.toggle("d-none", !listTab);
    el.statusFilterBlock.classList.toggle("d-none", !listTab);

    el.decorativeFilter.value = state.decorativeFilter;
    el.statusFilter.value = state.filter;
    el.limitSelect.value = String(state.limit);
  }

  /* ---- Table ---- */
  function renderTable() {
    var listTab = state.filter !== "3" && state.filter !== "4";

    el.thSelectAll.classList.toggle("d-none", !listTab);
    el.thDecorative.classList.toggle("d-none", !listTab);

    syncSelectAllCheckbox();

    if (!state.videoList.length) {
      el.tableBody.innerHTML = renderEmptyState();
      return;
    }

    var rows = state.videoList.map(function (video, index) {
      var selected = isSelected(video);
      var disabled = isRowDisabled(video);

      var checkboxCell = listTab
        ? '<div class="aioa_dashboard-table-td tcw-50 aioa_dashboard-table-cell-sidegap">' +
            '<div class="aioa_dashboard-table-td-cell-title d-none">Select Video</div>' +
            '<div class="aioa_dashboard-table-td-cell-value" aria-label="Select Video">' +
              '<span ' + (disabled ? 'data-bs-toggle="tooltip" title="' + escapeHtml(disabledReason(video)) + '"' : "") + '>' +
                '<div class="form-check p-0 m-0">' +
                  '<input class="form-check-input" type="checkbox" aria-label="Select Video" ' +
                    'data-row-select="' + video.id + '" id="video-check-' + video.id + '" ' +
                    (selected ? "checked " : "") + (disabled ? "disabled " : "") + "/>" +
                "</div>" +
              "</span>" +
            "</div>" +
          "</div>"
        : "";

      var decorativeCell = listTab
        ? '<div class="aioa_dashboard-table-td tcw-150 aioa_dashboard-table-cell-sidegap text-center">' +
            '<div class="aioa_dashboard-table-td-cell-title d-none">Decorative Status</div>' +
            '<div class="aioa_dashboard-table-td-cell-value" aria-label="Decorative Status">' +
              '<div class="form-check form-switch d-flex align-items-center justify-content-center">' +
                '<input class="form-check-input" type="checkbox" role="switch" ' +
                  'id="decorative-switch-' + video.id + '" data-decorative="' + video.id + '" ' +
                  'aria-label="Mark video as decorative" ' +
                  (video.is_decorative === 1 ? "checked " : "") +
                  (state.updatingDecorative[video.id] ? "disabled " : "") + "/>" +
              "</div>" +
            "</div>" +
          "</div>"
        : "";

      return '<div class="aioa_dashboard-table-tr">' +
        checkboxCell +
        '<div class="aioa_dashboard-table-td tcw-100 aioa_dashboard-table-cell-sidegap">' +
          '<div class="aioa_dashboard-table-td-cell-title d-none">Sr No</div>' +
          '<div class="aioa_dashboard-table-td-cell-value text-center" aria-label="Sr No">' +
            (index + 1 + state.offset) +
          "</div>" +
        "</div>" +
        '<div class="aioa_dashboard-table-td tcw-auto aioa_dashboard-table-cell-sidegap">' +
          '<div class="aioa_dashboard-table-td-cell-title d-none">Video URL</div>' +
          '<div class="aioa_dashboard-table-td-cell-value" aria-label="Video URL">' +
            '<span class="text-primary domain-name video-title d-block">' +
              '<a href="' + escapeHtml(video.video_url) + '" target="_blank" rel="noreferrer" ' +
                'class="d-flex flex-column" title="' + escapeHtml(video.video_url) + '">' +
                escapeHtml(video.video_url) +
              "</a>" +
            "</span>" +
          "</div>" +
        "</div>" +
        '<div class="aioa_dashboard-table-td tcw-150 aioa_dashboard-table-cell-sidegap text-center">' +
          '<div class="aioa_dashboard-table-td-cell-title d-none">Duration</div>' +
          '<div class="aioa_dashboard-table-td-cell-value" aria-label="Duration">' +
            escapeHtml(formatDuration(video.duration)) +
          "</div>" +
        "</div>" +
        decorativeCell +
        '<div class="aioa_dashboard-table-td tcw-50 aioa_dashboard-table-cell-sidegap text-center">' +
          '<div class="aioa_dashboard-table-td-cell-title d-none">Pages</div>' +
          '<div class="aioa_dashboard-table-td-cell-value" aria-label="Pages">' +
            '<button type="button" class="btn btn-link btn-sm p-0 text-primary" ' +
              'data-view-pages="' + video.id + '" aria-label="View pages for this video">' +
              '<i class="material-symbols-outlined" style="font-size:1.5rem">visibility</i>' +
            "</button>" +
          "</div>" +
        "</div>" +
        '<div class="aioa_dashboard-table-td tcw-200 text-center aioa_dashboard-table-cell-sidegap">' +
          '<div class="aioa_dashboard-table-td-cell-title d-none">Status</div>' +
          '<div class="aioa_dashboard-table-td-cell-value" aria-label="Status">' +
            renderStatusBadge(video) +
          "</div>" +
        "</div>" +
      "</div>";
    });

    el.tableBody.innerHTML = rows.join("");
    initTooltips(el.tableBody);
  }

  function disabledReason(video) {
    if (video.is_decorative === 1) return "Decorative videos cannot be remediated";
    if (video.status === 1 || video.status === 2 || video.status === 5) return "Video already requested";
    if (video.status === 4) return "Non Remediable";
    if (video.status === 3) return "Remediated";
    return "";
  }

  function renderStatusBadge(video) {
    if (video.status === 1 || video.status === 2 || video.status === 5) {
      return '<span class="badge text-bg-secondary py-1 processing-status-badge">' +
        "<span>Processing</span>" +
        '<span class="processing-spinner" aria-hidden="true"></span>' +
      "</span>";
    }
    if (video.status === 0) {
      return '<span class="badge text-bg-warning py-1">Pending</span>';
    }
    if (video.status === 4) {
      var reason = video.failed_msg && video.failed_msg.trim()
        ? video.failed_msg
        : "Not able to access video need permission";
      return '<span class="badge text-bg-danger py-1 d-inline-flex align-items-center gap-1">Failed' +
        '<i class="material-symbols-outlined" style="font-size:1rem;cursor:pointer;line-height:1" ' +
          'data-bs-toggle="tooltip" data-bs-placement="top" title="' + escapeHtml(reason) + '" ' +
          'role="button" tabindex="0" aria-label="Failed reason">info</i>' +
      "</span>";
    }
    if (video.status === 3) {
      return '<span class="badge text-bg-success py-1">Remediated</span>';
    }
    return "";
  }

  function renderDomainInvalidState() {
    return '<div class="d-flex flex-column align-items-center justify-content-center text-center py-5">' +
      '<div style="background:#F5EEFB;border:1px solid #E1CFF5;border-radius:14px;' +
        'padding:1.5rem 2rem;max-width:560px;">' +
        '<h5 class="mb-2" style="color:#420083;">Domain Not Valid</h5>' +
        '<p class="mb-0" style="color:#5A5A6E;">' + escapeHtml(VideoApi.config.invalidDomainMessage) + "</p>" +
      "</div>" +
    "</div>";
  }

  function renderEmptyState() {
    if (state.lastError) {
      return '<div class="aioa_dashboard-no-record">' +
        '<span class="material-symbols-outlined" style="color:#E74C3C">cloud_off</span>' +
        "<p><strong>Couldn't load videos.</strong><br />" + escapeHtml(state.lastError) + "</p>" +
        '<button type="button" class="btn btn-outline-primary btn-sm mt-2" data-retry>Retry</button>' +
      "</div>";
    }
    if (state.tabStep === 0 && state.isScanned === 0) {
      return '<div class="d-flex flex-column align-items-center justify-content-center text-center py-5">' +
        '<i class="material-symbols-outlined" style="font-size:48px;color:#420083">travel_explore</i>' +
        '<h5 class="mt-3 mb-1">Scanning website for videos&hellip;</h5>' +
        '<p class="text-muted mb-0">We\'re still looking for videos on your site. ' +
        "Results will appear here once found.</p>" +
      "</div>";
    }

    if (state.tabStep === 0 && state.isScanned === 1 && state.totalRecord === 0 &&
        (state.totalRemediatedVideos > 0 || state.totalFailedVideos > 0)) {
      var heading = state.totalFailedVideos > 0 && state.totalRemediatedVideos > 0
        ? "All videos have been remediated or marked as failed."
        : state.totalFailedVideos > 0
          ? "All videos have been processed. Some videos failed remediation."
          : "All videos have been successfully remediated!";
      return '<div class="d-flex flex-column align-items-center justify-content-center text-center py-5">' +
        '<i class="material-symbols-outlined" style="font-size:48px;color:#2ECC71">task_alt</i>' +
        '<h5 class="mt-3 mb-1">' + escapeHtml(heading) + "</h5>" +
        '<p class="text-muted mb-0">Check the Remediated and Failed tabs to review the results.</p>' +
      "</div>";
    }

    var text = state.tabStep === 0
      ? "No videos found yet!"
      : state.tabStep === 1
        ? "No video's remediated yet!"
        : "No failed videos found!";
    return '<div class="aioa_dashboard-no-record">' +
      '<span class="material-symbols-outlined">' +
        (state.tabStep === 0 ? "smart_display" : "video_library") +
      "</span>" +
      "<p>" + escapeHtml(text) + "</p>" +
    "</div>";
  }

  /* ---- Sticky selection footer ---- */
  function renderSelectionFooter() {
    var visible = state.selectVideo.length > 0 && state.tabStep === 0;
    el.selectionFooter.classList.toggle("d-none", !visible);
    if (!visible) return;

    var selectedMinutes = selectedSeconds() / 60;
    el.selectionSummary.textContent =
      state.selectVideo.length + " Selected Videos  (" +
      formatMinutesAsTime(selectedMinutes) + " / " +
      minutesAsClock(state.totalRemaingVideosMin) + " min)";

    var hasPending = state.selectVideo.some(function (v) { return v.status === 0; });
    el.selectionActions.classList.toggle("d-none", !hasPending);

    var showPrePurchaseWarning = state.prePurchaseVideoTotalCount > 0 &&
      state.prePurchaseVideoRemainingCount > 0 &&
      state.prePurchaseVideoRemainingCount < state.selectVideo.length;
    el.prePurchaseAlert.classList.toggle("d-none", !showPrePurchaseWarning);
    if (showPrePurchaseWarning) {
      el.prePurchaseAlert.innerHTML = "<strong>" + state.selectVideo.length +
        " Videos selected. You can select up to " + state.prePurchaseVideoRemainingCount +
        " Videos under your current plan.</strong>";
    }

    var hasZeroDuration = state.selectVideo.some(function (v) { return v.duration === 0; });
    el.estimatedPricingMsg.classList.toggle("d-none", !hasZeroDuration);

    el.remediateSelectedBtn.disabled = state.paymentBtnLoading;
    el.multiLangSwitch.checked = state.filterMultiLang;
  }

  /* ---- Select-all checkbox state (useEffect on renderVideoList) ---- */
  function syncSelectAllCheckbox() {
    var selectable = state.videoList.filter(isSelectable);

    if (!selectable.length) {
      state.isCheckAll = false;
      el.selectAllCheckbox.checked = false;
      el.selectAllCheckbox.disabled = true;
      return;
    }

    var unselected = selectable.filter(function (item) { return !isSelected(item); });
    var remaining = remainingBudgetSeconds() - selectedSeconds();
    var canSelectMore = unselected.some(function (item) {
      return (item.duration || 0) <= remaining;
    });

    state.isCheckAll = unselected.length === 0 || !canSelectMore;
    el.selectAllCheckbox.checked = state.isCheckAll;
    el.selectAllCheckbox.disabled =
      state.selectVideo.length === 0 && unselected.length === selectable.length && !canSelectMore;
  }

  /* ---- ShowRecordItem ---- */
  function renderShowRecord() {
    var total = paginationTotal();
    if (!total) {
      el.showRecordItem.textContent = "";
      return;
    }
    var from = state.offset + 1;
    var to = Math.min(state.offset + state.limit, total);
    el.showRecordItem.textContent = "Showing " + from + " - " + to + " of " + total + " item(s)";
  }

  /* VideoList.tsx passes total_remediated_videos / total_failed_videos for
     those two tabs and total_record otherwise. */
  function paginationTotal() {
    if (state.filter === "3") return state.totalRemediatedVideos;
    if (state.filter === "4") return state.totalFailedVideos;
    return state.totalRecord;
  }

  /* ---- PaginationComponent port ---- */
  function renderPagination() {
    var totalRecords = paginationTotal();
    var totalPages = Math.ceil(totalRecords / state.limit);
    el.paginationList.innerHTML = "";

    if (totalPages <= 1) return;

    if (!midpoint) midpoint = 4;
    if (state.currentPage > 5 && state.currentPage < totalPages - 2) {
      midpoint = state.currentPage;
    } else if (state.currentPage > 6 && state.currentPage >= totalPages - 2) {
      midpoint = totalPages - 3;
    }

    var items = [];

    function pageItem(page) {
      return { type: "page", page: page };
    }

    if (totalPages < 10) {
      for (var i = 1; i <= totalPages; i++) items.push(pageItem(i));
    } else {
      items.push(pageItem(1));
      items.push({ type: "ellipsis", dir: "down", disabled: midpoint <= 4 });
      for (var m = midpoint - 2; m <= midpoint + 2; m++) items.push(pageItem(m));
      items.push({ type: "ellipsis", dir: "up", disabled: midpoint >= totalPages - 3 });
      items.push(pageItem(totalPages));
    }

    var html = "";
    html += navItem("&laquo;", 1, state.currentPage === 1, "First page");
    html += navItem("&lsaquo;", state.currentPage - 1, state.currentPage === 1, "Previous page");

    items.forEach(function (item) {
      if (item.type === "page") {
        if (item.page < 1 || item.page > totalPages) return;
        html += '<li class="page-item' + (item.page === state.currentPage ? " active" : "") + '">' +
          '<button type="button" class="page-link" data-page="' + item.page + '">' + item.page + "</button>" +
        "</li>";
      } else {
        if (item.disabled) return;
        html += '<li class="page-item">' +
          '<button type="button" class="page-link" data-shift="' + item.dir + '" ' +
            'aria-label="More pages">&hellip;</button>' +
        "</li>";
      }
    });

    html += navItem("&rsaquo;", state.currentPage + 1, state.currentPage === totalPages, "Next page");
    html += navItem("&raquo;", totalPages, state.currentPage === totalPages, "Last page");

    el.paginationList.innerHTML = html;

    function navItem(label, page, disabled, aria) {
      return '<li class="page-item' + (disabled ? " disabled" : "") + '">' +
        '<button type="button" class="page-link" data-page="' + page + '" ' +
          'aria-label="' + aria + '"' + (disabled ? " disabled" : "") + ">" + label + "</button>" +
      "</li>";
    }
  }

  function shiftMidpoint(direction) {
    var totalPages = Math.ceil(paginationTotal() / state.limit);
    if (direction === "down") {
      midpoint = midpoint - 5 <= 3 ? 4 : midpoint - 5;
    } else {
      midpoint = midpoint + 5 >= totalPages - 1 ? totalPages - 3 : midpoint + 5;
    }
    renderPagination();
  }

  /* ======================================================================
     5. SELECTION HANDLERS
     ====================================================================== */

  /* individualCheck() */
  function individualCheck(video, checked) {
    if (checked) {
      var newTotal = selectedSeconds() + (video.duration || 0);
      if (newTotal > remainingBudgetSeconds()) {
        showToast(
          "Selected videos total duration exceeds the limit of " +
          minutesAsClock(state.totalRemaingVideosMin) + " minutes.",
          "danger"
        );
        renderTable();
        return;
      }
      state.selectVideo = state.selectVideo.concat([video]);
    } else {
      state.selectVideo = state.selectVideo.filter(function (v) { return v.id !== video.id; });
    }
    renderTable();
    renderSelectionFooter();
  }

  /* HandleCheckAll() */
  function handleCheckAll(checked) {
    if (checked) {
      var remaining = remainingBudgetSeconds() - selectedSeconds();
      var available = state.videoList.filter(function (item) {
        return isSelectable(item) && !isSelected(item);
      });

      var newlySelected = [];
      available.forEach(function (video) {
        var duration = video.duration || 0;
        if (duration <= remaining) {
          newlySelected.push(video);
          remaining -= duration;
        }
      });

      if (newlySelected.length) {
        state.selectVideo = state.selectVideo.concat(newlySelected);
      } else {
        showToast("You have reached the maximum allowed minutes for video remediation.", "danger");
      }
    } else {
      var pageIds = state.videoList.filter(isSelectable).map(function (v) { return v.id; });
      state.selectVideo = state.selectVideo.filter(function (v) {
        return pageIds.indexOf(v.id) === -1;
      });
    }
    renderTable();
    renderSelectionFooter();
  }

  function clearSelection() {
    state.selectVideo = [];
  }

  /* ======================================================================
     6. ACTIONS
     ====================================================================== */

  /* handleDirectPaymentRequest() */
  function handleDirectPaymentRequest() {
    if (!state.selectVideo.length) return;
    state.paymentBtnLoading = true;
    el.remediateSelectedBtn.disabled = true;
    el.remediateSelectedBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing&hellip;';

    var ids = state.selectVideo.map(function (v) { return v.id; });

    VideoApi.requestRemediation(ids, state.filterMultiLang)
      .then(function (response) {
        showToast(response.msg || ids.length + " video(s) queued for remediation.", "success");
        clearSelection();
        state.currentPage = 1;
        syncOffset();
        return loadVideoList({ silent: true });
      })
      .catch(function (error) {
        showToast(error.message || "Could not submit the selected videos.", "danger");
      })
      .finally(function () {
        state.paymentBtnLoading = false;
        el.remediateSelectedBtn.innerHTML =
          '<span class="material-symbols-outlined me-2" style="font-size:20px">auto_awesome</span>' +
          "Add Selected for Remediation";
        el.remediateSelectedBtn.disabled = false;
      });
  }

  /* handleDecorativeUpdate() */
  function handleDecorativeUpdate(videoId, newValue) {
    var video = state.videoList.find(function (v) { return v.id === videoId; });
    if (!video) return;

    var oldValue = video.is_decorative;
    video.is_decorative = newValue;
    if (newValue === 1) {
      state.selectVideo = state.selectVideo.filter(function (v) { return v.id !== videoId; });
    }
    state.updatingDecorative[videoId] = true;
    renderTable();
    renderSelectionFooter();

    VideoApi.setDecorative(videoId, newValue)
      .then(function (response) {
        showToast(response.msg || "Decorative status updated successfully", "success");
      })
      .catch(function (error) {
        video.is_decorative = oldValue;
        showToast(error.message || "Failed to update decorative status", "danger");
      })
      .finally(function () {
        state.updatingDecorative[videoId] = false;
        // Re-fetch so the decorative filter stays authoritative.
        loadVideoList({ silent: true });
      });
  }

  /* handleViewPages() */
  function handleViewPages(videoId) {
    el.pagesModalBody.innerHTML =
      '<div class="text-center py-3">' +
        '<span class="spinner-border text-primary" role="status" aria-hidden="true"></span>' +
        '<span class="ms-2">Loading pages&hellip;</span>' +
      "</div>";
    modals.pages.show();

    VideoApi.getVideoPages(videoId).catch(function (error) {
      return { Data: [], error: error.message };
    }).then(function (response) {
      if (response.error) {
        el.pagesModalBody.innerHTML =
          '<div class="alert alert-danger mb-0">' + escapeHtml(response.error) + "</div>";
        return;
      }
      if (!response.Data || !response.Data.length) {
        el.pagesModalBody.innerHTML =
          '<div class="d-flex justify-content-center align-items-center">' +
            '<p class="h6 mb-0">No pages associated with this video.</p>' +
          "</div>";
        return;
      }
      var rows = response.Data.map(function (pageItem, idx) {
        var url = (pageItem.page_detail && pageItem.page_detail.page_url) || "";
        return "<tr><td>" + (idx + 1) + "</td><td>" +
          '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" ' +
          'class="text-primary text-decoration-none">' + escapeHtml(url) + "</a></td></tr>";
      }).join("");

      el.pagesModalBody.innerHTML =
        '<div class="table-responsive">' +
          '<table class="table table-striped table-hover mb-0">' +
            "<thead><tr><th>Sr No</th><th>URL</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
          "</table>" +
        "</div>";
    });
  }

  /* handleAddVideoManually() + URL validation */
  function isAllowedDomain(hostname, allowedDomain) {
    if (!allowedDomain) return false;
    var normalizeHost = function (h) {
      return h.toLowerCase().replace(/^www\./, "").replace(/\/+$/, "");
    };
    var normalizedHost = normalizeHost(hostname);
    var normalizedAllowed = allowedDomain.toLowerCase().trim();
    try {
      normalizedAllowed = new URL(
        normalizedAllowed.indexOf("http") === 0 ? normalizedAllowed : "https://" + normalizedAllowed
      ).hostname;
    } catch (e) { /* fall back to the raw string */ }
    normalizedAllowed = normalizeHost(normalizedAllowed);
    return normalizedHost === normalizedAllowed ||
      normalizedHost.slice(-(normalizedAllowed.length + 1)) === "." + normalizedAllowed;
  }

  function isValidVideoUrl(value, websiteDomain) {
    var trimmed = value.trim();
    if (!trimmed) return { valid: false, reason: "empty" };

    var parsed;
    try {
      parsed = new URL(trimmed);
    } catch (e) {
      return { valid: false, reason: "malformed" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, reason: "malformed" };
    }
    if (!parsed.hostname || parsed.hostname.indexOf(".") === -1) {
      return { valid: false, reason: "malformed" };
    }
    if (!isAllowedDomain(parsed.hostname, websiteDomain)) {
      return { valid: false, reason: "domain" };
    }
    return { valid: true };
  }

  function handleManualUrlChange(value) {
    if (!value.trim()) {
      setManualUrlError("");
    } else {
      var result = isValidVideoUrl(value, VideoApi.config.websiteUrl);
      if (result.valid) {
        setManualUrlError("");
      } else if (result.reason === "domain") {
        setManualUrlError("URL must belong to " + VideoApi.config.websiteUrl);
      } else {
        setManualUrlError("Please enter a valid URL (must start with http:// or https://)");
      }
    }
    el.addManualUrlBtn.disabled =
      state.addingVideo || !value.trim() || !!state.manualUrlError;
  }

  function setManualUrlError(message) {
    state.manualUrlError = message;
    el.manualUrlInput.classList.toggle("is-invalid", !!message);
    el.manualUrlError.textContent = message;
    el.manualUrlHelp.classList.toggle("d-none", !!message);
  }

  function handleAddVideoManually() {
    var trimmed = el.manualUrlInput.value.trim();
    if (!trimmed) {
      showToast("Please enter a valid URL", "warning");
      return;
    }
    var result = isValidVideoUrl(trimmed, VideoApi.config.websiteUrl);
    if (!result.valid) {
      var message = result.reason === "domain"
        ? "URL must belong to " + VideoApi.config.websiteUrl
        : "Please enter a valid URL";
      setManualUrlError(message);
      showToast(message, "warning");
      return;
    }

    state.addingVideo = true;
    el.addManualUrlBtn.disabled = true;
    el.addManualUrlBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Adding&hellip;';

    VideoApi.addVideoManually(trimmed)
      .then(function (response) {
        var ok = response.status === undefined || response.status === 200;
        showToast(response.msg || (ok ? "Video URL added." : "Could not add the URL."),
          ok ? "success" : "danger");
        if (ok) {
          el.manualUrlInput.value = "";
          setManualUrlError("");
        }
        return loadVideoList({ silent: true });
      })
      .catch(function (error) {
        showToast(error.message || "Failed to add video. Please try again.", "danger");
      })
      .finally(function () {
        state.addingVideo = false;
        el.addManualUrlBtn.innerHTML =
          '<span class="material-symbols-outlined" style="font-size:18px">add</span><span>Add URL</span>';
        el.addManualUrlBtn.disabled = !el.manualUrlInput.value.trim() || !!state.manualUrlError;
      });
  }

  /* handleScanNextBatch() */
  function handleScanNextBatch(scanAll) {
    state.scanning = true;
    el.scanConfirmBtn.disabled = true;
    el.scanCancelBtn.disabled = true;
    el.scanConfirmBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Scanning&hellip;';

    VideoApi.startScan(scanAll)
      .then(function (response) {
        modals.scan.hide();
        showToast(response.msg || "Scan started.", "success");
        startScanPolling();
        return loadVideoList({ silent: true });
      })
      .catch(function (error) {
        showToast(error.message || "Failed to start scan", "danger");
      })
      .finally(function () {
        state.scanning = false;
        el.scanConfirmBtn.disabled = false;
        el.scanCancelBtn.disabled = false;
        updateScanConfirmLabel();
      });
  }

  /* While a scan is running the list is re-polled every 10s (instead of the
     component's 40s) so the progress bar advances visibly. Stops when the
     server reports scannning_process === 1. */
  function startScanPolling() {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = setInterval(function () {
      loadVideoList({ silent: true }).then(function () {
        if (state.isScanned === 1) {
          clearInterval(scanTimer);
          scanTimer = null;
          showToast("Website scan completed.", "success");
        }
      });
    }, 10000);
  }

  function updateScanConfirmLabel() {
    el.scanConfirmBtn.textContent = state.scanMode === 1
      ? "Confirm & Start Full Scan"
      : "Confirm";
  }

  /* ======================================================================
     7. PLAN SELECTION MODAL  (UpgradeVideoPlan.tsx)
     ====================================================================== */

  /* Reads the tier this site is on, and remembers the tiers on offer. */
  /* ----------------------------------------------------------------------
     Loads the plan catalog and, if this site is not registered yet,
     registers it and reloads so the freshly created account is reflected.

     `currentPackage: null` in the packages response means the service has
     no record of this domain. That is the ONLY situation in which
     get-start is called:

         packages → currentPackage == null → get-start → packages again

     Keeping registration conditional matters. get-start is an
     account-creating write, and calling it for a site that already exists
     was observed to reset that site to the Free tier. A registered site
     always comes back with a currentPackage, so it never reaches the
     registration branch.

     `allowRegister` guards the recursion: the retry passes false, so a
     domain the service still will not register cannot loop.
     ---------------------------------------------------------------------- */
  function loadPlanContext(allowRegister) {
    /* Domain guard, defense in depth — see loadVideoList(). get-start is
       an account-creating write, so this matters even more here: it must
       never run for "localhost". */
    if (VideoApi.config.isLocalDomain) {
      state.packagesLoaded = true;
      return Promise.resolve();
    }

    var mayRegister = allowRegister !== false;

    return VideoApi.getPlans().then(function (result) {
      state.plans = result.plans;
      state.currentPackage = result.currentPackage;

      if (!result.currentPackage && mayRegister) {
        /* Not registered yet — create the account, then read the catalog
           again so the new tier drives the header and the rest of the UI. */
        return VideoApi.getStart()
          .then(function () {
            /* The registration's adon_link is intentionally not surfaced —
               see the note in index.html where the button used to be. It is
               still available on VideoApi.registration.link if a future
               endpoint makes an account link usable for every site. */
            return loadPlanContext(false); // ← retry once, cannot recurse again
          })
          .catch(function (error) {
            /* Non-fatal: the video endpoints key off website_url and work
               without an account, so the dashboard still loads. */
            console.warn("[video-subtitle] get-start registration failed:", error.message);
            state.packagesLoaded = true;
            renderAddonHeader();
          });
      }

      state.packagesLoaded = true;
      renderAddonHeader();
    }).catch(function () {
      state.packagesLoaded = true;
    });
  }

  function openPlanModal() {
    /* Domain guard: the header's Upgrade Plan button stays visible even on
       the "Domain Not Valid" screen, so without this check it was the one
       remaining path that could still hit the service (getPlans) for a
       localhost/private-IP domain. */
    if (VideoApi.config.isLocalDomain) {
      showToast(VideoApi.config.invalidDomainMessage, "danger");
      return;
    }

    VideoApi.getPlans().then(function (result) {
      state.plans = result.plans;
      state.currentPackage = result.currentPackage;
      state.selectedPlanId = null;
      renderPlanList();
      modals.plan.show();
    }).catch(function (error) {
      showToast(error.message || "Could not load plans.", "danger");
    });
  }

  function renderPlanList() {
    /* The allowance of the tier the site is on. It arrives with the price
       list, so it is current even when the video list has not reloaded. */
    var current = state.currentPackage && state.currentPackage.pages
      ? Number(state.currentPackage.pages)
      : (state.totalVideosMin || 0);

    var availablePlans = state.plans.filter(function (plan) {
      return plan.minutes > current && plan.price > 0;
    });

    /* The smallest step up is the one to suggest. */
    var recommended = availablePlans.length ? availablePlans[0] : null;

    if (!availablePlans.length) {
      el.planList.innerHTML =
        '<div class="d-flex align-content-center justify-content-center w-100 fs-5 fw-bold">' +
          '<div class="card" style="border:2px solid #420083;' +
          'background:linear-gradient(78deg,#D5D1FD 10.33%,#EDEBFF 121.25%);padding:20px">' +
            '<div class="card-body"><p class="mb-0">To upgrade your plan please contact us at ' +
            "'hello@skynettechnologies.com'</p></div>" +
          "</div>" +
        "</div>";
      el.planFooter.classList.add("d-none");
      return;
    }

    el.planFooter.classList.remove("d-none");

    el.planList.innerHTML = availablePlans.map(function (item) {
      var selected = state.selectedPlanId === item.id;
      var isFree = Number(item.price) === 0;

      return '<div class="card aioa_dashboard-plan-radio-row' + (selected ? " selected" : "") + '" ' +
        'role="button" tabindex="0" data-plan="' + item.id + '" ' +
        'data-pay="' + escapeHtml(item.paymentLink) + '">' +
        '<div class="card-body d-flex align-items-center justify-content-between">' +
          '<div class="d-flex align-items-start gap-3">' +
            '<div class="form-check aioa_dashboard-plan-radio-input m-0">' +
              '<input class="form-check-input" type="radio" name="plan-select" ' +
                'aria-label="' + escapeHtml(item.name) + '" ' + (selected ? "checked" : "") + " />" +
            "</div>" +
            "<div>" +
              '<div class="aioa_dashboard-plan-radio-name d-flex align-items-center">' +
                "<div>" + escapeHtml(item.name) + "</div>" +
                (recommended && recommended.id === item.id
                  ? '<span class="badge-recommended ms-1">Recommended</span>'
                  : "") +
              "</div>" +
              '<div class="aioa_dashboard-plan-radio-desc">Unlimited video remediation, up to ' +
                '<span class="highlight-text">' + item.minutes + " Minutes</span>" +
                " with unlimited subtitle playback</div>" +
            "</div>" +
          "</div>" +
          '<div class="aioa_dashboard-plan-radio-price text-end">' +
            (isFree
              ? '<div class="aioa_dashboard-plan-radio-current">Free</div>'
              : '<div class="aioa_dashboard-plan-radio-current">$' + item.price +
                "<span>/Month</span></div>") +
          "</div>" +
        "</div>" +
      "</div>";
    }).join("");

    el.planSubmitBtn.disabled = !state.selectedPlanId;
  }

  /* ======================================================================
     8. TOOLTIPS / POPOVERS
     ====================================================================== */

  function initTooltips(root) {
    root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (node) {
      var existing = bootstrap.Tooltip.getInstance(node);
      if (existing) existing.dispose();
      new bootstrap.Tooltip(node, { delay: { show: 250, hide: 400 } });
    });
  }

  function statusLegendHtml() {
    var rows = [
      ["#fd7e14", "Pending", "Pending for remediation."],
      ["#6c757d", "Processing", "Subtitle generation is in progress."],
      ["#198754", "Remediated", "Subtitle is generated successfully."],
      ["#9f0000", "Failed", "Unable to access or process video audio. Permission may be required."]
    ];
    return '<div class="d-flex flex-column gap-2">' +
      rows.map(function (row) {
        return '<div class="d-flex align-items-center gap-1">' +
          '<span class="status-dot" style="background-color:' + row[0] + '"></span>' +
          '<span class="fw-semibold me-1">' + row[1] + "</span>" +
          '<span class="text-muted small">' + row[2] + "</span>" +
        "</div>";
      }).join("") +
    "</div>";
  }

  /* ======================================================================
     9. WIRING
     ====================================================================== */

  function cacheElements() {
    el.toastContainer = $("toastContainer");
    el.planPrice = $("planPrice");
    el.planInterval = $("planInterval");
    el.planStatus = $("planStatus");

    el.quotaAlertRow = $("quotaAlertRow");
    el.lowQuotaHint = $("lowQuotaHint");
    el.statRemediated = $("statRemediated");
    el.statTotalMin = $("statTotalMin");
    el.statUsedMin = $("statUsedMin");
    el.statRemainMin = $("statRemainMin");

    el.scanBlockedBox = $("scanBlockedBox");
    el.scanProgressBox = $("scanProgressBox");
    el.scanPercentLabel = $("scanPercentLabel");
    el.scanProgressBar = $("scanProgressBar");
    el.scanProgressText = $("scanProgressText");

    el.topCardsWrapper = $("topCardsWrapper");
    el.manualUrlCol = $("manualUrlCol");
    el.manualUrlInput = $("manualUrlInput");
    el.manualUrlError = $("manualUrlError");
    el.manualUrlHelp = $("manualUrlHelp");
    el.addManualUrlBtn = $("addManualUrlBtn");
    el.scanMoreCol = $("scanMoreCol");
    el.scanMoreBtnLabel = $("scanMoreBtnLabel");
    el.remainingUrlCount = $("remainingUrlCount");

    el.tabButtons = document.querySelectorAll("[data-tab]");
    el.tabCount0 = $("tabCount0");
    el.tabCount1 = $("tabCount1");
    el.tabCount2 = $("tabCount2");
    el.listCaption = $("listCaption");

    el.decorativeFilterBlock = $("decorativeFilterBlock");
    el.statusFilterBlock = $("statusFilterBlock");
    el.decorativeFilter = $("decorative_filter");
    el.statusFilter = $("pdf_type");
    el.limitSelect = $("showPages");

    el.thSelectAll = $("thSelectAll");
    el.thDecorative = $("thDecorative");
    el.selectAllCheckbox = $("selectAllCheckbox");
    el.tableBody = $("tableBody");

    el.selectionFooter = $("selectionFooter");
    el.selectionSummary = $("selectionSummary");
    el.selectionActions = $("selectionActions");
    el.prePurchaseAlert = $("prePurchaseAlert");
    el.estimatedPricingMsg = $("estimatedPricingMsg");
    el.remediateSelectedBtn = $("remediateSelectedBtn");
    el.multiLangSwitch = $("multi-lang-switch");

    el.showRecordItem = $("showRecordItem");
    el.paginationList = $("paginationList");

    el.pagesModalBody = $("pagesModalBody");
    el.scanConfirmBtn = $("scanConfirmBtn");
    el.scanCancelBtn = $("scanCancelBtn");
    el.fullScanWarning = $("fullScanWarning");

    el.planList = $("planList");
    el.planFooter = $("planFooter");
    el.planError = $("planError");
    el.planSubmitBtn = $("planSubmitBtn");
  }

  function initModals() {
    modals.pages = new bootstrap.Modal($("pagesModal"));
    modals.scan = new bootstrap.Modal($("scanModal"));
    modals.decorative = new bootstrap.Modal($("decorativeConfirmModal"));
    modals.status = new bootstrap.Modal($("statusModal"));
    modals.plan = new bootstrap.Modal($("planModal"));
    modals.howTo = new bootstrap.Modal($("howToUseModal"));
  }

  function bindEvents() {
    /* ---- Tabs ---- */
    Array.prototype.forEach.call(el.tabButtons, function (btn) {
      btn.addEventListener("click", function () {
        state.tabStep = parseInt(btn.dataset.tab, 10);
        state.filter = state.tabStep === 1 ? "3" : state.tabStep === 2 ? "4" : "all";
        state.currentPage = 1;
        state.offset = 0;
        clearSelection();
        loadVideoList();
      });
    });

    /* ---- Filters ---- */
    el.statusFilter.addEventListener("change", function () {
      state.filter = this.value;
      state.tabStep = this.value === "3" ? 1 : this.value === "4" ? 2 : 0;
      state.currentPage = 1;
      state.offset = 0;
      clearSelection();
      loadVideoList();
    });

    el.decorativeFilter.addEventListener("change", function () {
      state.decorativeFilter = this.value;
      state.currentPage = 1;
      state.offset = 0;
      clearSelection();
      loadVideoList();
    });

    el.limitSelect.addEventListener("change", function () {
      state.limit = parseInt(this.value, 10);
      state.currentPage = 1;
      syncOffset();
      loadVideoList();
    });

    /* ---- Pagination ---- */
    el.paginationList.addEventListener("click", function (event) {
      var btn = event.target.closest("button");
      if (!btn || btn.disabled) return;

      if (btn.dataset.shift) {
        shiftMidpoint(btn.dataset.shift);
        return;
      }
      var page = parseInt(btn.dataset.page, 10);
      var totalPages = Math.ceil(paginationTotal() / state.limit);
      if (!page || page < 1 || page > totalPages || page === state.currentPage) return;

      state.currentPage = page;
      syncOffset();
      loadVideoList();
    });

    /* ---- Table interactions (delegated) ---- */
    el.selectAllCheckbox.addEventListener("change", function () {
      handleCheckAll(this.checked);
    });

    el.tableBody.addEventListener("change", function (event) {
      var target = event.target;

      if (target.dataset.rowSelect) {
        var id = parseInt(target.dataset.rowSelect, 10);
        var video = state.videoList.find(function (v) { return v.id === id; });
        if (video) individualCheck(video, target.checked);
        return;
      }

      if (target.dataset.decorative) {
        state.pendingDecorative = {
          videoId: parseInt(target.dataset.decorative, 10),
          newValue: target.checked ? 1 : 0
        };
        target.checked = !target.checked; // wait for the confirmation
        modals.decorative.show();
      }
    });

    el.tableBody.addEventListener("click", function (event) {
      var pagesBtn = event.target.closest("[data-view-pages]");
      if (pagesBtn) {
        handleViewPages(parseInt(pagesBtn.dataset.viewPages, 10));
        return;
      }
      if (event.target.closest("[data-retry]")) loadVideoList();
    });

    $("howToUseBtn").addEventListener("click", function () {
      modals.howTo.show();
    });

    /* ---- Status legend popover ---- */
    statusLegendPopover = new bootstrap.Popover($("statusLegendBtn"), {
      html: true,
      sanitize: false,
      trigger: "focus",
      placement: "bottom",
      customClass: "status-legend",
      title: "Status Legend",
      content: statusLegendHtml()
    });

    /* ---- Selection footer ---- */
    el.multiLangSwitch.addEventListener("change", function () {
      state.filterMultiLang = this.checked;
    });
    el.remediateSelectedBtn.addEventListener("click", handleDirectPaymentRequest);

    /* ---- Decorative confirm ---- */
    $("decorativeConfirmBtn").addEventListener("click", function () {
      var pending = state.pendingDecorative;
      modals.decorative.hide();
      if (pending.videoId !== null && pending.newValue !== null) {
        handleDecorativeUpdate(pending.videoId, pending.newValue);
      }
      state.pendingDecorative = { videoId: null, newValue: null };
    });
    $("decorativeConfirmModal").addEventListener("hidden.bs.modal", function () {
      state.pendingDecorative = { videoId: null, newValue: null };
      renderTable();
    });

    /* ---- Manual URL ---- */
    el.manualUrlInput.addEventListener("input", function () {
      handleManualUrlChange(this.value);
    });
    el.manualUrlInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !el.addManualUrlBtn.disabled) handleAddVideoManually();
    });
    el.addManualUrlBtn.addEventListener("click", handleAddVideoManually);

    /* ---- Scan modal ---- */
    $("openScanModalBtn").addEventListener("click", function () {
      renderTopCards();
      modals.scan.show();
    });

    document.querySelectorAll(".scan-option").forEach(function (option) {
      var select = function () {
        state.scanMode = parseInt(option.dataset.scanMode, 10);
        document.querySelectorAll(".scan-option").forEach(function (node) {
          var active = node === option;
          node.classList.toggle("selected", active);
          node.querySelector('input[type="radio"]').checked = active;
        });
        el.fullScanWarning.classList.toggle("d-none", state.scanMode !== 1);
        updateScanConfirmLabel();
      };
      option.addEventListener("click", select);
      option.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
    });

    el.scanConfirmBtn.addEventListener("click", function () {
      handleScanNextBatch(state.scanMode);
    });

    /* ---- Plan modal ---- */
    $("upgradePlanBtn").addEventListener("click", openPlanModal);

    el.planList.addEventListener("click", function (event) {
      var row = event.target.closest("[data-plan]");
      if (!row) return;
      state.selectedPlanId = parseInt(row.dataset.plan, 10);
      el.planError.classList.add("d-none");
      renderPlanList();
    });

    el.planSubmitBtn.addEventListener("click", function () {
      if (!state.selectedPlanId) {
        el.planError.textContent = "Please select a plan to continue.";
        el.planError.classList.remove("d-none");
        return;
      }
      var plan = state.plans.find(function (p) { return p.id === state.selectedPlanId; });
      modals.plan.hide();
      if (plan && plan.paymentLink) {
        window.open(plan.paymentLink, "_blank", "noreferrer");
      } else {
        showToast("The service did not return a checkout link for that plan.", "danger");
      }
    });

  }

  /* Background refresh, mirroring the 40s interval in the React component. */
  function startBackgroundPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (state.selectVideo.length) return; // don't clobber an in-progress selection
      loadVideoList({ silent: true });
    }, 40000);
  }

  /* ======================================================================
     10. BOOT
     ====================================================================== */
  document.addEventListener("DOMContentLoaded", function () {
    cacheElements();
    initModals();
    bindEvents();

    /* Domain guard — mirrors the SkynetAccessibility Scanner plugin: a
       localhost/private-IP host has no real videos the service can reach,
       so registration and the video-list/plan requests never fire for it.
       The header, stat cards, and Add-URL card are left exactly as they
       render on first paint (all zeros) and the message is shown where
       the video list would normally appear, using the same empty-state
       treatment as "Scanning website for videos..." above. */
    if (VideoApi.config.isLocalDomain) {
      document.title = "SkynetAccessibility Video Subtitle — Domain Not Valid";
      el.tableBody.innerHTML = renderDomainInvalidState();

      /* Plan upgrade (and scanning) are account/billing actions tied to a
         registered domain. get-start is never called for localhost/
         private-IP hosts, so no account exists for them to upgrade or scan
         against — disable the buttons outright rather than relying only on
         the click-time guard in openPlanModal() and the API-level guards
         in api.js. */
      var upgradeBtn = $("upgradePlanBtn");
      if (upgradeBtn) {
        upgradeBtn.disabled = true;
        upgradeBtn.title = VideoApi.config.invalidDomainMessage;
      }
      var scanBtn = $("openScanModalBtn");
      if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.title = VideoApi.config.invalidDomainMessage;
      }
      return;
    }

    document.title = "SkynetAccessibility Video Subtitle — " + VideoApi.config.websiteUrl;
    syncOffset();
    updateScanConfirmLabel();

    /* The price list names the tier the site is on, which decides whether
       the add-by-URL card belongs on the page, so it is fetched before the
       first render.

       It also drives registration: if the catalog comes back with
       currentPackage == null, this domain has no account yet, so
       loadPlanContext() calls get-start once and re-reads the catalog. A
       registered site never reaches that branch. See loadPlanContext(). */
    loadPlanContext()
      .then(function () { return loadVideoList(); })
      .then(startBackgroundPolling);
  });
})();
