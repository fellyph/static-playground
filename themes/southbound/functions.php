<?php
/**
 * Southbound theme setup and shared editor/front-end assets.
 */
add_action('after_setup_theme', function () {
    add_theme_support('editor-styles');
    add_theme_support('responsive-embeds');
    add_editor_style(['style.css', 'editor.css']);
});

add_action('wp_enqueue_scripts', function () {
    $version = wp_get_theme()->get('Version');
    wp_enqueue_style('southbound', get_stylesheet_uri(), [], $version);
    wp_enqueue_script('southbound-hero-scroll', get_theme_file_uri('hero-scroll.js'), [], $version, [
        'strategy' => 'defer',
        'in_footer' => true,
    ]);
});
