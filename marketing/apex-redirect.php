<?php
// Drop this file in as index.php at the DOCUMENT ROOT of the apex domain
// (aspireitech.net's public_html) - NOT inside marketing/. It just 301s
// every request straight to the real marketing site on the iam subdomain, so
// typing the bare domain still gets someone to the product instead of a
// blank/empty site.
//
// This keeps the apex free to become a real "Aspire iTECH Solutions" company
// site later without migrating any product content off it first - remove
// this one file and put a real site there whenever that's ready.
$target = 'https://iam.aspireitech.net' . $_SERVER['REQUEST_URI'];
header('Location: ' . $target, true, 301);
exit;
