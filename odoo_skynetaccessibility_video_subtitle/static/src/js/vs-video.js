
/*
 * SkynetAccessibility Video Subtitle - dashboard front-end
 * Odoo 16 port of the statamic-skynet-accessibility-video-subtitle addon.
 * Talks directly to the Skynet Video Subtitle API (video-subtitle/details,
 * video-subtitle/packages, active-language, video-subtitle/settings,
 * video-subtitle/update-settings) - logic unchanged from the reference
 * implementation, only the host page (Odoo dashboard template) differs.
 */

// API CONFIGURATION.
// The base URL is injected by the Statamic addon (see dashboard.blade.php) via
// window.SAVS_API_BASE. It falls back to the live endpoint when opened standalone.
const API_BASE = (typeof window !== 'undefined' && window.SAVS_API_BASE)
    ? String(window.SAVS_API_BASE).replace(/\/+$/, '') + '/'
    : 'https://ada.skynettechnologies.us/api/';

const API_CONFIG = {
    videosUrl: API_BASE + 'video-subtitle/details',
    planPackagesUrl: API_BASE + 'video-subtitle/packages',
    activeLanguages: API_BASE + 'active-language',
    apiURL: API_BASE,
    headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',        
    },
};

/*const API_CONFIG = {
    videosUrl: 'https://stagingada.skynettechnologies.us/api/video-subtitle/details',
    planPackagesUrl: 'https://stagingada.skynettechnologies.us/api/video-subtitle/packages',    
    activeLanguages: 'https://stagingada.skynettechnologies.us/api/active-language',
    apiURL: 'https://stagingada.skynettechnologies.us/api/',    
    headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',        
    },
};*/

// Data will be populated from APIs.
let MOCK_VIDEOS = [];
let PLAN_PACKAGES = [];
let AIOA_LANGUAGES = {};

// Prevent multiple loaders from incorrectly hiding each other.
let activeApiRequests = 0;

// LOADER.
function createApiLoader() {
    if (document.getElementById('apiLoaderOverlay')) {
        return;
    }
    const loaderStyle = document.createElement('style');
    loaderStyle.id = 'apiLoaderStyles';
    loaderStyle.textContent = `
        #apiLoaderOverlay {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.82);
            backdrop-filter: blur(3px);
        }

        #apiLoaderOverlay.show {
            display: flex;
        }

        #apiLoaderOverlay .api-loader-card {
            min-width: 190px;
            padding: 24px;
            border-radius: 16px;
            background: #ffffff;
            box-shadow: 0 12px 35px rgba(0, 0, 0, 0.14);
            text-align: center;
            color: #420083;
            font-family: Inter, Arial, sans-serif;
            font-size: 14px;
            font-weight: 600;
        }

        #apiLoaderOverlay .api-loader-spinner {
            width: 38px;
            height: 38px;
            margin: 0 auto 12px;
            border: 4px solid #eee8f8;
            border-top-color: #420083;
            border-radius: 50%;
            animation: apiLoaderRotation 0.8s linear infinite;
        }

        @keyframes apiLoaderRotation {
            from {
                transform: rotate(0deg);
            }

            to {
                transform: rotate(360deg);
            }
        }
    `;
    document.head.appendChild(loaderStyle);
    const loader = document.createElement('div');
    loader.id = 'apiLoaderOverlay';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.setAttribute('aria-busy', 'true');

    loader.innerHTML = `
        <div class="api-loader-card">
            <div class="api-loader-spinner"></div>
            <div id="apiLoaderMessage">Loading data...</div>
        </div>
    `;
    document.body.appendChild(loader);
}

function showApiLoader(message = 'Loading data...') {
    createApiLoader();
    activeApiRequests += 1;
    const loader = document.getElementById('apiLoaderOverlay');
    const loaderMessage = document.getElementById('apiLoaderMessage');
    if (loaderMessage) {
        loaderMessage.textContent = message;
    }
    loader?.classList.add('show');
}

function hideApiLoader() {
    activeApiRequests = Math.max(0, activeApiRequests - 1);
    if (activeApiRequests === 0) {
        document.getElementById('apiLoaderOverlay')?.classList.remove('show');
    }
}

// ERROR MESSAGE.
function showApiError(message) {
    let errorElement = document.getElementById('apiErrorAlert');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.id = 'apiErrorAlert';
        errorElement.className = 'alert alert-danger position-fixed top-0 start-50 translate-middle-x mt-3 shadow';
        errorElement.style.zIndex = '99998';
        errorElement.style.maxWidth = '90%';
        document.body.appendChild(errorElement);
    }
    errorElement.textContent = message || 'Unable to load data. Please try again.';
    errorElement.style.display = 'block';
}

function clearApiError() {
    document.getElementById('apiErrorAlert')?.remove();
}

// API HELPERS,
async function fetchJson(url, loaderMessage) {
    showApiLoader(loaderMessage);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: API_CONFIG.headers,
            // Use "include" when cookies must also be sent cross-domain.
            credentials: 'same-origin',
        });
        if (!response.ok) {
            let serverMessage = '';
            try {
                const errorResponse = await response.json();
                serverMessage = errorResponse?.message || errorResponse?.error || '';
            } catch (_) {
                try {
                    serverMessage = await response.text();
                } catch (_) {
                    serverMessage = '';
                }
            }
            throw new Error(
                serverMessage || `API request failed with status ${response.status}.`,
            );
        }
        return await response.json();
    } catch (error) {
        console.error(`API request failed: ${url}`, error);
        throw error;
    } finally {
        hideApiLoader();
    }
}

/**
 * Supports responses such as:
 *
 * [...]
 * { data: [...] }
 * { videos: [...] }
 * { data: { videos: [...] } }
 * { result: { packages: [...] } }
 */
function extractArrayFromResponse(response, possibleKeys = []) {
    if (Array.isArray(response)) {
        return response;
    }
    if (!response || typeof response !== 'object') {
        return [];
    }
    for (const key of possibleKeys) {
        if (Array.isArray(response[key])) {
            return response[key];
        }
        if (
            response.data &&
            typeof response.data === 'object' &&
            Array.isArray(response.data[key])
        ) {
            return response.data[key];
        }
        if (
            response.result &&
            typeof response.result === 'object' &&
            Array.isArray(response.result[key])
        ) {
            return response.result[key];
        }
    }    
    if (Array.isArray(response.Data)) {
        return response.Data;
    }
    if (Array.isArray(response.result)) {
        return response.result;
    }
    if (Array.isArray(response.items)) {
        return response.items;
    }
    if (Array.isArray(response.records)) {
        return response.records;
    }
    return [];
}

// RESPONSE NORMALIZATION.
function normalizeVideo(video, index) {
    return {
        ...video,
        id:
            video.id ??
            video.video_id ??
            index + 1,
        title:
            video.title ??
            video.video_title ??
            video.name ??
            `Untitled Video`,
        video_url:
            video.video_url ??
            video.videoUrl ??
            video.embed_url ??
            video.embedUrl ??
            video.url ??
            '',
        total_duration: String(
            video.total_duration ??
            video.totalDuration ??
            video.duration ??
            video.duration_seconds ??
            0,
        ),
        language:
            video.language ??
            video.video_language ??
            video.lang ??
            'Unknown',
        created_at:
            video.created_at ??
            video.createdAt ??
            video.date ??
            '',
    };
}

function normalizePlan(plan, index) {    
    return {
        ...plan,
        id:
            plan.id ??
            plan.plan_id ??
            index + 1,
        name:
            plan.name ??
            plan.plan_name ??
            plan.title ??
            plan.package_name ??
            '',
        pages: Number(
            plan.pages ??
            plan.minutes ??
            plan.total_minutes ??
            plan.minute_limit ??
            plan.limit ??
            0,
        ),
        monthly_price: Number(
            plan.monthly_price ??
            plan.monthlyPrice ??
            plan.month_price ??
            plan.price_monthly ??
            0,
        ),
        price: Number(
            plan.price ??
            plan.yearly_price ??
            plan.yearlyPrice ??
            plan.annual_price ??
            0,
        ),
        interval:
            plan.interval ??
            plan.billing_interval ??
            'M',
        payment_link:
            plan.payment_link ??
            null,
    };
}

// FETCH VIDEOS.
async function fetchVideos(websiteUrl) {
    const normalizedWebsiteUrl = typeof websiteUrl === 'string' ? websiteUrl.trim() : '';
    if (!normalizedWebsiteUrl) {
        throw new Error('Website URL is required.');
    }
    showApiLoader('Loading videos...');
    try {
        const formData = new FormData();
        formData.append('website_url', normalizedWebsiteUrl);
        const response = await fetch(API_CONFIG.videosUrl, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
            },
            body: formData,
        });
        // Read the response as text first.
        const responseText = await response.text();
        /*console.log('Video API status:', response.status);
        console.log('Video API content type:', response.headers.get('content-type'));
        console.log('Video API raw response:', responseText);*/

        if (!response.ok) {
            throw new Error(
                `Video API failed with status ${response.status}. ` +
                responseText.substring(0, 300),
            );
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error(
                'The video API returned HTML instead of JSON. ' +
                `Response starts with: ${responseText.substring(0, 150)}`,
            );
        }
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (error) {
            throw new Error(
                `Invalid JSON returned by video API: ${responseText.substring(0, 150)}`,
            );
        }    
        const videos = extractArrayFromResponse(responseData, [
            'videos',
            'video_list',
            'videoList',
            'records',
            'items',
        ]);
        return [videos.map(normalizeVideo),responseData.adon_purchase_package];
    } catch (error) {
        console.error('Video API request failed:', error);
        throw error;
    } finally {
        hideApiLoader();
    }
}

// FETCH PLANS.
async function fetchPlanPackages() {
    const normalizedWebsiteUrl = typeof websiteUrl === 'string' ? websiteUrl.trim() : '';
    const formData = new FormData();
    formData.append('website_url', normalizedWebsiteUrl);
    const response = await fetch(API_CONFIG.planPackagesUrl, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
        },
        body: formData,
    });        
    /*const response = await fetchJson(
        API_CONFIG.planPackagesUrl,
        'Loading plans...',
    );*/
    const responseText = await response.text();
    let responseData;
    try {
        responseData = JSON.parse(responseText);
    } catch (error) {
        throw new Error(
            `Invalid JSON returned by video API: ${responseText.substring(0, 150)}`,
        );
    }   
    console.log('response',responseData);
    const plans = extractArrayFromResponse(responseData, [
        'plans',
        'packages',
        'plan_packages',
        'planPackages',
        'items',
    ]);
    //.map(normalizePlan).filter((plan) => plan.price > 0)
    return plans    
    .map(normalizePlan)
    .map((plan) => ({
        id: plan.id,
        name: plan.name,
        pages: plan.pages,
        monthly_price: plan.monthly_price,
        price: plan.price,
        interval: plan.interval,
        payment_link: plan.payment_link
    }));
}

async function fetchLanguages() {
    try {
        const response = await fetch(API_CONFIG.activeLanguages, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            }
        });
        // Read the response as text first.
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(
                `Video API failed with status ${response.status}. ` +
                responseText.substring(0, 300),
            );
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error(
                'The video API returned HTML instead of JSON. ' +
                `Response starts with: ${responseText.substring(0, 150)}`,
            );
        }
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (error) {
            throw new Error(
                `Invalid JSON returned by video API: ${responseText.substring(0, 150)}`,
            );
        }                            
        return responseData.Data;
    } catch (error) {
        console.error('Languages API request failed:', error);
        throw error;
    } 
}

// LOAD ALL INITIAL API DATA.
async function loadInitialData() {
    clearApiError();
    try {
        const [language_list,language_flag] = await Promise.all([
            fetchLanguages(),
            enableLanguageToggle()
        ]);                
        language_list.forEach(lang => {
            AIOA_LANGUAGES[lang.code] = lang.original_name;
        });
        const [videos_data, plans] = await Promise.all([
            fetchVideos(websiteUrl),
            fetchPlanPackages(),
        ]);
        videos = videos_data[0];
        Current_Package_Data = videos_data[1];            
        MOCK_VIDEOS = videos;
        PLAN_PACKAGES = plans;
        console.log(PLAN_PACKAGES);
        currentPlan = PLAN_PACKAGES.find(item => item.id === Current_Package_Data.package_price_id);        
        //console.log(currentPlan);
        totalMin = currentPlan?.pages ?? 0;
        return true;
    } catch (error) {
        MOCK_VIDEOS = [];
        PLAN_PACKAGES = [];
        currentPlan = null;
        totalMin = 0;
        showApiError(
            error?.message ||
            'Unable to load videos and plans.',
        );
        return false;
    }
}

// APP STATE.
let isPurchased = true;
let totalMin = 0;
let currentPlan = null;

// Analytics state.
let allVideos = [];
let filteredVideos = [];
let dateRange = {
    startDate: '',
    endDate: '',
};
let dateRangeLabel = 'Current';
let selectedLanguage = 'all';
let pieChartInstance = null;
// Custom range state.
let tempStartDate = '';
let tempEndDate = '';
let isCustomRange = false;
//let websiteUrl = 'happyscribe.com';
//let websiteUrl = 'aioademowebsite.mitiendanube.com'
let websiteUrl = document.getElementById('savs_website').value;
let savs_url_token = document.getElementById('savs_url_token').value;
// ---- DOM refs ----
const $ = (id) => document.getElementById(id);
const qs = (sel, ctx) => (ctx || document).querySelector(sel);
const qsa = (sel, ctx) => (ctx || document).querySelectorAll(sel);

// ---- Helpers ----
function extractYouTubeId(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }
    const patterns = [
        /youtube\.com\/embed\/([^?&/]+)/,
        /youtube\.com\/watch\?v=([^?&/]+)/,
        /youtu\.be\/([^?&/]+)/,
        /youtube\.com\/shorts\/([^?&/]+)/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }
    return null;
}

function getThumbnailUrl(id) {
    return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}

function parseDurationToSeconds(dur) {
    if (!dur) return 0;
    const n = Number(dur);
    if (!isNaN(n) && dur.trim() !== '') return n;
    const parts = dur.split(':').map(Number);
    if (parts.length === 2) {
        const [m, s] = parts;
        if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
    } else if (parts.length === 3) {
        const [h, m, s] = parts;
        if (!isNaN(h) && !isNaN(m) && !isNaN(s)) return h * 3600 + m * 60 + s;
    }
    const fb = parseInt(dur, 10);
    return isNaN(fb) ? 0 : fb;
}

function formatDuration(sec) {
    if (sec < 0) sec = 0;
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatMinSec(sec) {
    const s = sec < 0 ? 0 : sec;
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatDateDDMMYYYY(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    if (!y || !m || !d) return str;
    return `${d}/${m}/${y}`;
}

function getThisMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = now;
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
    };
}

function getLastMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
    };
}

function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffWeek = Math.floor(diffDay / 7);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffDay / 365);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHour < 24) return `${diffHour} ${diffHour === 1 ? 'Hour' : 'Hours'} ago`;
    if (diffDay < 7) return `${diffDay} ${diffDay === 1 ? 'Day' : 'Days'} ago`;
    if (diffWeek < 5) return `${diffWeek} ${diffWeek === 1 ? 'Week' : 'Weeks'} ago`;
    if (diffMonth < 12) return `${diffMonth} ${diffMonth === 1 ? 'Month' : 'Months'} ago`;
    return `${diffYear} ${diffYear === 1 ? 'Year' : 'Years'} ago`;
}

// PROCESS VIDEOS.
function processVideos(videos) {
    return videos.map((video, index) => {
        const videoId = extractYouTubeId(video.video_url);
        const duration = parseDurationToSeconds(
            video.total_duration,
        );
        const code = OLD_LANGUAGE_CODES[video.language] || video.language || "Unknown";
        const languageName = AIOA_LANGUAGES[code] || code;
        return {
            id: video.id ?? index,
            videoId,
            durationSec: duration,
            durationFormatted: formatDuration(duration),
            thumbnail: videoId ? getThumbnailUrl(videoId) : '',
            embedUrl: video.video_url,
            title: video.title || `Untitled Video`,
            language: video.language || 'Unknown',            
            languageName:languageName,
            createdAt: video.created_at || '',
        };
    });
}

// COMPUTE ANALYTICS
function computeAnalytics(videos, totalMin) {
    if (!videos.length) {
        return {
            totalVideos: 0,
            totalDurationFormatted: '0:00',
            totalDurationSeconds: 0,
            totalUsedMinutes: 0,
            averageDurationFormatted: '0:00',
            longestVideoTitle: '',
            longestVideoDuration: '0:00',
            remainingMinutes: totalMin,
            remainingSeconds: totalMin * 60,
            remainingDurationFormatted: formatDuration(totalMin * 60),
            percentageUsed: 0,
            isLowRemaining: false,
        };
    }
    const totalSec = videos.reduce((s, v) => s + v.durationSec, 0);
    const totalUsedMin = totalSec / 60;
    const avgSec = totalSec / videos.length;
    const longest = videos.reduce((a, b) => a.durationSec > b.durationSec ? a : b);
    const remSec = Math.max(0, totalMin * 60 - totalSec);
    const remMin = remSec / 60;
    const pct = totalMin > 0 ? (totalUsedMin / totalMin) * 100 : 0;
    const low = totalMin > 0 && remMin <= 2;

    return {
        totalVideos: videos.length,
        totalDurationFormatted: formatDuration(totalSec),
        totalDurationSeconds: totalSec,
        totalUsedMinutes: Math.round(totalUsedMin * 10) / 10,
        averageDurationFormatted: formatDuration(Math.round(avgSec)),
        longestVideoTitle: longest.title,
        longestVideoDuration: longest.durationFormatted,
        remainingMinutes: Math.round(remMin * 10) / 10,
        remainingSeconds: remSec,
        remainingDurationFormatted: formatDuration(remSec),
        percentageUsed: Math.round(pct),
        isLowRemaining: low,
    };
}

    // LANGUAGE STATS.    
    const OLD_LANGUAGE_CODES = {
        iw: "he", // Hebrew
        in: "id", // Indonesian
        ji: "yi", // Yiddish
        jw: "jv",  // Javanese        
        "hi-IN": "hi",
        "en-US": "en",
        "ja-JP":"ja",
        "pl-PL":"pl"
    };
    function getLanguageStats(videos) {                
        const map = new Map();  
        videos.forEach(v => {
            const code = OLD_LANGUAGE_CODES[v.language] || v.language || "Unknown";
            const name = AIOA_LANGUAGES[code] || code;
            if (!map.has(code)) {
                map.set(code, { code, name, count: 0 });
            }
            map.get(code).count++;
        });
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    // PIE COLORS.
    const PIE_COLORS = [
        '#C9BFFB', '#BEDBF8', '#C7F0D4', '#FCE7B0',
        '#B8AECB', '#D6AEE0', '#F6E1C0', '#F4C6C6', '#BEE9E4'
    ];

// RENDER FUNCTIONS.
function renderHeader(isPurchased, plan) {
    const container = $('headerRight');
    if (!container) {
        return;
    }
    if (isPurchased && plan) {
        const price = Number(plan.monthly_price || 0).toFixed(2);
        var priceHtml = `<span class="plan-price-badge">
                $${price} / Per Month
            </span>`;
        if(price<=0) {
            var priceHtml = `<span class="plan-price-badge">
                Free Plan
            </span>`;
        }
        container.innerHTML = priceHtml+`            
            <span
                class="badge badge-status"
                style="background-color:#1f5c21;color:#fff"
            >
                <i class="fas fa-check-circle me-1"></i>
                Active Status
            </span>
            <button
                class="btn btn-sm"
                id="upgradeBtn"
                style="
                    border-radius:10px;
                    font-weight:600;
                    background-color:#420083;
                    color:#fff;
                "
            >
                <i class="fas fa-arrow-up me-1"></i>
                Upgrade Plan
            </button>
            <span
                class="toggle-hint d-none"
                title="Double-click to toggle purchased state"
            >
                ⏺
            </span>
        `;
        $('upgradeBtn')?.addEventListener(
            'click',
            openUpgradeModal,
        );
        return;
    }

    container.innerHTML = `
        <span class="badge bg-secondary badge-status">
            Activate Now
        </span>
        <span
            class="toggle-hint d-none"
            title="Double-click to toggle purchased state"
        >
            ⏺
        </span>
    `;
}

function renderStatCards(analytics, totalMin) {
    $('statVideos').textContent = analytics.totalVideos;
    $('statTotalLimit').innerHTML = `${totalMin} <small style="font-size:14px;font-weight:400;">min</small>`;
    $('statSpent').textContent = analytics.totalDurationFormatted;
    $('statRemaining').textContent = formatMinSec(analytics.remainingSeconds);
    const badge = $('lowRemainingBadge');
    if (analytics.isLowRemaining && analytics.totalVideos > 0) {
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
}

function renderCircularProgress(percentage, totalSec, totalMin) {
    const container = $('circularContainer');
    const size = 180;
    const stroke = 20;
    const radius = (size - stroke) / 2;
    const circ = 2 * Math.PI * radius;
    const clamped = Math.min(100, Math.max(0, percentage));
    const offset = circ - (clamped / 100) * circ;
    const color = percentage >= 90 ? '#E74C3C' : percentage > 70 ? '#F39C12' : '#420083';

    container.innerHTML = `
        <div class="circular-progress">
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="#F1EEFF" stroke-width="${stroke}" />
                <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}"
                    stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"
                    style="transition:stroke-dashoffset 0.6s ease;" />
            </svg>
            <div class="center-text">
                <span class="pct">${clamped}%</span>
                <span class="label">Usage</span>
            </div>
        </div>
    `;
    const caption = $('usageCaption');
    const usedMin = Math.floor(totalSec / 60);
    const usedSec = Math.floor(totalSec % 60);
    caption.textContent = `${usedMin} min and ${usedSec} sec used out of ${totalMin} min`;
}

function renderPieChart(langStats) {
    const canvas = $('pieChart');
    const ctx = canvas.getContext('2d');

    if (pieChartInstance) {
        pieChartInstance.destroy();
        pieChartInstance = null;
    }

    if (!langStats.length) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#8A8DA6';
        ctx.font = '16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No language data', canvas.width / 2, canvas.height / 2);
        $('pieLegend').innerHTML = '';
        return;
    }

    const labels = langStats.map(d => d.name);
    const data = langStats.map(d => d.count);
    const colors = langStats.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]);

    pieChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: '#FFFFFF',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.label}: ${context.parsed} videos`;
                        }
                    }
                }
            }
        }
    });

    const legend = $('pieLegend');
    legend.innerHTML = langStats.map((d, i) => `
        <div class="d-flex align-items-center gap-2">
            <span class="legend-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]};"></span>
            <span style="font-size:13px;font-weight:500;">${d.name}</span>
        </div>
    `).join('');
}

function renderVideoGrid(videos) {
    const grid = $('videoGrid');
    const empty = $('emptyState');
    const badge = $('videoCountBadge');

    if (!videos.length) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        badge.textContent = '0 Videos';
        return;
    }
    empty.style.display = 'none';
    badge.textContent = `${videos.length} Videos`;

    grid.innerHTML = videos.map(v => `
        <div class="col-6 col-md-4 col-lg-3">
            <div class="video-card" data-embed="${v.embedUrl}">
                <div class="thumb-wrapper">
                    <img src="${v.thumbnail || 'https://placehold.co/640x360/e0dceb/8A8DA6?text=No+Preview'}" alt="${v.title}" loading="lazy" />
                    <div class="play-badge"><i class="fas fa-play" style="margin-left:2px;"></i></div>
                </div>
                <div class="card-body py-2 px-3">
                    <div class="fw-semibold" style="font-size:15px;">${v.title}</div>
                    <div class="d-flex align-items-center justify-content-between mt-1">
                        <span class="d-flex align-items-center gap-1" style="font-size:12px;">
                            <i class="far fa-clock" style="font-size:12px;"></i> ${v.durationFormatted}
                        </span>
                        ${v.languageName ? `<span style="font-size:12px;font-weight:500;">${v.languageName}</span>` : ''}
                    </div>
                    ${v.createdAt ? `<div class="mt-1" style="font-size:12px;color:var(--gray);">${formatTimeAgo(v.createdAt)}</div>` : ''}
                </div>
            </div>
        </div>
    `).join('');

    grid.querySelectorAll('.video-card').forEach(el => {
        el.addEventListener('click', function() {
            const embed = this.dataset.embed;
            openVideoModal(embed);
        });
    });
}

function openVideoModal(embedUrl) {
    const iframe = $('videoIframe');
    iframe.src = embedUrl;
    const modal = new bootstrap.Modal($('videoModal'));
    modal.show();
    $('videoModal').addEventListener('hidden.bs.modal', function() {
        iframe.src = '';
    }, { once: true });
}

// DATE RANGE DROPDOWN.
function buildDateDropdown() {
    const menu = $('dateDropdownMenu');
    const label = $('dateRangeLabel');
    const isCustom = isCustomRange;
    let html = '';
    if (!isCustom) {
        html += `
            <li><button class="dropdown-item" data-range="lastMonth">Last Month</button></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item" id="customRangeBtn">Custom Range</button></li>
            ${dateRangeLabel !== 'Current' ? `
                <li><hr class="dropdown-divider"></li>
                <li><button class="dropdown-item text-danger" id="clearRangeBtn">Clear</button></li>
            ` : ''}
        `;
    } else {
        const minDate = '2026-06-01';
        const maxDate = new Date().toISOString().split('T')[0];
        html += `
            <li>
                <div class="p-2">
                    <div class="fw-semibold mb-2">Custom Range</div>
                    <div class="mb-2">
                        <label class="small text-muted">Start Date</label>
                        <input type="date" id="customStart" class="form-control form-control-sm"
                            value="${tempStartDate}" min="${minDate}" max="${maxDate}" />
                    </div>
                    <div class="mb-3">
                        <label class="small text-muted">End Date</label>
                        <input type="date" id="customEnd" class="form-control form-control-sm"
                            value="${tempEndDate}" min="${minDate}" max="${maxDate}" />
                    </div>
                    <div class="d-flex gap-2">
                        <button class="btn btn-sm btn-primary" id="applyCustomRange">Apply</button>
                        <button class="btn btn-sm btn-outline-secondary" id="cancelCustomRange">Cancel</button>
                    </div>
                </div>
            </li>
        `;
    }
    menu.innerHTML = html;
    if (!isCustom) {
        menu.querySelectorAll('[data-range]').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                const range = this.dataset.range;
                if (range === 'lastMonth') {
                    const { start, end } = getLastMonth();
                    dateRange = { startDate: start, endDate: end };
                    dateRangeLabel = 'Last Month';
                    isCustomRange = false;
                    updateAnalytics();
                }
                bootstrap.Dropdown.getInstance($('dateDropdown')).hide();
            });
        });

        const customBtn = menu.querySelector('#customRangeBtn');
        if (customBtn) {
            customBtn.addEventListener('click', function(e) {
                e.preventDefault();
                isCustomRange = true;
                tempStartDate = dateRange.startDate || '';
                tempEndDate = dateRange.endDate || '';
                buildDateDropdown();
            });
        }
        const clearBtn = menu.querySelector('#clearRangeBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const { start, end } = getThisMonth();
                dateRange = { startDate: start, endDate: end };
                dateRangeLabel = 'Current';
                isCustomRange = false;
                updateAnalytics();
                bootstrap.Dropdown.getInstance($('dateDropdown')).hide();
            });
        }
    } else {
        const startInput = menu.querySelector('#customStart');
        const endInput = menu.querySelector('#customEnd');
        const applyBtn = menu.querySelector('#applyCustomRange');
        const cancelBtn = menu.querySelector('#cancelCustomRange');
        if (applyBtn) {
            applyBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const s = startInput.value;
                const e2 = endInput.value;
                if (s && e2) {
                    if (s > e2) {
                        alert('Start date cannot be after end date.');
                        return;
                    }
                    dateRange = { startDate: s, endDate: e2 };
                    dateRangeLabel = `${formatDateDDMMYYYY(s)} to ${formatDateDDMMYYYY(e2)}`;
                    isCustomRange = false;
                    updateAnalytics();
                    bootstrap.Dropdown.getInstance($('dateDropdown')).hide();
                }
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function(e) {
                e.preventDefault();
                isCustomRange = false;
                tempStartDate = '';
                tempEndDate = '';
                buildDateDropdown();
            });
        }
    }
    label.textContent = dateRangeLabel;
}

// LANGUAGE FILTER.
function buildLanguageFilter(langStats, totalVideos) {
    const sel = $('languageFilter');
    const allCount = totalVideos;
    let html = `<option value="all">All Languages (${allCount})</option>`;
    langStats.forEach(d => {
        html += `<option value="${d.code}">${d.name} (${d.count})</option>`;
    });
    sel.innerHTML = html;
    sel.value = selectedLanguage;
}
async function enableLanguageToggle(){
    const normalizedWebsiteUrl = typeof websiteUrl === 'string' ? websiteUrl.trim() : ''; 
    /*if (isChecked) {
        var video_widget_lang_enable = 1;
    } else {
        var video_widget_lang_enable = 0;
    }*/
    const formData = new FormData();
    formData.append('website_url', normalizedWebsiteUrl);
    
    const response = await fetch(API_CONFIG.apiURL+'video-subtitle/settings', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
        },
        body: formData,
    });        
    const responseText = await response.text();
    let responseData;
    try {
        responseData = JSON.parse(responseText);
    } catch (error) {
        throw new Error(
            `Invalid JSON returned by video API: ${responseText.substring(0, 150)}`,
        );
    }    
    const checkbox = $('lang-widget-toggle');
    if (responseData.video_widget_lang_enable == 0) {
        checkbox.checked = false;
    } else {
        checkbox.checked = true;
    }
    console.log(responseData.video_widget_lang_enable);
}

function updateLanguageToggle(isChecked) {   
    const normalizedWebsiteUrl = typeof websiteUrl === 'string' ? websiteUrl.trim() : ''; 
    if (isChecked) {
        var video_widget_lang_enable = 1;
    } else {
        var video_widget_lang_enable = 0;
    }
    const formData = new FormData();
    formData.append('website_url', normalizedWebsiteUrl);
    formData.append('video_widget_lang_enable', video_widget_lang_enable);        
    const response = fetch(API_CONFIG.apiURL+'video-subtitle/update-settings', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
        },
        body: formData,
    });        
    /*const responseText = response.text();
    console.log(video_widget_lang_enable,responseText);*/
}

// UPDATE ANALYTICS (dashboard).
function updateAnalytics() {
    // 1. Filter by date range
    let raw = MOCK_VIDEOS.filter(v => {
        if (!dateRange.startDate || !dateRange.endDate) return true;
        const created = v.created_at ? v.created_at.split('T')[0] : '';
        return created >= dateRange.startDate && created <= dateRange.endDate;
    });
    const processed = processVideos(raw);
    // 2. Language stats
    const langStats = getLanguageStats(processed);
    console.log('langStats',langStats);
    // 3. Apply language filter
    let filtered = processed;
    if (selectedLanguage !== 'all') {
        filtered = processed.filter(v => v.language === selectedLanguage);
    }
    // 4. Analytics
    const analytics = computeAnalytics(filtered, totalMin);
    // 5. Render
    renderStatCards(analytics, totalMin);
    renderCircularProgress(analytics.percentageUsed, analytics.totalDurationSeconds, totalMin);
    renderPieChart(langStats);
    renderVideoGrid(filtered);
    // 6. Quota alert
    const quotaAlert = $('quotaAlert');
    const isQuota = totalMin > 0 && analytics.totalUsedMinutes >= totalMin;
    quotaAlert.style.display = isQuota ? 'flex' : 'none';
    // 7. Language filter dropdown
    buildLanguageFilter(langStats, processed.length);
    // 8. Video count
    $('videoCountBadge').textContent = `${filtered.length} Videos`;
}

// UPGRADE MODAL (PlanSelectionModal)
// Format a monthly price without trailing ".00".
function formatPlanPrice(value) {
    const amount = Number(value || 0);
    return Number.isInteger(amount)
        ? String(amount)
        : amount.toFixed(2);
}

function openUpgradeModal() {
    const body = $('upgradeModalBody');
    const modalElement = $('upgradeModal');
    if (!body || !modalElement) {
        return;
    }
    if (!PLAN_PACKAGES.length) {
        body.innerHTML = `
            <div class="alert alert-warning mb-0">
                No upgrade plans are currently available.
            </div>
        `;
        new bootstrap.Modal(modalElement).show();
        return;
    }

    // Only offer plans larger than the current one.
    const upgradePlans = PLAN_PACKAGES.filter(
        (plan) => !(currentPlan && currentPlan.pages >= plan.pages),
    );

    if (!upgradePlans.length) {
        body.innerHTML = `
            <div class="alert alert-warning mb-0">
                To Upgrade Your Plan Please Contact us at "hello@skynettechnologies.com"
            </div>
        `;
        new bootstrap.Modal(modalElement).show();
        return;
    }

    body.innerHTML = `
        <div class="plan-option-list" id="upgradePlanOptions" role="radiogroup" aria-label="Available plans">
            ${upgradePlans.map((plan, index) => `
                <div
                    class="plan-option ${index === 0 ? 'selected' : ''}"
                    data-plan-id="${plan.id}"
                    role="radio"
                    aria-checked="${index === 0 ? 'true' : 'false'}"
                    tabindex="${index === 0 ? '0' : '-1'}"
                >
                    <span class="plan-radio"></span>
                    <div class="plan-info">
                        <div class="plan-name">${plan.name || `${plan.pages} Minutes Plan`}</div>
                        <p class="plan-desc">
                            Unlimited videos, up to
                            <strong>${plan.pages} Minutes</strong>
                            of total playback time
                        </p>
                    </div>
                    <span class="plan-amount">$${formatPlanPrice(plan.monthly_price)}/Month</span>
                </div>
            `).join('')}
        </div>
        <div class="text-center mt-4">
            <a
                href="#"
                id="upgradeSelectBtn"
                class="btn upgrade-select-btn"
                target="_blank"
                rel="noopener"
            >
                Select Plan
            </a>
        </div>
    `;

    const options = body.querySelectorAll('.plan-option');
    const selectBtn = $('upgradeSelectBtn');
    let selectedPlanId = String(upgradePlans[0].id);

    function syncSelectBtn() {
        const plan = PLAN_PACKAGES.find(
            (item) => String(item.id) === selectedPlanId,
        );
        if (plan && plan.payment_link) {
            selectBtn.setAttribute('href', plan.payment_link);
            selectBtn.classList.remove('disabled');
        } else {
            selectBtn.setAttribute('href', '#');
            selectBtn.classList.add('disabled');
        }
    }

    options.forEach((option) => {
        const selectOption = () => {
            options.forEach((other) => {
                other.classList.remove('selected');
                other.setAttribute('aria-checked', 'false');
                other.setAttribute('tabindex', '-1');
            });
            option.classList.add('selected');
            option.setAttribute('aria-checked', 'true');
            option.setAttribute('tabindex', '0');
            option.focus();
            selectedPlanId = String(option.dataset.planId);
            syncSelectBtn();
        };
        option.addEventListener('click', selectOption);
        option.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectOption();
            }
        });
    });

    // Block navigation when the selected plan has no payment link.
    selectBtn.addEventListener('click', (event) => {
        if (
            selectBtn.classList.contains('disabled') ||
            selectBtn.getAttribute('href') === '#'
        ) {
            event.preventDefault();
            showApiError('No payment link is available for this plan.');
        }
    });

    syncSelectBtn();
    new bootstrap.Modal(modalElement).show();
}


// RENDER APP (dashboard is always shown; plan selection screen removed).
function renderApp() {
    const dashboard = $('analyticsDashboard');
    if (!dashboard) {
        return;
    }
    dashboard.style.display = 'block';
    renderHeader(isPurchased, currentPlan);
    updateAnalytics();
}

// INIT.
document.addEventListener(
    'DOMContentLoaded',
    async function () {
        createApiLoader();
        // Loader appears before both API requests.
        await loadInitialData();
        const currentMonth = getThisMonth();
        dateRange = {
            startDate: currentMonth.start,
            endDate: currentMonth.end,
        };
        dateRangeLabel = 'Current';
        isCustomRange = false;
        enableLanguageToggle();
        buildDateDropdown();
        $('lang-widget-toggle')?.addEventListener('change', function () {
            const isChecked = this.checked;
            console.log(isChecked); // true or false
            updateLanguageToggle(isChecked);
        });
        $('languageFilter')?.addEventListener(
            'change',
            function () {
                selectedLanguage = this.value;
                updateAnalytics();
            },
        );

        window.togglePurchase =
            function () {
                isPurchased =
                    !isPurchased;

                if (
                    isPurchased &&
                    !currentPlan
                ) {
                    currentPlan =
                        PLAN_PACKAGES[0] ??
                        null;

                    totalMin =
                        currentPlan?.pages ??
                        0;
                }
                renderApp();
                buildDateDropdown();
            };

        // Call reloadDashboardData() to reload both APIs manually.
        window.reloadDashboardData =
            async function () {
                clearApiError();
                await loadInitialData();
                renderApp();
                buildDateDropdown();
            };
        renderApp();
        $('dateDropdown')?.addEventListener(
            'show.bs.dropdown',
            function () {
                buildDateDropdown();
            },
        );
        let resizeTimer;
        window.addEventListener(
            'resize',
            function () {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(
                    function () {
                        pieChartInstance
                            ?.resize();
                    },
                    200,
                );
            },
        );
    },
);
