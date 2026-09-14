<?php
// Build-time only: public HTML must not advertise services absent from the static host.
add_filter('show_admin_bar', '__return_false');
add_filter('comments_open', '__return_false');
add_filter('pings_open', '__return_false');
add_action('pre_get_posts', function ($query) { if (!is_admin()) $query->set('has_password', false); });
add_filter('get_next_post_where', function ($where) { return $where . " AND p.post_password = ''"; });
add_filter('get_previous_post_where', function ($where) { return $where . " AND p.post_password = ''"; });
add_action('after_setup_theme', function () {
    remove_action('wp_head', 'rest_output_link_wp_head');
    remove_action('wp_head', 'wp_oembed_add_discovery_links');
    remove_action('wp_head', 'wp_shortlink_wp_head');
    remove_action('wp_head', 'rsd_link');
    remove_action('wp_head', 'wlwmanifest_link');
    remove_action('wp_head', 'feed_links', 2);
    remove_action('wp_head', 'feed_links_extra', 3);
});
