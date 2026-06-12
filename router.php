<?php

// Router für den PHP-Entwicklungsserver: php -S localhost:8000 router.php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path !== '/' && is_file(__DIR__ . $path)) {
    return false;
}
require __DIR__ . '/index.html';
