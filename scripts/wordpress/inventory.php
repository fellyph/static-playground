<?php
require '/wordpress/wp-load.php';
if (is_multisite()) throw new Exception('Multisite is outside v1.');
if (!get_option('permalink_structure')) throw new Exception('Enable pretty permalinks before exporting.');
$routes = array();
function add_route($url) {
    global $routes;
    if (is_wp_error($url)) throw new Exception($url->get_error_message());
    $path = wp_parse_url($url, PHP_URL_PATH) ?: '/';
    if (wp_parse_url($url, PHP_URL_QUERY)) throw new Exception('Query-string permalinks are unsupported: ' . $path);
    $routes[$path] = true;
}
function add_query_pages($url, $args) {
    add_route($url);
    $query = new WP_Query(array_merge(array('post_status' => 'publish', 'has_password' => false, 'posts_per_page' => get_option('posts_per_page')), $args));
    for ($page = 2; $page <= $query->max_num_pages; $page++) add_route(trailingslashit($url) . 'page/' . $page . '/');
}
add_route(home_url('/'));
$front = (int) get_option('page_on_front');
$blog = (int) get_option('page_for_posts');
if (get_option('show_on_front') === 'posts') add_query_pages(home_url('/'), array('post_type' => 'post'));
elseif ($blog) add_query_pages(get_permalink($blog), array('post_type' => 'post'));
$types = get_post_types(array('public' => true));
unset($types['attachment']);
$posts = get_posts(array('post_type' => array_values($types), 'post_status' => 'publish', 'has_password' => false, 'numberposts' => -1));
$authors = array(); $years = array(); $months = array(); $days = array();
foreach ($posts as $post) {
    add_route(get_permalink($post));
    $segments = substr_count($post->post_content, '<!--nextpage-->') + 1;
    for ($page = 2; $page <= $segments; $page++) add_route(trailingslashit(get_permalink($post)) . $page . '/');
    if ($post->post_type === 'post') {
        $authors[$post->post_author] = true;
        $years[substr($post->post_date, 0, 4)] = true;
        $months[substr($post->post_date, 0, 7)] = true;
        $days[substr($post->post_date, 0, 10)] = true;
    }
}
foreach ($types as $type) {
    $obj = get_post_type_object($type);
    if ($obj->has_archive) add_query_pages(get_post_type_archive_link($type), array('post_type' => $type));
}
foreach (get_taxonomies(array('public' => true)) as $taxonomy) {
    $terms = get_terms(array('taxonomy' => $taxonomy, 'hide_empty' => true));
    if (is_wp_error($terms)) throw new Exception($terms->get_error_message());
    foreach ($terms as $term) add_query_pages(get_term_link($term), array('post_type' => array_values($types), 'tax_query' => array(array('taxonomy' => $taxonomy, 'field' => 'term_id', 'terms' => $term->term_id))));
}
foreach (array_keys($authors) as $author) if (get_userdata($author)) add_query_pages(get_author_posts_url($author), array('author' => $author));
foreach (array_keys($years) as $year) add_query_pages(get_year_link($year), array('year' => $year));
foreach (array_keys($months) as $month) { list($y, $m) = explode('-', $month); add_query_pages(get_month_link($y, $m), array('year' => $y, 'monthnum' => $m)); }
foreach (array_keys($days) as $day) { list($y, $m, $d) = explode('-', $day); add_query_pages(get_day_link($y, $m, $d), array('year' => $y, 'monthnum' => $m, 'day' => $d)); }
$paths = array_keys($routes); sort($paths);
echo wp_json_encode($paths);
