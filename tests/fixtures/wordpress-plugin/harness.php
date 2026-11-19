<?php
// SPDX-License-Identifier: Apache-2.0
$statePath = $argv[1] ?? '';
$command = $argv[2] ?? '';
if ($statePath === '' || $command === '') {
    fwrite(STDERR, "Usage: php harness.php <state.json> <setup|update|show|reset> [json]\n");
    exit(2);
}
$GLOBALS['tutorialx_fixture_state_path'] = $statePath;
function fixture_read(): array {
    $path = $GLOBALS['tutorialx_fixture_state_path'];
    if (!is_file($path)) return [];
    $value = json_decode((string)file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
    return is_array($value) ? $value : [];
}
function get_option(string $name, mixed $default = false): mixed {
    $state = fixture_read();
    return $state[$name] ?? $default;
}
function update_option(string $name, mixed $value, bool $autoload = false): bool {
    $state = fixture_read();
    $state[$name] = $value;
    file_put_contents($GLOBALS['tutorialx_fixture_state_path'], json_encode($state, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
    return true;
}
function delete_option(string $name): bool {
    $state = fixture_read();
    unset($state[$name]);
    file_put_contents($GLOBALS['tutorialx_fixture_state_path'], json_encode($state, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
    return true;
}
function add_action(string $hook, callable $callback): void {}
function register_setting(string $group, string $name, array $args): void {}
require __DIR__ . '/tutorialx-fixture.php';

try {
    $result = match ($command) {
        'setup' => tutorialx_fixture_setup(),
        'reset' => tutorialx_fixture_reset(),
        'show' => get_option('tutorialx_fixture_settings', tutorialx_fixture_defaults()),
        'update' => tutorialx_fixture_update(json_decode($argv[3] ?? '{}', true, 32, JSON_THROW_ON_ERROR)),
        default => throw new InvalidArgumentException('Unknown harness command.'),
    };
    fwrite(STDOUT, json_encode($result, JSON_THROW_ON_ERROR) . "\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(2);
}
