<?php
require '/wordpress/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
wp_set_current_user(1);
foreach (get_posts(array('post_type' => 'any', 'post_status' => 'any', 'numberposts' => -1)) as $p) wp_delete_post($p->ID, true);
switch_theme('twentytwentyfive');
update_option('blogname', 'Playground Field Notes');
update_option('blogdescription', 'Edited in WordPress. Published as static files.');
update_option('permalink_structure', '/%postname%/');
update_option('posts_per_page', 2);
$image = media_handle_sideload(array('name' => 'field-notes.png', 'tmp_name' => '/tmp/fixture.png'), 0);
if (is_wp_error($image)) throw new Exception($image->get_error_message() . ' Fixture diagnostics: ' . wp_json_encode(array('mime' => wp_get_image_mime('/tmp/fixture.png'), 'check' => wp_check_filetype_and_ext('/tmp/fixture.png', 'field-notes.png'), 'size' => filesize('/tmp/fixture.png'), 'header' => bin2hex(file_get_contents('/tmp/fixture.png', false, null, 0, 8)), 'pngAllowed' => get_allowed_mime_types()['png'] ?? null)));
$picture = '<!-- wp:image {"id":' . $image . ',"sizeSlug":"large"} --><figure class="wp-block-image size-large">' . wp_get_attachment_image($image, 'large') . '</figure><!-- /wp:image -->';
$home = wp_insert_post(array('post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Home', 'post_content' => '<!-- wp:heading {"level":1} --><h1 class="wp-block-heading">A local place to create.</h1><!-- /wp:heading --><!-- wp:paragraph --><p>This design and its content travel together in a Playground checkpoint.</p><!-- /wp:paragraph -->' . $picture));
$about = wp_insert_post(array('post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'About', 'post_content' => '<!-- wp:paragraph --><p>A small publishing experiment built with WordPress Playground.</p><!-- /wp:paragraph -->'));
wp_insert_post(array('post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Our process', 'post_parent' => $about, 'post_content' => '<!-- wp:paragraph --><p>Edit, save, build, publish, and restore.</p><!-- /wp:paragraph -->'));
$blog = wp_insert_post(array('post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Journal'));
update_option('show_on_front', 'page'); update_option('page_on_front', $home); update_option('page_for_posts', $blog);
$category = wp_insert_term('Dispatches', 'category');
for ($i = 1; $i <= 5; $i++) {
  wp_insert_post(array('post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Field note ' . $i, 'post_name' => 'field-note-' . $i, 'post_date' => '2025-06-10 12:00:00', 'post_category' => array($category['term_id']), 'post_content' => '<!-- wp:paragraph --><p>Dispatch ' . $i . ': a published entry that remains editable after restoration.</p><!-- /wp:paragraph -->' . $picture));
}
wp_insert_post(array('post_type' => 'post', 'post_status' => 'draft', 'post_title' => 'Secret draft marker', 'post_content' => 'NEVER_PUBLISH_DRAFT_915'));
wp_insert_post(array('post_type' => 'post', 'post_status' => 'private', 'post_title' => 'Private marker', 'post_content' => 'NEVER_PUBLISH_PRIVATE_915'));
wp_insert_post(array('post_type' => 'post', 'post_status' => 'publish', 'post_password' => 'protected', 'post_title' => 'Protected marker', 'post_content' => 'NEVER_PUBLISH_PROTECTED_915'));
$styles = WP_Theme_JSON_Resolver::get_user_global_styles_post_id();
wp_update_post(array('ID' => $styles, 'post_content' => wp_json_encode(array('version' => 3, 'isGlobalStylesUserThemeJSON' => true, 'styles' => array('color' => array('background' => '#f4f0e7', 'text' => '#173e45'), 'typography' => array('fontFamily' => 'Arial, sans-serif'), 'elements' => array('link' => array('color' => array('text' => '#185a65'))))))));
// Store template overrides in the DB, exactly as the Site Editor does.
$nav = '<!-- wp:navigation {"overlayMenu":"mobile"} --><!-- wp:navigation-link {"label":"Home","url":"' . home_url('/') . '"} /--><!-- wp:navigation-link {"label":"About","url":"' . get_permalink($about) . '"} /--><!-- wp:navigation-link {"label":"Journal","url":"' . get_permalink($blog) . '"} /--><!-- /wp:navigation -->';
$header = '<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between"},"style":{"spacing":{"padding":{"top":"24px","bottom":"24px"}}}} --><div class="wp-block-group" style="padding-top:24px;padding-bottom:24px"><!-- wp:site-title /-->' . $nav . '</div><!-- /wp:group -->';
$footer = '<!-- wp:paragraph --><p>Field Notes · Made with WordPress Playground</p><!-- /wp:paragraph -->';
foreach (array('header' => $header, 'footer' => $footer) as $slug => $content) {
  $part = wp_insert_post(array('post_type' => 'wp_template_part', 'post_status' => 'publish', 'post_name' => $slug, 'post_title' => ucfirst($slug), 'post_content' => $content));
  wp_set_object_terms($part, 'twentytwentyfive', 'wp_theme');
}
flush_rewrite_rules();
echo 'Fixture created';
