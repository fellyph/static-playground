import { php } from './runtime.mjs';

// Site-specific legacy migration; never run by the reusable action.
export async function migrateSouthbound(runtime) {
  if (await php(runtime, 'echo get_stylesheet();') !== 'southbound') throw new Error('The checkpoint must use the Southbound theme.');
  console.log(await php(runtime, `
    $id = (int) get_option('page_on_front');
    $page = get_post($id);
    if ($page && hash('sha256', $page->post_content) === '46c1c49e11a707217848e28d65480fd0268c437893baf5df9569730f046af71d') {
      wp_save_post_revision($id);
      $updated = wp_update_post(array('ID' => $id, 'post_content' => ''), true);
      if (is_wp_error($updated)) throw new Exception($updated->get_error_message());
      echo 'Moved the original homepage layout to the Front Page template; retained its revision.';
    } elseif ($page && trim($page->post_content) !== '') {
      throw new Exception('The homepage has custom content. Review its migration before syncing this theme.');
    } else {
      echo 'Homepage layout already uses the Front Page template.';
    }
  `));
}
