/** @odoo-module **/
/*
 * Client action that hosts the SkynetAccessibility Video Subtitle dashboard
 * inside the Odoo backend (URL: /odoo/skynetaccessibility_video_subtitle_dashboard).
 *
 * Same approach as the SkynetA11y PDF Remediation module: the dashboard page
 * is fetched as text and loaded into an iframe through `srcdoc`. Files of
 * imported (zip) modules are served as attachments with
 * `Content-Security-Policy: default-src 'none'`, so the page could not load
 * its own CSS/JS if it were opened directly; a srcdoc document takes the CSP
 * of this Odoo page instead.
 */
import { Component, onMounted, useProps, xml } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

const MODULE = "odoo_skynetaccessibility_video_subtitle";
const SERVER_ACTION = `${MODULE}.action_skynet_vs_dashboard`;
const PAGE_URL = `/${MODULE}/static/dashboard.html?v=20.0.1.2.0`;

/** Makes a value safe to place inside an inline <script> block. */
function scriptSafeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

class VideoSubtitleDashboard extends Component {
    static template = xml`
        <div class="o_action o_skynet_vs_dashboard h-100">
            <iframe class="o_skynet_vs_frame w-100 h-100 border-0" title="SkynetAccessibility Video Subtitle"/>
        </div>`;

    props = useProps();

    setup() {
        this.actionService = useService("action");
        onMounted(() => this.load());
    }

    async load() {
        const params = (this.props.action && this.props.action.params) || {};
        if (!params.config) {
            // Opened without settings (page reload, bookmarked URL, back button):
            // run the menu's server action again, which supplies them.
            return this.actionService.doAction(SERVER_ACTION, { clearBreadcrumbs: true });
        }
        // The iframe's own location is about:srcdoc, so give api.js the Odoo host.
        const config = { ...params.config, hostDomain: window.location.hostname };
        const response = await fetch(PAGE_URL, { credentials: "same-origin" });
        if (!response.ok) {
            throw new Error(`Could not load the Video Subtitle page (HTTP ${response.status}).`);
        }
        let html = await response.text();
        // api.js reads window.SkynetVideoSubtitleConfig before it does anything else.
        const inject = `<script>window.SkynetVideoSubtitleConfig = ${scriptSafeJson(config)};</script>`;
        html = html.replace("</head>", `${inject}</head>`);
        const frame = document.querySelector("iframe.o_skynet_vs_frame");
        if (frame) {
            frame.srcdoc = html;
        }
    }
}

registry.category("actions").add("skynetaccessibility_video_subtitle_dashboard", VideoSubtitleDashboard);
