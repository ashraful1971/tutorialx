<?php
/**
 * Plugin Name: TutorialX Capture Fixture
 * Description: Licensed deterministic settings fixture for TutorialX capture tests.
 * Version: 1.0.0
 * License: Apache-2.0
 * SPDX-License-Identifier: Apache-2.0
 */

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}

function tutorialx_fixture_defaults(): array {
    return ['site_title' => 'TutorialX WordPress Demo', 'accent' => '#176bff', 'revision' => 1];
}

function tutorialx_fixture_normalize(array $input, ?array $current = null): array {
    $current = $current ?? tutorialx_fixture_defaults();
    $title = trim((string)($input['site_title'] ?? ''));
    $accent = strtolower(trim((string)($input['accent'] ?? '')));
    if ($title === '' || strlen($title) > 80 || !preg_match('/^#[a-f0-9]{6}$/', $accent)) {
        throw new InvalidArgumentException('Invalid TutorialX fixture settings.');
    }
    return ['site_title' => $title, 'accent' => $accent, 'revision' => ((int)$current['revision']) + 1];
}

function tutorialx_fixture_setup(): array {
    $state = tutorialx_fixture_defaults();
    update_option('tutorialx_fixture_settings', $state, false);
    return $state;
}

function tutorialx_fixture_reset(): array {
    delete_option('tutorialx_fixture_settings');
    return tutorialx_fixture_setup();
}

function tutorialx_fixture_update(array $input): array {
    $current = get_option('tutorialx_fixture_settings', tutorialx_fixture_defaults());
    $state = tutorialx_fixture_normalize($input, is_array($current) ? $current : null);
    update_option('tutorialx_fixture_settings', $state, false);
    return $state;
}

if (function_exists('add_action')) {
    add_action('admin_init', function (): void {
        register_setting('tutorialx_fixture', 'tutorialx_fixture_settings', [
            'type' => 'object',
            'sanitize_callback' => 'tutorialx_fixture_normalize',
            'default' => tutorialx_fixture_defaults(),
        ]);
    });
}
