<?php
// SPDX-License-Identifier: Apache-2.0
declare(strict_types=1);

$statePath = getenv('TUTORIALX_FIXTURE_STATE') ?: '';
$fixtureToken = getenv('TUTORIALX_FIXTURE_TOKEN') ?: '';
if ($statePath === '' || $fixtureToken === '') {
    http_response_code(500);
    echo "Fixture state and token are required.\n";
    return;
}
$GLOBALS['tutorialx_fixture_state_path'] = $statePath;

function fixture_read(): array {
    $path = $GLOBALS['tutorialx_fixture_state_path'];
    if (!is_file($path)) return [];
    $value = json_decode((string)file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
    return is_array($value) ? $value : [];
}
function fixture_write(array $state): void {
    $path = $GLOBALS['tutorialx_fixture_state_path'];
    $temporary = $path . '.tmp';
    file_put_contents($temporary, json_encode($state, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
    rename($temporary, $path);
}
function get_option(string $name, mixed $default = false): mixed {
    $state = fixture_read();
    return $state[$name] ?? $default;
}
function update_option(string $name, mixed $value, bool $autoload = false): bool {
    $state = fixture_read();
    $state[$name] = $value;
    fixture_write($state);
    return true;
}
function delete_option(string $name): bool {
    $state = fixture_read();
    unset($state[$name]);
    fixture_write($state);
    return true;
}
function add_action(string $hook, callable $callback): void {}
function register_setting(string $group, string $name, array $args): void {}

require __DIR__ . '/tutorialx-fixture.php';
if (get_option('tutorialx_fixture_settings', null) === null) tutorialx_fixture_setup();

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
header('Cache-Control: no-store');

if ($path === '/api/state' && $method === 'GET') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(get_option('tutorialx_fixture_settings', tutorialx_fixture_defaults()), JSON_THROW_ON_ERROR) . "\n";
    return;
}
if ($path === '/__fixture/reset' && $method === 'POST') {
    if (($_SERVER['HTTP_AUTHORIZATION'] ?? '') !== 'Bearer ' . $fixtureToken) {
        http_response_code(403);
        echo "Fixture token required.\n";
        return;
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(tutorialx_fixture_reset(), JSON_THROW_ON_ERROR) . "\n";
    return;
}

$adminPath = '/wp-admin/options-general.php';
if ($path !== $adminPath) {
    http_response_code(404);
    echo "Not found.\n";
    return;
}

$error = null;
if ($method === 'POST') {
    try {
        tutorialx_fixture_update([
            'site_title' => $_POST['site_title'] ?? '',
            'accent' => $_POST['accent'] ?? '',
        ]);
        header('Location: ' . $adminPath . '?page=tutorialx-fixture&saved=1', true, 303);
        return;
    } catch (InvalidArgumentException $exception) {
        http_response_code(422);
        $error = $exception->getMessage();
    }
}

$settings = get_option('tutorialx_fixture_settings', tutorialx_fixture_defaults());
$escape = static fn(mixed $value): string => htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$saved = isset($_GET['saved']);
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>TutorialX WordPress fixture</title></head>
<body><main><h1>TutorialX plugin settings</h1>
<?php if ($saved): ?><p role="status">Plugin settings saved.</p><?php endif; ?>
<?php if ($error !== null): ?><p role="alert"><?= $escape($error) ?></p><?php endif; ?>
<form method="post" action="<?= $adminPath ?>?page=tutorialx-fixture">
<label>Site title <input data-testid="wp-site-title" name="site_title" value="<?= $escape($settings['site_title']) ?>"></label>
<label>Accent color <input data-testid="wp-accent" name="accent" value="<?= $escape($settings['accent']) ?>"></label>
<button type="submit">Save plugin settings</button>
</form></main></body></html>
