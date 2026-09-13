<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

$config = require __DIR__ . '/../config.php';

function respond(int $status, array $payload) {
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Method not allowed']);
}

// Honeypot: a real visitor never sees or fills this field (hidden via CSS in
// index.php). A generic bot form-filler often does. Pretend success without
// touching the database, so a bot's script doesn't learn the honeypot worked.
if (!empty($_POST['website'] ?? '')) {
    respond(200, ['ok' => true, 'demo_url' => $config['demo_url']]);
}

$name = trim((string)($_POST['name'] ?? ''));
$email = trim((string)($_POST['email'] ?? ''));
$company = trim((string)($_POST['company'] ?? ''));
$companySize = trim((string)($_POST['company_size'] ?? ''));
$phone = trim((string)($_POST['phone'] ?? ''));
$message = trim((string)($_POST['message'] ?? ''));

if ($name === '' || mb_strlen($name) > 120) {
    respond(400, ['ok' => false, 'error' => 'Please enter your name.']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
    respond(400, ['ok' => false, 'error' => 'Please enter a valid work email.']);
}
if ($company === '' || mb_strlen($company) > 160) {
    respond(400, ['ok' => false, 'error' => 'Please enter your company name.']);
}
if (mb_strlen($companySize) > 40 || mb_strlen($phone) > 40 || mb_strlen($message) > 500) {
    respond(400, ['ok' => false, 'error' => 'One of the fields is too long.']);
}

$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$userAgent = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);

try {
    $pdo = new PDO(
        sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $config['db']['host'], $config['db']['name']),
        $config['db']['user'],
        $config['db']['pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    error_log('[leads] DB connection failed: ' . $e->getMessage());
    respond(500, ['ok' => false, 'error' => 'Something went wrong. Please try again shortly.']);
}

// Fixed-window rate limit per IP (1 hour, 5 submissions) - generous for a real
// visitor, tight enough to blunt a scripted flood. Mirrors the same
// fixed-window pattern collector/src/server.js already uses for its own API.
$pdo->exec('DELETE FROM lead_rate_limit WHERE window_start < (NOW() - INTERVAL 1 HOUR)');
$check = $pdo->prepare('SELECT submit_count FROM lead_rate_limit WHERE ip_address = ?');
$check->execute([$ip]);
$existing = $check->fetchColumn();
if ($existing !== false && (int)$existing >= 5) {
    respond(429, ['ok' => false, 'error' => 'Too many requests. Please try again later.']);
}
$pdo->prepare(
    'INSERT INTO lead_rate_limit (ip_address, submit_count, window_start) VALUES (?, 1, NOW())
     ON DUPLICATE KEY UPDATE submit_count = submit_count + 1'
)->execute([$ip]);

$insert = $pdo->prepare(
    'INSERT INTO leads (name, email, company, company_size, phone, message, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
$insert->execute([
    $name, $email, $company,
    $companySize !== '' ? $companySize : null,
    $phone !== '' ? $phone : null,
    $message !== '' ? $message : null,
    $ip, $userAgent,
]);

if (!empty($config['notify_email'])) {
    $subject = 'New IAM Intelligence demo lead: ' . $company;
    $body = "Name: $name\nEmail: $email\nCompany: $company\nCompany size: $companySize\nPhone: $phone\nMessage: $message\nIP: $ip\n";
    $headers = 'From: ' . $config['from_email'];
    // Best-effort only - the lead is already safely in MySQL regardless of
    // whether this succeeds. @ suppresses the warning if the host's mail
    // sender isn't configured; that's a hosting setting to fix in hPanel, not
    // something this script should fail the request over.
    @mail($config['notify_email'], $subject, $body, $headers);
}

respond(200, ['ok' => true, 'demo_url' => $config['demo_url']]);
