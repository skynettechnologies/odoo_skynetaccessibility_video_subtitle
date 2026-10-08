# -*- coding: utf-8 -*-
{
    'name': 'SkynetAccessibility Video Subtitle',
    'summary': 'Publish Captioned Video Content with AI-Powered Subtitles',
    'description': "",
    'version': '1.0.0',
    'category': 'Website',
    'author': 'Skynet Technologies USA LLC',
    'website': 'https://www.skynettechnologies.com',
    'support': 'hello@skynettechnologies.com',
    'license': 'LGPL-3',
    'depends': ['base', 'web', 'website'],
    'data': [
        'templates/website_widget_template.xml',
        'views/video_subtitle_menu.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'odoo_skynetaccessibility_video_subtitle/static/src/client/dashboard_action.js',
        ],
    },
    'images': ['static/description/banner.jpg'],
    'installable': True,
    'application': True,
    'auto_install': False,
}
